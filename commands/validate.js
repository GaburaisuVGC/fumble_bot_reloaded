import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import Tournament from '../models/Tournament.js';
import Match from '../models/Match.js';
import PlayerStats from '../models/PlayerStats.js';
import User from '../models/User.js';
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
    await interaction.deferReply({ ephemeral: false });

    const tournamentIdInput = interaction.options.getString('tournamentid').toUpperCase();
    const userId = interaction.user.id;
    const userTag = interaction.user.tag;

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        // Ensure the validating user (organizer) exists
        await findOrCreateUser(userId, userTag, session);

        const tournament = await Tournament.findOne({ tournamentId: tournamentIdInput })
            .populate('participants')
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

        let allPlayerStatsForTournament = await PlayerStats.find({ tournament: tournament._id }).session(session);
        let isTopCutPhase = tournament.config.topCutSize > 0 && tournament.currentRound > tournament.config.numSwissRounds;

        let nextRoundEmbed = new EmbedBuilder().setTimestamp();
        let operationMessage = "";

        if (!isTopCutPhase) {
            // 1. Calculate Standings (only during Swiss rounds)
            let currentStandings = await calculateStandings(tournament._id, allPlayerStatsForTournament, session);
            // --- SWISS ROUNDS ---
            operationMessage = `Validating Swiss Round ${tournament.currentRound}.`;
            nextRoundEmbed.setTitle(`Swiss Round ${tournament.currentRound} Results & Next Round`);

            nextRoundEmbed.addFields({ name: `Online Standings`, value: `[View Standings on Website](${process.env.WEBSITE_URL}/standings/${tournament.tournamentId})` });
            if (tournament.participants.length <= 32) {
                const standingsDescription = currentStandings
                    .map((ps, index) => `${index + 1}. <@${ps.userId}>: (${ps.wins}-${ps.draws}-${ps.losses}) (${(ps.tiebreaker1_OWP*100).toFixed(1)}% | ${(ps.tiebreaker2_OOWP*100).toFixed(1)}% )`)
                    .join('\n');
                nextRoundEmbed.addFields({ name: `Current Standings (after Round ${tournament.currentRound})`, value: standingsDescription || 'No players.' });
            }

            // --- Two-Phase Swiss Transition Logic ---
            if (tournament.config.isTwoPhase && tournament.currentRound === tournament.config.phase1Rounds) {
                operationMessage += `\nEnd of Swiss Phase 1. Calculating cut to Phase 2.`;
                const threshold = ((tournament.config.phase1Rounds - 3) * 3) + 1;
                operationMessage += `\nPoint threshold to advance: ${threshold} points.`;

                const playerUpdates = [];
                let advancingPlayerCount = 0;
                let droppedPlayerCount = 0;

                for (const player of currentStandings) {
                    if (player.score >= threshold) {
                        advancingPlayerCount++;
                        playerUpdates.push({
                            updateOne: {
                                filter: { _id: player._id },
                                update: { $set: { receivedByeInRound: 0 } }
                            }
                        });
                    } else {
                        droppedPlayerCount++;
                        playerUpdates.push({
                            updateOne: {
                                filter: { _id: player._id },
                                update: { $set: { activeInTournament: false, tiebreakersFrozen: true } }
                            }
                        });
                    }
                }

                if (playerUpdates.length > 0) {
                    await PlayerStats.bulkWrite(playerUpdates, { session });
                }

                operationMessage += `\n${advancingPlayerCount} players have advanced to Phase 2.`;
                if (droppedPlayerCount > 0) {
                    operationMessage += `\n${droppedPlayerCount} players have been dropped.`;
                }

                // Refetch standings to get the active players for the next round
                allPlayerStatsForTournament = await PlayerStats.find({ tournament: tournament._id }).session(session);
                currentStandings = await calculateStandings(tournament._id, allPlayerStatsForTournament, session);
            }

            if (tournament.currentRound < tournament.config.numSwissRounds) {
                // Generate next Swiss round
                tournament.currentRound += 1;
                const { pairingsDescriptionList, newMatchesInfo } = await generateNextSwissRoundPairings(tournament, currentStandings, tournament.currentRound, session);
                if (newMatchesInfo.length > 0) {
                    nextRoundEmbed.addFields({ name: `Online Pairings`, value: `[View Pairings on Website](${process.env.WEBSITE_URL}/pairings/${tournament.tournamentId})` });
                    if (tournament.participants.length <= 32) {
                        nextRoundEmbed.addFields({ name: `Swiss Round ${tournament.currentRound} Pairings`, value: pairingsDescriptionList.join('\n') });
                    }
                    operationMessage += `\nGenerated pairings for Swiss Round ${tournament.currentRound}.`;
                } else {
                    nextRoundEmbed.addFields({ name: `Swiss Round ${tournament.currentRound} Pairings`, value: "Could not generate pairings (e.g., all remaining are rematches or error)." });
                    operationMessage += `\nCould not automatically generate pairings for Round ${tournament.currentRound}. Manual check needed.`;
                }
                await tournament.save({ session });
            } else {
                // Last Swiss round completed
                if (tournament.participants.length < 8) {
                    operationMessage += `\nFewer than 8 players. Finishing tournament without a top cut.`;
                    nextRoundEmbed.setTitle(`Tournament ${tournament.tournamentId} - Final Swiss Results`);
                    currentStandings.forEach((ps, index) => {
                        ps.finalRank = index + 1;
                    });
                    await finishTournament(interaction, tournament, currentStandings, session);
                    await session.commitTransaction();
                    session.endSession();
                    return;
                }
                if (tournament.config.cutType === 'points') {
                    const topCutPlayers = currentStandings.filter(p => p.score >= tournament.config.pointsRequired);

                    if (topCutPlayers.length === 0) {
                        operationMessage += `\nNo players reached the required ${tournament.config.pointsRequired} points for top cut. Finalizing tournament.`;
                        await finishTournament(interaction, tournament, currentStandings, session);
                        await session.commitTransaction();
                        session.endSession();
                        return;
                    }
                    
                    let bracketSize = 2;
                    while (bracketSize < topCutPlayers.length) {
                        bracketSize *= 2;
                    }
                    tournament.config.topCutSize = bracketSize;
                    
                    const seedPromises = topCutPlayers.map((ps, index) => PlayerStats.updateOne({ _id: ps._id }, { $set: { initialSeed: index + 1 } }).session(session));
                    await Promise.all(seedPromises);

                    const seededTopCutPlayers = await PlayerStats.find({ _id: { $in: topCutPlayers.map(p => p._id) } }).sort({ initialSeed: 1 }).session(session);
                    
                    tournament.currentRound += 1;
                    const { pairingsDescriptionList } = await generateTopCutPairings(tournament, seededTopCutPlayers, tournament.currentRound, session);
                    
                    nextRoundEmbed.setTitle(`End of Swiss - Top ${topCutPlayers.length} Cut Begins! (Round ${tournament.currentRound})`);
                    nextRoundEmbed.addFields({ name: `Top ${bracketSize} Pairings`, value: pairingsDescriptionList.join('\n') });
                    operationMessage += `\nLast Swiss round finished. Generated Top Cut pairings for ${topCutPlayers.length} players.`;
                    await tournament.save({ session });

                } else if (tournament.config.topCutSize > 0) { // Rank-based cut
                    isTopCutPhase = true;
                    
                    tournament.currentRound +=1;
                    const topCutPlayers = currentStandings.slice(0, tournament.config.topCutSize);
                    
                    const seedPromises = topCutPlayers.map((ps, index) => PlayerStats.updateOne({ _id: ps._id }, { $set: { initialSeed: index + 1 } }).session(session));
                    await Promise.all(seedPromises);
                    
                    const seededTopCutPlayers = await PlayerStats.find({ _id: { $in: topCutPlayers.map(p=>p._id) } }).sort({initialSeed: 1}).session(session);
                    
                    const { pairingsDescriptionList } = await generateTopCutPairings(tournament, seededTopCutPlayers, tournament.currentRound, session);
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
            // More accurately, find winners of the *just validated* top cut round
            const winnersOfValidatedRound = [];
            for(const match of currentRoundMatches) {
                if(match.isTopCutRound && match.reported && match.winnerId) {
                    const winnerStat = allPlayerStatsForTournament.find(ps => ps.userId === match.winnerId);
                    if(winnerStat) winnersOfValidatedRound.push(winnerStat);
                    // Set elimination stage for the loser. Only applies to matches with a loser (i.e., not byes).
                    if (match.winnerId && match.player2) {
                        const loserId = match.player1.userId === match.winnerId ? match.player2.userId : match.player1.userId;
                        if (loserId) { // Ensure loserId is valid
                            let stage = '';
                            if (match.bracketPosition) {
                                const baseName = match.bracketPosition.split('-')[0]; // "Quarterfinals", "Top16", etc.
                                if (baseName === 'Quarterfinals') stage = 'QF';
                                else if (baseName === 'Semifinals') stage = 'SF';
                                else if (baseName.startsWith('Top')) stage = baseName; // "Top16", "Top32"
                                // Finals loser is handled separately and not assigned a stage here.
                            }

                            if (stage) {
                                // The final ranking logic expects specific keys like 'SF', 'QF', 'Top16', etc.
                                // This new logic provides them correctly.
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
                const eliminationStagesOrder = [];
                let size = tournament.config.topCutSize;
                while (size > 2) {
                    if (size === 4) eliminationStagesOrder.push('SF');
                    else if (size === 8) eliminationStagesOrder.push('QF');
                    else eliminationStagesOrder.push(`Top${size}`);
                    size /= 2;
                }
                eliminationStagesOrder.reverse(); // Process highest stages (e.g. SF) first
                let currentRank = 3;

                for (const stage of eliminationStagesOrder) {
                    const eliminatedThisStage = allPlayerStatsForTournament.filter(ps => ps.eliminationStage === stage && !ps.finalRank);
                    if (eliminatedThisStage.length === 0) continue;

                    eliminatedThisStage.sort((a, b) => a.initialSeed - b.initialSeed);

                    // Assign sequential ranks to players eliminated in the same stage, sorted by seed
                    eliminatedThisStage.forEach(ps => {
                        ps.finalRank = currentRank;
                        finalRankedStats.push(ps);
                        currentRank++; // Increment rank for each player
                    });
                }

                // Add players who made top cut but somehow weren't caught by eliminationStage (shouldn't happen)
                const remainingTopCutPlayers = allPlayerStatsForTournament.filter(ps => ps.initialSeed > 0 && !ps.finalRank);
                remainingTopCutPlayers.sort((a,b)=> a.initialSeed - b.initialSeed);
                remainingTopCutPlayers.forEach(ps => {
                    ps.finalRank = currentRank++;
                    finalRankedStats.push(ps);
                });

                // Add players who did not make top cut - their rank is based on their frozen Swiss standings
                const nonTopCutPlayers = allPlayerStatsForTournament.filter(ps => ps.initialSeed === undefined || ps.initialSeed === null);
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

/**
 * Calculates player standings, including tiebreakers OWP and OOWP.
 * This function MUTATES the playerStats objects by adding OWP and OOWP.
 */
async function calculateStandings(tournamentId, allPlayersStatsForTournament, session) {
    console.log(`Calculating standings for tournament ${tournamentId}`);

    const playerStatsMap = new Map(allPlayersStatsForTournament.map(ps => [ps.userId, ps]));

    // Calculate OWP (Opponent Win Percentage) for each player whose tiebreakers are not frozen.
    for (const playerStat of allPlayersStatsForTournament) {
        if (playerStat.tiebreakersFrozen) continue;

        let totalOpponentWinPercentage = 0;
        const uniqueOpponentIds = [...new Set(playerStat.opponents)];
        if (uniqueOpponentIds.length === 0) {
            playerStat.tiebreaker1_OWP = 0;
            continue;
        }

        for (const opponentId of uniqueOpponentIds) {
            const opponentStat = playerStatsMap.get(opponentId);
            if (opponentStat) {
                const byes = opponentStat.receivedByeInRound > 0 ? 1 : 0;
                const matchesPlayed = opponentStat.wins + opponentStat.losses + opponentStat.draws;
                const actualMatches = matchesPlayed - byes;
                let baseWinPerc = actualMatches > 0 ? (opponentStat.wins - byes + opponentStat.draws * 0.5) / actualMatches : 0;
                
                let finalWinPerc;
                // Manually dropped players have their win % capped at 75%.
                if (!opponentStat.activeInTournament && !opponentStat.tiebreakersFrozen) {
                    finalWinPerc = Math.min(baseWinPerc, 0.75);
                } else {
                    // Active players or players dropped from phase 1 are capped at 100%.
                    finalWinPerc = Math.min(baseWinPerc, 1.0);
                }
                
                // All opponents have a minimum of 25% for OWP calculation.
                totalOpponentWinPercentage += Math.max(0.25, finalWinPerc);
            }
        }
        playerStat.tiebreaker1_OWP = totalOpponentWinPercentage / uniqueOpponentIds.length;
    }

    // Calculate OOWP (Opponent's Opponent Win Percentage) for each player whose tiebreakers are not frozen.
    for (const playerStat of allPlayersStatsForTournament) {
        if (playerStat.tiebreakersFrozen) continue;

        let totalOpponentsOWP = 0;
        const uniqueOpponentIds = [...new Set(playerStat.opponents)];
        if (uniqueOpponentIds.length === 0) {
            playerStat.tiebreaker2_OOWP = 0;
            continue;
        }
        
        for (const opponentId of uniqueOpponentIds) {
            const opponentStat = playerStatsMap.get(opponentId);
            if (opponentStat) {
                // Here we use the tiebreaker1_OWP that we just calculated for all players.
                totalOpponentsOWP += opponentStat.tiebreaker1_OWP;
            }
        }
        playerStat.tiebreaker2_OOWP = totalOpponentsOWP / uniqueOpponentIds.length;
    }

    // Fetch all matches for the tournament to use in head-to-head tiebreaker
    const allMatches = await Match.find({ tournament: tournamentId }).session(session);

    // Initial sort by primary criteria
    allPlayersStatsForTournament.sort((a, b) => {
        const aMatches = a.wins + a.losses + a.draws;
        const bMatches = b.wins + b.losses + b.draws;
        if (aMatches !== bMatches) return bMatches - aMatches; // More matches played is better

        if (b.score !== a.score) return b.score - a.score;
        if (b.tiebreaker1_OWP !== a.tiebreaker1_OWP) return b.tiebreaker1_OWP - a.tiebreaker1_OWP;
        return b.tiebreaker2_OOWP - a.tiebreaker2_OOWP;
    });

    // Iterate through the sorted list and resolve ties using head-to-head and random
    for (let i = 0; i < allPlayersStatsForTournament.length - 1; i++) {
        const tiedPlayers = [allPlayersStatsForTournament[i]];
        let j = i + 1;
        while (
            j < allPlayersStatsForTournament.length &&
            allPlayersStatsForTournament[j].score === allPlayersStatsForTournament[i].score &&
            allPlayersStatsForTournament[j].tiebreaker1_OWP === allPlayersStatsForTournament[i].tiebreaker1_OWP &&
            allPlayersStatsForTournament[j].tiebreaker2_OOWP === allPlayersStatsForTournament[i].tiebreaker2_OOWP
        ) {
            tiedPlayers.push(allPlayersStatsForTournament[j]);
            j++;
        }

        if (tiedPlayers.length > 1) {
            const tiedPlayerIds = tiedPlayers.map(p => p.userId);
            const headToHeadMatches = allMatches.filter(m => 
                m.player1 && m.player2 && // Ensure both players exist
                tiedPlayerIds.includes(m.player1.userId) && tiedPlayerIds.includes(m.player2.userId)
            );

            tiedPlayers.sort((a, b) => {
                const matchesBetweenPair = headToHeadMatches.filter(
                    m => (m.player1.userId === a.userId && m.player2.userId === b.userId) || (m.player1.userId === b.userId && m.player2.userId === a.userId)
                );

                if (matchesBetweenPair.length > 0) {
                    let aWins = 0;
                    let bWins = 0;
                    for (const match of matchesBetweenPair) {
                        if (match.winnerId === a.userId) aWins++;
                        if (match.winnerId === b.userId) bWins++;
                    }

                    // If score is 2-0 or 1-0, the winner is placed above.
                    if (aWins !== bWins) {
                        return bWins - aWins; // Higher score comes first
                    }
                }
                
                // If 1-1, or no matches played between them, fallback to random.
                return Math.random() - 0.5;
            });

            // Replace the original slice with the newly sorted one
            allPlayersStatsForTournament.splice(i, tiedPlayers.length, ...tiedPlayers);
        }
        
        i = j - 1; // Move index to the end of the processed tied group
    }

    // Update PlayerStats in DB with calculated tiebreakers
    const updatePromises = allPlayersStatsForTournament.map(ps =>
        PlayerStats.updateOne(
            { _id: ps._id },
            { 
                tiebreaker1_OWP: ps.tiebreaker1_OWP, 
                tiebreaker2_OOWP: ps.tiebreaker2_OOWP 
            }
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
    const newMatchesInput = [];
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
    const pairings = findSwissPairings(availablePlayers, tournament);

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
      createdMatchModels.push(...matchModelsToSave);

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
            p1Ops.$addToSet = { opponents: match.player2.userId };
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
  function findSwissPairings(players, tournament) {
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
    const result = backtrackPairings(orderedPlayers, [], new Set(), tournament);

    if (result) {
      console.log(`Found valid pairing solution with ${result.length} matches`);
      return result;
    } else {
      console.error("Backtracking failed to find valid pairings");
      return null;
    }
  }

function backtrackPairings(remainingPlayers, currentPairings, pairedPlayerIds, tournament) {
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

      // Check if this pairing is valid (haven't played before in the same phase)
      let opponentsInCurrentPhase;
      if (tournament.config.isTwoPhase) {
          if (tournament.currentRound > tournament.config.phase1Rounds) {
              opponentsInCurrentPhase = player1.opponentsPhase2 || [];
          } else {
              opponentsInCurrentPhase = player1.opponentsPhase1 || [];
          }
      } else {
          opponentsInCurrentPhase = player1.opponents || [];
      }

      if (!opponentsInCurrentPhase.includes(player2.userId)) {
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
          newPairedPlayerIds,
          tournament
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

function getRoundName(numPlayers) {
    if (numPlayers === 2) return 'Finals';
    if (numPlayers === 4) return 'Semifinals';
    if (numPlayers === 8) return 'Quarterfinals';
    return `Top${numPlayers}`; // e.g., Top16, Top32
}

/**
 * Generates a standard tournament bracket structure for a given size.
 * @param {number} bracketSize The size of the bracket (must be a power of 2).
 * @returns {object} A bracket structure object with rounds and match progressions.
 */
function generateBracket(bracketSize) {
    if (bracketSize < 2 || (bracketSize & (bracketSize - 1)) !== 0) {
        throw new Error(`Invalid bracket size: ${bracketSize}. Must be a power of 2.`);
    }

    function getSeedOrder(size) {
        if (size === 2) return [1, 2];
        const rounds = Math.log2(size) - 1;
        let pls = [1, 2];
        for (let i = 0; i < rounds; i++) {
            const out = [];
            const length = pls.length * 2 + 1;
            pls.forEach(d => {
                out.push(d);
                out.push(length - d);
            });
            pls = out;
        }
        return pls;
    }

    const seedOrder = getSeedOrder(bracketSize);
    const rounds = [];
    let currentRoundMatchups = [];
    for (let i = 0; i < seedOrder.length; i += 2) {
        currentRoundMatchups.push({ p1_source: seedOrder[i], p2_source: seedOrder[i + 1] });
    }

    while (currentRoundMatchups.length >= 1) {
        const roundName = getRoundName(currentRoundMatchups.length * 2);
        const matches = [];
        for (let i = 0; i < currentRoundMatchups.length; i++) {
            let matchId = `${roundName.split(' ')[0]}-${i + 1}`;
            if (roundName === 'Finals') {
                matchId = 'Final';
            }
            matches.push({
                matchId: matchId,
                source_1: currentRoundMatchups[i].p1_source,
                source_2: currentRoundMatchups[i].p2_source,
                winnerGoesTo: null,
            });
        }

        if (matches.length > 1) {
            for (let i = 0; i < matches.length; i += 2) {
                const nextRoundName = getRoundName(matches.length);
                let nextMatchId = `${nextRoundName.split(' ')[0]}-${Math.floor(i / 2) + 1}`;
                if (nextRoundName === 'Finals') {
                    nextMatchId = 'Final';
                }
                matches[i].winnerGoesTo = nextMatchId;
                matches[i + 1].winnerGoesTo = nextMatchId;
            }
        }
        
        rounds.push({ name: roundName, matches });
        if (currentRoundMatchups.length === 1) break;

        const nextRoundSources = [];
        for (let i = 0; i < matches.length; i += 2) {
            nextRoundSources.push({ p1_source: matches[i].matchId, p2_source: matches[i + 1].matchId });
        }
        currentRoundMatchups = nextRoundSources;
    }

    return { size: bracketSize, rounds };
}

async function generateTopCutPairings(tournament, players, topCutRoundNumber, session) {
    let pairingsDescriptionList = [];
    const newMatchesInput = [];
    let matchCounter = await Match.countDocuments({ tournament: tournament._id }).session(session);

    const isFirstTopCutRound = topCutRoundNumber === tournament.config.numSwissRounds + 1;

    if (isFirstTopCutRound) {
        let bracketSize = 2;
        while (bracketSize < players.length) { bracketSize *= 2; }
        if (tournament.config.topCutSize !== bracketSize) {
            tournament.config.topCutSize = bracketSize;
        }
        
        const bracket = generateBracket(bracketSize);
        const firstRoundMatches = bracket.rounds[0].matches;
        const playerSeedMap = new Map(players.map(p => [p.initialSeed, p]));

        for (const bracketMatch of firstRoundMatches) {
            const p1 = playerSeedMap.get(bracketMatch.source_1);
            const p2 = playerSeedMap.get(bracketMatch.source_2);
            matchCounter++;
            const matchId = formatMatchId(matchCounter);

            const matchData = {
                matchId, tournament: tournament._id, roundNumber: topCutRoundNumber, isTopCutRound: true,
                bracketPosition: bracketMatch.matchId,
                nextBracketPosition: bracketMatch.winnerGoesTo,
                p1Data: p1,
                p2Data: p2,
            };

            if (p1 && p2) {
                matchData.player1 = { userId: p1.userId, discordTag: p1.discordTag };
                matchData.player2 = { userId: p2.userId, discordTag: p2.discordTag };
            } else if (p1 && !p2) {
                matchData.player1 = { userId: p1.userId, discordTag: p1.discordTag };
                matchData.player2 = null;
                matchData.winnerId = p1.userId;
                matchData.reported = true;
            } else if (!p1 && p2) {
                matchData.player1 = { userId: p2.userId, discordTag: p2.discordTag };
                matchData.player2 = null;
                matchData.winnerId = p2.userId;
                matchData.reported = true;
            }
            newMatchesInput.push(matchData);
        }
    } else {
        const prevMatches = await Match.find({ tournament: tournament._id, roundNumber: topCutRoundNumber - 1, isTopCutRound: true }).session(session);
        const pairingsMap = new Map();
        for (const winner of players) {
            const prevMatch = prevMatches.find(m => m.winnerId === winner.userId);
            if (prevMatch && prevMatch.nextBracketPosition) {
                if (!pairingsMap.has(prevMatch.nextBracketPosition)) {
                    pairingsMap.set(prevMatch.nextBracketPosition, []);
                }
                pairingsMap.get(prevMatch.nextBracketPosition).push(winner);
            }
        }

        const bracket = generateBracket(tournament.config.topCutSize);
        const currentRoundInBracket = bracket.rounds.find(r => r.matches.some(m => pairingsMap.has(m.matchId)));

        for (const [pos, pair] of pairingsMap.entries()) {
            if (pair.length === 2) {
                const [p1, p2] = pair.sort((a,b) => a.initialSeed - b.initialSeed);
                matchCounter++;
                const matchId = formatMatchId(matchCounter);
                const bracketMatchInfo = currentRoundInBracket?.matches.find(m => m.matchId === pos);

                newMatchesInput.push({
                    matchId, tournament: tournament._id, roundNumber: topCutRoundNumber, isTopCutRound: true,
                    player1: { userId: p1.userId, discordTag: p1.discordTag },
                    player2: { userId: p2.userId, discordTag: p2.discordTag },
                    bracketPosition: pos,
                    nextBracketPosition: bracketMatchInfo?.winnerGoesTo || null,
                    p1Data: p1,
                    p2Data: p2
                });
            }
        }
    }
    
    newMatchesInput.sort((a, b) => a.bracketPosition.localeCompare(b.bracketPosition, undefined, { numeric: true }));

    for (const match of newMatchesInput) {
        if (match.p1Data && match.p2Data) {
            pairingsDescriptionList.push(`Match ${match.matchId} (${match.bracketPosition}): <@${match.p1Data.userId}> (Seed ${match.p1Data.initialSeed}) vs <@${match.p2Data.userId}> (Seed ${match.p2Data.initialSeed})`);
        } else if (match.p1Data && !match.p2Data) {
            pairingsDescriptionList.push(`Match ${match.matchId} (${match.bracketPosition}): <@${match.p1Data.userId}> (Seed ${match.p1Data.initialSeed}) gets a BYE!`);
        }
    }

    if (newMatchesInput.length > 0) {
        const models = newMatchesInput.map(m => new Match(m));
        await Match.insertMany(models, { session });
        const promises = [];
        for (const match of models) {
            const p1StatUpdate = PlayerStats.updateOne({ tournament: tournament._id, userId: match.player1.userId }, { $push: { matchesPlayed: match._id } });
            promises.push(p1StatUpdate.session(session));

            if (match.player2) { // Not a bye
                const p2StatUpdate = PlayerStats.updateOne({ tournament: tournament._id, userId: match.player2.userId }, { $push: { matchesPlayed: match._id } });
                promises.push(p2StatUpdate.session(session));
            } else { // It's a bye for p1
                const byeWinnerUpdate = PlayerStats.updateOne({ tournament: tournament._id, userId: match.player1.userId }, { $inc: { score: 3, wins: 1 } });
                promises.push(byeWinnerUpdate.session(session));
            }
        }
        await Promise.all(promises);
    }
    return { pairingsDescriptionList, newMatchesInfo: newMatchesInput };
}

const PRIZE_PROPORTIONS = {
    top4_no_cut: { 1: 0.50, 2: 0.25, 3: 0.125, 4: 0.125 },
    top4_cut:    { 1: 0.50, 2: 0.25, 3: 0.125, 4: 0.125 },
    top8_cut:    { 1: 0.40, 2: 0.20, '3-4': 0.10, '5-8': 0.05 },
    top16_cut:   { 1: 0.35, 2: 0.18, '3-4': 0.085, '5-8': 0.04, '9-16': 0.02 },
    top32_cut:   { 1: 0.30, 2: 0.15, '3-4': 0.075, '5-8': 0.03, '9-16': 0.015, '17-32': 0.0075 } 
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

    allPlayerStatsFromTournament.sort((a, b) => a.finalRank - b.finalRank);

    const finalStandings = allPlayerStatsFromTournament.map(ps => ({
        rank: ps.finalRank,
        username: ps.discordTag,
        wins: ps.wins,
        ties: ps.draws,
        losses: ps.losses,
        score: ps.score,
        owp: ps.tiebreaker1_OWP,
        oowp: ps.tiebreaker2_OOWP,
    }));

    tournament.standings = finalStandings;
    
    allPlayerStatsFromTournament.forEach((ps, index) => {
        if (!ps.finalRank) ps.finalRank = index + 1;
    });

    const totalPrizePool = tournament.auraCost * tournament.participants.length;
    const prizeDistributionMessages = [`Total Prize Pool: ${totalPrizePool} Aura`];

    const userEloIncreases = new Map();
    const userAggregatedUpdates = new Map();

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
            }
        } else if (tournament.prizeMode === 'spread') {
            let numQualified;
            if (tournament.config.cutType === 'points') {
                const qualifiedPlayers = allPlayerStatsFromTournament.filter(p => p.score >= tournament.config.pointsRequired);
                numQualified = qualifiedPlayers.length;
            } else {
                numQualified = tournament.config.topCutSize;
            }

            let prizeBracket = 1;
            while (prizeBracket * 2 <= numQualified) {
                prizeBracket *= 2;
            }

            let proportionsKey;
            if (prizeBracket >= 32) proportionsKey = 'top32_cut';
            else if (prizeBracket >= 16) proportionsKey = 'top16_cut';
            else if (prizeBracket >= 8) proportionsKey = 'top8_cut';
            else if (prizeBracket >= 4) proportionsKey = 'top4_cut';
            else proportionsKey = 'top4_no_cut';
            
            const proportionsToUse = PRIZE_PROPORTIONS[proportionsKey];
            let totalAuraDistributed = 0;
            const pendingPrizeAwards = [];

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

            const remainder = totalPrizePool - totalAuraDistributed;
            if (remainder > 0) {
                const winnerAward = pendingPrizeAwards.find(p => p.finalRank === 1);
                if (winnerAward) {
                    winnerAward.amount += remainder;
                } else {
                    const winnerStat = allPlayerStatsFromTournament.find(p => p.finalRank === 1);
                    if (winnerStat) {
                        pendingPrizeAwards.push({ userId: winnerStat.userId, amount: remainder, finalRank: 1 });
                    }
                }
            }

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
        .setColor('#FFD700')
        .setTitle(`🏆 Tournament Finished: ${tournament.title} 🏆`)
        .setDescription(`The tournament has concluded! View the full standings [here](${process.env.WEBSITE_URL}/standings/${tournament.tournamentId}).`)
        .addFields({ name: 'Prize Distribution', value: prizeDistributionMessages.join('\n') || 'No prizes.' });

    const top32Standings = allPlayerStatsFromTournament.slice(0, 8);
    let standingsText = top32Standings
        .map(ps => {
            if (ps.initialSeed > 0) { // Top Cut Player
                return `${ps.finalRank}- <@${ps.userId}> (${ps.wins}-${ps.draws}-${ps.losses})`;
            } else { // Non-Top Cut Player
                return `${ps.finalRank}- <@${ps.userId}> (${ps.wins}-${ps.draws}-${ps.losses}) (${(ps.tiebreaker1_OWP*100).toFixed(1)}% | ${(ps.tiebreaker2_OOWP*100).toFixed(1)}%)`;
            }
        })
        .join('\n');
    
    if (allPlayerStatsFromTournament.length > 8) {
        standingsText += `\n...and ${allPlayerStatsFromTournament.length - 8} more.`
    }

    finalStandingsEmbed.addFields({ name: 'Final Standings', value: standingsText || 'No standings available.' });

    finalStandingsEmbed.setFooter({ text: `Organized by: ${interaction.user.tag}` }).setTimestamp(); 

    await interaction.followUp({ embeds: [finalStandingsEmbed] });

    console.log(`Tournament ${tournament.tournamentId} finished. Leaderboard update will be triggered by the calling function for server ${tournament.serverId}.`);

    // Delete all matches and playerStats for this tournament (in transaction)
    try {
        const tournamentObjectId = tournament._id;

        const matchDeletionResult = await Match.deleteMany({ tournament: tournamentObjectId }).session(session);
        console.log(`Deleted ${matchDeletionResult.deletedCount} matches for tournament ${tournament.tournamentId}`);

        const playerStatsDeletionResult = await PlayerStats.deleteMany({ tournament: tournamentObjectId }).session(session);
        console.log(`Deleted ${playerStatsDeletionResult.deletedCount} playerStats for tournament ${tournament.tournamentId}`);

    } catch (deleteError) {
        console.error(`Error deleting matches/playerStats for tournament ${tournament.tournamentId}:`, deleteError);
    }
}
