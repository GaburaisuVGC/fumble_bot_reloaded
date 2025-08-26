import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import Tournament from '../models/Tournament.js';
import Match from '../models/Match.js';
import PlayerStats from '../models/PlayerStats.js';
import User from '../models/User.js'; // Still needed for some direct User operations and types
import { formatMatchId, shuffleArray } from '../utils/tournamentUtils.js';
import { updateUserRankPeakLow, findOrCreateUser } from '../utils/userUtils.js';
import mongoose from 'mongoose';

export const data = new SlashCommandBuilder()
    .setName('validate')
    .setDescription('Validates the current round, calculates standings, and proceeds to the next stage.')
    .addStringOption(option =>
        option.setName('tournamentid')
            .setDescription('The ID of the tournament to validate.')
            .setRequired(true));

export async function execute(interaction) {
    await interaction.deferReply({ ephemeral: false }); // Public response, potentially long

    const tournamentIdInput = interaction.options.getString('tournamentid').toUpperCase();
    const userId = interaction.user.id;
    const userTag = interaction.user.tag;

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        // Ensure the validating user (organizer) exists
        await findOrCreateUser(userId, userTag, session);

        const tournament = await Tournament.findOne({ tournamentId: tournamentIdInput })
            .populate('participants') // Assuming 'participants' field in Tournament has refs or basic info
            .session(session);

        if (!tournament) {
            await interaction.editReply(`Tournament with ID \`${tournamentIdInput}\` not found.`);
            await session.abortTransaction();
            session.endSession();
            return;
        }

        if (tournament.organizerId !== userId) {
            await interaction.editReply('Only the tournament organizer can validate rounds.');
            await session.abortTransaction();
            session.endSession();
            return;
        }

        if (tournament.status !== 'active') {
            await interaction.editReply(`This tournament is not active. Current status: ${tournament.status}.`);
            await session.abortTransaction();
            session.endSession();
            return;
        }

        // Check if all matches in the current round are reported
        const currentRoundMatches = await Match.find({
            tournament: tournament._id,
            roundNumber: tournament.currentRound,
            // isTopCutRound: tournament.currentRoundType === 'topcut' // Differentiate if needed
        }).session(session);

        if (currentRoundMatches.length === 0 && tournament.currentRound > 0) {
             // This case can happen if /starttour failed to create matches or if currentRound is misaligned
             await interaction.editReply(`No matches found for the current round (${tournament.currentRound}) of tournament ${tournament.tournamentId}. Please check the tournament state or contact support.`);
             await session.abortTransaction();
             session.endSession();
             return;
        }


        const unreportedMatches = currentRoundMatches.filter(match => !match.reported);
        if (unreportedMatches.length > 0) {
            const unreportedMatchIds = unreportedMatches.map(m => m.matchId).join(', ');
            await interaction.editReply(`Cannot validate round ${tournament.currentRound}. The following matches are still unreported: ${unreportedMatchIds}.`);
            await session.abortTransaction();
            session.endSession();
            return;
        }

        // --- Main Validation Logic ---
        // Store the round number being validated *before* any potential increments
        const validatedRoundNumber = tournament.currentRound;

        const allPlayerStatsForTournament = await PlayerStats.find({ tournament: tournament._id }).session(session);
        let isTopCutPhase = tournament.config.topCutSize > 0 && tournament.currentRound > tournament.config.numSwissRounds;

        // 1. Calculate Standings (always useful, especially for Swiss)
        // For top cut, standings are more about who is still in.
        const currentStandings = await calculateStandings(tournament._id, allPlayerStatsForTournament, session);

        let nextRoundEmbed = new EmbedBuilder().setTimestamp();
        let operationMessage = "";

        if (!isTopCutPhase) {
            // --- SWISS ROUNDS ---
            operationMessage = `Validating Swiss Round ${tournament.currentRound}.`;
            nextRoundEmbed.setTitle(`Swiss Round ${tournament.currentRound} Results & Next Round`);

            const standingsDescription = currentStandings
                .map((ps, index) => `${index + 1}. <@${ps.userId}>: (${ps.wins}-${ps.draws}-${ps.losses}) (${(ps.tiebreaker1_OWP*100).toFixed(1)}% | ${(ps.tiebreaker2_OOWP*100).toFixed(1)}% )`)
                .join('\n');
            nextRoundEmbed.addFields({ name: `Current Standings (after Round ${tournament.currentRound})`, value: standingsDescription || 'No players.' });

            if (tournament.currentRound < tournament.config.numSwissRounds) {
                // Generate next Swiss round
                tournament.currentRound += 1;
                const { pairingsDescriptionList, newMatchesInfo } = await generateNextSwissRoundPairings(tournament, currentStandings, tournament.currentRound, session);
                if (newMatchesInfo.length > 0) {
                    nextRoundEmbed.addFields({ name: `Swiss Round ${tournament.currentRound} Pairings`, value: pairingsDescriptionList.join('\n') });
                    operationMessage += `\nGenerated pairings for Swiss Round ${tournament.currentRound}.`;
                } else {
                    nextRoundEmbed.addFields({ name: `Swiss Round ${tournament.currentRound} Pairings`, value: "Could not generate pairings (e.g., all remaining are rematches or error)." });
                    operationMessage += `\nCould not automatically generate pairings for Round ${tournament.currentRound}. Manual check needed.`;
                }
                await tournament.save({ session });
            } else {
                // Last Swiss round completed
                if (tournament.config.topCutSize > 0) {
                    // Proceed to Top Cut
                    isTopCutPhase = true; // Mark for next phase logic
                    tournament.currentRound +=1; // Increment round number for the first top cut round
                    const topCutPlayers = currentStandings.slice(0, tournament.config.topCutSize);

                    // Assign initial seeds
                    const seedPromises = topCutPlayers.map((ps, index) =>
                        PlayerStats.updateOne({ _id: ps._id }, { $set: { initialSeed: index + 1 } }).session(session)
                    );
                    await Promise.all(seedPromises);
                     // Re-fetch stats with seeds for these players
                    const seededTopCutPlayers = await PlayerStats.find({ _id: { $in: topCutPlayers.map(p=>p._id) } }).sort({initialSeed: 1}).session(session);

                    const { pairingsDescriptionList, newMatchesInfo } = await generateTopCutPairings(tournament, seededTopCutPlayers, tournament.currentRound, session);
                    nextRoundEmbed.setTitle(`End of Swiss - Top ${tournament.config.topCutSize} Cut Begins! (Round ${tournament.currentRound})`);
                    nextRoundEmbed.addFields({ name: `Top ${tournament.config.topCutSize} Pairings`, value: pairingsDescriptionList.join('\n') });
                    operationMessage += `\nLast Swiss round finished. Generated Top ${tournament.config.topCutSize} pairings.`;
                    await tournament.save({ session });
                } else {
                    // No Top Cut, finish tournament
                    operationMessage += `\nLast Swiss round finished. No top cut. Finalizing tournament.`;
                    nextRoundEmbed.setTitle(`Tournament ${tournament.tournamentId} - Final Swiss Results`);
                    // Assign final ranks based on Swiss standings
                    currentStandings.forEach((ps, index) => {
                        ps.finalRank = index + 1;
                    });
                    await finishTournament(interaction, tournament, currentStandings, session);
                    await session.commitTransaction();
                    session.endSession();
                    return;
                }
            }
        }

        if (isTopCutPhase && tournament.status === 'active') { // Check status again in case it was finished above
            // --- TOP CUT ROUNDS ---
            // Determine current stage of top cut (e.g. QF, SF, F) by number of active players or round number
            const activeTopCutPlayers = currentStandings.filter(ps =>
                ps.initialSeed > 0 && // Was part of top cut
                !currentRoundMatches.some(m => (m.player1?.userId === ps.userId || m.player2?.userId === ps.userId) && m.winnerId !== ps.userId && !m.isDraw) // Did not lose in current round
            );
            // More accurately, find winners of the *just validated* top cut round
            const winnersOfValidatedRound = [];
            for(const match of currentRoundMatches) {
                if(match.isTopCutRound && match.reported && match.winnerId) {
                    const winnerStat = allPlayerStatsForTournament.find(ps => ps.userId === match.winnerId);
                    if(winnerStat) winnersOfValidatedRound.push(winnerStat);
                    // Set elimination stage for the loser
                    if (match.winnerId) { // If there's a winner, there's a loser
                        const loserId = match.player1.userId === match.winnerId ? match.player2.userId : match.player1.userId;
                        if (loserId) { // Ensure loserId is valid
                            let stage = '';
                            // Determine stage based on how many players *were* in the round being validated.
                            const playersInValidatedRound = currentRoundMatches.length * 2;
                            if (playersInValidatedRound === 4) stage = 'SF';
                            else if (playersInValidatedRound === 8) stage = 'QF';
                            else if (playersInValidatedRound === 16) stage = 'Top16';
                            // Finals loser is rank 2, handled separately.

                            if (stage) {
                                await PlayerStats.updateOne(
                                    { tournament: tournament._id, userId: loserId },
                                    { $set: { eliminationStage: stage } }
                                ).session(session);
                            }
                        }
                    }
                }
                // If a draw occurred in top cut, it needs special handling (e.g. rematch) - not covered here.
            }


            if (winnersOfValidatedRound.length === 1 && currentRoundMatches.some(m => m.isTopCutRound)) {
                // Only one winner means it was the Finals match that was just validated
                operationMessage += `\nFinals match reported. Finalizing tournament.`;
                // Tournament finished after Top Cut. Calculate final ranks.
                const finalRankedStats = [];
                const finalMatch = currentRoundMatches.find(m => m.isTopCutRound && m.reported); // The final match just validated

                if (finalMatch && finalMatch.winnerId) {
                    const winner = allPlayerStatsForTournament.find(ps => ps.userId === finalMatch.winnerId);
                    const runnerUp = allPlayerStatsForTournament.find(ps =>
                        (ps.userId === finalMatch.player1.userId || ps.userId === finalMatch.player2.userId) && ps.userId !== finalMatch.winnerId
                    );
                    if (winner) { winner.finalRank = 1; winner.eliminationStage = 'Winner'; finalRankedStats.push(winner); }
                    if (runnerUp) { runnerUp.finalRank = 2; runnerUp.eliminationStage = 'Runner-up'; finalRankedStats.push(runnerUp); }
                }

                // Group other top cut players by elimination stage
                const eliminationStagesOrder = ['SF', 'QF', 'Top16']; // Highest eliminated to lowest
                let currentRank = 3;

                for (const stage of eliminationStagesOrder) {
                    const eliminatedThisStage = allPlayerStatsForTournament.filter(ps => ps.eliminationStage === stage && !ps.finalRank);
                    // Sort by initialSeed (lower seed is better rank)
                    eliminatedThisStage.sort((a, b) => a.initialSeed - b.initialSeed);

                    eliminatedThisStage.forEach(ps => {
                        ps.finalRank = currentRank;
                        finalRankedStats.push(ps);
                        currentRank++;
                    });
                }

                // Add players who made top cut but somehow weren't caught by eliminationStage (shouldn't happen)
                const remainingTopCutPlayers = allPlayerStatsForTournament.filter(ps => ps.initialSeed > 0 && !ps.finalRank);
                remainingTopCutPlayers.sort((a,b)=> a.initialSeed - b.initialSeed);
                remainingTopCutPlayers.forEach(ps => {
                    ps.finalRank = currentRank++;
                    finalRankedStats.push(ps);
                });

                // Add players who did not make top cut - their rank is based on Swiss standings
                const nonTopCutPlayers = allPlayerStatsForTournament.filter(ps => !(ps.initialSeed > 0));
                nonTopCutPlayers.sort((a, b) => {
                     if (b.score !== a.score) return b.score - a.score;
                     if (b.tiebreaker1_OWP !== a.tiebreaker1_OWP) return b.tiebreaker1_OWP - a.tiebreaker1_OWP;
                     return b.tiebreaker2_OOWP - a.tiebreaker2_OOWP;
                });
                nonTopCutPlayers.forEach(ps => {
                    ps.finalRank = currentRank++;
                    finalRankedStats.push(ps);
                });

                // Ensure all players have a final rank
                 allPlayerStatsForTournament.forEach(ps => {
                    if(!ps.finalRank) {
                        ps.finalRank = currentRank++;
                        if(!finalRankedStats.find(rs => rs.userId === ps.userId)) finalRankedStats.push(ps);
                    }
                 });
                 finalRankedStats.sort((a,b) => a.finalRank - b.finalRank);


                await finishTournament(interaction, tournament, finalRankedStats, session);
                await session.commitTransaction();
                session.endSession();
                return;
            } else if (winnersOfValidatedRound.length > 1) {
                // More than one winner, so previous top cut round finished, generate next stage
                tournament.currentRound += 1;
                // Ensure winnersOfValidatedRound are sorted by their initial seed for consistent pairing generation
                winnersOfValidatedRound.sort((a,b) => a.initialSeed - b.initialSeed);

                const { pairingsDescriptionList, newMatchesInfo } = await generateTopCutPairings(tournament, winnersOfValidatedRound, tournament.currentRound, session);
                let stageName = "Next Top Cut Round";
                if (newMatchesInfo.length === 1) stageName = "Finals";
                else if (newMatchesInfo.length === 2) stageName = "Semifinals"; // Assuming if 4 players made it, next is SF
                else if (newMatchesInfo.length === 4) stageName = "Quarterfinals"; // Assuming if 8 players made it, next is QF

                nextRoundEmbed.setTitle(`${stageName} Pairings (Round ${tournament.currentRound})`);
                nextRoundEmbed.addFields({ name: `${stageName} Pairings`, value: pairingsDescriptionList.join('\n') });
                operationMessage += `\nValidated Top Cut Round. Generated pairings for ${stageName}.`;
                await tournament.save({ session });
            } else if (winnersOfValidatedRound.length === 0 && currentRoundMatches.some(m => m.isTopCutRound)) {
                // No winners from the reported top cut matches, implies something went wrong or all were draws (unhandled)
                operationMessage += `\nError: No winners found from the reported top cut round. Cannot proceed.`;
                nextRoundEmbed.setDescription("Could not determine winners for the next stage of top cut.");
            }
            // If it's the *first* top cut round being validated, the logic is handled by the end of the Swiss block.
            // This block is for subsequent top cut rounds.
        }


        // Before committing, if the round was successfully processed (not finished yet or just finished),
        // clear the pre-report stats for the validated round's matches.
        if (tournament.status === 'active' || (tournament.status === 'finished' && operationMessage.includes("Finalizing tournament"))) {
            // `currentRoundMatches` are the matches of the round that was just processed.
            // Or, if it was the move from Swiss to TopCut, `validatedRoundNumber` holds the last Swiss round number.
            // Or, if advancing top cut, `validatedRoundNumber` holds the top cut round number just processed.

            // Use bulk update to clear pre-report stats rather than saving each match one-by-one.
            await Match.updateMany(
                {
                    tournament: tournament._id,
                    roundNumber: validatedRoundNumber,
                    reported: true
                },
                {
                    $unset: { player1StatsBeforeReport: "", player2StatsBeforeReport: "" }
                }
            ).session(session);

            console.log(`Cleared pre-report stats for matches of round ${validatedRoundNumber} in tournament ${tournament.tournamentId}`);
        }

        await session.commitTransaction();
        if (tournament.status !== 'finished') { // Don't send this if finishTournament already sent one
            await interaction.editReply({ content: operationMessage || "Round validated.", embeds: [nextRoundEmbed] });
        } else {
            // Tournament is finished (and finishTournament was called, which also sets status)
            // Leaderboard display is handled here after commit.
            try {
                const { displayTournamentLeaderboard } = await import('../commands/leaderboard.js');
                if (interaction.client && tournament.serverId && interaction.channelId) {
                    console.log(`Attempting to display leaderboard for finished tournament ${tournament.tournamentId} on server ${tournament.serverId}`);
                    // Get user IDs of those who were in *this* tournament.
                    // tournament.participants is populated from the database and contains { userId, discordTag }
                    const finalParticipantsUserIds = tournament.participants.map(p => p.userId);
                    await displayTournamentLeaderboard(interaction.client, tournament.serverId, interaction.channelId, 'wins', finalParticipantsUserIds);
                } else {
                    console.error("Leaderboard display skipped: client, serverId, or channelId missing from interaction context after tournament finish.");
                }
            } catch (e) {
                console.error("Failed to trigger leaderboard update post-commit:", e);
            }
        }

    } catch (error) {
        await session.abortTransaction();
        console.error(`Error validating round for tournament ${tournamentIdInput}:`, error);
        if (!interaction.replied || !interaction.deferred) {
            await interaction.reply({ content: 'There was an error validating the round. Please try again later.', ephemeral: true });
        } else {
            await interaction.editReply({ content: 'There was an error validating the round. Please try again later.' });
        }
    } finally {
        session.endSession();
    }
}

