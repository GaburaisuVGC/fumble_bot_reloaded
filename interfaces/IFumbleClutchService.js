/**
 * Interface for fumble and clutch related services.
 * This interface defines the contract for services that handle fumbles and clutches.
 */
export default class IFumbleClutchService {
    /**
     * Processes a fumble for a user.
     * @param {string} userId - The Discord user ID.
     * @param {string} username - The Discord username.
     * @param {string} context - The context of the fumble.
     * @param {Array<Object>} votes - The votes for the fumble (upvotes and downvotes).
     * @param {number} createdTimestamp - The timestamp when the fumble was created.
     * @returns {Promise<Object>} The result of the fumble processing.
     */
    async processFumble(userId, username, context, votes, createdTimestamp) {
        throw new Error('Method not implemented');
    }

    /**
     * Processes a clutch for a user.
     * @param {string} userId - The Discord user ID.
     * @param {string} username - The Discord username.
     * @param {string} context - The context of the clutch.
     * @param {Array<Object>} votes - The votes for the clutch (upvotes and downvotes).
     * @param {number} createdTimestamp - The timestamp when the clutch was created.
     * @returns {Promise<Object>} The result of the clutch processing.
     */
    async processClutch(userId, username, context, votes, createdTimestamp) {
        throw new Error('Method not implemented');
    }

    /**
     * Calculates the ELO change for a fumble or clutch.
     * @param {Array<Object>} votes - The votes (upvotes and downvotes).
     * @param {number} createdTimestamp - The timestamp when the fumble/clutch was created.
     * @param {number} comboMultiplier - The user's current combo multiplier.
     * @returns {Object} The calculated ELO change and related statistics.
     */
    calculateEloChange(votes, createdTimestamp, comboMultiplier) {
        throw new Error('Method not implemented');
    }

    /**
     * Creates an embed for a new fumble.
     * @param {string} username - The Discord username.
     * @param {string} context - The context of the fumble.
     * @param {string} avatarUrl - The URL of the user's avatar.
     * @returns {Object} The fumble embed.
     */
    createFumbleEmbed(username, context, avatarUrl) {
        throw new Error('Method not implemented');
    }

    /**
     * Creates an embed for a new clutch.
     * @param {string} username - The Discord username.
     * @param {string} context - The context of the clutch.
     * @param {string} avatarUrl - The URL of the user's avatar.
     * @returns {Object} The clutch embed.
     */
    createClutchEmbed(username, context, avatarUrl) {
        throw new Error('Method not implemented');
    }

    /**
     * Creates a result embed for a fumble.
     * @param {string} username - The Discord username.
     * @param {string} context - The context of the fumble.
     * @param {string} avatarUrl - The URL of the user's avatar.
     * @param {Object} stats - The statistics for the fumble.
     * @param {number} initialElo - The initial ELO of the user.
     * @param {number} finalElo - The final ELO of the user.
     * @param {string} rankChange - The rank change message (if any).
     * @returns {Object} The fumble result embed.
     */
    createFumbleResultEmbed(username, context, avatarUrl, stats, initialElo, finalElo, rankChange) {
        throw new Error('Method not implemented');
    }

    /**
     * Creates a result embed for a clutch.
     * @param {string} username - The Discord username.
     * @param {string} context - The context of the clutch.
     * @param {string} avatarUrl - The URL of the user's avatar.
     * @param {Object} stats - The statistics for the clutch.
     * @param {number} initialElo - The initial ELO of the user.
     * @param {number} finalElo - The final ELO of the user.
     * @param {string} rankChange - The rank change message (if any).
     * @returns {Object} The clutch result embed.
     */
    createClutchResultEmbed(username, context, avatarUrl, stats, initialElo, finalElo, rankChange) {
        throw new Error('Method not implemented');
    }
}