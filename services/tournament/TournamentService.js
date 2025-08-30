import Tournament from "../../models/Tournament.js";
import Match from "../../models/Match.js";
import PlayerStats from "../../models/PlayerStats.js";
import User from "../../models/User.js";
import ITournamentService from "../../interfaces/ITournamentService.js";
import {
  generateTournamentId,
  shuffleArray,
  formatMatchId,
} from "../../utils/tournamentUtils.js";
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import mongoose from "mongoose";

const PRIZE_PROPORTIONS = {
    top4_no_cut: { 1: 0.50, 2: 0.25, 3: 0.125, 4: 0.125 },
    top4_cut:    { 1: 0.50, 2: 0.25, 3: 0.125, 4: 0.125 },
    top8_cut:    { 1: 0.40, 2: 0.20, '3-4': 0.10, '5-8': 0.05 },
    top16_cut:   { 1: 0.35, 2: 0.18, '3-4': 0.085, '5-8': 0.04, '9-16': 0.02 },
    top32_cut:   { 1: 0.30, 2: 0.15, '3-4': 0.075, '5-8': 0.03, '9-16': 0.015, '17-32': 0.0075 } 
};

/**
 * Service for tournament-related operations.
 * Implements the ITournamentService interface.
 */
export default class TournamentService extends ITournamentService {
  /**
   * Determines the number of Swiss rounds and top cut size based on player count.
   * @param {number} playerCount - The number of players in the tournament.
   * @returns {Object|null} An object containing numSwissRounds and topCutSize, or null if not enough players.
   */
  getTournamentParameters(playerCount) {
    if (playerCount < 4) return null;

    let numSwissRounds, topCutSize, pointsRequired;
    let isTwoPhase = false, phase1Rounds = 0, phase2Rounds = 0;

    if (playerCount >= 4 && playerCount < 8) {
        numSwissRounds = 3;
        topCutSize = 0;
        phase1Rounds = 3;
    } else if (playerCount === 8) {
        numSwissRounds = 3;
        topCutSize = 2;
        phase1Rounds = 3;
    }
    else if (playerCount >= 9 && playerCount <= 16) {
        numSwissRounds = 4;
        topCutSize = 4;
        phase1Rounds = 4;
    } else if (playerCount >= 17 && playerCount <= 32) {
        numSwissRounds = 5;
        topCutSize = 8;
        phase1Rounds = 5;
    } else if (playerCount >= 33 && playerCount <= 64) {
        numSwissRounds = 6;
        topCutSize = 8;
        phase1Rounds = 6;
    } else if (playerCount >= 65 && playerCount <= 128) {
        isTwoPhase = true;
        phase1Rounds = 6;
        phase2Rounds = 2;
        numSwissRounds = phase1Rounds + phase2Rounds;
        topCutSize = 16;
    } else if (playerCount >= 129 && playerCount <= 256) {
        isTwoPhase = true;
        phase1Rounds = 7;
        phase2Rounds = 2;
        numSwissRounds = phase1Rounds + phase2Rounds;
        topCutSize = 16;
    } else if (playerCount >= 257 && playerCount <= 512) {
        isTwoPhase = true;
        phase1Rounds = 8;
        phase2Rounds = 2;
        numSwissRounds = phase1Rounds + phase2Rounds;
        topCutSize = 32; 
    } else if (playerCount >= 513 && playerCount <= 1024) {
        isTwoPhase = true;
        phase1Rounds = 8;
        phase2Rounds = 3;
        numSwissRounds = phase1Rounds + phase2Rounds;
        topCutSize = 32;
    } else if (playerCount >= 1025 && playerCount <= 2048) {
        isTwoPhase = true;
        phase1Rounds = 8;
        phase2Rounds = 4;
        numSwissRounds = phase1Rounds + phase2Rounds;
        topCutSize = 32;
    } else { // 2049+
        isTwoPhase = true;
        phase1Rounds = 9;
        phase2Rounds = 4;
        numSwissRounds = phase1Rounds + phase2Rounds;
        topCutSize = 32;
    }

    pointsRequired = ((numSwissRounds - 3) * 3) + 1;

    return { numSwissRounds, topCutSize, pointsRequired, isTwoPhase, phase1Rounds, phase2Rounds };
  }
  constructor(userService) {
    super();
    this.userService = userService;
  }

  /**
   * Creates a new tournament.
   * @param {string} serverId - The Discord server ID.
   * @param {string} organizerId - The Discord user ID of the organizer.
   * @param {number} auraCost - The Aura (ELO) cost to join the tournament.
   * @param {string} prizeMode - How prizes are distributed ('all' or 'spread').
   * @param {string} title - The title of the tournament.
   * @param {string} description - The description of the tournament.
   * @param {string} cutType - The type of top cut ('rank' or 'points').
   * @param {number|null} pointsRequired - The points required for a point-based cut, if manually provided.
   * @param {number|null} maxPlayers - The maximum number of players allowed to join.
   * @returns {Promise<Object>} The created tournament.
   */
  async createTournament(serverId, organizerId, auraCost, prizeMode, title, description, cutType, pointsRequired, maxPlayers) {
    const tournamentId = generateTournamentId();
    const newTournament = new Tournament({
      tournamentId,
      serverId,
      organizerId,
      title: title || "Untitled Tournament",
      description,
      auraCost,
      prizeMode,
      maxPlayers: maxPlayers || 0,
      status: "pending",
      participants: [],
      config: {
        cutType,
        pointsRequired: pointsRequired || null, // Store manual override, or null
      },
      currentRound: 0,
    });
    await newTournament.save();
    return newTournament;
  }

  /**
   * Adds a participant to a tournament.
   * @param {string} tournamentId - The tournament ID.
   * @param {string} userId - The Discord user ID.
   * @param {string} discordTag - The Discord tag of the user.
   * @param {string} executingUserId - The Discord user ID of the user executing the command.
   * @returns {Promise<Object>} Object containing the updated tournament and user.
   */
  async joinTournament(tournamentId, userId, discordTag, executingUserId) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Find the tournament
      const tournament = await Tournament.findOne({ tournamentId }).session(
        session
      );
      if (!tournament) {
        throw new Error(`Tournament with ID ${tournamentId} not found.`);
      }

      // Check if tournament is in a joinable state
      if (tournament.status !== "pending") {
        throw new Error(
          `Tournament is not in a joinable state. Current status: ${tournament.status}`
        );
      }

      // Check if the tournament is full
      if (
        tournament.maxPlayers > 0 &&
        tournament.participants.length >= tournament.maxPlayers
      ) {
        throw new Error(
          `Tournament is full. The maximum number of players (${tournament.maxPlayers}) has been reached.`
        );
      }

      // If someone other than the organizer is trying to add a user
      if (
        userId !== executingUserId &&
        executingUserId !== tournament.organizerId
      ) {
        throw new Error(
          "Only the tournament organizer can add other users to the tournament."
        );
      }

      // Ensure the executing user exists (for logging/consistency)
      await this.userService.findOrCreateUser(executingUserId, null, session);

      // Check if user is already in the tournament
      if (tournament.participants.some((p) => p.userId === userId)) {
        throw new Error(`User ${discordTag} is already in the tournament.`);
      }

      // Check if player stats already exist (shouldn't happen, but check for desync)
      const existingPlayerStats = await PlayerStats.findOne({
        tournament: tournament._id,
        userId,
      }).session(session);

      if (existingPlayerStats) {
        throw new Error(
          `User ${discordTag} is already registered in this tournament (player stats exist). Contact organizer.`
        );
      }

      // Find or create the user
      const user = await this.userService.findOrCreateUser(
        userId,
        discordTag,
        session
      );

      // Check if user has enough Aura
      if (user.elo < tournament.auraCost) {
        throw new Error(
          `User ${discordTag} does not have enough Aura to join. Required: ${tournament.auraCost}, Current: ${user.elo}`
        );
      }

      // Deduct Aura cost
      if (tournament.auraCost > 0) {
        const newElo = user.elo - tournament.auraCost;
        user.auraSpentTournaments =
          (user.auraSpentTournaments || 0) + tournament.auraCost;
        await this.userService.updateUserRankPeakLow(user, newElo, session);
      }

      // Add user to tournament participants
      tournament.participants.push({
        userId,
        discordTag,
      });

      // Save the tournament
      await tournament.save({ session });

      // Create PlayerStats entry for this tournament
      const newPlayerStats = new PlayerStats({
        tournament: tournament._id,
        userId,
        discordTag,
        score: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        matchesPlayed: [],
        opponents: [],
        tiebreaker1_OWP: 0,
        tiebreaker2_OOWP: 0,
        receivedByeInRound: 0,
        activeInTournament: true,
      });
      await newPlayerStats.save({ session });

      await session.commitTransaction();
      session.endSession();