// --- Helper function stubs to be filled in later ---

// (calculateStandings, generateNextSwissRoundPairings, etc. will be here)

/**
 * Calculates player standings, including tiebreakers OWP and OOWP.
 * This function MUTATES the playerStats objects by adding OWP and OOWP.
 */
async function calculateStandings(tournamentId, allPlayersStatsForTournament, session) {
    console.log(`Calculating standings for tournament ${tournamentId}`);

    // Create a map for quick lookup of player stats by userId
    const playerStatsMap = new Map(allPlayersStatsForTournament.map(ps => [ps.userId, ps]));

    // Calculate OWP (Opponent Win Percentage) for each player
    for (const playerStat of allPlayersStatsForTournament) {
        let totalOpponentWinPercentage = 0;
        let opponentsConsideredForOWP = 0;

        // Removed: Player's own bye no longer contributes a phantom opponent to OWP.

        for (const opponentId of playerStat.opponents) {
            const opponentStat = playerStatsMap.get(opponentId);
            if (opponentStat) {
                const opponentByes = opponentStat.receivedByeInRound > 0 ? 1 : 0;
                const opponentActualWins = opponentStat.wins - opponentByes;
                const opponentTotalMatchesIncludingByes = opponentStat.wins + opponentStat.losses + opponentStat.draws;
                const opponentActualMatchesPlayed = opponentTotalMatchesIncludingByes - opponentByes;

                let opponentWinPerc = 0; // Default to 0 if no actual matches played
                if (opponentActualMatchesPlayed > 0) {
                    opponentWinPerc = Math.max(0.25, opponentActualWins / opponentActualMatchesPlayed);
                }
                // If opponentActualMatchesPlayed is 0 (e.g. they only had byes, or no matches),
                // their contribution to OWP is 0. The 0.25 minimum applies only if they played actual matches.

                totalOpponentWinPercentage += opponentWinPerc;
                opponentsConsideredForOWP++;
            }
        }
        playerStat.tiebreaker1_OWP = opponentsConsideredForOWP > 0 ? totalOpponentWinPercentage / opponentsConsideredForOWP : 0;
    }

    // Calculate OOWP (Opponent's Opponent Win Percentage) for each player
    // This uses the OWP values we just calculated
    for (const playerStat of allPlayersStatsForTournament) {
        let totalOpponentsOWP = 0;
        let opponentsConsideredForOOWP = 0;

        for (const opponentId of playerStat.opponents) {
            const opponentStat = playerStatsMap.get(opponentId);
            if (opponentStat) { // opponentStat already has its OWP calculated
                totalOpponentsOWP += opponentStat.tiebreaker1_OWP;
                opponentsConsideredForOOWP++;
            }
        }
        playerStat.tiebreaker2_OOWP = opponentsConsideredForOOWP > 0 ? totalOpponentsOWP / opponentsConsideredForOOWP : 0;
    }

    // Sort players: 1. Score (desc), 2. OWP (desc), 3. OOWP (desc)
    allPlayersStatsForTournament.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.tiebreaker1_OWP !== a.tiebreaker1_OWP) return b.tiebreaker1_OWP - a.tiebreaker1_OWP;
        return b.tiebreaker2_OOWP - a.tiebreaker2_OOWP;
    });

    // Update PlayerStats in DB with calculated tiebreakers (optional here, could be done after pairings)
    // For now, we assume the calling function will handle saving if needed, or we do it here.
    // Let's do it here for simplicity in this step.
    const updatePromises = allPlayersStatsForTournament.map(ps =>
        PlayerStats.updateOne(
            { _id: ps._id },
            { tiebreaker1_OWP: ps.tiebreaker1_OWP, tiebreaker2_OOWP: ps.tiebreaker2_OOWP }
        ).session(session)
    );
    await Promise.all(updatePromises);

    return allPlayersStatsForTournament;
}

