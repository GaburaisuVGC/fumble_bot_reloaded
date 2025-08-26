/**
 * Interface for tournament-related services.
 * This interface defines the contract for services that manage tournaments.
 */
export default class ITournamentService {
    /**
     * Creates a new tournament.
     * @param {string} serverId - The Discord server ID.
     * @param {string} organizerId - The Discord user ID of the organizer.
     * @param {number} auraCost - The Aura (ELO) cost to join the tournament.
     * @param {string} prizeMode - How prizes are distributed ('all' or 'spread').
     * @returns {Promise<Object>} The created tournament.
     */
    async createTournament(serverId, organizerId, auraCost, prizeMode) {
        throw new Error('Method not implemented');
    }

    /**
     * Adds a participant to a tournament.
     * @param {string} tournamentId - The tournament ID.
     * @param {string} userId - The Discord user ID.
     * @param {string} discordTag - The Discord tag of the user.
     * @returns {Promise<Object>} The updated tournament.
     */
    async joinTournament(tournamentId, userId, discordTag) {
        throw new Error('Method not implemented');
    }

    /**
     * Removes a participant from a tournament.
     * @param {string} tournamentId - The tournament ID.
     * @param {string} userId - The Discord user ID.
     * @returns {Promise<Object>} The updated tournament.
     */
    async leaveTournament(tournamentId, userId) {
        throw new Error('Method not implemented');
    }

    /**
     * Starts a tournament and creates the first round of matches.
     * @param {string} tournamentId - The tournament ID.
     * @param {number} numSwissRounds - The number of Swiss rounds.
     * @param {number} topCutSize - The size of the top cut.
     * @returns {Promise<Object>} The started tournament with first round matches.
     */
    async startTournament(tournamentId, numSwissRounds, topCutSize) {
        throw new Error('Method not implemented');
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
    async reportMatch(tournamentId, matchId, winnerId, winnerTag, drawOpponentId, drawOpponentTag, reporterId, reporterTag) {
        throw new Error('Method not implemented');
    }

    /**
     * Advances the tournament to the next round.
     * @param {string} tournamentId - The tournament ID.
     * @returns {Promise<Object>} The tournament with next round matches.
     */
    async advanceToNextRound(tournamentId) {
        throw new Error('Method not implemented');
    }

    /**
     * Resets a specific round in a tournament.
     * @param {string} tournamentId - The tournament ID.
     * @param {number} roundNumber - The round number to reset.
     * @returns {Promise<Object>} The tournament with reset round.
     */
    async resetRound(tournamentId, roundNumber) {
        throw new Error('Method not implemented');
    }

    /**
     * Gets the current standings for a tournament.
     * @param {string} tournamentId - The tournament ID.
     * @returns {Promise<Array<Object>>} The tournament standings.
     */
    async getTournamentStandings(tournamentId) {
        throw new Error('Method not implemented');
    }

    /**
     * Finalizes a tournament and distributes prizes.
     * @param {string} tournamentId - The tournament ID.
     * @returns {Promise<Object>} The finalized tournament.
     */
    async finalizeTournament(tournamentId) {
        throw new Error('Method not implemented');
    }

    /**
     * Gets the tournament leaderboard data.
     * @param {string} sortBy - The field to sort by ('wins', 'gained', 'delta', 'totalWins', 'winLossRatio').
     * @param {string} serverId - The Discord server ID (null for global leaderboard).
     * @param {Array<string>} specificUserIds - Specific user IDs to include (null for all users).
     * @returns {Promise<Array<Object>>} The sorted leaderboard data.
     */
    async getLeaderboard(sortBy, serverId, specificUserIds) {
        throw new Error('Method not implemented');
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
    async createLeaderboardEmbed(client, users, page, sortBy, serverName) {
        throw new Error('Method not implemented');
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
    async displayTournamentLeaderboard(client, serverId, channelId, sort, specificUserIds) {
        throw new Error('Method not implemented');
    }

    /**
     * Drops a player from a tournament.
     * @param {string} tournamentId - The tournament ID.
     * @param {string} playerId - The Discord user ID of the player to drop.
     * @param {string} organizerId - The Discord user ID of the organizer executing the command.
     * @returns {Promise<Object>} Object containing the tournament, player, and match update message.
     */
    async dropPlayer(tournamentId, playerId, organizerId) {}

    /**
     * Validates the current round of a tournament, calculates standings, and proceeds to the next stage.
     * @param {string} tournamentId - The tournament ID.
     * @param {string} organizerId - The Discord user ID of the organizer.
     * @param {string} organizerTag - The Discord tag of the organizer.
     * @param {Object} client - The Discord client for leaderboard display.
     * @param {string} channelId - The Discord channel ID for leaderboard display.
     * @returns {Promise<Object>} Object containing the tournament, validation results, and next round information.
     */
    async validateRound(tournamentId, organizerId, organizerTag, client, channelId) {}
}