      return {
        tournament,
        user,
      };
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  }

  /**
   * Removes a participant from a tournament.
   * @param {string} tournamentId - The tournament ID.
   * @param {string} userId - The Discord user ID.
   * @param {string} userTag - The Discord tag of the user.
   * @param {string} executingUserId - The Discord user ID of the user executing the command.
   * @returns {Promise<Object>} Object containing the updated tournament and user.
   */
  async leaveTournament(tournamentId, userId, userTag, executingUserId) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Find the tournament
      const tournament = await Tournament.findOne({ tournamentId }).session(
        session
      );
      if (!tournament) {
        throw new Error(`Tournament with ID ${tournamentId} not found.`);
      }

      // Check if tournament is in a leavable state
      if (tournament.status !== "pending") {
        throw new Error(
          `Tournament is not in a leavable state. Current status: ${tournament.status}`
        );
      }

      // If someone other than the organizer is trying to remove a user
      if (
        userId !== executingUserId &&
        executingUserId !== tournament.organizerId
      ) {
        throw new Error(
          "Only the tournament organizer can remove other users from the tournament."
        );
      }

      // Ensure the executing user exists (for logging/consistency)
      await this.userService.findOrCreateUser(executingUserId, null, session);

      // Check if user is in the tournament
      const participantIndex = tournament.participants.findIndex(
        (p) => p.userId === userId
      );
      if (participantIndex === -1) {
        throw new Error(`User is not in the tournament.`);
      }

      // Find or create the user
      const user = await this.userService.findOrCreateUser(
        userId,
        userTag,
        session
      );

      // Refund Aura cost
      if (tournament.auraCost > 0) {
        const newElo = user.elo + tournament.auraCost;
        user.auraSpentTournaments = Math.max(
          0,
          (user.auraSpentTournaments || 0) - tournament.auraCost
        );
        await this.userService.updateUserRankPeakLow(user, newElo, session);
      }

      // Remove user from tournament participants
      tournament.participants.splice(participantIndex, 1);

      // Save the tournament
      await tournament.save({ session });

      // Remove PlayerStats entry
      await PlayerStats.deleteOne({
        tournament: tournament._id,
        userId,
      }).session(session);

      await session.commitTransaction();
      session.endSession();

      return {
        tournament,
        user,
      };
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  }

  /**
   * Starts a tournament and creates the first round of matches.
   * @param {string} tournamentId - The tournament ID.
   * @param {number} numSwissRounds - The number of Swiss rounds.
   * @param {number} topCutSize - The size of the top cut.
   * @returns {Promise<Object>} The started tournament with first round matches.
   */
  async startTournament(tournamentId, numSwissRounds, topCutSize) {
    // Find the tournament
    const tournament = await Tournament.findOne({ tournamentId });
    if (!tournament) {
      throw new Error(`Tournament with ID ${tournamentId} not found.`);
    }

    // Check if tournament is in a startable state
    if (tournament.status !== "pending") {
      throw new Error(
        `Tournament is not in a startable state. Current status: ${tournament.status}`
      );
    }

    // Check if there are enough participants
    if (tournament.participants.length < 2) {
      throw new Error(`Tournament needs at least 2 participants to start.`);
    }

    // Set tournament config
    tournament.config = {
      numSwissRounds,
      topCutSize,
    };

    // Set tournament status to active
    tournament.status = "active";
    tournament.currentRound = 1;

    // Save the tournament
    await tournament.save();

    // Create player stats for all participants
    for (const participant of tournament.participants) {
      const playerStats = new PlayerStats({
        tournament: tournament._id,
        userId: participant.userId,
        discordTag: participant.discordTag,
        score: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        matchesPlayed: [],
        opponents: [],
        tiebreaker1_OWP: 0,
        tiebreaker2_OOWP: 0,
        receivedByeInRound: 0,
        activeInTournament: true,
      });
      await playerStats.save();
    }

    // Create first round matches
    await this.createRoundMatches(tournament);

    return tournament;
  }

  /**
   * Reports the result of a match.
   * @param {string} tournamentId - The tournament ID.
   * @param {string} matchId - The match ID.
   * @param {string} winnerId - The Discord user ID of the winner.
   * @param {string} winnerTag - The Discord tag of the winner.
   * @param {string|null} drawOpponentId - The Discord user ID of the draw opponent (null if not a draw).
   * @param {string|null} drawOpponentTag - The Discord tag of the draw opponent (null if not a draw).
   * @param {string} reporterId - The Discord user ID of the reporter.
   * @param {string} reporterTag - The Discord tag of the reporter.
   * @returns {Promise<Object>} Object containing the tournament, match, isDraw, and resultMessage.
   */
  async reportMatch(
    tournamentId,
    matchId,
    winnerId,
    winnerTag,
    drawOpponentId,
    drawOpponentTag,
    reporterId,
    reporterTag
  ) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Find the tournament
      const tournament = await Tournament.findOne({ tournamentId }).session(
        session
      );
      if (!tournament) {
        throw new Error(`Tournament with ID ${tournamentId} not found.`);
      }

      // Check if tournament is active
      if (tournament.status !== "active") {
        throw new Error(
          `This tournament is not currently active. Status: ${tournament.status}.`
        );
      }

      // Find the match
      const match = await Match.findOne({
        tournament: tournament._id,
        matchId,
      }).session(session);

      if (!match) {
        throw new Error(
          `Match with ID ${matchId} not found in tournament ${tournamentId}.`
        );
      }

      // Check if match is already reported
      if (match.reported) {
        const winnerTag = match.winnerId
          ? `<@${match.winnerId}>`
          : match.isDraw
          ? "Draw"
          : "Not yet determined";
        throw new Error(
          `This match has already been reported. Result: ${winnerTag}.`
        );
      }

      // Check if it's a bye match
      if (match.player2 === null && match.player1?.userId === winnerId) {
        throw new Error(
          `This match is a BYE and has already been accounted for.`
        );
      }

      // Validate players involved
      const player1Id = match.player1?.userId;
      const player2Id = match.player2?.userId;

      if (!player1Id || !player2Id) {
        throw new Error(
          "This match does not have two assigned players. This might be a BYE or an error."
        );
      }

      // Check if the reporter is one of the players in the match OR the tournament organizer
      const isPlayerInMatch =
        reporterId === player1Id || reporterId === player2Id;
      const isTournamentOrganizer = reporterId === tournament.organizerId;

      if (!isPlayerInMatch && !isTournamentOrganizer) {
        throw new Error(
          "You are not a participant in this match nor the tournament organizer, and therefore cannot report its result."
        );
      }

      // Ensure users exist in the database
      await this.userService.findOrCreateUser(winnerId, winnerTag, session);
      if (drawOpponentId) {
        await this.userService.findOrCreateUser(
          drawOpponentId,
          drawOpponentTag,
          session
        );
      }

      let isDraw = false;
      let actualWinnerId = null;
      let actualLoserId = null;
      let player1StatsUpdate = {};
      let player2StatsUpdate = {};
      let resultMessage = "";

      if (drawOpponentId) {
        // It's a draw
        if (
          (winnerId === player1Id && drawOpponentId === player2Id) ||
          (winnerId === player2Id && drawOpponentId === player1Id)
        ) {
          isDraw = true;
          match.isDraw = true;
          match.winnerId = null; // No winner in a draw

          player1StatsUpdate = { $inc: { score: 1, draws: 1 } };
          player2StatsUpdate = { $inc: { score: 1, draws: 1 } };

          resultMessage = `Match ${matchId} reported as a DRAW between <@${player1Id}> and <@${player2Id}>.`;
        } else {
          throw new Error(
            "For a draw, both specified users must be the players in this match."
          );
        }
      } else {
        // It's a win/loss
        if (winnerId === player1Id) {
          actualWinnerId = player1Id;
          actualLoserId = player2Id;
        } else if (winnerId === player2Id) {
          actualWinnerId = player2Id;
          actualLoserId = player1Id;
        } else {
          throw new Error(
            `The specified winner <@${winnerId}> is not a participant in match ${matchId} (<@${player1Id}> vs <@${player2Id}>).`
          );
        }
        match.winnerId = actualWinnerId;
        match.isDraw = false;

        // Update stats based on winner/loser
        if (actualWinnerId === player1Id) {
          player1StatsUpdate = { $inc: { score: 3, wins: 1 } };
          player2StatsUpdate = { $inc: { score: 0, losses: 1 } };
        } else {
          // actualWinnerId === player2Id
          player1StatsUpdate = { $inc: { score: 0, losses: 1 } };
          player2StatsUpdate = { $inc: { score: 3, wins: 1 } };
        }

        resultMessage = `Match ${matchId} reported: <@${actualWinnerId}> defeated <@${actualLoserId}>.`;
      }

      // Fetch current stats for P1 and P2 to store them before update
      const player1Stat = await PlayerStats.findOne({
        tournament: tournament._id,
        userId: player1Id,
      }).session(session);

      const player2Stat = await PlayerStats.findOne({
        tournament: tournament._id,
        userId: player2Id,
      }).session(session);

      if (!player1Stat || !player2Stat) {
        throw new Error(
          "Could not find player stats for one or both players in the match."
        );
      }

      // Store pre-report stats on the match document
      match.player1StatsBeforeReport = {
        wins: player1Stat.wins,
        losses: player1Stat.losses,
        draws: player1Stat.draws,
        score: player1Stat.score,
      };
      match.player2StatsBeforeReport = {
        wins: player2Stat.wins,
        losses: player2Stat.losses,
        draws: player2Stat.draws,
        score: player2Stat.score,
      };

      match.reported = true;
      await match.save({ session });

      // Update PlayerStats for both players
      await PlayerStats.updateOne(
        { _id: player1Stat._id },
        player1StatsUpdate
      ).session(session);
      await PlayerStats.updateOne(
        { _id: player2Stat._id },
        player2StatsUpdate
      ).session(session);

      // Add match to played matches and opponents
      const opponentField = tournament.config.isTwoPhase && match.roundNumber > tournament.config.phase1Rounds
        ? 'opponentsPhase2'
        : 'opponentsPhase1';

      await PlayerStats.updateOne(
        { _id: player1Stat._id },
        { $addToSet: { matchesPlayed: match._id, opponents: player2Id, [opponentField]: player2Id } }
      ).session(session);

      await PlayerStats.updateOne(
        { _id: player2Stat._id },
        { $addToSet: { matchesPlayed: match._id, opponents: player1Id, [opponentField]: player1Id } }
      ).session(session);

      await session.commitTransaction();
      session.endSession();

      return {
        tournament,
        match,
        isDraw,
        resultMessage,
      };
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  }

  /**
   * Advances the tournament to the next round.
   * @param {string} tournamentId - The tournament ID.
   * @returns {Promise<Object>} The tournament with next round matches.
   */
  async advanceToNextRound(tournamentId) {
    // Find the tournament
    const tournament = await Tournament.findOne({ tournamentId });
    if (!tournament) {
      throw new Error(`Tournament with ID ${tournamentId} not found.`);
    }

    // Check if tournament is active
    if (tournament.status !== "active") {
      throw new Error(
        `Tournament is not active. Current status: ${tournament.status}`
      );
    }

    // Check if all matches in the current round are reported
    const currentRoundMatches = await Match.find({
      tournament: tournament._id,
      roundNumber: tournament.currentRound,
    });

    const unreportedMatches = currentRoundMatches.filter(
      (match) => !match.reported
    );
    if (unreportedMatches.length > 0) {
      throw new Error(
        `There are ${unreportedMatches.length} unreported matches in the current round.`
      );
    }

    // Calculate tiebreakers
    await this.calculateTiebreakers(tournament);

    // Check if we need to move to top cut or next Swiss round
    const isLastSwissRound =
      tournament.currentRound >= tournament.config.numSwissRounds;
    const isTopCutRound =
      currentRoundMatches.length > 0 && currentRoundMatches[0].isTopCutRound;

    if (isLastSwissRound && !isTopCutRound) {
      // Move to top cut
      await this.startTopCut(tournament);
    } else if (isTopCutRound) {
      // Continue top cut or finish tournament
      const remainingPlayers = await PlayerStats.countDocuments({
        tournament: tournament._id,
        activeInTournament: true,
      });

      if (remainingPlayers <= 1) {
        // Tournament is finished
        await this.finalizeTournament(tournamentId);
      } else {
        // Next top cut round
        tournament.currentRound += 1;
        await tournament.save();
        await this.createTopCutMatches(tournament);
      }
    } else {
      // Next Swiss round
      tournament.currentRound += 1;
      await tournament.save();
      await this.createRoundMatches(tournament);
    }

    return tournament;
  }

  /**
   * Gets a tournament by its ID.
   * @param {string} tournamentId - The tournament ID.
   * @returns {Promise<Object>} The tournament document.
   */
  async getTournamentById(tournamentId) {
    const tournament = await Tournament.findOne({ tournamentId });
    return tournament;
  }

  /**
   * Resets a specific round in a tournament.
   * @param {string} tournamentId - The tournament ID.
   * @param {number} roundNumber - The round number to reset.
   * @returns {Promise<Object>} Object containing the tournament and the number of matches reset.
   */
  async resetRound(tournamentId, roundNumber) {
    // Find the tournament
    const tournament = await Tournament.findOne({ tournamentId });
    if (!tournament) {
      throw new Error(`Tournament with ID ${tournamentId} not found.`);
    }

    // Check if tournament is active
    if (tournament.status !== "active") {
      throw new Error(
        `Tournament is not active. Current status: ${tournament.status}`
      );
    }

    // Check if round number is valid
    if (roundNumber > tournament.currentRound) {
      throw new Error(
        `Invalid round number. Current round: ${tournament.currentRound}`
      );
    }

    // Find matches in the round
    const matches = await Match.find({
      tournament: tournament._id,
      roundNumber,
    });

    // Reset reported matches
    let matchesResetCount = 0;
    for (const match of matches) {
      if (match.reported) {
        // Reset player stats to before the match was reported
        if (match.player1 && match.player1StatsBeforeReport) {
          const player1Stats = await PlayerStats.findOne({
            tournament: tournament._id,
            userId: match.player1.userId,
          });
          if (player1Stats) {
            player1Stats.wins = match.player1StatsBeforeReport.wins;
            player1Stats.losses = match.player1StatsBeforeReport.losses;
            player1Stats.draws = match.player1StatsBeforeReport.draws;
            player1Stats.score = match.player1StatsBeforeReport.score;
            player1Stats.matchesPlayed = player1Stats.matchesPlayed.filter(
              (m) => !m.equals(match._id)
            );
            player1Stats.opponents = player1Stats.opponents.filter(
              (o) => o !== match.player2.userId
            );
            await player1Stats.save();
          }
        }

        if (match.player2 && match.player2StatsBeforeReport) {
          const player2Stats = await PlayerStats.findOne({
            tournament: tournament._id,
            userId: match.player2.userId,
          });
          if (player2Stats) {
            player2Stats.wins = match.player2StatsBeforeReport.wins;
            player2Stats.losses = match.player2StatsBeforeReport.losses;
            player2Stats.draws = match.player2StatsBeforeReport.draws;
            player2Stats.score = match.player2StatsBeforeReport.score;
            player2Stats.matchesPlayed = player2Stats.matchesPlayed.filter(
              (m) => !m.equals(match._id)
            );
            player2Stats.opponents = player2Stats.opponents.filter(
              (o) => o !== match.player1.userId
            );
            await player2Stats.save();
          }
        }

        // Reset match
        match.reported = false;
        match.winnerId = null;
        match.isDraw = false;
        await match.save();

        matchesResetCount++;
      }
    }

    // If resetting the current round, recalculate tiebreakers
    if (roundNumber === tournament.currentRound) {
      await this.calculateTiebreakers(tournament);
    }

    // If resetting a round before the current round, set current round to the reset round
    if (roundNumber < tournament.currentRound) {
      tournament.currentRound = roundNumber;
      await tournament.save();

      // Delete matches from later rounds
      await Match.deleteMany({
        tournament: tournament._id,
        roundNumber: { $gt: roundNumber },
      });

      // Reset player stats for eliminated players in top cut
      if (matches.length > 0 && matches[0].isTopCutRound) {
        await PlayerStats.updateMany(
          { tournament: tournament._id, eliminationStage: { $ne: null } },
          { $set: { activeInTournament: true, eliminationStage: null } }
        );
      }
    }

    return {
      tournament,
      matchesResetCount,
    };
  }

  /**
   * Gets the current standings for a tournament.
   * @param {string} tournamentId - The tournament ID.
   * @returns {Promise<Array<Object>>} The tournament standings.
   */
  async getTournamentStandings(tournamentId) {
    // Find the tournament
    const tournament = await Tournament.findOne({ tournamentId });
    if (!tournament) {
      throw new Error(`Tournament with ID ${tournamentId} not found.`);
    }

    // Get player stats
    const playerStats = await PlayerStats.find({
      tournament: tournament._id,
    }).sort({
      score: -1,
      tiebreaker1_OWP: -1,
      tiebreaker2_OOWP: -1,
    });

    // Format standings
    return playerStats.map((stats) => ({
      userId: stats.userId,
      discordTag: stats.discordTag,
      score: stats.score,
      wins: stats.wins,
      losses: stats.losses,
      draws: stats.draws,
      tiebreaker1_OWP: stats.tiebreaker1_OWP,
      tiebreaker2_OOWP: stats.tiebreaker2_OOWP,
      activeInTournament: stats.activeInTournament,
      eliminationStage: stats.eliminationStage,
      finalRank: stats.finalRank,
    }));
  }

  /**
   * Finalizes a tournament and distributes prizes.
   * @param {string} tournamentId - The tournament ID.
   * @returns {Promise<Object>} The finalized tournament.
   */
  async finalizeTournament(tournamentId) {
    const tournament = await Tournament.findOne({ tournamentId });
    if (!tournament) throw new Error(`Tournament with ID ${tournamentId} not found.`);
    if (tournament.status !== 'active') throw new Error(`Tournament is not active.`);
    tournament.status = 'finished';
    await tournament.save();

    const standings = await this.getTournamentStandings(tournamentId);
    const prizePool = tournament.auraCost * tournament.participants.length;

    if (prizePool > 0) {
        if (tournament.prizeMode === 'all') {
            if (standings.length > 0 && standings[0].activeInTournament) {
                await User.updateOne({ discordId: standings[0].userId }, { $inc: { elo: prizePool, auraGainedTournaments: prizePool, tournamentWins: 1 } });
            }
        } else if (tournament.prizeMode === 'spread') {
            let numQualified;
            if (tournament.config.cutType === 'points') {
                const qualifiedPlayers = standings.filter(p => p.score >= tournament.config.pointsRequired);
                numQualified = qualifiedPlayers.length;
            } else { // rank
                numQualified = tournament.config.topCutSize;
            }

            let prizeBracket = 1;
            while (prizeBracket * 2 <= numQualified) {
                prizeBracket *= 2;
            }

            let proportionsKey;
            if (prizeBracket >= 16) proportionsKey = 'top16_cut';
            else if (prizeBracket >= 8) proportionsKey = 'top8_cut';
            else if (prizeBracket >= 4) proportionsKey = 'top4_cut';
            else proportionsKey = 'top4_no_cut';
            
            const proportions = PRIZE_PROPORTIONS[proportionsKey];
            const topCutPlayers = standings.filter(s => s.initialSeed != null || s.finalRank <= prizeBracket);

            for (const rankRange in proportions) {
                const proportion = proportions[rankRange];
                const range = rankRange.split('-').map(Number);
                const startRank = range[0];
                const endRank = range.length > 1 ? range[1] : startRank;
                
                const playersInRange = topCutPlayers.filter(p => p.finalRank >= startRank && p.finalRank <= endRank);
                if (playersInRange.length > 0) {
                    const prizePerPlayer = Math.floor((prizePool * proportion) / playersInRange.length);
                    for (const player of playersInRange) {
                        await User.updateOne({ discordId: player.userId }, { $inc: { elo: prizePerPlayer, auraGainedTournaments: prizePerPlayer } });
                    }
                }
            }
        }
    }

    for (const participant of tournament.participants) {
        const playerStats = await PlayerStats.findOne({ tournament: tournament._id, userId: participant.userId });
        if (playerStats) {
            await User.updateOne({ discordId: participant.userId }, {
                $inc: {
                    tournamentParticipations: 1,
                    totalWins: playerStats.wins,
                    totalLosses: playerStats.losses,
                },
                $addToSet: { playedOnServers: tournament.serverId }
            });
        }
    }

    return tournament;
  }

  /**
   * Starts a tournament, generates Round 1 pairings, and creates an embed for the response.
   * @param {string} tournamentId - The tournament ID.
   * @param {string} organizerId - The Discord user ID of the organizer.
   * @param {string} organizerTag - The Discord tag of the organizer.
   * @returns {Promise<Object>} Object containing the tournament, matches, and embed.
   */
  async startTournamentWithPairings(tournamentId, organizerId, organizerTag) {
    const session = await mongoose.startSession(); // Use a transaction for atomicity
    session.startTransaction();

    try {
      const tournament = await Tournament.findOne({ tournamentId }).session(
        session
      );

      if (!tournament) {
        throw new Error(`Tournament with ID ${tournamentId} not found.`);
      }

      if (tournament.organizerId !== organizerId) {
        throw new Error(
          "Only the tournament organizer can start this tournament."
        );
      }

      if (tournament.status !== "pending") {
        throw new Error(
          `This tournament cannot be started. Current status: ${tournament.status}.`
        );
      }

      const participantCount = tournament.participants.length;
      const params = this.getTournamentParameters(participantCount);

      if (!params) {
        throw new Error(
          `Not enough players to start the tournament. Minimum 4 players required, found ${participantCount}.`
        );
      }

      // Set the final configuration now that player count is known
      tournament.config.numSwissRounds = params.numSwissRounds;
      tournament.config.isTwoPhase = params.isTwoPhase;
      tournament.config.phase1Rounds = params.phase1Rounds;
      tournament.config.phase2Rounds = params.phase2Rounds;
      
      if (tournament.config.cutType === 'rank') {
        tournament.config.topCutSize = params.topCutSize;
      } else { // 'points'
        // If pointsRequired was not manually set at creation, use the default from params
        if (!tournament.config.pointsRequired) {
          tournament.config.pointsRequired = params.pointsRequired;
        }
        // topCutSize is determined after Swiss for point-based cuts
        tournament.config.topCutSize = null;
      }
      tournament.status = "active";
      tournament.currentRound = 1;

      let shuffledParticipants = shuffleArray([...tournament.participants]);
      const newMatches = [];
      const playerStatsUpdates = [];
      let matchCounter = 0;
      let byePlayerStat = null;

      // Generate Round 1 Pairings
      const pairingsDescriptionList = [];

      for (let i = 0; i < shuffledParticipants.length; i += 2) {
        matchCounter++;
        const matchId = formatMatchId(matchCounter);

        if (i + 1 < shuffledParticipants.length) {
          const player1 = shuffledParticipants[i];
          const player2 = shuffledParticipants[i + 1];

          const match = new Match({
            matchId,
            tournament: tournament._id,
            roundNumber: 1,
            isTopCutRound: false,
            player1: { userId: player1.userId, discordTag: player1.discordTag },
            player2: { userId: player2.userId, discordTag: player2.discordTag },
            reported: false,
          });
          newMatches.push(match);

          // Prepare PlayerStats updates
          playerStatsUpdates.push(
            PlayerStats.updateOne(
              { tournament: tournament._id, userId: player1.userId },
              { $addToSet: { matchesPlayed: match._id, opponents: player2.userId, opponentsPhase1: player2.userId } }
            ).session(session),
            PlayerStats.updateOne(
              { tournament: tournament._id, userId: player2.userId },
              { $addToSet: { matchesPlayed: match._id, opponents: player1.userId, opponentsPhase1: player1.userId } }
            ).session(session)
          );
          pairingsDescriptionList.push(
            `Match ${matchId}: <@${player1.userId}> vs <@${player2.userId}>`
          );
        } else {
          // Odd number of players, last one gets a BYE
          const byePlayer = shuffledParticipants[i];

          const match = new Match({
            // Create a match for the bye
            matchId,
            tournament: tournament._id,
            roundNumber: 1,
            isTopCutRound: false,
            player1: {
              userId: byePlayer.userId,
              discordTag: byePlayer.discordTag,
            },
            player2: null, // No opponent for a bye
            winnerId: byePlayer.userId, // Bye player automatically wins
            reported: true, // Bye match is auto-reported
          });
          newMatches.push(match);

          // Update PlayerStats for BYE recipient
          // The $push is done separately if this is the byePlayerStat object
          byePlayerStat = {
            userId: byePlayer.userId,
            matchId: match._id, // Store matchId to push later
          };
          pairingsDescriptionList.push(
            `Match ${matchId}: <@${byePlayer.userId}> gets a BYE!`
          );
        }
      }

      await Match.insertMany(newMatches, { session });
      await Promise.all(playerStatsUpdates);

      if (byePlayerStat) {
        // Find the specific match object that was just inserted for the bye
        const byeMatchJustInserted = newMatches.find(
          (m) => m.matchId === formatMatchId(matchCounter) && m.player2 === null
        );
        if (byeMatchJustInserted) {
          await PlayerStats.updateOne(
            { tournament: tournament._id, userId: byePlayerStat.userId },
            {
              score: 3,
              wins: 1,
              receivedByeInRound: 1,
              $push: { matchesPlayed: byeMatchJustInserted._id }, // Opponent list not updated for a bye by default
            }
          ).session(session);
        } else {
          console.error(
            "Could not find the inserted BYE match to update PlayerStats with its ID."
          );
        }
      }

      await tournament.save({ session });
      await session.commitTransaction();

      const embed = new EmbedBuilder()
        .setColor("#0099ff")
        .setTitle(`Tournament Start — ${tournament.title}`)
        .setDescription(
          `The tournament has officially begun! Here are the pairings for Round 1:`
        )
        .addFields(
          {
            name: "Swiss Rounds",
            value: params.isTwoPhase ? `${params.phase1Rounds} Day 1 rounds + ${params.phase2Rounds} Day 2 rounds` : `${params.numSwissRounds}`,
            inline: true,
          },
          {
            name: "Top Cut",
            value:
              tournament.config.cutType === 'rank'
                ? (tournament.config.topCutSize > 0 ? `Top ${tournament.config.topCutSize}` : "No Top Cut")
                : `Point-based (${tournament.config.pointsRequired} pts)`,
            inline: true,
          },
          { name: "Participants", value: `${participantCount}`, inline: true }
        )
        .setFooter({
          text: `Tournament ID: ${tournament.tournamentId} | Use /matchreport to submit results. Organizer: ${organizerTag}`,
        })
        .setTimestamp();

      embed.addFields({
        name: "Pairings",
        value: `[View Pairings on Website](${process.env.WEBSITE_URL}/pairings/${tournament.tournamentId}/)`,
      });

      if (participantCount <= 8) {
        embed.addFields({
            name: "Round 1 Pairings",
            value: pairingsDescriptionList.join('\n') || 'No pairings generated.'
        });
      }

      if (tournament.config.isTwoPhase) {
        const pointsToPass = Math.ceil(tournament.config.phase1Rounds / 2) * 3 + 1;
        const winThreshold = Math.ceil(tournament.config.phase1Rounds / 2) + 1;
        embed.addFields({ name: 'Phase 1 Advancement', value: `Players need at least ${pointsToPass} points (e.g. ${winThreshold} wins) to guarantee advancement to Phase 2.` });
      }

      if (tournament.config.cutType === 'points') {
        const P = tournament.config.pointsRequired;
        let requirementLine = '';
        if (P % 3 === 0) {
          requirementLine = `Minimum to cut: ${P / 3} wins.`;
        } else {
          const winsNeeded = Math.ceil(P / 3);
          const altWins = winsNeeded - 1;
          const tiesNeeded = P - (altWins * 3);
          requirementLine = `Minimum to cut: ${winsNeeded} wins\nAlternative: ${altWins} wins + ${tiesNeeded} ties.`;
        }
        embed.addFields({ name: 'Points Requirement', value: requirementLine });
      }

      return {
        tournament,
        matches: newMatches,
        embed,
      };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Creates matches for a Swiss round.
   * @param {Object} tournament - The tournament document.
   * @returns {Promise<Array<Object>>} The created matches.
   * @private
   */
  async createRoundMatches(tournament) {
    // Get active players
    const playerStats = await PlayerStats.find({
      tournament: tournament._id,
      activeInTournament: true,
    }).sort({
      score: -1,
      tiebreaker1_OWP: -1,
      tiebreaker2_OOWP: -1,
    });

    // Create pairings
    const pairings = [];
    const paired = new Set();

    // First try to pair players with the same score
    const scoreGroups = {};
    for (const player of playerStats) {
      if (!scoreGroups[player.score]) {
        scoreGroups[player.score] = [];
      }
      scoreGroups[player.score].push(player);
    }

    // Sort score groups by score (descending)
    const sortedScores = Object.keys(scoreGroups).sort((a, b) => b - a);

    for (const score of sortedScores) {
      const players = scoreGroups[score];

      // Shuffle players within the same score group
      shuffleArray(players);

      while (players.length >= 2) {
        const player1 = players.shift();

        // Find a valid opponent (not already played against)
        let opponentIndex = -1;
        for (let i = 0; i < players.length; i++) {
          if (!player1.opponents.includes(players[i].userId)) {
            opponentIndex = i;
            break;
          }
        }

        // If no valid opponent found, try the first available
        if (opponentIndex === -1 && players.length > 0) {
          opponentIndex = 0;
        }

        if (opponentIndex !== -1) {
          const player2 = players.splice(opponentIndex, 1)[0];
          pairings.push([player1, player2]);
          paired.add(player1.userId);
          paired.add(player2.userId);
        } else if (players.length === 0) {
          // No opponent found and no more players in this score group
          // This player will be paired in the next score group or get a bye
          break;
        }
      }
    }

    // Handle unpaired players
    const unpaired = playerStats.filter((p) => !paired.has(p.userId));

    // If odd number of players, one gets a bye
    if (unpaired.length % 2 === 1) {
      // Find player with lowest score who hasn't had a bye yet
      unpaired.sort((a, b) => a.score - b.score);
      const byePlayerIndex = unpaired.findIndex(
        (p) => p.receivedByeInRound === 0
      );

      if (byePlayerIndex !== -1) {
        const byePlayer = unpaired.splice(byePlayerIndex, 1)[0];

        // Create a bye match
        const byeMatch = new Match({
          matchId: `${tournament.tournamentId}-${formatMatchId(
            tournament.currentRound
          )}-BYE`,
          tournament: tournament._id,
          roundNumber: tournament.currentRound,
          isTopCutRound: false,
          player1: {
            userId: byePlayer.userId,
            discordTag: byePlayer.discordTag,
          },
          player2: null, // Bye
          winnerId: byePlayer.userId, // Auto-win for bye
          isDraw: false,
          reported: true, // Auto-reported
        });

        await byeMatch.save();

        // Update player stats
        byePlayer.receivedByeInRound = tournament.currentRound;
        byePlayer.wins += 1;
        byePlayer.score += 3;
        byePlayer.matchesPlayed.push(byeMatch._id);
        await byePlayer.save();
      }
    }

    // Pair remaining players
    while (unpaired.length >= 2) {
      const player1 = unpaired.shift();
      const player2 = unpaired.shift();
      pairings.push([player1, player2]);
    }

    // Create matches for all pairings
    const matches = [];
    let matchCounter = 1;

    for (const [player1, player2] of pairings) {
      const match = new Match({
        matchId: `${tournament.tournamentId}-${formatMatchId(
          tournament.currentRound
        )}-${formatMatchId(matchCounter++)}`,
        tournament: tournament._id,
        roundNumber: tournament.currentRound,
        isTopCutRound: false,
        player1: {
          userId: player1.userId,
          discordTag: player1.discordTag,
        },
        player2: {
          userId: player2.userId,
          discordTag: player2.discordTag,
        },
        winnerId: null,
        isDraw: false,
        reported: false,
      });

      await match.save();
      matches.push(match);
    }

    return matches;
  }

  /**
   * Starts the top cut phase of a tournament.
   * @param {Object} tournament - The tournament document.
   * @returns {Promise<void>}
   * @private
   */
  async startTopCut(tournament) {
    let topCutPlayers;

    if (tournament.config.cutType === 'points') {
        const allPlayers = await PlayerStats.find({
            tournament: tournament._id,
            activeInTournament: true,
        }).sort({
            score: -1,
            tiebreaker1_OWP: -1,
            tiebreaker2_OOWP: -1,
        });

        topCutPlayers = allPlayers.filter(p => p.score >= tournament.config.pointsRequired);

        if (topCutPlayers.length === 0) {
            await this.finalizeTournament(tournament.tournamentId);
            return;
        }

        let bracketSize = 2;
        while (bracketSize < topCutPlayers.length) {
            bracketSize *= 2;
        }
        tournament.config.topCutSize = bracketSize;
        await tournament.save();

    } else { // 'rank'
        topCutPlayers = await PlayerStats.find({
            tournament: tournament._id,
            activeInTournament: true,
        })
        .sort({
            score: -1,
            tiebreaker1_OWP: -1,
            tiebreaker2_OOWP: -1,
        })
        .limit(tournament.config.topCutSize);
    }
    
    if (topCutPlayers.length === 0) {
        await this.finalizeTournament(tournament.tournamentId);
        return;
    }

    for (let i = 0; i < topCutPlayers.length; i++) {
        topCutPlayers[i].initialSeed = i + 1;
        await topCutPlayers[i].save();
    }

    await PlayerStats.updateMany(
      {
        tournament: tournament._id,
        activeInTournament: true,
        _id: { $nin: topCutPlayers.map((p) => p._id) },
      },
      { $set: { activeInTournament: false } }
    );

    tournament.currentRound += 1;
    await tournament.save();

    await this.createTopCutMatches(tournament);
  }

  /**
   * Creates matches for a top cut round.
   * @param {Object} tournament - The tournament document.
   * @returns {Promise<Array<Object>>} The created matches.
   * @private
   */
  async createTopCutMatches(tournament) {
    const playerStats = await PlayerStats.find({ tournament: tournament._id, activeInTournament: true }).sort({ initialSeed: 1 });
    const session = await mongoose.startSession();
    try {
      await this.generateTopCutPairings(tournament, playerStats, tournament.currentRound, session);
    } finally {
      session.endSession();
    }
  }

  async generateTopCutPairings(tournament, topCutQualifiedStats, topCutRoundNumber, session) {
    const newMatchesInput = [];
    let matchCounter = await Match.countDocuments({ tournament: tournament._id }).session(session);
    
    if (topCutRoundNumber === tournament.config.numSwissRounds + 1) { // First round of Top Cut
        const bracketSize = tournament.config.topCutSize;
        const numByes = bracketSize - topCutQualifiedStats.length;

        for (let i = 0; i < numByes; i++) {
            const byePlayer = topCutQualifiedStats[i];
            matchCounter++;
            newMatchesInput.push({
                matchId: formatMatchId(matchCounter), tournament: tournament._id, roundNumber: topCutRoundNumber, isTopCutRound: true,
                player1: { userId: byePlayer.userId, discordTag: byePlayer.discordTag }, player2: null,
                winnerId: byePlayer.userId, reported: true, bracketPosition: `BYE-${byePlayer.initialSeed}`
            });
        }
        
        const playersToPair = topCutQualifiedStats.slice(numByes);
        let pairings = [];
        const seedsToPair = playersToPair.map(p => p.initialSeed);
        const createPair = (s1, s2, pos) => {
            if (seedsToPair.includes(s1) && seedsToPair.includes(s2)) {
                pairings.push({ p1: topCutQualifiedStats.find(p=>p.initialSeed===s1), p2: topCutQualifiedStats.find(p=>p.initialSeed===s2), pos });
            }
        };

        if (bracketSize === 4) { createPair(1, 4, 'SF1'); createPair(2, 3, 'SF2'); }
        else if (bracketSize === 8) { createPair(1, 8, 'QF1'); createPair(4, 5, 'QF2'); createPair(2, 7, 'QF3'); createPair(3, 6, 'QF4'); }
        else if (bracketSize === 16) {
            createPair(1, 16, 'R16-1'); createPair(8, 9, 'R16-2'); createPair(5, 12, 'R16-3'); createPair(4, 13, 'R16-4');
            createPair(2, 15, 'R16-5'); createPair(7, 10, 'R16-6'); createPair(6, 11, 'R16-7'); createPair(3, 14, 'R16-8');
        } else if (bracketSize >= 32) {
            const sorted = [...playersToPair].sort((a,b) => a.initialSeed - b.initialSeed);
            const half = sorted.length / 2;
            for (let i = 0; i < half; i++) {
                pairings.push({ p1: sorted[i], p2: sorted[sorted.length - 1 - i], pos: `R${bracketSize}-${i+1}` });
            }
        }
        for (const pair of pairings) {
            matchCounter++;
            newMatchesInput.push({
                matchId: formatMatchId(matchCounter), tournament: tournament._id, roundNumber: topCutRoundNumber, isTopCutRound: true,
                player1: { userId: pair.p1.userId, discordTag: pair.p1.discordTag }, player2: { userId: pair.p2.userId, discordTag: pair.p2.discordTag },
                bracketPosition: pair.pos
            });
        }
    } else { // Subsequent Top Cut Rounds
        const sortedWinners = [...topCutQualifiedStats].sort((a,b) => a.initialSeed - b.initialSeed);
        const half = sortedWinners.length / 2;
        for (let i = 0; i < half; i++) {
            matchCounter++;
            newMatchesInput.push({
                matchId: formatMatchId(matchCounter), tournament: tournament._id, roundNumber: topCutRoundNumber, isTopCutRound: true,
                player1: { userId: sortedWinners[i].userId, discordTag: sortedWinners[i].discordTag },
                player2: { userId: sortedWinners[sortedWinners.length - 1 - i].userId, discordTag: sortedWinners[sortedWinners.length - 1 - i].discordTag },
                bracketPosition: `R${sortedWinners.length}-${i+1}`
            });
        }
    }

    if (newMatchesInput.length > 0) {
        const models = newMatchesInput.map(m => new Match(m));
        await Match.insertMany(models, { session });
        const promises = [];
        for (const match of models) {
            if (match.player2 === null) { // Bye
                promises.push(PlayerStats.updateOne({ tournament: tournament._id, userId: match.player1.userId }, { $inc: { score: 3, wins: 1 }, $push: { matchesPlayed: match._id } }).session(session));
            } else {
                promises.push(PlayerStats.updateOne({ tournament: tournament._id, userId: match.player1.userId }, { $push: { matchesPlayed: match._id } }).session(session));
                promises.push(PlayerStats.updateOne({ tournament: tournament._id, userId: match.player2.userId }, { $push: { matchesPlayed: match._id } }).session(session));
            }
        }
        await Promise.all(promises);
    }
  }

  /**
   * Calculates tiebreakers for all players in a tournament.
   * @param {Object} tournament - The tournament document.
   * @returns {Promise<void>}
   * @private
   */
  async calculateTiebreakers(tournament) {
    const allPlayerStatsForTournament = await PlayerStats.find({ tournament: tournament._id });
    if (allPlayerStatsForTournament.length === 0) {
        return;
    }
    const allMatches = await Match.find({ tournament: tournament._id });
    const playerStatsMap = new Map(allPlayerStatsForTournament.map(ps => [ps.userId, ps]));

    allPlayerStatsForTournament.forEach(ps => {
        const byes = ps.receivedByeInRound > 0 ? 1 : 0;
        const matchesPlayed = ps.wins + ps.losses + ps.draws;
        const actualMatches = matchesPlayed - byes;
        let winPerc = actualMatches > 0 ? (ps.wins - byes + ps.draws * 0.5) / actualMatches : 0;

        // Manually dropped players have their win % capped at 75% for OWP calculations.
        // This does not apply to players dropped after Phase 1, whose tiebreakers are frozen.
        if (!ps.activeInTournament && !ps.tiebreakersFrozen) {
            winPerc = Math.min(winPerc, 0.75);
        }
        
        ps.winPercentage = winPerc;
    });

    for (const playerStat of allPlayerStatsForTournament) {
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
                totalOpponentWinPercentage += Math.max(0.25, opponentStat.winPercentage);
            }
        }
        playerStat.tiebreaker1_OWP = totalOpponentWinPercentage / uniqueOpponentIds.length;
    }

    for (const playerStat of allPlayerStatsForTournament) {
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
                totalOpponentsOWP += opponentStat.tiebreaker1_OWP;
            }
        }
        playerStat.tiebreaker2_OOWP = totalOpponentsOWP / uniqueOpponentIds.length;
    }

    allPlayerStatsForTournament.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.tiebreaker1_OWP !== a.tiebreaker1_OWP) return b.tiebreaker1_OWP - a.tiebreaker1_OWP;
        return b.tiebreaker2_OOWP - a.tiebreaker2_OOWP;
    });

    for (let i = 0; i < allPlayerStatsForTournament.length - 1; i++) {
        const tiedPlayers = [allPlayerStatsForTournament[i]];
        let j = i + 1;
        while (
            j < allPlayersStatsForTournament.length &&
            allPlayerStatsForTournament[j].score === allPlayersStatsForTournament[i].score &&
            allPlayerStatsForTournament[j].tiebreaker1_OWP === allPlayersStatsForTournament[i].tiebreaker1_OWP &&
            allPlayerStatsForTournament[j].tiebreaker2_OOWP === allPlayersStatsForTournament[i].tiebreaker2_OOWP
        ) {
            tiedPlayers.push(allPlayerStatsForTournament[j]);
            j++;
        }

        if (tiedPlayers.length > 1) {
            const tiedPlayerIds = tiedPlayers.map(p => p.userId);
            const headToHeadMatches = allMatches.filter(m => 
                m.player1 && m.player2 &&
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

                    if (aWins !== bWins) {
                        return bWins - aWins;
                    }
                }
                
                return Math.random() - 0.5;
            });

            allPlayerStatsForTournament.splice(i, tiedPlayers.length, ...tiedPlayers);
        }
        
        i = j - 1;
    }

    for (const playerStats of allPlayerStatsForTournament) {
      await PlayerStats.updateOne({ _id: playerStats._id }, {
        tiebreaker1_OWP: playerStats.tiebreaker1_OWP,
        tiebreaker2_OOWP: playerStats.tiebreaker2_OOWP,
      });
    }
  }

  /**
   * Gets the tournament leaderboard data.
   * @param {string} sortBy - The field to sort by ('wins', 'gained', 'delta', 'totalWins', 'winLossRatio').
   * @param {string} serverId - The Discord server ID (null for global leaderboard).
   * @param {Array<string>} specificUserIds - Specific user IDs to include (null for all users).
   * @returns {Promise<Array<Object>>} The sorted leaderboard data.
   */
  async getLeaderboard(sortBy, serverId = null, specificUserIds = null) {
    let userFilter = {};
    // Define a base filter for general leaderboards (global or server-wide if not specific user list)
    // Now includes participation as a valid reason to appear on a general leaderboard.
    const baseActivityFilter = {
      $or: [
        { tournamentWins: { $gt: 0 } },
        { auraGainedTournaments: { $gt: 0 } },
        { tournamentParticipations: { $gt: 0 } },
      ],
    };

    if (specificUserIds && specificUserIds.length > 0) {
      // Case 1: Called immediately after a tournament finishes (from validate.js or similar).
      // We want to display all users who were part of that specific tournament.
      // The `specificUserIds` list contains all participants.
      // No additional server-side filtering based on general activity needed here.
      userFilter = {
        discordId: { $in: specificUserIds },
      };

    } else if (serverId) {
      // Case 2: General /tourleaderboard command for a specific server.
      // Users must have played on this server AND meet base activity criteria.
      userFilter = {
        $and: [baseActivityFilter, { playedOnServers: serverId }],
      };

    } else {
      // Case 3: Global leaderboard (serverId is null, specificUserIds is null).
      // Users must meet base activity criteria.
      userFilter = baseActivityFilter;

    }

    let users = await User.find(userFilter);

    // Add new stats to the leaderboard display if desired. For now, keeping existing fields.
    // The sorting logic below already uses tournamentWins and auraDelta.
    // If you want to sort by totalWins or participations, that would be added here.

    users = users.map((u) => {
      const totalWins = u.totalWins || 0;
      const totalLosses = u.totalLosses || 0;
      let winLossRatio = 0;
      if (totalLosses === 0) {
        winLossRatio = totalWins > 0 ? Infinity : 0; // Infinity if wins > 0 & losses = 0, else 0 if wins = 0 & losses = 0
      } else {
        winLossRatio = totalWins / totalLosses;
      }
      return {
        ...u.toObject(), // Convert Mongoose doc to plain object
        auraDelta: u.auraGainedTournaments - u.auraSpentTournaments,
        calculatedWinLossRatio: winLossRatio,
        totalWins: totalWins, // ensure it's part of the mapped object if not already
        totalLosses: totalLosses, // ensure it's part of the mapped object
      };
    });

    switch (sortBy) {
      case "wins": // Sort by official tournamentWins (1st place finishes)
        users.sort(
          (a, b) =>
            b.tournamentWins - a.tournamentWins ||
            b.auraDelta - a.auraDelta ||
            b.totalWins - a.totalWins
        );
        break;
      case "gained":
        users.sort(
          (a, b) =>
            b.auraGainedTournaments - a.auraGainedTournaments ||
            b.tournamentWins - a.tournamentWins ||
            b.totalWins - a.totalWins
        );
        break;
      case "delta":
        users.sort(
          (a, b) =>
            b.auraDelta - a.auraDelta ||
            b.tournamentWins - a.tournamentWins ||
            b.totalWins - a.totalWins
        );
        break;
      case "totalWins": // Sort by total match wins
        users.sort(
          (a, b) =>
            b.totalWins - a.totalWins ||
            b.calculatedWinLossRatio - a.calculatedWinLossRatio ||
            b.tournamentWins - a.tournamentWins
        );
        break;
      case "winLossRatio": // Sort by W/L Ratio
        // Handle Infinity: users with Infinity ratio (wins > 0, losses = 0) should be at the top.
        // Then sort by ratio descending.
        // Then by totalWins as a tie-breaker.
        users.sort((a, b) => {
          if (
            a.calculatedWinLossRatio === Infinity &&
            b.calculatedWinLossRatio !== Infinity
          )
            return -1;
          if (
            b.calculatedWinLossRatio === Infinity &&
            a.calculatedWinLossRatio !== Infinity
          )
            return 1;
          if (
            a.calculatedWinLossRatio === Infinity &&
            b.calculatedWinLossRatio === Infinity
          ) {
            return b.totalWins - a.totalWins; // Higher wins is better if both are Infinity
          }
          // If neither is Infinity, or both are finite numbers (including 0)
          const ratioDiff = b.calculatedWinLossRatio - a.calculatedWinLossRatio;
          if (ratioDiff !== 0) return ratioDiff;
          return b.totalWins - a.totalWins; // Higher total wins if ratios are equal
        });
        break;
      default: // Default to tournamentWins
        users.sort(
          (a, b) =>
            b.tournamentWins - a.tournamentWins ||
            b.auraDelta - a.auraDelta ||
            b.totalWins - a.totalWins
        );
    }
    // limit to top 100
    users = users.slice(0, 100);
    return users;
  }

  /**
   * Creates a leaderboard embed.
   * @param {Object} client - The Discord client.
   * @param {Array<Object>} users - The sorted user data.
   * @param {number} page - The page number.
   * @param {string} sortBy - The field being sorted by.
   * @param {string} serverName - The name of the server (or "Global").
   * @returns {Promise<Object>} The created embed.
   */
  async createLeaderboardEmbed(
    client,
    users,
    page,
    sortBy,
    serverName = "Global"
  ) {
    const ENTRIES_PER_PAGE = 10;
    const start = page * ENTRIES_PER_PAGE;
    const end = start + ENTRIES_PER_PAGE;
    const currentUsersOnPage = users.slice(start, end);

    let sortLabel;
    switch (sortBy) {
      case "wins":
        sortLabel = "Tournament Wins (1st Place)";
        break;
      case "gained":
        sortLabel = "Aura Gained";
        break;
      case "delta":
        sortLabel = "Aura Delta";
        break;
      case "totalWins":
        sortLabel = "Total Match Wins";
        break;
      case "winLossRatio":
        sortLabel = "Win/Loss Ratio";
        break;
      default:
        sortLabel = "Tournament Wins (1st Place)";
    }

    const embed = new EmbedBuilder()
      .setTitle(
        `🏆 ${serverName} Tournament Leaderboard - Sorted by ${sortLabel}`
      )
      .setColor("#FFD700")
      .setFooter({
        text: `Page ${page + 1} of ${Math.ceil(
          users.length / ENTRIES_PER_PAGE
        )}`,
      });

    if (currentUsersOnPage.length === 0) {
      embed.setDescription("No users found with tournament activity.");
      return embed;
    }

    const fieldPromises = currentUsersOnPage.map(async (user, index) => {
      const rank = start + index + 1;
      let userDisplay = `<@${user.discordId}>`; // Default to mention
      try {
        const fetchedUser = await client.users.fetch(user.discordId);
        userDisplay = fetchedUser.tag; // e.g., username#1234
      } catch (e) {
        console.warn(
          `Could not fetch user ${user.discordId} for leaderboard display:`,
          e.message
        );
        // Fallback to stored username if available, otherwise mention
        if (user.username && user.username !== user.discordId)
          userDisplay = `${user.username} (<@${user.discordId}>)`;
      }

      let wlRatioDisplay = "N/A";
      if (user.calculatedWinLossRatio === Infinity) {
        wlRatioDisplay = "Perfect (∞)";
      } else if (user.totalWins > 0 || user.totalLosses > 0) {
        // Avoid showing 0.00 for 0W/0L
        wlRatioDisplay = user.calculatedWinLossRatio.toFixed(2);
      }
      // Ensure all necessary fields are present, falling back to 0 if undefined
      const tournamentWins = user.tournamentWins || 0;
      const totalWins = user.totalWins || 0;
      const totalLosses = user.totalLosses || 0;
      const auraDelta = user.auraDelta || 0;

      return {
        name: `${rank}. ${userDisplay}`,
        value: `Tourn. Wins: ${tournamentWins} | Matches: ${totalWins}W - ${totalLosses}L (${wlRatioDisplay}) | Aura Δ: ${auraDelta}`,
        inline: false,
      };
    });
    const fields = await Promise.all(fieldPromises);
    embed.addFields(fields);
    return embed;
  }

  /**
   * Displays a tournament leaderboard in a channel.
   * @param {Object} client - The Discord client.
   * @param {string} serverId - The Discord server ID.
   * @param {string} channelId - The Discord channel ID.
   * @param {string} sort - The field to sort by.
   * @param {Array<string>} specificUserIds - Specific user IDs to include.
   * @returns {Promise<void>}
   */
  async displayTournamentLeaderboard(
    client,
    serverId,
    channelId,
    sort = "wins",
    specificUserIds = null
  ) {
    const channel = await client.channels.cache.get(channelId);
    if (!channel) {
      console.error(
        `Leaderboard display failed: Channel ${channelId} not found.`
      );
      return;
    }

    const serverName = client.guilds.cache.get(serverId)?.name || "Global";
    // Pass specificUserIds to getLeaderboard
    const users = await this.getLeaderboard(sort, serverId, specificUserIds);
    const embed = await this.createLeaderboardEmbed(
      client,
      users,
      0,
      sort,
      serverName
    ); // Display first page

    const componentsRow1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`lb_sort_wins_auto_${serverId || "global"}`)
        .setLabel("Tourn. Wins")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(sort === "wins"),
      new ButtonBuilder()
        .setCustomId(`lb_sort_totalWins_auto_${serverId || "global"}`)
        .setLabel("Match Wins")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(sort === "totalWins"),
      new ButtonBuilder()
        .setCustomId(`lb_sort_winLossRatio_auto_${serverId || "global"}`)
        .setLabel("W/L Ratio")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(sort === "winLossRatio")
    );
    const componentsRow2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`lb_sort_gained_auto_${serverId || "global"}`)
        .setLabel("Aura Gained")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(sort === "gained"),
      new ButtonBuilder()
        .setCustomId(`lb_sort_delta_auto_${serverId || "global"}`)
        .setLabel("Aura Delta")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(sort === "delta")
    );

    try {
      const sentMessage = await channel.send({
        embeds: [embed],
        components: [componentsRow1, componentsRow2],
      });
      const collector = sentMessage.createMessageComponentCollector({
        componentType: ButtonStyle.Button,
        time: 300000,
      }); // 5 mins

      collector.on("collect", async (i) => {
        const parts = i.customId.split("_");
        const newSort = parts[2]; // wins, totalWins, winLossRatio, gained, delta

        const updatedUsers = await this.getLeaderboard(
          newSort,
          serverId,
          specificUserIds
        );
        const updatedEmbed = await this.createLeaderboardEmbed(
          client,
          updatedUsers,
          0,
          newSort,
          serverName
        );

        const updatedComponentsRow1 = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`lb_sort_wins_auto_${serverId || "global"}`)
            .setLabel("Tourn. Wins")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(newSort === "wins"),
          new ButtonBuilder()
            .setCustomId(`lb_sort_totalWins_auto_${serverId || "global"}`)
            .setLabel("Match Wins")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(newSort === "totalWins"),
          new ButtonBuilder()
            .setCustomId(`lb_sort_winLossRatio_auto_${serverId || "global"}`)
            .setLabel("W/L Ratio")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(newSort === "winLossRatio")
        );
        const updatedComponentsRow2 = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`lb_sort_gained_auto_${serverId || "global"}`)
            .setLabel("Aura Gained")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(newSort === "gained"),
          new ButtonBuilder()
            .setCustomId(`lb_sort_delta_auto_${serverId || "global"}`)
            .setLabel("Aura Delta")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(newSort === "delta")
        );
        await i.update({
          embeds: [updatedEmbed],
          components: [updatedComponentsRow1, updatedComponentsRow2],
        });
      });

      collector.on("end", () => {
        // Fetch final state of embed before disabling buttons
        // This might be tricky if users/sort changed; for simplicity, just remove components
        sentMessage
          .edit({ components: [] })
          .catch((err) =>
            console.error("Error editing message on collector end:", err)
          );
      });
    } catch (err) {
      console.error("Failed to send or update automatic leaderboard:", err);
    }
  }

  /**
   * Drops a player from a tournament.
   * @param {string} tournamentId - The tournament ID.
   * @param {string} playerId - The Discord user ID of the player to drop.
   * @param {string} organizerId - The Discord user ID of the organizer executing the command.
   * @returns {Promise<Object>} Object containing the tournament, player, and match update message.
   */
  async dropPlayer(tournamentId, playerId, organizerId) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Find the tournament
      const tournament = await Tournament.findOne({ tournamentId }).session(
        session
      );
      if (!tournament) {
        throw new Error(`Tournament with ID ${tournamentId} not found.`);
      }

      // Check if the user is the tournament organizer
      if (tournament.organizerId !== organizerId) {
        throw new Error("Only the tournament organizer can drop players.");
      }

      // Check if tournament is active
      if (tournament.status !== "active") {
        throw new Error(
          `Tournament is not active. Current status: ${tournament.status}. Players cannot be dropped.`
        );
      }

      // Find the player's stats
      const playerStat = await PlayerStats.findOne({
        tournament: tournament._id,
        userId: playerId,
      }).session(session);

      if (!playerStat) {
        throw new Error(
          `Player is not registered in tournament ${tournament.tournamentId}.`
        );
      }

      if (!playerStat.activeInTournament) {
        throw new Error(`Player is already inactive in this tournament.`);
      }

      // Find the player's current match for the current round
      const currentMatch = await Match.findOne({
        tournament: tournament._id,
        roundNumber: tournament.currentRound,
        $or: [{ "player1.userId": playerId }, { "player2.userId": playerId }],
      }).session(session);

      // Check if the match has been reported
      if (currentMatch && currentMatch.reported) {
        throw new Error(
          `Player's match for the current round (${tournament.currentRound}) has already been reported. Cannot drop.`
        );
      }

      // Mark player as inactive
      playerStat.activeInTournament = false;
      await playerStat.save({ session });

      // Remove from tournament.participants list
      tournament.participants = tournament.participants.filter(
        (p) => p.userId !== playerId
      );
      await tournament.save({ session });

      let matchUpdateMessage = "";
      if (currentMatch) {
        const opponentGetsWin = true; // Standard procedure unless it was a bye for the dropped player
        let opponentStat = null;

        if (
          currentMatch.player1 &&
          currentMatch.player1.userId === playerId &&
          currentMatch.player2
        ) {
          // Dropped was P1, P2 exists
          currentMatch.winnerId = currentMatch.player2.userId;
          opponentStat = await PlayerStats.findOne({
            tournament: tournament._id,
            userId: currentMatch.player2.userId,
          }).session(session);
          matchUpdateMessage = `Match ${currentMatch.matchId}: <@${currentMatch.player2.userId}> wins by default as <@${playerId}> was dropped.`;
        } else if (
          currentMatch.player2 &&
          currentMatch.player2.userId === playerId &&
          currentMatch.player1
        ) {
          // Dropped was P2, P1 exists
          currentMatch.winnerId = currentMatch.player1.userId;
          opponentStat = await PlayerStats.findOne({
            tournament: tournament._id,
            userId: currentMatch.player1.userId,
          }).session(session);
          matchUpdateMessage = `Match ${currentMatch.matchId}: <@${currentMatch.player1.userId}> wins by default as <@${playerId}> was dropped.`;
        } else {
          // Player was in a bye or something unusual
          if (
            currentMatch.player1 &&
            currentMatch.player1.userId === playerId &&
            !currentMatch.player2
          ) {
            matchUpdateMessage = `Match ${currentMatch.matchId} (BYE for <@${playerId}>) is void as player was dropped.`;
          }
        }

        currentMatch.reported = true;

        // Update opponent stats if there is an opponent and a winner
        if (opponentStat && currentMatch.winnerId) {
          opponentStat.score += 3;
          opponentStat.wins += 1;
          opponentStat.opponents.addToSet(playerId);
          await opponentStat.save({ session });
        }

        await currentMatch.save({ session });
      }

      await session.commitTransaction();

      return {
        tournament,
        playerId,
        matchUpdateMessage,
      };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Validates the current round of a tournament, calculates standings, and proceeds to the next stage.
   * @param {string} tournamentId - The tournament ID.
   * @param {string} organizerId - The Discord user ID of the organizer.
   * @param {string} organizerTag - The Discord tag of the organizer.
   * @param {Object} client - The Discord client for leaderboard display.
   * @param {string} channelId - The Discord channel ID for leaderboard display.
   * @returns {Promise<Object>} Object containing the tournament, validation results, and next round information.
   */
  async validateRound(interaction, tournamentId, organizerId, organizerTag) {
    const session = await mongoose.startSession();
    const client = interaction.client;
    const channelId = interaction.channelId;
    session.startTransaction();

    try {
      // Ensure the validating user (organizer) exists
      await this.userService.findOrCreateUser(
        organizerId,
        organizerTag,
        session
      );

      const tournament = await Tournament.findOne({ tournamentId })
        .populate("participants")
        .session(session);

      if (!tournament) {
        throw new Error(`Tournament with ID ${tournamentId} not found.`);
      }

      if (tournament.organizerId !== organizerId) {
        throw new Error("Only the tournament organizer can validate rounds.");
      }

      if (tournament.status !== "active") {
        throw new Error(
          `This tournament is not active. Current status: ${tournament.status}.`
        );
      }

      // Check if all matches in the current round are reported
      const currentRoundMatches = await Match.find({
        tournament: tournament._id,
        roundNumber: tournament.currentRound,
      }).session(session);

      if (currentRoundMatches.length === 0 && tournament.currentRound > 0) {
        throw new Error(
          `No matches found for the current round (${tournament.currentRound}) of tournament ${tournament.tournamentId}. Please check the tournament state or contact support.`
        );
      }

      const unreportedMatches = currentRoundMatches.filter(
        (match) => !match.reported
      );
      if (unreportedMatches.length > 0) {
        const unreportedMatchIds = unreportedMatches
          .map((m) => m.matchId)
          .join(", ");
        throw new Error(
          `Cannot validate round ${tournament.currentRound}. The following matches are still unreported: ${unreportedMatchIds}.`
        );
      }

      // --- Main Validation Logic ---
      // Store the round number being validated *before* any potential increments
      const validatedRoundNumber = tournament.currentRound;

      const allPlayerStatsForTournament = await PlayerStats.find({
        tournament: tournament._id,
      }).session(session);
      let isTopCutPhase =
        tournament.config.topCutSize > 0 &&
        tournament.currentRound > tournament.config.numSwissRounds;

      // 1. Calculate Standings (always useful, especially for Swiss)
      const currentStandings = await this.calculateStandings(
        tournament._id,
        allPlayerStatsForTournament,
        session
      );

      let nextRoundEmbed = new EmbedBuilder()
        .setTimestamp()
        .setFooter({ text: `Tournament ID: ${tournament.tournamentId} | Organizer: ${organizerTag}` });
      let operationMessage = "";
      let pairingsDescriptionList = [];

      if (!isTopCutPhase) {
        // --- SWISS ROUNDS ---
        operationMessage = `Validating Swiss Round ${tournament.currentRound}.`;
        nextRoundEmbed.setTitle(
          `Swiss Round ${tournament.currentRound} Results & Next Round — ${tournament.title}`
        );

        const standingsDescription = currentStandings
          .map(
            (ps, index) =>
              `${index + 1}. <@${ps.userId}>: ${
                ps.score
              } pts (OWP: ${ps.tiebreaker1_OWP.toFixed(
                3
              )}, OOWP: ${ps.tiebreaker2_OOWP.toFixed(3)})`
          )
          .join("\n");
        nextRoundEmbed.addFields({
          name: `Current Standings (after Round ${tournament.currentRound})`,
          value: standingsDescription || "No players.",
        });

        if (tournament.currentRound < tournament.config.numSwissRounds) {
          // Generate next Swiss round
          tournament.currentRound += 1;
          const result = await this.generateNextSwissRoundPairings(
            tournament,
            currentStandings,
            tournament.currentRound,
            session
          );
          pairingsDescriptionList = result.pairingsDescriptionList;

          if (result.newMatchesInfo.length > 0) {
            nextRoundEmbed.addFields({
              name: `Swiss Round ${tournament.currentRound} Pairings`,
              value: pairingsDescriptionList.join("\n"),
            });
            operationMessage += `\nGenerated pairings for Swiss Round ${tournament.currentRound}.`;
          } else {
            nextRoundEmbed.addFields({
              name: `Swiss Round ${tournament.currentRound} Pairings`,
              value:
                "Could not generate pairings (e.g., all remaining are rematches or error).",
            });
            operationMessage += `\nCould not automatically generate pairings for Round ${tournament.currentRound}. Manual check needed.`;
          }
          await tournament.save({ session });
        } else {
          // Last Swiss round completed
          if (tournament.config.topCutSize > 0) {
            // Proceed to Top Cut
            isTopCutPhase = true; // Mark for next phase logic
            tournament.currentRound += 1; // Increment round number for the first top cut round
            const topCutPlayers = currentStandings.slice(
              0,
              tournament.config.topCutSize
            );

            // Assign initial seeds
            const seedPromises = topCutPlayers.map((ps, index) =>
              PlayerStats.updateOne(
                { _id: ps._id },
                { $set: { initialSeed: index + 1 } }
              ).session(session)
            );
            await Promise.all(seedPromises);
            // Re-fetch stats with seeds for these players
            const seededTopCutPlayers = await PlayerStats.find({
              _id: { $in: topCutPlayers.map((p) => p._id) },
            })
              .sort({ initialSeed: 1 })
              .session(session);

            const result = await this.generateTopCutPairings(
              tournament,
              seededTopCutPlayers,
              tournament.currentRound,
              session
            );
            pairingsDescriptionList = result.pairingsDescriptionList;

            nextRoundEmbed.setTitle(
              `End of Swiss - Top ${tournament.config.topCutSize} Cut Begins! — ${tournament.title}`
            );
            nextRoundEmbed.addFields({
              name: `Top ${tournament.config.topCutSize} Pairings (Round ${tournament.currentRound})`,
              value: pairingsDescriptionList.join("\n"),
            });
            operationMessage += `\nLast Swiss round finished. Generated Top ${tournament.config.topCutSize} pairings.`;
            await tournament.save({ session });
          } else {
            // No Top Cut, finish tournament
            operationMessage += `\nLast Swiss round finished. No top cut. Finalizing tournament.`;
            nextRoundEmbed.setTitle(
              `Tournament ${tournament.tournamentId} - Final Swiss Results — ${tournament.title}`
            );
            // Assign final ranks based on Swiss standings
            currentStandings.forEach((ps, index) => {
              ps.finalRank = index + 1;
            });
            await this.finishTournament(
              interaction,
              tournament,
              currentStandings,
              session
            );
            await session.commitTransaction();
            session.endSession();
            return {
              tournament,
              operationMessage,
              nextRoundEmbed,
              isFinished: true,
            };
          }
        }
      }

      if (isTopCutPhase && tournament.status === "active") {
        // Check status again in case it was finished above
        // --- TOP CUT ROUNDS ---
        // Determine current stage of top cut (e.g. QF, SF, F) by number of active players or round number
        const activeTopCutPlayers = currentStandings.filter(
          (ps) =>
            ps.initialSeed > 0 && // Was part of top cut
            !currentRoundMatches.some(
              (m) =>
                (m.player1?.userId === ps.userId ||
                  m.player2?.userId === ps.userId) &&
                m.winnerId !== ps.userId &&
                !m.isDraw
            ) // Did not lose in current round
        );
        // More accurately, find winners of the *just validated* top cut round
        const winnersOfValidatedRound = [];
        for (const match of currentRoundMatches) {
          if (match.isTopCutRound && match.reported && match.winnerId) {
            const winnerStat = allPlayerStatsForTournament.find(
              (ps) => ps.userId === match.winnerId
            );
            if (winnerStat) winnersOfValidatedRound.push(winnerStat);
            // Set elimination stage for the loser
            if (match.winnerId) {
              // If there's a winner, there's a loser
              const loserId =
                match.player1.userId === match.winnerId
                  ? match.player2.userId
                  : match.player1.userId;
              if (loserId) {
                // Ensure loserId is valid
                let stage = "";
                const numPlayersInCutPreviously =
                  winnersOfValidatedRound.length * 2; // Approx players before this round
                if (numPlayersInCutPreviously === tournament.config.topCutSize)
                  stage = `Top${tournament.config.topCutSize}`;
                else if (numPlayersInCutPreviously === 4)
                  stage = "SF"; // Eliminated in Semifinals
                else if (numPlayersInCutPreviously === 8)
                  stage = "QF"; // Eliminated in Quarterfinals
                else if (numPlayersInCutPreviously === 16) stage = "Top16"; // Eliminated in Top 16

                const playersInValidatedRound = currentRoundMatches.length * 2;
                if (playersInValidatedRound === 4)
                  stage = "SF"; // Loser of SF is out at SF stage
                else if (playersInValidatedRound === 8)
                  stage = "QF"; // Loser of QF is out at QF stage
                else if (playersInValidatedRound === 16) stage = "Top16"; // Loser of Top16 round is out at Top16 stage
                // No stage for finals loser here, that's Rank 2.

                if (stage) {
                  await PlayerStats.updateOne(
                    { tournament: tournament._id, userId: loserId },
                    { $set: { eliminationStage: stage } }
                  ).session(session);
                }
              }
            }
          }
        }

        if (
          winnersOfValidatedRound.length === 1 &&
          currentRoundMatches.some((m) => m.isTopCutRound)
        ) {
          // Only one winner means it was the Finals match that was just validated
          operationMessage += `\nFinals match reported. Finalizing tournament.`;
          // Tournament finished after Top Cut. Calculate final ranks.
          const finalRankedStats = [];
          const finalMatch = currentRoundMatches.find(
            (m) => m.isTopCutRound && m.reported
          ); // The final match just validated

          if (finalMatch && finalMatch.winnerId) {
            const winner = allPlayerStatsForTournament.find(
              (ps) => ps.userId === finalMatch.winnerId
            );
            const runnerUp = allPlayerStatsForTournament.find(
              (ps) =>
                (ps.userId === finalMatch.player1.userId ||
                  ps.userId === finalMatch.player2.userId) &&
                ps.userId !== finalMatch.winnerId
            );
            if (winner) {
              winner.finalRank = 1;
              winner.eliminationStage = "Winner";
              finalRankedStats.push(winner);
            }
            if (runnerUp) {
              runnerUp.finalRank = 2;
              runnerUp.eliminationStage = "Runner-up";
              finalRankedStats.push(runnerUp);
            }
          }

          // Group other top cut players by elimination stage
          const eliminationStagesOrder = ["SF", "QF", "Top16"]; // Highest eliminated to lowest
          let currentRank = 3;

          for (const stage of eliminationStagesOrder) {
            const eliminatedThisStage = allPlayerStatsForTournament.filter(
              (ps) => ps.eliminationStage === stage && !ps.finalRank
            );
            // Sort by initialSeed (lower seed is better rank)
            eliminatedThisStage.sort((a, b) => a.initialSeed - b.initialSeed);

            eliminatedThisStage.forEach((ps) => {
              ps.finalRank = currentRank;
              finalRankedStats.push(ps);
              currentRank++;
            });
          }

          // Add players who made top cut but somehow weren't caught by eliminationStage
          const remainingTopCutPlayers = allPlayerStatsForTournament.filter(
            (ps) => ps.initialSeed > 0 && !ps.finalRank
          );
          remainingTopCutPlayers.sort((a, b) => a.initialSeed - b.initialSeed);
          remainingTopCutPlayers.forEach((ps) => {
            ps.finalRank = currentRank++;
            finalRankedStats.push(ps);
          });

          // Add players who did not make top cut - their rank is based on Swiss standings
          const nonTopCutPlayers = allPlayerStatsForTournament.filter(
            (ps) => !(ps.initialSeed > 0)
          );
          // They should already be sorted by Swiss performance by `calculateStandings` if it was run last for them
          // Or re-sort them here to be sure:
          nonTopCutPlayers.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            if (b.tiebreaker1_OWP !== a.tiebreaker1_OWP)
              return b.tiebreaker1_OWP - a.tiebreaker1_OWP;
            return b.tiebreaker2_OOWP - a.tiebreaker2_OOWP;
          });
          nonTopCutPlayers.forEach((ps) => {
            ps.finalRank = currentRank++; // Continue ranking from where top cut players left off
            finalRankedStats.push(ps);
          });

          // Ensure all players have a final rank, even if something went wrong
          allPlayerStatsForTournament.forEach((ps) => {
            if (!ps.finalRank) {
              ps.finalRank = currentRank++; // Assign a trailing rank
              if (!finalRankedStats.find((rs) => rs.userId === ps.userId))
                finalRankedStats.push(ps);
            }
          });
          finalRankedStats.sort((a, b) => a.finalRank - b.finalRank);

          await this.finishTournament(
            tournament,
            finalRankedStats,
            client,
            channelId,
            session
          );
          await session.commitTransaction();
          session.endSession();
          return {
            tournament,
            operationMessage,
            nextRoundEmbed,
            isFinished: true,
          };
        } else if (winnersOfValidatedRound.length > 1) {
          // More than one winner, so previous top cut round finished, generate next stage
          tournament.currentRound += 1;
          // Ensure winnersOfValidatedRound are sorted by their initial seed for consistent pairing generation
          winnersOfValidatedRound.sort((a, b) => a.initialSeed - b.initialSeed);

          const result = await this.generateTopCutPairings(
            tournament,
            winnersOfValidatedRound,
            tournament.currentRound,
            session
          );
          pairingsDescriptionList = result.pairingsDescriptionList;

          let stageName = "Next Top Cut Round";
          if (result.newMatchesInfo.length === 1) stageName = "Finals";
          else if (result.newMatchesInfo.length === 2)
            stageName =
              "Semifinals"; // Assuming if 4 players made it, next is SF
          else if (result.newMatchesInfo.length === 4)
            stageName = "Quarterfinals"; // Assuming if 8 players made it, next is QF

          nextRoundEmbed.setTitle(`${stageName} Pairings (Round ${tournament.currentRound}) — ${tournament.title}`);
          nextRoundEmbed.addFields({
            name: `${stageName} Pairings`,
            value: pairingsDescriptionList.join("\n"),
          });
          operationMessage += `\nValidated Top Cut Round. Generated pairings for ${stageName}.`;
          await tournament.save({ session });
        } else if (
          winnersOfValidatedRound.length === 0 &&
          currentRoundMatches.some((m) => m.isTopCutRound)
        ) {
          // No winners from the reported top cut matches, implies something went wrong or all were draws (unhandled)
          operationMessage += `\nError: No winners found from the reported top cut round. Cannot proceed.`;
          nextRoundEmbed.setDescription(
            "Could not determine winners for the next stage of top cut."
          );
        }
        // If it's the *first* top cut round being validated, the logic is handled by the end of the Swiss block.
        // This block is for subsequent top cut rounds.
      }

      // Before committing, if the round was successfully processed (not finished yet or just finished),
      // clear the pre-report stats for the validated round's matches.
      if (
        tournament.status === "active" ||
        (tournament.status === "finished" &&
          operationMessage.includes("Finalizing tournament"))
      ) {
        // `currentRoundMatches` are the matches of the round that was just processed.
        // Or, if it was the move from Swiss to TopCut, `validatedRoundNumber` holds the last Swiss round number.
        // Or, if advancing top cut, `validatedRoundNumber` holds the top cut round number just processed.

        const matchesOfValidatedRound = await Match.find({
          tournament: tournament._id,
          roundNumber: validatedRoundNumber, // Use the stored round number
        }).session(session);

        for (const match of matchesOfValidatedRound) {
          if (match.reported) {
            // Only clear if it was reported and thus potentially had stored stats
            match.player1StatsBeforeReport = undefined;
            match.player2StatsBeforeReport = undefined;
            await match.save({ session });
          }
        }
      }

      await session.commitTransaction();

      return {
        tournament,
        operationMessage,
        nextRoundEmbed,
        isFinished: false,
      };
    } catch (error) {
      await session.abortTransaction();
      console.log("Transaction aborted due to error:", error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Calculates player standings, including tiebreakers OWP and OOWP.
   * This function MUTATES the playerStats objects by adding OWP and OOWP.
   * @private
   */
  async calculateStandings(
    tournamentId,
    allPlayersStatsForTournament,
    session
  ) {
    // Create a map for quick lookup of player stats by userId
    const playerStatsMap = new Map(
      allPlayersStatsForTournament.map((ps) => [ps.userId, ps])
    );

    // Calculate OWP (Opponent Win Percentage) for each player
    for (const playerStat of allPlayersStatsForTournament) {
      let totalOpponentWinPercentage = 0;
      let opponentsConsideredForOWP = 0;

      for (const opponentId of playerStat.opponents) {
        const opponentStat = playerStatsMap.get(opponentId);
        if (opponentStat) {
          const opponentByes = opponentStat.receivedByeInRound > 0 ? 1 : 0;
          const opponentActualWins = opponentStat.wins - opponentByes;
          const opponentTotalMatchesIncludingByes =
            opponentStat.wins + opponentStat.losses + opponentStat.draws;
          const opponentActualMatchesPlayed =
            opponentTotalMatchesIncludingByes - opponentByes;

          let opponentWinPerc = 0; // Default to 0 if no actual matches played
          if (opponentActualMatchesPlayed > 0) {
            opponentWinPerc = Math.max(
              0.25,
              opponentActualWins / opponentActualMatchesPlayed
            );
          }

          totalOpponentWinPercentage += opponentWinPerc;
          opponentsConsideredForOWP++;
        }
      }
      playerStat.tiebreaker1_OWP =
        opponentsConsideredForOWP > 0
          ? totalOpponentWinPercentage / opponentsConsideredForOWP
          : 0;
    }

    // Calculate OOWP (Opponent's Opponent Win Percentage) for each player
    for (const playerStat of allPlayersStatsForTournament) {
      let totalOpponentsOWP = 0;
      let opponentsConsideredForOOWP = 0;

      for (const opponentId of playerStat.opponents) {
        const opponentStat = playerStatsMap.get(opponentId);
        if (opponentStat) {
          // opponentStat already has its OWP calculated
          totalOpponentsOWP += opponentStat.tiebreaker1_OWP;
          opponentsConsideredForOOWP++;
        }
      }
      playerStat.tiebreaker2_OOWP =
        opponentsConsideredForOOWP > 0
          ? totalOpponentsOWP / opponentsConsideredForOOWP
          : 0;
    }

    // Sort players: 1. Score (desc), 2. OWP (desc), 3. OOWP (desc)
    allPlayersStatsForTournament.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.tiebreaker1_OWP !== a.tiebreaker1_OWP)
        return b.tiebreaker1_OWP - a.tiebreaker1_OWP;
      return b.tiebreaker2_OOWP - a.tiebreaker2_OOWP;
    });

    // Update PlayerStats in DB with calculated tiebreakers
    const updatePromises = allPlayersStatsForTournament.map((ps) =>
      PlayerStats.updateOne(
        { _id: ps._id },
        {
          tiebreaker1_OWP: ps.tiebreaker1_OWP,
          tiebreaker2_OOWP: ps.tiebreaker2_OOWP,
        }
      ).session(session)
    );
    await Promise.all(updatePromises);

    return allPlayersStatsForTournament;
  }

  /**
   * Generates pairings for the next Swiss round.
   * @private
   */
  async generateNextSwissRoundPairings(
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
  findSwissPairings(players) {
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

  backtrackPairings(remainingPlayers, currentPairings, pairedPlayerIds) {
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

  /**
   * Generates pairings for a top cut round.
   * @private
   */
  async generateTopCutPairings(
    tournament,
    topCutQualifiedStats,
    topCutRoundNumber,
    session
  ) {
    const pairingsDescriptionList = [];
    const newMatchesInput = [];
    let matchCounter = await Match.countDocuments({
      tournament: tournament._id,
    }).session(session);

    // topCutQualifiedStats should be sorted by their Swiss seeding (1st, 2nd, etc.)
    // Their `initialSeed` field in PlayerStats should reflect this (1 to N)

    const numPlayersInCut = topCutQualifiedStats.length;

    if (numPlayersInCut === 2) {
      // Finals
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
      pairingsDescriptionList.push(
        `Finals (Match ${matchId}): <@${p1.userId}> (Seed ${p1.initialSeed}) vs <@${p2.userId}> (Seed ${p2.initialSeed})`
      );
    } else if (numPlayersInCut === 4) {
      // Semifinals (Top 4)
      // Seeds are 1,2,3,4 based on initial Swiss. Pair 1v4, 2v3.
      const seed1 = topCutQualifiedStats.find((p) => p.initialSeed === 1);
      const seed2 = topCutQualifiedStats.find((p) => p.initialSeed === 2);
      const seed3 = topCutQualifiedStats.find((p) => p.initialSeed === 3);
      const seed4 = topCutQualifiedStats.find((p) => p.initialSeed === 4);

      if (!seed1 || !seed2 || !seed3 || !seed4) {
        pairingsDescriptionList.push(
          "Error: Could not determine correct seeds for Top 4. Manual intervention required."
        );
        return { pairingsDescriptionList, newMatchesInfo: [] };
      }

      // Match 1: Seed 1 vs Seed 4
      matchCounter++;
      let matchId = formatMatchId(matchCounter);
      newMatchesInput.push({
        matchId,
        tournament: tournament._id,
        roundNumber: topCutRoundNumber,
        isTopCutRound: true,
        player1: { userId: seed1.userId, discordTag: seed1.discordTag },
        player2: { userId: seed4.userId, discordTag: seed4.discordTag },
      });
      pairingsDescriptionList.push(
        `Semifinal 1 (Match ${matchId}): <@${seed1.userId}> (Seed 1) vs <@${seed4.userId}> (Seed 4)`
      );

      // Match 2: Seed 2 vs Seed 3
      matchCounter++;
      matchId = formatMatchId(matchCounter);
      newMatchesInput.push({
        matchId,
        tournament: tournament._id,
        roundNumber: topCutRoundNumber,
        isTopCutRound: true,
        player1: { userId: seed2.userId, discordTag: seed2.discordTag },
        player2: { userId: seed3.userId, discordTag: seed3.discordTag },
      });
      pairingsDescriptionList.push(
        `Semifinal 2 (Match ${matchId}): <@${seed2.userId}> (Seed 2) vs <@${seed3.userId}> (Seed 3)`
      );
    } else if (numPlayersInCut === 8) {
      // Quarterfinals (Top 8)
      // Pairings: 1v8, 4v5, 2v7, 3v6
      const seeds = {};
      topCutQualifiedStats.forEach((p) => (seeds[p.initialSeed] = p));

      if (Object.keys(seeds).length !== 8) {
        pairingsDescriptionList.push(
          "Error: Could not determine correct seeds for Top 8. Manual intervention required."
        );
        return { pairingsDescriptionList, newMatchesInfo: [] };
      }

      const pairings = [
        [seeds[1], seeds[8]],
        [seeds[4], seeds[5]], // Top half of bracket
        [seeds[2], seeds[7]],
        [seeds[3], seeds[6]], // Bottom half of bracket
      ];
      for (const pair of pairings) {
        if (!pair[0] || !pair[1]) {
          pairingsDescriptionList.push(
            "Error: Incomplete seed for Top 8. Manual intervention needed."
          );
          continue; // Skip this pairing if a player is missing
        }
        matchCounter++;
        const matchId = formatMatchId(matchCounter);
        newMatchesInput.push({
          matchId,
          tournament: tournament._id,
          roundNumber: topCutRoundNumber,
          isTopCutRound: true,
          player1: { userId: pair[0].userId, discordTag: pair[0].discordTag },
          player2: { userId: pair[1].userId, discordTag: pair[1].discordTag },
        });
        pairingsDescriptionList.push(
          `Quarterfinal (Match ${matchId}): <@${pair[0].userId}> (Seed ${pair[0].initialSeed}) vs <@${pair[1].userId}> (Seed ${pair[1].initialSeed})`
        );
      }
    } else if (numPlayersInCut === 16) {
      // Top 16
      const seeds = {};
      topCutQualifiedStats.forEach((p) => (seeds[p.initialSeed] = p));

      if (Object.keys(seeds).length !== 16) {
        pairingsDescriptionList.push(
          "Error: Could not determine correct seeds for Top 16. Manual intervention required."
        );
        return { pairingsDescriptionList, newMatchesInfo: [] };
      }
      // Standard 16-player bracket:
      // 1v16, 8v9, 5v12, 4v13 (Quarter 1 & 2)
      // 2v15, 7v10, 6v11, 3v14 (Quarter 3 & 4)
      const pairings = [
        [seeds[1], seeds[16]],
        [seeds[8], seeds[9]],
        [seeds[5], seeds[12]],
        [seeds[4], seeds[13]],
        [seeds[2], seeds[15]],
        [seeds[7], seeds[10]],
        [seeds[6], seeds[11]],
        [seeds[3], seeds[14]],
      ];
      for (const pair of pairings) {
        if (!pair[0] || !pair[1]) {
          pairingsDescriptionList.push(
            "Error: Incomplete seed for Top 16. Manual intervention needed."
          );
          continue;
        }
        matchCounter++;
        const matchId = formatMatchId(matchCounter);
        newMatchesInput.push({
          matchId,
          tournament: tournament._id,
          roundNumber: topCutRoundNumber,
          isTopCutRound: true,
          player1: { userId: pair[0].userId, discordTag: pair[0].discordTag },
          player2: { userId: pair[1].userId, discordTag: pair[1].discordTag },
        });
        pairingsDescriptionList.push(
          `Top 16 (Match ${matchId}): <@${pair[0].userId}> (Seed ${pair[0].initialSeed}) vs <@${pair[1].userId}> (Seed ${pair[1].initialSeed})`
        );
      }
    } else {
      pairingsDescriptionList.push(
        `Error: Top cut size of ${numPlayersInCut} is not supported for automatic pairing.`
      );
      // No matches will be generated
    }

    // Create Match documents and update PlayerStats
    const createdMatchModels = [];
    if (newMatchesInput.length > 0) {
      const matchModelsToSave = newMatchesInput.map(
        (mInput) => new Match(mInput)
      );
      await Match.insertMany(matchModelsToSave, { session });
      createdMatchModels.push(...matchModelsToSave);

      const playerStatsUpdatePromises = [];
      for (const match of createdMatchModels) {
        const p1Stat = topCutQualifiedStats.find(
          (p) => p.userId === match.player1?.userId
        );
        const p2Stat = topCutQualifiedStats.find(
          (p) => p.userId === match.player2?.userId
        );

        if (p1Stat) {
          playerStatsUpdatePromises.push(
            PlayerStats.updateOne(
              { _id: p1Stat._id },
              { $push: { matchesPlayed: match._id } }
            ).session(session)
          );
        }
        if (p2Stat) {
          playerStatsUpdatePromises.push(
            PlayerStats.updateOne(
              { _id: p2Stat._id },
              { $push: { matchesPlayed: match._id } }
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
        isBye: false, // No byes in top cut
      })),
    };
  }

  /**
   * Finalizes a tournament and distributes prizes.
   * @param {Object} interaction - The Discord interaction object.
   * @param {Object} tournament - The tournament document.
   * @param {Array<Object>} allPlayerStatsFromTournament - The player stats for the tournament.
   * @param {Object} session - The MongoDB session.
   * @returns {Promise<void>}
   * @private
   */
  async finishTournament(interaction, tournament, allPlayerStatsFromTournament, session) {
    console.log(`Finishing tournament ${tournament.tournamentId}`);
    
    if (tournament.status === "finished") {
      await interaction.followUp({
        content: `Tournament ${tournament.tournamentId} has already been marked as finished.`,
      });
      return;
    }

    tournament.status = "finished";

    // Ensure all players have a final rank
    allPlayerStatsFromTournament.forEach((ps, index) => {
      if (!ps.finalRank) ps.finalRank = index + 1;
    });

    // Calculate prize pool and prepare distribution messages
    const totalPrizePool = tournament.auraCost * tournament.participants.length;
    const prizeDistributionMessages = [`Total Prize Pool: ${totalPrizePool} Aura`];

    // Maps and arrays to batch our database operations
    const userEloIncreases = new Map(); // userId -> amount
    const userStatUpdates = []; // For non-Elo stats like auraGainedTournaments
    const playerStatsFinalRankUpdates = []; // For updating final ranks
    const userComprehensiveUpdates = []; // For participations, wins/losses, etc.

    // Process prize distribution
    if (totalPrizePool > 0) {
      if (tournament.prizeMode === "all") {
        // Winner takes all
        const winnerStat = allPlayerStatsFromTournament.find(p => p.finalRank === 1);
        if (winnerStat) {
          prizeDistributionMessages.push(`Winner <@${winnerStat.userId}> receives ${totalPrizePool} Aura!`);
          userEloIncreases.set(winnerStat.userId, totalPrizePool);
          userStatUpdates.push({
            userId: winnerStat.userId,
            update: { $inc: { auraGainedTournaments: totalPrizePool, tournamentWins: 1 } }
          });
        } else {
          prizeDistributionMessages.push('No winner found for "Winner Takes All" mode. No prizes distributed.');
        }
      } else if (tournament.prizeMode === "spread") {
        // Distribute prizes based on final rankings
        let proportionsToUse;
        const topCutSize = tournament.config.topCutSize;
        
        // Select appropriate prize distribution
        if (topCutSize === 0) proportionsToUse = PRIZE_PROPORTIONS.top4_no_cut;
        else if (topCutSize === 4) proportionsToUse = PRIZE_PROPORTIONS.top4_cut;
        else if (topCutSize === 8) proportionsToUse = PRIZE_PROPORTIONS.top8_cut;
        else if (topCutSize === 16) proportionsToUse = PRIZE_PROPORTIONS.top16_cut;
        else proportionsToUse = PRIZE_PROPORTIONS.top4_no_cut; // Default

        // Calculate and distribute prizes
        const pendingPrizeAwards = [];
        let totalAuraDistributed = 0;

        // Process each rank range in the prize distribution
        for (const rankRange in proportionsToUse) {
          const proportion = proportionsToUse[rankRange];
          const prizeForRankRange = Math.floor(totalPrizePool * proportion);
          
          if (prizeForRankRange <= 0) continue;

          // Find players in this rank range
          let playersInRankRange = [];
          if (rankRange.includes("-")) {
            const [startRank, endRank] = rankRange.split("-").map(Number);
            playersInRankRange = allPlayerStatsFromTournament.filter(
              p => p.finalRank >= startRank && p.finalRank <= endRank
            );
          } else {
            const rank = Number(rankRange);
            playersInRankRange = allPlayerStatsFromTournament.filter(
              p => p.finalRank === rank
            );
          }

          // Distribute prize among players in this rank
          if (playersInRankRange.length > 0) {
            const prizePerPlayer = Math.floor(prizeForRankRange / playersInRankRange.length);
            if (prizePerPlayer > 0) {
              playersInRankRange.forEach(ps => {
                pendingPrizeAwards.push({
                  userId: ps.userId,
                  amount: prizePerPlayer,
                  finalRank: ps.finalRank
                });
                totalAuraDistributed += prizePerPlayer;
              });
            }
          }
        }

        // Handle remainder (give to winner)
        const remainder = totalPrizePool - totalAuraDistributed;
        if (remainder > 0) {
          const winnerAward = pendingPrizeAwards.find(p => p.finalRank === 1);
          if (winnerAward) {
            winnerAward.amount += remainder;
          } else {
            const winnerStat = allPlayerStatsFromTournament.find(p => p.finalRank === 1);
            if (winnerStat) {
              pendingPrizeAwards.push({
                userId: winnerStat.userId,
                amount: remainder,
                finalRank: 1
              });
            } else {
              prizeDistributionMessages.push(`Note: ${remainder} Aura remainder could not be awarded to a winner.`);
            }
          }
        }

        // Process all awards
        for (const award of pendingPrizeAwards) {
          prizeDistributionMessages.push(`<@${award.userId}> (Rank ${award.finalRank}) receives ${award.amount} Aura.`);
          userEloIncreases.set(award.userId, (userEloIncreases.get(award.userId) || 0) + award.amount);
          
          const incOps = { auraGainedTournaments: award.amount };
          if (award.finalRank === 1) {
            incOps.tournamentWins = 1; // Winner gets win counted
          }
          
          userStatUpdates.push({
            userId: award.userId,
            update: { $inc: incOps }
          });
        }
      }
    } else {
      prizeDistributionMessages.push("No Aura cost, so no prizes to distribute.");
    }

    // Prepare player stats final rank updates
    allPlayerStatsFromTournament.forEach(ps => {
      playerStatsFinalRankUpdates.push({
        _id: ps._id,
        finalRank: ps.finalRank
      });
    });

    // Prepare comprehensive user stat updates
    for (const playerStat of allPlayerStatsFromTournament) {
      userComprehensiveUpdates.push({
        userId: playerStat.userId,
        discordTag: playerStat.discordTag,
        stats: {
          tournamentParticipations: 1,
          totalWins: playerStat.wins || 0,
          totalLosses: playerStat.losses || 0
        },
        serverId: tournament.serverId
      });
    }

    // BATCH 1: Process direct user stat updates (non-Elo)
    if (userStatUpdates.length > 0) {
      console.log(`Processing ${userStatUpdates.length} direct user updates for aura gained/wins.`);
      await Promise.all(userStatUpdates.map(update => 
        User.updateOne(
          { discordId: update.userId },
          update.update
        ).session(session)
      ));
    }

    // BATCH 2: Process Elo updates
    const eloUpdatePromises = [];
    for (const [userId, eloIncrease] of userEloIncreases.entries()) {
      // Find player info
      const playerStat = allPlayerStatsFromTournament.find(ps => ps.userId === userId);
      const discordTag = playerStat?.discordTag || 
                        tournament.participants.find(p => p.userId === userId)?.discordTag || 
                        "UnknownUser#0000";
      
      // Get or create user
      const userDoc = await this.userService.findOrCreateUser(userId, discordTag, session);
      
      if (userDoc && eloIncrease > 0) {
        const newEloValue = userDoc.elo + eloIncrease;
        eloUpdatePromises.push(
          this.userService.updateUserRankPeakLow(userDoc, newEloValue, session)
        );
      }
    }

    // Handle winner who might not have gotten Elo
    const winnerStat = allPlayerStatsFromTournament.find(p => p.finalRank === 1);
    if (winnerStat && !userEloIncreases.has(winnerStat.userId)) {
      const winnerHasStatUpdate = userStatUpdates.some(update => 
        update.userId === winnerStat.userId && 
        update.update.$inc && 
        update.update.$inc.tournamentWins
      );
      
      if (!winnerHasStatUpdate) {
        const userDoc = await this.userService.findOrCreateUser(
          winnerStat.userId, 
          winnerStat.discordTag, 
          session
        );
        
        if (userDoc) {
          await User.updateOne(
            { discordId: winnerStat.userId },
            { $inc: { tournamentWins: 1 } }
          ).session(session);
        }
      }
    }

    if (eloUpdatePromises.length > 0) {
      console.log(`Processing ${eloUpdatePromises.length} user updates for Elo, rank, peak, and low.`);
      await Promise.all(eloUpdatePromises);
    }

    // BATCH 3: Update player stats final ranks
    if (playerStatsFinalRankUpdates.length > 0) {
      console.log(`Processing ${playerStatsFinalRankUpdates.length} player stats updates for final ranks.`);
      await Promise.all(playerStatsFinalRankUpdates.map(update => 
        PlayerStats.updateOne(
          { _id: update._id },
          { $set: { finalRank: update.finalRank } }
        ).session(session)
      ));
    }

    // BATCH 4: Update comprehensive user stats
    if (userComprehensiveUpdates.length > 0) {
      console.log(`Processing ${userComprehensiveUpdates.length} user updates for participations, total wins/losses, and playedOnServers.`);
      
      const userUpdatePromises = [];
      for (const update of userComprehensiveUpdates) {
        const userDoc = await this.userService.findOrCreateUser(
          update.userId,
          update.discordTag,
          session
        );
        
        if (userDoc) {
          userUpdatePromises.push(
            User.updateOne(
              { discordId: update.userId },
              {
                $inc: {
                  tournamentParticipations: 1,
                  totalWins: update.stats.totalWins,
                  totalLosses: update.stats.totalLosses
                },
                $addToSet: { playedOnServers: update.serverId }
              }
            ).session(session)
          );
        }
      }
      
      await Promise.all(userUpdatePromises);
    }

    // Save tournament status
    await tournament.save({ session });

    // Create final standings embed
    const finalStandingsEmbed = new EmbedBuilder()
      .setColor("#FFD700")
      .setTitle(`Tournament ${tournament.tournamentId} - Final Results — ${tournament.title}`)
      .setDescription(`The tournament has concluded!`)
      .addFields(
        {
          name: "Prize Distribution",
          value: prizeDistributionMessages.join("\n") || "No prizes.",
        }
      );

    // Add standings to embed
    const topPlayersToShow = Math.min(allPlayerStatsFromTournament.length, 32);
    let standingsText = allPlayerStatsFromTournament
      .slice(0, topPlayersToShow)
      .map(ps => 
        `${ps.finalRank}- <@${ps.userId}> (${ps.wins}-${ps.draws}-${ps.losses}) (${ps.tiebreaker1_OWP.toFixed(3) * 100}% | ${ps.tiebreaker2_OOWP.toFixed(3) * 100}% )`
      )
      .join("\n");
      
    if (allPlayerStatsFromTournament.length > topPlayersToShow) {
      standingsText += `\n...and ${allPlayerStatsFromTournament.length - topPlayersToShow} more.`;
    }
    
    finalStandingsEmbed.addFields({
      name: "Final Standings",
      value: standingsText || "No standings available.",
    });

    // Add organizer info
    const client = interaction.client;
    const organizerUser = await client.users
      .fetch(tournament.organizerId)
      .catch(() => null);

    finalStandingsEmbed
      .setFooter({ text: `Tournament ID: ${tournament.tournamentId} | Organized by: ${organizerUser?.tag || tournament.organizerId}` })
      .setTimestamp();

    // Send final results
    await interaction.followUp({ embeds: [finalStandingsEmbed] });

    // Clean up tournament data
    try {
      const tournamentObjectId = tournament._id;
      
      // Delete matches and player stats in parallel
      const [matchDeletionResult, playerStatsDeletionResult] = await Promise.all([
        Match.deleteMany({ tournament: tournamentObjectId }).session(session),
        PlayerStats.deleteMany({ tournament: tournamentObjectId }).session(session)
      ]);
      
      console.log(
        `Deleted ${matchDeletionResult.deletedCount} matches and ${playerStatsDeletionResult.deletedCount} playerStats for tournament ${tournament.tournamentId}`
      );
    } catch (deleteError) {
      console.error(
        `Error deleting matches/playerStats for tournament ${tournament.tournamentId}:`,
        deleteError
      );
    }
  }
}