async function generateNextSwissRoundPairings(
    tournament,
    sortedPlayerStats,
    currentRoundNumber,
    session
  ) {
    console.log(
      `Generating Swiss round ${currentRoundNumber} for ${tournament.tournamentId}`
    );
    const pairingsDescriptionList = [];
    const newMatchesInput = []; // Store data for new Match documents
    let matchCounter = await Match.countDocuments({
      tournament: tournament._id,
    }).session(session);

    // Get players who are still active in the tournament
    let availablePlayers = sortedPlayerStats.filter(
      (p) => p.activeInTournament
    );
    let byeRecipientThisRound = null;

    // 1. Handle BYE for odd number of players
    if (availablePlayers.length % 2 !== 0) {
      // Try to give BYE to someone who hasn't had one.
      // Prefer player with lowest score among those who haven't received a bye.
      let potentialByePlayers = availablePlayers.filter(
        (p) => p.receivedByeInRound === 0
      );

      if (potentialByePlayers.length === 0) {
        // All eligible players have already received a bye
        potentialByePlayers = [...availablePlayers]; // Any active player can receive it, pick the one with lowest current standing
      }

      // Sort by score (asc), then OWP (asc), then OOWP (asc) to find "lowest-ranked" eligible for bye
      potentialByePlayers.sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score;
        if (a.tiebreaker1_OWP !== b.tiebreaker1_OWP)
          return a.tiebreaker1_OWP - b.tiebreaker1_OWP; // Lower OWP is "worse"
        if (a.tiebreaker2_OOWP !== b.tiebreaker2_OOWP)
          return a.tiebreaker2_OOWP - b.tiebreaker2_OOWP; // Lower OOWP is "worse"
        return 0;
      });

      if (potentialByePlayers.length > 0) {
        byeRecipientThisRound = potentialByePlayers[0];
        availablePlayers = availablePlayers.filter(
          (p) => p.userId !== byeRecipientThisRound.userId
        ); // Remove from pairing pool
      }
    }

    // 2. Create Swiss pairings using backtracking algorithm
    const pairings = findSwissPairings(availablePlayers);

    if (!pairings) {
      console.error(
        `CRITICAL: Could not generate valid Swiss pairings for round ${currentRoundNumber}`
      );
      throw new Error(
        `Failed to generate Swiss pairings for round ${currentRoundNumber}. This should not happen in normal circumstances.`
      );
    }

    console.log(
      `Successfully generated ${pairings.length} pairings for round ${currentRoundNumber}`
    );

    // 3. Create matches from successful pairings
    // Handle BYE match first if needed
    if (byeRecipientThisRound) {
      matchCounter++;
      const matchId = formatMatchId(matchCounter);
      newMatchesInput.push({
        matchId,
        tournament: tournament._id,
        roundNumber: currentRoundNumber,
        isTopCutRound: false,
        player1: {
          userId: byeRecipientThisRound.userId,
          discordTag: byeRecipientThisRound.discordTag,
        },
        player2: null, // Indicates BYE
        winnerId: byeRecipientThisRound.userId, // Auto-win for BYE
        reported: true, // Auto-reported
      });
      pairingsDescriptionList.push(
        `Match ${matchId}: <@${byeRecipientThisRound.userId}> gets a BYE!`
      );
    }

    // Create regular matches
    for (const pairing of pairings) {
      matchCounter++;
      const matchId = formatMatchId(matchCounter);
      newMatchesInput.push({
        matchId,
        tournament: tournament._id,
        roundNumber: currentRoundNumber,
        isTopCutRound: false,
        player1: {
          userId: pairing.player1.userId,
          discordTag: pairing.player1.discordTag,
        },
        player2: {
          userId: pairing.player2.userId,
          discordTag: pairing.player2.discordTag,
        },
      });
      pairingsDescriptionList.push(
        `Match ${matchId}: <@${pairing.player1.userId}> vs <@${pairing.player2.userId}>`
      );
    }

    // 4. Only now that we're sure pairings are successful, save to database
    const createdMatchModels = [];
    if (newMatchesInput.length > 0) {
      const matchModelsToSave = newMatchesInput.map(
        (mInput) => new Match(mInput)
      );
      await Match.insertMany(matchModelsToSave, { session });
      createdMatchModels.push(...matchModelsToSave); // these now have _ids from DB

      const playerStatsUpdatePromises = [];
      for (const match of createdMatchModels) {
        const p1Stat = sortedPlayerStats.find(
          (p) => p.userId === match.player1?.userId
        ); // Find from original sorted list
        const p2Stat = sortedPlayerStats.find(
          (p) => p.userId === match.player2?.userId
        );

        if (match.player1) {
          // If there's a player1 (always, unless error)
          const p1Ops = { $push: { matchesPlayed: match._id } };
          if (match.player2) {
            // If it's not a BYE for p1
            p1Ops.$addToSet = { opponents: match.player2.userId }; // $addToSet to avoid duplicate opponent entries over tournament
          }
          playerStatsUpdatePromises.push(
            PlayerStats.updateOne({ _id: p1Stat._id }, p1Ops).session(session)
          );
        }

        if (match.player2) {
          // If there's a player2 (i.e., not a BYE)
          const p2Ops = {
            $push: { matchesPlayed: match._id },
            $addToSet: { opponents: match.player1.userId },
          };
          playerStatsUpdatePromises.push(
            PlayerStats.updateOne({ _id: p2Stat._id }, p2Ops).session(session)
          );
        }

        // If it's a BYE match (player2 is null, reported is true, winner is player1)
        if (
          !match.player2 &&
          match.player1 &&
          match.reported &&
          match.winnerId === match.player1.userId
        ) {
          playerStatsUpdatePromises.push(
            PlayerStats.updateOne(
              { _id: p1Stat._id },
              {
                $inc: { score: 3, wins: 1 },
                $set: { receivedByeInRound: currentRoundNumber },
              }
            ).session(session)
          );
        }
      }
      await Promise.all(playerStatsUpdatePromises);
    }

    return {
      pairingsDescriptionList,
      newMatchesInfo: createdMatchModels.map((m) => ({
        id: m.matchId,
        p1: m.player1?.discordTag,
        p2: m.player2?.discordTag,
        isBye: !m.player2,
      })),
    };
  }

  // Swiss pairing algorithm with backtracking
  function findSwissPairings(players) {
    if (players.length % 2 !== 0) {
      console.error("findSwissPairings called with odd number of players");
      return null;
    }

    // Group players by score
    const scoreGroups = new Map();
    for (const player of players) {
      if (!scoreGroups.has(player.score)) {
        scoreGroups.set(player.score, []);
      }
      scoreGroups.get(player.score).push(player);
    }

    // Shuffle each score group
    for (const [score, playerList] of scoreGroups) {
      scoreGroups.set(score, shuffleArray([...playerList]));
    }

    // Create ordered list respecting score brackets but with randomization within each bracket
    const scoreKeysDesc = Array.from(scoreGroups.keys()).sort((a, b) => b - a);
    const orderedPlayers = [];
    for (const score of scoreKeysDesc) {
      orderedPlayers.push(...scoreGroups.get(score));
    }

    console.log(
      `Attempting to pair ${orderedPlayers.length} players with backtracking algorithm`
    );

    // Try to find valid pairings using backtracking
    const result = backtrackPairings(orderedPlayers, [], new Set());

    if (result) {
      console.log(`Found valid pairing solution with ${result.length} matches`);
      return result;
    } else {
      console.error("Backtracking failed to find valid pairings");
      return null;
    }
  }

