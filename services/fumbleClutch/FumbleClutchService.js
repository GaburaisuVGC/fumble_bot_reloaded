import { EmbedBuilder } from 'discord.js';
import User from '../../models/User.js';
import IFumbleClutchService from '../../interfaces/IFumbleClutchService.js';

/**
 * Service for handling fumbles and clutches.
 * Implements the IFumbleClutchService interface.
 */
export default class FumbleClutchService extends IFumbleClutchService {
    constructor(userService) {
        super();
        this.userService = userService;
    }

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
        let user = await User.findOne({ discordId: userId });
        const initialElo = user ? user.elo : 1000;

        // Calculate ELO change and stats
        const stats = this.calculateEloChange(votes, createdTimestamp, user?.comboMultiplier || 1);
        const eloChange = stats.eloChange;
        
        // Calculate new ELO (decrease for fumble)
        const newElo = initialElo - eloChange;
        
        // Get or create user if not exists
        if (!user) {
            user = new User({
                discordId: userId,
                username: username,
                elo: 1000, // Start with default before applying fumble
                peakElo: 1000,
                lowestElo: 1000,
                rank: 'Iron I',
                fumbles: 1, // First fumble
                clutches: 0,
                fumbleCombo: 1,
                clutchCombo: 0,
                comboMultiplier: stats.upvotes > stats.downvotes ? 1.1 : 1, // Initial combo multiplier
            });
        } else {
            // Update user stats
            user.fumbles = (user.fumbles || 0) + 1;
            user.fumbleCombo = (user.fumbleCombo || 0) + 1;
            user.clutchCombo = 0; // Reset clutch combo
            user.comboMultiplier = stats.upvotes > stats.downvotes ? 
                (user.comboMultiplier || 1) + 0.1 : 1;
        }

        // Store old rank for comparison
        const oldRank = user.rank;
        
        // Update user's rank, peak/low ELO
        await this.userService.updateUserRankPeakLow(user, newElo);
        
        // Check if rank changed
        let rankChange = '';
        if (oldRank !== user.rank) {
            rankChange = `Initial rank: ${oldRank} -> New rank: ${user.rank}`;
        }

        return {
            user,
            initialElo,
            finalElo: user.elo,
            eloChange,
            stats,
            rankChange
        };
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
        let user = await User.findOne({ discordId: userId });
        const initialElo = user ? user.elo : 1000;

        // Calculate ELO change and stats
        const stats = this.calculateEloChange(votes, createdTimestamp, user?.comboMultiplier || 1);
        const eloChange = stats.eloChange;
        
        // Calculate new ELO (increase for clutch)
        const newElo = initialElo + eloChange;
        
        // Get or create user if not exists
        if (!user) {
            user = new User({
                discordId: userId,
                username: username,
                elo: 1000, // Start with default before applying clutch
                peakElo: 1000,
                lowestElo: 1000,
                rank: 'Iron I',
                clutches: 1, // First clutch
                fumbles: 0,
                clutchCombo: 1,
                fumbleCombo: 0,
                comboMultiplier: stats.upvotes > stats.downvotes ? 1.1 : 1, // Initial combo multiplier
            });
        } else {
            // Update user stats
            user.clutches = (user.clutches || 0) + 1;
            user.clutchCombo = (user.clutchCombo || 0) + 1;
            user.fumbleCombo = 0; // Reset fumble combo
            user.comboMultiplier = stats.upvotes > stats.downvotes ? 
                (user.comboMultiplier || 1) + 0.1 : 1;
        }

        // Store old rank for comparison
        const oldRank = user.rank;
        
        // Update user's rank, peak/low ELO
        await this.userService.updateUserRankPeakLow(user, newElo);
        
        // Check if rank changed
        let rankChange = '';
        if (oldRank !== user.rank) {
            rankChange = `Initial rank: ${oldRank} -> New rank: ${user.rank}`;
        }

