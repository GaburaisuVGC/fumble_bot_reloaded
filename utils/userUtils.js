import User from '../models/User.js';
import { findRank } from './rank.js';

/**
 * Updates a user's rank, peak Elo, and lowest Elo based on a new Elo value.
 * This function MODIFIES the passed user document and SAVES it.
 * The user document's `elo` field should be set to the new Elo value *before* calling this function,
 * or this function should be responsible for setting it if `newElo` is the source of truth.
 * For clarity, this function will assume userDoc.elo is already the newElo or will set it.
 *
 * @param {mongoose.Document<User>} userDoc - The Mongoose User document to update.
 * @param {number} newEloValue - The new absolute Elo of the user. This will be set on userDoc.elo.
 * @param {mongoose.ClientSession} [session=null] - Optional Mongoose session for transactions.
 * @returns {Promise<void>}
 * @throws {Error} if userDoc is not provided or if saving fails.
 */
export async function updateUserRankPeakLow(userDoc, newEloValue, session = null) {
    if (!userDoc) {
        // This should ideally not happen if called correctly, but good to check.
        console.error("updateUserRankPeakLow called with null userDoc.");
        throw new Error("User document must be provided to updateUserRankPeakLow.");
    }

    userDoc.elo = newEloValue; // Set the new Elo value

    // Ensure peakElo and lowestElo are initialized if they are not present (e.g. for very old documents)
    // Schema now has defaults, so this might be overly cautious but safe.
    const currentPeakElo = userDoc.peakElo === undefined || userDoc.peakElo === null ? newEloValue : userDoc.peakElo;
    const currentLowestElo = userDoc.lowestElo === undefined || userDoc.lowestElo === null ? newEloValue : userDoc.lowestElo;

    userDoc.peakElo = Math.max(currentPeakElo, newEloValue);
    userDoc.lowestElo = Math.min(currentLowestElo, newEloValue);
    userDoc.rank = findRank(newEloValue, userDoc.rank); // findRank needs the new Elo

    await userDoc.save({ session });
}

/**
 * Finds a user by their Discord ID or creates a new one if not found.
 *
 * @param {string} discordId - The Discord ID of the user.
 * @param {string} discordTag - The Discord tag of the user (e.g., username#1234).
 * @param {mongoose.ClientSession} [session=null] - Optional Mongoose session for transactions.
 * @returns {Promise<mongoose.Document<User>>} The found or newly created user document.
 * @throws {Error} if saving the new user fails.
 */
export async function findOrCreateUser(discordId, discordTag, session = null) {
    let user = await User.findOne({ discordId }).session(session);

    if (user) {
        // User found, check for username update.
        const newUsername = discordTag.includes('#') ? discordTag.substring(0, discordTag.lastIndexOf('#')) : discordTag;
        if (discordTag && user.username !== newUsername) {
            console.log(`Updating username for ${discordId}: from '${user.username}' to '${newUsername}'`);
            user.username = newUsername;
            await user.save({ session });
        }
    } else {
        // User not found, create a new one.
        console.log(`User ${discordId} (${discordTag}) not found. Creating new user.`);
        user = new User({
            discordId: discordId,
            username: discordTag.includes('#') ? discordTag.substring(0, discordTag.lastIndexOf('#')) : discordTag, // Store username part of tag
            rank: 'Iron I', // Default rank from init.js
            elo: 1000,         // Default Elo from init.js
            fumbles: 0,
            clutches: 0,
            peakElo: 1000,
            lowestElo: 1000,
            fumbleCombo: 0,
            clutchCombo: 0,
            comboMultiplier: 1,
            auraGainedTournaments: 0,
            auraSpentTournaments: 0,
            tournamentWins: 0
        });
        await user.save({ session });
        console.log(`New user ${discordId} (${discordTag}) created successfully.`);
    }
    return user;
}