function backtrackPairings(remainingPlayers, currentPairings, pairedPlayerIds) {
    // Base case: all players are paired
    if (remainingPlayers.length === 0) {
      return currentPairings;
    }

    // Should never happen, but safety check
    if (remainingPlayers.length % 2 !== 0) {
      return null;
    }

    // Take the first unpaired player (this maintains some Swiss ordering preference)
    const player1 = remainingPlayers[0];

    // Try pairing with each other remaining player
    for (let i = 1; i < remainingPlayers.length; i++) {
      const player2 = remainingPlayers[i];

      // Check if this pairing is valid (haven't played before)
      if (!player1.opponents.includes(player2.userId)) {
        // Create this pairing
        const newPairing = { player1, player2 };
        const newCurrentPairings = [...currentPairings, newPairing];
        const newPairedPlayerIds = new Set([
          ...pairedPlayerIds,
          player1.userId,
          player2.userId,
        ]);

        // Create new remaining players list without these two players
        const newRemainingPlayers = remainingPlayers.filter(
          (p) => p.userId !== player1.userId && p.userId !== player2.userId
        );

        // Recursively try to pair the remaining players
        const result = backtrackPairings(
          newRemainingPlayers,
          newCurrentPairings,
          newPairedPlayerIds
        );

        if (result !== null) {
          return result; // Found a valid solution
        }

        // If we reach here, this pairing didn't lead to a solution, try next player2
      }
    }

    // No valid pairing found for player1
    return null;
  }

