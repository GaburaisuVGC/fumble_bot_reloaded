import User from '../../models/User.js';
import Server from '../../models/Server.js';
import IUserService from '../../interfaces/IUserService.js';
import { findRank } from '../../utils/rank.js';

/**
 * Service for user-related operations.
 * Implements the IUserService interface.
 */
export default class UserService extends IUserService {
    /**
     * Finds a user by their Discord ID or creates a new one if not found.
     * @param {string} discordId - The Discord ID of the user.
     * @param {string} discordTag - The Discord tag of the user.
     * @returns {Promise<Object>} The found or newly created user.
     */
    async findOrCreateUser(discordId, discordTag) {
        let user = await User.findOne({ discordId });

        if (!user) {
            console.log(`User ${discordId} (${discordTag}) not found. Creating new user.`);
            user = new User({
                discordId: discordId,
                username: discordTag.includes('#') ? discordTag.substring(0, discordTag.lastIndexOf('#')) : discordTag,
                rank: 'Iron I',
                elo: 1000,
                fumbles: 0,
                clutches: 0,
                peakElo: 1000,
                lowestElo: 1000,
                fumbleCombo: 0,
                clutchCombo: 0,
                comboMultiplier: 1,
                auraGainedTournaments: 0,
                auraSpentTournaments: 0,
                tournamentWins: 0,
                tournamentParticipations: 0,
                totalWins: 0,
                totalLosses: 0,
                playedOnServers: []
            });
            await user.save();
            console.log(`New user ${discordId} (${discordTag}) created successfully.`);
        }
        return user;
    }

    /**
     * Updates a user's rank, peak Elo, and lowest Elo based on a new Elo value.
     * @param {Object} user - The user document to update.
     * @param {number} newEloValue - The new Elo value.
     * @returns {Promise<Object>} The updated user.
     */
    async updateUserRankPeakLow(user, newEloValue) {
        if (!user) {
            console.error("updateUserRankPeakLow called with null user.");
            throw new Error("User document must be provided to updateUserRankPeakLow.");
        }

        user.elo = newEloValue; // Set the new Elo value

        // Ensure peakElo and lowestElo are initialized if they are not present
        const currentPeakElo = user.peakElo === undefined || user.peakElo === null ? newEloValue : user.peakElo;
        const currentLowestElo = user.lowestElo === undefined || user.lowestElo === null ? newEloValue : user.lowestElo;

        user.peakElo = Math.max(currentPeakElo, newEloValue);
        user.lowestElo = Math.min(currentLowestElo, newEloValue);
        user.rank = findRank(newEloValue, user.rank);

        await user.save();
        return user;
    }

    /**
     * Gets a user's rank information.
     * @param {string} discordId - The Discord ID of the user.
     * @returns {Promise<Object>} The user's rank information.
     */
    async getUserRankInfo(discordId) {
        const user = await User.findOne({ discordId });
        if (!user) {
            throw new Error(`User with Discord ID ${discordId} not found.`);
        }
        
        return {
            username: user.username,
            rank: user.rank,
            elo: user.elo,
            peakElo: user.peakElo,
            lowestElo: user.lowestElo,
            fumbles: user.fumbles,
            clutches: user.clutches,
            fumbleCombo: user.fumbleCombo,
            clutchCombo: user.clutchCombo,
            comboMultiplier: user.comboMultiplier,
            tournamentWins: user.tournamentWins,
            tournamentParticipations: user.tournamentParticipations,
            totalWins: user.totalWins,
            totalLosses: user.totalLosses
        };
    }

    /**
     * Gets the leaderboard for a server.
     * @param {string} serverId - The Discord server ID.
     * @param {number} limit - The maximum number of users to return.
     * @returns {Promise<Array<Object>>} The server leaderboard.
     */
    async getServerLeaderboard(serverId, limit = 10) {
        const users = await User.find({ playedOnServers: serverId })
            .sort({ elo: -1 })
            .limit(limit);
        
        return users.map(user => ({
            username: user.username,
            rank: user.rank,
            elo: user.elo,
            fumbles: user.fumbles,
            clutches: user.clutches
        }));
    }

    /**
     * Registers a user's Pokemon Showdown username.
     * @param {string} discordId - The Discord ID of the user.
     * @param {string} serverId - The Discord server ID.
     * @param {string} showdownUsername - The Pokemon Showdown username.
     * @returns {Promise<Object>} The updated server document.
     */
    async registerShowdownUsername(discordId, serverId, showdownUsername) {
        let server = await Server.findOne({ discordId: serverId });
        
        if (!server) {
            server = new Server({
                discordId: serverId,
                registeredUsers: [],
                showdownRoom: null
            });
        }
        
        // Check if user is already registered
        const existingUserIndex = server.registeredUsers.findIndex(u => u.username === showdownUsername);
        if (existingUserIndex !== -1) {
            throw new Error(`Username ${showdownUsername} is already registered.`);
        }
        
        // Add user to registered users
        server.registeredUsers.push({
            username: showdownUsername,
            elo: 1000, // Default ELO for Showdown
            gxe: 50 // Default GXE for Showdown
        });
        
        await server.save();
        return server;
    }

    /**
     * Unregisters a user's Pokemon Showdown username.
     * @param {string} discordId - The Discord ID of the user.
     * @param {string} serverId - The Discord server ID.
     * @returns {Promise<Object>} The updated server document.
     */
    async unregisterShowdownUsername(discordId, serverId) {
        const server = await Server.findOne({ discordId: serverId });
        
        if (!server) {
            throw new Error(`Server with ID ${serverId} not found.`);
        }
        
        // Find the user's Showdown username
        const user = await User.findOne({ discordId });
        if (!user) {
            throw new Error(`User with Discord ID ${discordId} not found.`);
        }
        
        // Remove user from registered users
        server.registeredUsers = server.registeredUsers.filter(u => u.discordId !== discordId);
        
        await server.save();
        return server;
    }

    /**
     * Sets the Showdown room for a server.
     * @param {string} serverId - The Discord server ID.
     * @param {string} channelId - The Discord channel ID.
     * @returns {Promise<Object>} The updated server document.
     */
    async setShowdownRoom(serverId, channelId) {
        let server = await Server.findOne({ discordId: serverId });
        
        if (!server) {
            server = new Server({
                discordId: serverId,
                registeredUsers: [],
                showdownRoom: channelId
            });
        } else {
            server.showdownRoom = channelId;
        }
        
        await server.save();
        return server;
    }
}