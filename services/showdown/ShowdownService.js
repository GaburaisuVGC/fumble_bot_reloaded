import axios from 'axios';
import cheerio from 'cheerio';
import { EmbedBuilder } from 'discord.js';
import Server from '../../models/Server.js';
import IShowdownService from '../../interfaces/IShowdownService.js';
import showdownConfig from '../../config/showdown.js';

/**
 * Service for Pokemon Showdown related operations.
 * Implements the IShowdownService interface.
 */
export default class ShowdownService extends IShowdownService {
    constructor(client) {
        super();
        this.client = client;
        this.config = showdownConfig;
    }

    /**
     * Fetches user data from Pokemon Showdown.
     * @param {string} username - The Pokemon Showdown username.
     * @returns {Promise<Object|null>} The user data or null if not found.
     */
    async getUserData(username, attempt = 1) {
        try {
            console.log(`[${new Date().toISOString()}] Attempt ${attempt}/${this.config.MAX_RETRIES} for ${username}`);
            
            const response = await axios.get(`https://pokemonshowdown.com/users/${username}`, {
                timeout: this.config.TIMEOUT,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                    'Accept-Encoding': 'gzip, deflate',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1'
                }
            });

            const html = response.data;
            const $ = cheerio.load(html);

            // Get the username
            const pseudo = $('h1').text().trim();
            
            if (!pseudo) {
                console.log(`[${new Date().toISOString()}] User ${username} not found or empty page`);
                return null;
            }

            // Search for the table containing stats
            const tables = $('table');
            let formatStats;

            tables.each((index, table) => {
                const rows = $(table).find('tr');
                rows.each((i, row) => {
                    const cells = $(row).find('td');
                    if (cells.length > 0 && $(cells[0]).text().includes(this.config.FORMAT)) {
                        formatStats = cells;
                    }
                });
            });

            if (!formatStats) {
                console.log(`[${new Date().toISOString()}] Format ${this.config.FORMAT} not found for ${username}`);
                return null;
            }

            // Extract information from the corresponding line
            const elo = parseInt($(formatStats[1]).text().trim(), 10);
            const gxe = $(formatStats[2]).text().trim();

            console.log(`[${new Date().toISOString()}] ✓ Data retrieved for ${username}: ELO=${elo}, GXE=${gxe}`);
            
            return { pseudo, elo, gxe };

        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error attempt ${attempt}/${this.config.MAX_RETRIES} for ${username}:`, error.message);

            // If it's a 503 error or timeout and there are retries left
            if (attempt < this.config.MAX_RETRIES && 
                (error.code === 'ECONNABORTED' || 
                 error.response?.status === 503 || 
                 error.response?.status === 502 ||
                 error.response?.status === 504 ||
                 error.code === 'ENOTFOUND' ||
                 error.code === 'ECONNRESET')) {
                
                const retryDelay = this.getRetryDelay(attempt);
                console.log(`[${new Date().toISOString()}] Waiting ${retryDelay}ms before retry for ${username}`);
                await this.sleep(retryDelay);
                
                return this.getUserData(username, attempt + 1);
            }

            // If all retries failed
            console.error(`[${new Date().toISOString()}] ❌ Final failure for ${username} after ${attempt} attempts`);
            return null;
        }
    }

    /**
     * Processes a batch of usernames to fetch their data from Pokemon Showdown.
     * @param {Array<string>} usernames - Array of Pokemon Showdown usernames.
     * @returns {Promise<Array<Object>>} Array of results with username and data.
     */
    async processUsersBatch(usernames) {
        const results = [];
        
        // Divide into small batches to avoid overloading the server
        for (let i = 0; i < usernames.length; i += this.config.BATCH_SIZE) {
            const batch = usernames.slice(i, i + this.config.BATCH_SIZE);
            
            console.log(`[${new Date().toISOString()}] Processing batch ${Math.floor(i/this.config.BATCH_SIZE) + 1}/${Math.ceil(usernames.length/this.config.BATCH_SIZE)} (${batch.length} users)`);
            
            // Process the batch in parallel
            const batchPromises = batch.map(username => this.getUserData(username));
            const batchResults = await Promise.allSettled(batchPromises);
            
            // Process results
            batchResults.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    results.push({ username: batch[index], data: result.value });
                } else {
                    console.error(`[${new Date().toISOString()}] Critical error for ${batch[index]}:`, result.reason);
                    results.push({ username: batch[index], data: null });
                }
            });
            
            // Wait between batches (except for the last one)
            if (i + this.config.BATCH_SIZE < usernames.length) {
                console.log(`[${new Date().toISOString()}] Waiting ${this.config.RATE_LIMIT_DELAY}ms before next batch...`);
                await this.sleep(this.config.RATE_LIMIT_DELAY);
            }
        }
        
        return results;
    }

    /**
     * Sends a daily summary of ladder rankings to registered servers.
     * @returns {Promise<void>}
     */
    async sendDailySummary() {
        console.log(`[${new Date().toISOString()}] 🌅 Starting daily summary`);
        
        const servers = await Server.find();
        
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const currentDate = yesterday.toLocaleDateString('en-US');

        for (const server of servers) {
            const { discordId, showdownRoom, registeredUsers } = server;

            if (!showdownRoom) continue;  // Skip servers with no showdown room set

            console.log(`[${new Date().toISOString()}] Processing server ${discordId} with ${registeredUsers.length} users`);

            // Get all usernames for this server
            const usernames = registeredUsers.map(user => user.username);
            
            // Process in batches with retry
            const results = await this.processUsersBatch(usernames);
            
            // Statistics for this server
            const successful = results.filter(r => r.data !== null).length;
            const failed = results.filter(r => r.data === null).length;
            
            console.log(`[${new Date().toISOString()}] Server ${discordId}: ${successful} successes, ${failed} failures`);

            let summaryData = [];

            // Process each user with the new data and prepare data for the summary
            for (const user of registeredUsers) {
                const { username, elo: previousElo, gxe: previousGxe } = user;
                
                // Find corresponding data
                const result = results.find(r => r.username === username);
                const userData = result ? result.data : null;

                if (!userData) {
                    console.log(`[${new Date().toISOString()}] ⚠️ No data for ${username}, keeping previous values`);
                    // Keep previous data if retrieval failed
                    summaryData.push({
                        username,
                        previousElo,
                        currentElo: previousElo,
                        previousGxe,
                        currentGxe: previousGxe,
                        dataAvailable: false
                    });
                    continue;
                }

                const { elo: currentElo, gxe: currentGxe } = userData;

                summaryData.push({
                    username,
                    previousElo,
                    currentElo,
                    previousGxe,
                    currentGxe: parseFloat(currentGxe),
                    dataAvailable: true
                });

                // Update user's elo and gxe in the database
                user.elo = currentElo;
                user.gxe = parseFloat(currentGxe);

            }

            // Sort users by current ELO, then by GXE in case of a tie
            summaryData.sort((a, b) => {
                if (b.currentElo === a.currentElo) {
                    return b.currentGxe - a.currentGxe;
                }
                return b.currentElo - a.currentElo;
            });

            // Build the summary with the correct values
            let summary = `\n`;
            for (const userData of summaryData) {
                const { username, previousElo, currentElo, previousGxe, currentGxe, dataAvailable } = userData;

                const eloDifference = currentElo - previousElo;
                const gxeDifference = currentGxe - previousGxe;

                if (!dataAvailable) {
                    summary += `- ${username} ${previousElo} -> ${currentElo} (0) ${previousGxe}% -> ${currentGxe}% (0.0%) [Data not available]\n`;
                } else {
                    summary += `- ${username} ${previousElo} -> ${currentElo} (${eloDifference >= 0 ? '+' : ''}${eloDifference}) ${previousGxe}% -> ${currentGxe}% (${gxeDifference >= 0 ? '+' : ''}${gxeDifference.toFixed(1)}%)\n`;
                }
            }

            // Save updated server data
            try {
                await server.save();
                console.log(`[${new Date().toISOString()}] ✅ Server ${discordId} saved`);
            } catch (error) {
                console.error(`[${new Date().toISOString()}] ❌ Error saving server ${discordId}:`, error);
            }

            // Send summary message to the specified channel
            const channel = this.client.channels.cache.get(showdownRoom);
            if (channel) {
                const embed = new EmbedBuilder()
                    .setColor('#0099ff')
                    .setTitle(`Ladder summary for ${currentDate}`)
                    .setDescription(summary)
                    .setFooter({ text: `${successful}/${registeredUsers.length} users updated successfully` })
                    .setTimestamp();

                try {
                    await channel.send({ embeds: [embed] });
                    console.log(`[${new Date().toISOString()}] ✅ Summary sent to server ${discordId}`);
                } catch (error) {
                    console.error(`[${new Date().toISOString()}] ❌ Error sending message to server ${discordId}:`, error);
                }
            } else {
                console.error(`[${new Date().toISOString()}] ❌ Channel not found for server ${discordId}`);
            }

            // Small pause between servers
            await this.sleep(500);
        }

        console.log(`[${new Date().toISOString()}] ✅ Daily summary completed`);
    }

    /**
     * Calculates the retry delay with exponential backoff.
     * @param {number} attempt - The current attempt number.
     * @returns {number} The delay in milliseconds.
     * @private
     */
    getRetryDelay(attempt) {
        const delay = this.config.RETRY_DELAY * Math.pow(2, attempt - 1);
        const jitter = Math.random() * 1000; // Add some randomness
        return Math.min(delay + jitter, this.config.MAX_RETRY_DELAY);
    }

    /**
     * Utility function to sleep for a specified duration.
     * @param {number} ms - The duration to sleep in milliseconds.
     * @returns {Promise<void>} A promise that resolves after the specified duration.
     * @private
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}