async function generateTopCutPairings(tournament, topCutQualifiedStats, topCutRoundNumber, session) {
    console.log(`Generating Top Cut Round ${topCutRoundNumber} for ${tournament.tournamentId}`);
    const pairingsDescriptionList = [];
    const newMatchesInput = [];
    let matchCounter = await Match.countDocuments({ tournament: tournament._id }).session(session);

    // topCutQualifiedStats should be sorted by their Swiss seeding (1st, 2nd, etc.)
    // Their `initialSeed` field in PlayerStats should reflect this (1 to N)

    const numPlayersInCut = topCutQualifiedStats.length;

    if (numPlayersInCut === 2) { // Finals
        matchCounter++;
        const matchId = formatMatchId(matchCounter);
        const p1 = topCutQualifiedStats[0]; // Highest remaining seed
        const p2 = topCutQualifiedStats[1]; // Second highest remaining seed
        newMatchesInput.push({
            matchId,
            tournament: tournament._id,
            roundNumber: topCutRoundNumber,
            isTopCutRound: true,
            player1: { userId: p1.userId, discordTag: p1.discordTag },
            player2: { userId: p2.userId, discordTag: p2.discordTag },
        });
        pairingsDescriptionList.push(`Finals (Match ${matchId}): <@${p1.userId}> (Seed ${p1.initialSeed}) vs <@${p2.userId}> (Seed ${p2.initialSeed})`);
    } else if (numPlayersInCut === 4) { // Semifinals (Top 4)
        // Seeds are 1,2,3,4 based on initial Swiss. Pair 1v4, 2v3.
        const seed1 = topCutQualifiedStats.find(p => p.initialSeed === 1);
        const seed2 = topCutQualifiedStats.find(p => p.initialSeed === 2);
        const seed3 = topCutQualifiedStats.find(p => p.initialSeed === 3);
        const seed4 = topCutQualifiedStats.find(p => p.initialSeed === 4);

        if (!seed1 || !seed2 || !seed3 || !seed4 ) {
            console.error("Error: Missing expected seeds for Top 4 generation.", topCutQualifiedStats.map(s => s.initialSeed));
            pairingsDescriptionList.push("Error: Could not determine correct seeds for Top 4. Manual intervention required.");
            return { pairingsDescriptionList, newMatchesInfo: [] };
        }

        // Match 1: Seed 1 vs Seed 4
        matchCounter++;
        let matchId = formatMatchId(matchCounter);
        newMatchesInput.push({
            matchId, tournament: tournament._id, roundNumber: topCutRoundNumber, isTopCutRound: true,
            player1: { userId: seed1.userId, discordTag: seed1.discordTag },
            player2: { userId: seed4.userId, discordTag: seed4.discordTag },
        });
        pairingsDescriptionList.push(`Semifinal 1 (Match ${matchId}): <@${seed1.userId}> (Seed 1) vs <@${seed4.userId}> (Seed 4)`);

        // Match 2: Seed 2 vs Seed 3
        matchCounter++;
        matchId = formatMatchId(matchCounter);
        newMatchesInput.push({
            matchId, tournament: tournament._id, roundNumber: topCutRoundNumber, isTopCutRound: true,
            player1: { userId: seed2.userId, discordTag: seed2.discordTag },
            player2: { userId: seed3.userId, discordTag: seed3.discordTag },
        });
        pairingsDescriptionList.push(`Semifinal 2 (Match ${matchId}): <@${seed2.userId}> (Seed 2) vs <@${seed3.userId}> (Seed 3)`);

    } else if (numPlayersInCut === 8) { // Quarterfinals (Top 8)
        // Pairings: 1v8, 4v5, 2v7, 3v6
        const seeds = {};
        topCutQualifiedStats.forEach(p => seeds[p.initialSeed] = p);

        if (Object.keys(seeds).length !== 8) {
             console.error("Error: Missing expected seeds for Top 8 generation.", topCutQualifiedStats.map(s => s.initialSeed));
             pairingsDescriptionList.push("Error: Could not determine correct seeds for Top 8. Manual intervention required.");
             return { pairingsDescriptionList, newMatchesInfo: [] };
        }

        const pairings = [
            [seeds[1], seeds[8]], [seeds[4], seeds[5]], // Top half of bracket
            [seeds[2], seeds[7]], [seeds[3], seeds[6]], // Bottom half of bracket
        ];
        for (const pair of pairings) {
            if (!pair[0] || !pair[1]) {
                 console.error("Error: A seed was missing for Top 8 pairing construction", pair, seeds);
                 pairingsDescriptionList.push("Error: Incomplete seed for Top 8. Manual intervention needed.");
                 continue; // Skip this pairing if a player is missing
            }
            matchCounter++;
            const matchId = formatMatchId(matchCounter);
            newMatchesInput.push({
                matchId, tournament: tournament._id, roundNumber: topCutRoundNumber, isTopCutRound: true,
                player1: { userId: pair[0].userId, discordTag: pair[0].discordTag },
                player2: { userId: pair[1].userId, discordTag: pair[1].discordTag },
            });
            pairingsDescriptionList.push(`Quarterfinal (Match ${matchId}): <@${pair[0].userId}> (Seed ${pair[0].initialSeed}) vs <@${pair[1].userId}> (Seed ${pair[1].initialSeed})`);
        }
    } else if (numPlayersInCut === 16) { // Top 16
        const seeds = {};
        topCutQualifiedStats.forEach(p => seeds[p.initialSeed] = p);

         if (Object.keys(seeds).length !== 16) {
             console.error("Error: Missing expected seeds for Top 16 generation.", topCutQualifiedStats.map(s => s.initialSeed));
             pairingsDescriptionList.push("Error: Could not determine correct seeds for Top 16. Manual intervention required.");
             return { pairingsDescriptionList, newMatchesInfo: [] };
        }
        // Standard 16-player bracket:
        const pairings = [
            [seeds[1], seeds[16]], [seeds[8], seeds[9]], [seeds[5], seeds[12]], [seeds[4], seeds[13]],
            [seeds[2], seeds[15]], [seeds[7], seeds[10]], [seeds[6], seeds[11]], [seeds[3], seeds[14]],
        ];
         for (const pair of pairings) {
             if (!pair[0] || !pair[1]) {
                 console.error("Error: A seed was missing for Top 16 pairing construction", pair, seeds);
                 pairingsDescriptionList.push("Error: Incomplete seed for Top 16. Manual intervention needed.");
                 continue;
            }
            matchCounter++;
            const matchId = formatMatchId(matchCounter);
            newMatchesInput.push({
                matchId, tournament: tournament._id, roundNumber: topCutRoundNumber, isTopCutRound: true,
                player1: { userId: pair[0].userId, discordTag: pair[0].discordTag },
                player2: { userId: pair[1].userId, discordTag: pair[1].discordTag },
            });
            pairingsDescriptionList.push(`Top 16 (Match ${matchId}): <@${pair[0].userId}> (Seed ${pair[0].initialSeed}) vs <@${pair[1].userId}> (Seed ${pair[1].initialSeed})`);
        }
    } else {
        console.error(`Unsupported top cut size: ${numPlayersInCut}`);
        pairingsDescriptionList.push(`Error: Top cut size of ${numPlayersInCut} is not supported for automatic pairing.`);
        // No matches will be generated
    }

    // Create Match documents and update PlayerStats
    const createdMatchModels = [];
    if (newMatchesInput.length > 0) {
        const matchModelsToSave = newMatchesInput.map(mInput => new Match(mInput));
        await Match.insertMany(matchModelsToSave, { session });
        createdMatchModels.push(...matchModelsToSave);

        const playerStatsUpdatePromises = [];
        for (const match of createdMatchModels) {
            const p1Stat = topCutQualifiedStats.find(p => p.userId === match.player1?.userId);
            const p2Stat = topCutQualifiedStats.find(p => p.userId === match.player2?.userId);

            if (p1Stat) {
                playerStatsUpdatePromises.push(
                    PlayerStats.updateOne({ _id: p1Stat._id }, { $push: { matchesPlayed: match._id } }).session(session)
                );
            }
            if (p2Stat) {
                 playerStatsUpdatePromises.push(
                    PlayerStats.updateOne({ _id: p2Stat._id }, { $push: { matchesPlayed: match._id } }).session(session)
                );
            }
        }
        await Promise.all(playerStatsUpdatePromises);
    }

    return {
        pairingsDescriptionList,
        newMatchesInfo: createdMatchModels.map(m => ({
            id: m.matchId,
            p1: m.player1?.discordTag,
            p2: m.player2?.discordTag,
            isBye: false // No byes in top cut
        }))
    };
}

