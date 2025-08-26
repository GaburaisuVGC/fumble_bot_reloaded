/**
 * Interface for user-related services.
 * This interface defines the contract for services that manage users.
 */
export default class IUserService {
    /**
     * Finds a user by their Discord ID or creates a new one if not found.
     * @param {string} discordId - The Discord ID of the user.
     * @param {string} discordTag - The Discord tag of the user.
     * @returns {Promise<Object>} The found or newly created user.
     */
    async findOrCreateUser(discordId, discordTag) {
        throw new Error('Method not implemented');
    }

    /**
     * Updates a user's rank, peak Elo, and lowest Elo based on a new Elo value.
     * @param {Object} user - The user document to update.
     * @param {number} newEloValue - The new Elo value.
     * @returns {Promise<Object>} The updated user.
     */
    async updateUserRankPeakLow(user, newEloValue) {
        throw new Error('Method not implemented');
    }

    /**
     * Gets a user's rank information.
     * @param {string} discordId - The Discord ID of the user.
     * @returns {Promise<Object>} The user's rank information.
     */
    async getUserRankInfo(discordId) {
        throw new Error('Method not implemented');
    }

    /**
     * Gets the leaderboard for a server.
     * @param {string} serverId - The Discord server ID.
     * @param {number} limit - The maximum number of users to return.
     * @returns {Promise<Array<Object>>} The server leaderboard.
     */
    async getServerLeaderboard(serverId, limit) {
        throw new Error('Method not implemented');
    }

    /**
     * Registers a user's Pokemon Showdown username.
     * @param {string} discordId - The Discord ID of the user.
     * @param {string} serverId - The Discord server ID.
     * @param {string} showdownUsername - The Pokemon Showdown username.
     * @returns {Promise<Object>} The updated server document.
     */
    async registerShowdownUsername(discordId, serverId, showdownUsername) {
        throw new Error('Method not implemented');
    }

    /**
     * Unregisters a user's Pokemon Showdown username.
     * @param {string} discordId - The Discord ID of the user.
     * @param {string} serverId - The Discord server ID.
     * @returns {Promise<Object>} The updated server document.
     */
    async unregisterShowdownUsername(discordId, serverId) {
        throw new Error('Method not implemented');
    }

    /**
     * Sets the Showdown room for a server.
     * @param {string} serverId - The Discord server ID.
     * @param {string} channelId - The Discord channel ID.
     * @returns {Promise<Object>} The updated server document.
     */
    async setShowdownRoom(serverId, channelId) {
        throw new Error('Method not implemented');
    }
}