        return {
            user,
            initialElo,
            finalElo: user.elo,
            eloChange,
            stats,
            rankChange
        };
    }

    /**
     * Calculates the ELO change for a fumble or clutch.
     * @param {Array<Object>} votes - The votes (upvotes and downvotes).
     * @param {number} createdTimestamp - The timestamp when the fumble/clutch was created.
     * @param {number} comboMultiplier - The user's current combo multiplier.
     * @returns {Object} The calculated ELO change and related statistics.
     */
    calculateEloChange(votes, createdTimestamp, comboMultiplier) {
        const upvotes = votes.filter(v => v.emoji === "👍").length;
        const downvotes = votes.filter(v => v.emoji === "👎").length;
        
        const t0 = createdTimestamp;
        const delays = votes.map(v => v.ts - t0);
        const avgTime = delays.length ? delays.reduce((a, b) => a + b, 0) / delays.length : 896000;

        const base = 10 + upvotes;
        const ratio = Math.log2(upvotes / (downvotes + 1) + 1);
        const speed = 1 + (896000 - avgTime) / 896000;
        const combo = comboMultiplier || 1;
        const randomComponent = 0.8 + Math.random() * 0.4;  
        
        const eloChange = Math.round(base * ratio * speed * combo * randomComponent);

        return {
            upvotes,
            downvotes,
            ratio: upvotes / (downvotes + 1),
            avgTime,
            combo,
            eloChange
        };
    }

    /**
     * Creates an embed for a new fumble.
     * @param {string} username - The Discord username.
     * @param {string} context - The context of the fumble.
     * @param {string} avatarUrl - The URL of the user's avatar.
     * @returns {Object} The fumble embed.
     */
    createFumbleEmbed(username, context, avatarUrl) {
        return new EmbedBuilder()
            .setColor('#ff0000')
            .setTitle('N E W  F U M B L E !')
            .setDescription(
                `${username} has fumbled!\n\nContext: ${context}\n\nPress 👍 to approve or 👎 to reject.\n\n(AURA updated 15 minutes after sending the fumble.)`
            )
            .setThumbnail(avatarUrl)
            .setTimestamp();
    }

    /**
     * Creates an embed for a new clutch.
     * @param {string} username - The Discord username.
     * @param {string} context - The context of the clutch.
     * @param {string} avatarUrl - The URL of the user's avatar.
     * @returns {Object} The clutch embed.
     */
    createClutchEmbed(username, context, avatarUrl) {
        return new EmbedBuilder()
            .setColor('#00ff32')
            .setTitle('N E W  C L U T C H !')
            .setDescription(
                `${username} has clutched!\n\nContext: ${context}\n\nPress 👍 to approve or 👎 to reject.\n\n(AURA updated 15 minutes after sending the clutch.)`
            )
            .setThumbnail(avatarUrl)
            .setTimestamp();
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
        return new EmbedBuilder()
            .setColor('#ff0000')
            .setTitle(`FUMBLE BY ${username}:`)
            .setDescription(
                `"${context}"\n\n\n👍 = ${stats.upvotes}   👎 = ${stats.downvotes}\nRatio = ${stats.ratio.toFixed(2)}\nAverage time = ${(stats.avgTime/1000).toFixed(1)} s\nCombo = ${stats.combo.toFixed(1)}\n\nΔ AURA = -${stats.eloChange}\nAURA: ${initialElo} → ${finalElo}\n\n${rankChange}`
            )
            .setThumbnail(avatarUrl)
            .setTimestamp();
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
        return new EmbedBuilder()
            .setColor('#00ff32')
            .setTitle(`CLUTCH BY ${username}:`)
            .setDescription(
                `"${context}"\n\n\n👍 = ${stats.upvotes}   👎 = ${stats.downvotes}\nRatio = ${stats.ratio.toFixed(2)}\nAverage time = ${(stats.avgTime/1000).toFixed(1)} s\nCombo = ${stats.combo.toFixed(1)}\n\nΔ AURA = +${stats.eloChange}\nAURA: ${initialElo} → ${finalElo}\n\n${rankChange}`
            )
            .setThumbnail(avatarUrl)
            .setTimestamp();
    }
}