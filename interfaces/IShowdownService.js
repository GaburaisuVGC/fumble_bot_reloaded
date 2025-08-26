/**
 * Interface for Pokemon Showdown related services.
 * This interface defines the contract for services that interact with Pokemon Showdown.
 */
export default class IShowdownService {
    /**
     * Fetches user data from Pokemon Showdown.
     * @param {string} username - The Pokemon Showdown username.
     * @returns {Promise<Object|null>} The user data or null if not found.
     */
    async getUserData(username) {
        throw new Error('Method not implemented');
    }

    /**
     * Processes a batch of usernames to fetch their data from Pokemon Showdown.
     * @param {Array<string>} usernames - Array of Pokemon Showdown usernames.
     * @returns {Promise<Array<Object>>} Array of results with username and data.
     */
    async processUsersBatch(usernames) {
        throw new Error('Method not implemented');
    }

    /**
     * Sends a daily summary of ladder rankings to registered servers.
     * @returns {Promise<void>}
     */
    async sendDailySummary() {
        throw new Error('Method not implemented');
    }
}