// Define prize proportions - these can be adjusted
const PRIZE_PROPORTIONS = {
    top4_no_cut: { 1: 0.50, 2: 0.25, 3: 0.125, 4: 0.125 }, // For tournaments with no top cut but spread prizes
    top4_cut:    { 1: 0.50, 2: 0.25, 3: 0.125, 4: 0.125 }, // Standard Top 4
    top8_cut:    { 1: 0.40, 2: 0.20, '3-4': 0.10, '5-8': 0.05 }, // Example for Top 8
    top16_cut:   { 1: 0.35, 2: 0.18, '3-4': 0.085, '5-8': 0.04, '9-16': 0.02 } // Example for Top 16
};

function chunkArray(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

async function finishTournament(interaction, tournament, allPlayerStatsFromTournament, session) {
    console.log(`Finishing tournament ${tournament.tournamentId}`);
    if (tournament.status === 'finished') {
        await interaction.followUp({content: `Tournament ${tournament.tournamentId} has already been marked as finished.`});
        return;
    }

    tournament.status = 'finished';
    const now = new Date();
    // tournament.endedAt = now; // Consider adding an endedAt field to Tournament schema

    // Assign final ranks if missing
    allPlayerStatsFromTournament.forEach((ps, index) => {
        if (!ps.finalRank) ps.finalRank = index + 1;
    });

    // 2. Prize Distribution
    const totalPrizePool = tournament.auraCost * tournament.participants.length;
    const prizeDistributionMessages = [`Total Prize Pool: ${totalPrizePool} Aura`];

    const userEloIncreases = new Map(); // Key: userId, Value: amount of Elo to increase

    // We'll aggregate user-side DB increments into a single map then perform bulkWrite once.
    const userAggregatedUpdates = new Map(); // userId => { $inc: {...}, addToSetPlayed: boolean }

    if (totalPrizePool > 0) {
        if (tournament.prizeMode === 'all') {
            const winnerStat = allPlayerStatsFromTournament.find(p => p.finalRank === 1);
            if (winnerStat) {
                prizeDistributionMessages.push(`Winner <@${winnerStat.userId}> receives ${totalPrizePool} Aura!`);
                userEloIncreases.set(winnerStat.userId, (userEloIncreases.get(winnerStat.userId) || 0) + totalPrizePool);

                const cur = userAggregatedUpdates.get(winnerStat.userId) || { inc: {}, addServer: false };
                cur.inc.auraGainedTournaments = (cur.inc.auraGainedTournaments || 0) + totalPrizePool;
                cur.inc.tournamentWins = (cur.inc.tournamentWins || 0) + 1;
                userAggregatedUpdates.set(winnerStat.userId, cur);
            } else {
                prizeDistributionMessages.push('No winner found for "Winner Takes All" mode. No prizes distributed.');
            }
        } else if (tournament.prizeMode === 'spread') {
            let proportionsToUse;
            const topCutSize = tournament.config.topCutSize;
            let totalAuraDistributed = 0;

            if (topCutSize === 0) proportionsToUse = PRIZE_PROPORTIONS.top4_no_cut;
            else if (topCutSize === 4) proportionsToUse = PRIZE_PROPORTIONS.top4_cut;
            else if (topCutSize === 8) proportionsToUse = PRIZE_PROPORTIONS.top8_cut;
            else if (topCutSize === 16) proportionsToUse = PRIZE_PROPORTIONS.top16_cut;
            else proportionsToUse = PRIZE_PROPORTIONS.top4_no_cut; // Default or fallback

            const pendingPrizeAwards = []; // Store who gets what before finalizing

            for (const rankRange in proportionsToUse) {
                const proportion = proportionsToUse[rankRange];
                const prizeForRankRange = Math.floor(totalPrizePool * proportion);

                if (prizeForRankRange <= 0) continue;

                let playersInRankRange = [];
                if (rankRange.includes('-')) {
                    const [startRank, endRank] = rankRange.split('-').map(Number);
                    playersInRankRange = allPlayerStatsFromTournament.filter(p => p.finalRank >= startRank && p.finalRank <= endRank);
                } else {
                    const rank = Number(rankRange);
                    playersInRankRange = allPlayerStatsFromTournament.filter(p => p.finalRank === rank);
                }

                if (playersInRankRange.length > 0) {
                    const prizePerPlayer = Math.floor(prizeForRankRange / playersInRankRange.length);
                    if (prizePerPlayer > 0) {
                        playersInRankRange.forEach(ps => {
                            pendingPrizeAwards.push({ userId: ps.userId, amount: prizePerPlayer, finalRank: ps.finalRank });
                            totalAuraDistributed += prizePerPlayer;
                        });
                    }
                }
            }

            // remainder -> winner
            const remainder = totalPrizePool - totalAuraDistributed;
            if (remainder > 0) {
                const winnerAward = pendingPrizeAwards.find(p => p.finalRank === 1);
                if (winnerAward) {
                    winnerAward.amount += remainder;
                } else {
                    const winnerStat = allPlayerStatsFromTournament.find(p => p.finalRank === 1);
                    if (winnerStat) {
                        pendingPrizeAwards.push({ userId: winnerStat.userId, amount: remainder, finalRank: 1 });
                    } else {
                        prizeDistributionMessages.push(`Note: ${remainder} Aura remainder could not be awarded to a winner.`);
                    }
                }
            }

            // Aggregate pending awards into userAggregatedUpdates and userEloIncreases
            for (const award of pendingPrizeAwards) {
                prizeDistributionMessages.push(`<@${award.userId}> (Rank ${award.finalRank}) receives ${award.amount} Aura.`);
                userEloIncreases.set(award.userId, (userEloIncreases.get(award.userId) || 0) + award.amount);
                const cur = userAggregatedUpdates.get(award.userId) || { inc: {}, addServer: false };
                cur.inc.auraGainedTournaments = (cur.inc.auraGainedTournaments || 0) + award.amount;
                if (award.finalRank === 1) {
                    cur.inc.tournamentWins = (cur.inc.tournamentWins || 0) + 1;
                }
                userAggregatedUpdates.set(award.userId, cur);
            }
        }
    } else {
        prizeDistributionMessages.push("No Aura cost, so no prizes to distribute.");
    }

    // --- Now aggregate user "participation" updates from playerStats for bulk update ---
    for (const playerStat of allPlayerStatsFromTournament) {
        const cur = userAggregatedUpdates.get(playerStat.userId) || { inc: {}, addServer: false };
        cur.inc.tournamentParticipations = (cur.inc.tournamentParticipations || 0) + 1;
        cur.inc.totalWins = (cur.inc.totalWins || 0) + (playerStat.wins || 0);
        cur.inc.totalLosses = (cur.inc.totalLosses || 0) + (playerStat.losses || 0);
        cur.addServer = true; // flag for $addToSet playedOnServers
        userAggregatedUpdates.set(playerStat.userId, cur);
    }

    // Prepare list of all users that need to exist (for Elo updates or updates)
    const allUserIdsToProcess = new Set([...userAggregatedUpdates.keys(), ...userEloIncreases.keys()]);
    // Also ensure winner exists even if not in maps
    const winnerStat = allPlayerStatsFromTournament.find(p => p.finalRank === 1);
    if (winnerStat) allUserIdsToProcess.add(winnerStat.userId);

    const allUserIdsArray = Array.from(allUserIdsToProcess);

    // Fast path: fetch existing users in one query
    const existingUsers = await User.find({ discordId: { $in: allUserIdsArray } }).session(session);
    const existingMap = new Map(existingUsers.map(u => [u.discordId, u]));

    // Create missing users in batch
    const missingUserIds = allUserIdsArray.filter(id => !existingMap.has(id));
    if (missingUserIds.length > 0) {
        const docsToCreate = [];
        for (const missingId of missingUserIds) {
            // Try to get a discordTag from playerStats or participants for better initial data
            const ps = allPlayerStatsFromTournament.find(p => p.userId === missingId);
            const participant = tournament.participants.find(p => p.userId === missingId);
            const discordTag = (ps && ps.discordTag) || (participant && participant.discordTag) || `${missingId}#0000`;
            // Minimal user doc - adapt to your User schema defaults if more fields required
            docsToCreate.push({ discordId: missingId, discordTag, elo: 0 });
        }
        // Insert in batches to avoid huge single insert
        const batches = chunkArray(docsToCreate, 500);
        for (const batch of batches) {
            await User.insertMany(batch, { session, ordered: false });
        }
    }

    // Re-fetch all user docs to have up-to-date docs
    const allUserDocs = await User.find({ discordId: { $in: allUserIdsArray } }).session(session);
    const allUserDocsMap = new Map(allUserDocs.map(u => [u.discordId, u]));

    // Build bulkWrite operations for aggregated user updates (aura, participations, wins/losses, playedOnServers)
    const userBulkOps = [];
    for (const [userIdKey, aggregated] of userAggregatedUpdates.entries()) {
        const updateOp = {};
        if (aggregated.inc && Object.keys(aggregated.inc).length > 0) updateOp.$inc = aggregated.inc;
        if (aggregated.addServer) updateOp.$addToSet = { playedOnServers: tournament.serverId };
        if (Object.keys(updateOp).length > 0) {
            userBulkOps.push({
                updateOne: {
                    filter: { discordId: userIdKey },
                    update: updateOp,
                    upsert: false
                }
            });
        }
    }

    if (userBulkOps.length > 0) {
        // Execute in batches to avoid enormous bulkWrite requests
        const opBatches = chunkArray(userBulkOps, 500);
        for (const ops of opBatches) {
            await User.bulkWrite(ops, { session, ordered: false });
        }
        console.log(`Applied ${userBulkOps.length} aggregated user updates via bulkWrite.`);
    }

    // Now, handle Elo updates via updateUserRankPeakLow (which may have its own logic).
    // Call these in parallel for all users who need Elo change or rank recalculation.
    const eloUpdatePromises = [];
    for (const [userIdKey, eloIncrease] of userEloIncreases.entries()) {
        const userDoc = allUserDocsMap.get(userIdKey);
        if (userDoc) {
            const newEloValue = (userDoc.elo || 0) + eloIncrease;
            eloUpdatePromises.push(updateUserRankPeakLow(userDoc, newEloValue, session));
        } else {
            // If for some reason the userDoc isn't found (shouldn't happen), attempt to create/find via utility
            eloUpdatePromises.push((async () => {
                const created = await findOrCreateUser(userIdKey, `${userIdKey}#0000`, session);
                if (created) return updateUserRankPeakLow(created, (created.elo || 0) + (eloIncrease || 0), session);
            })());
        }
    }

    // Also ensure we run updateUserRankPeakLow for users with no Elo increase but who may have changed rank due to others.
    for (const userDoc of allUserDocs) {
        if (!userEloIncreases.has(userDoc.discordId)) {
            eloUpdatePromises.push(updateUserRankPeakLow(userDoc, userDoc.elo || 0, session));
        }
    }

    if (eloUpdatePromises.length > 0) {
        console.log(`Processing ${eloUpdatePromises.length} user updates for Elo/rank/peak/low in parallel.`);
        await Promise.all(eloUpdatePromises);
    }

    // Handle PlayerStats updates (Final Ranks) via bulkWrite
    const playerStatsBulkOps = allPlayerStatsFromTournament.map(ps => ({
        updateOne: {
            filter: { _id: ps._id },
            update: { $set: { finalRank: ps.finalRank } }
        }
    }));
    if (playerStatsBulkOps.length > 0) {
        const batches = chunkArray(playerStatsBulkOps, 500);
        for (const b of batches) {
            await PlayerStats.bulkWrite(b, { session, ordered: false });
        }
        console.log(`Updated ${playerStatsBulkOps.length} PlayerStats final ranks via bulkWrite.`);
    }

    // --- New User Stats Update Step (already aggregated above) ---
    // We already did aggregated user updates (participations, wins/losses, playedOnServers etc.) with userBulkOps.

    await tournament.save({ session });

    // 3. Announce Final Results
    const finalStandingsEmbed = new EmbedBuilder()
        .setColor('#FFD700') // Gold for finished
        .setTitle(`🏆 Tournament Finished: ${tournament.tournamentId} 🏆`)
        .setDescription(`The tournament has concluded!`)
        .addFields({ name: 'Prize Distribution', value: prizeDistributionMessages.join('\n') || 'No prizes.' });

    let standingsText = allPlayerStatsFromTournament
        .map(ps => `${ps.finalRank}- <@${ps.userId}> (${ps.wins}-${ps.draws}-${ps.losses}) (${(ps.tiebreaker1_OWP*100).toFixed(1)}% | ${(ps.tiebreaker2_OOWP*100).toFixed(1)}% )`)
        .join('\n');

    finalStandingsEmbed.addFields({ name: 'Final Standings', value: standingsText || 'No standings available.' });

    finalStandingsEmbed.setFooter({ text: `Organized by: ${interaction.user.tag}` }).setTimestamp(); 

    await interaction.followUp({ embeds: [finalStandingsEmbed] });

    console.log(`Tournament ${tournament.tournamentId} finished. Leaderboard update will be triggered by the calling function for server ${tournament.serverId}.`);

    // Delete all matches and playerStats for this tournament (in transaction)
    try {
        const tournamentObjectId = tournament._id; // Use the actual ObjectId

        const matchDeletionResult = await Match.deleteMany({ tournament: tournamentObjectId }).session(session);
        console.log(`Deleted ${matchDeletionResult.deletedCount} matches for tournament ${tournament.tournamentId}`);

        const playerStatsDeletionResult = await PlayerStats.deleteMany({ tournament: tournamentObjectId }).session(session);
        console.log(`Deleted ${playerStatsDeletionResult.deletedCount} playerStats for tournament ${tournament.tournamentId}`);

    } catch (deleteError) {
        console.error(`Error deleting matches/playerStats for tournament ${tournament.tournamentId}:`, deleteError);
        // Decide policy: we log and continue because tournament is finished and prize awarded.
    }
}
