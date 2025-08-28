import crypto from 'crypto';

/**
 * Generates a random alphanumeric string of a given length.
 * @param {number} length The desired length of the string.
 * @returns {string} The generated alphanumeric string.
 */
function generateAlphanumericId(length) {
    return crypto.randomBytes(Math.ceil(length / 2))
        .toString('hex') // convert to hexadecimal format
        .slice(0, length); // return required number of characters
}

/**
 * Generates a unique 6-character alphanumeric tournament ID.
 * @returns {string}
 */
export function generateTournamentId() {
    return generateAlphanumericId(6).toUpperCase();
}

/**
 * Formats a number as a 3-digit string, padding with leading zeros if necessary.
 * @param {number} number The number to format.
 * @returns {string} The formatted 3-digit string (e.g., 1 -> "001", 23 -> "023").
 */
export function formatMatchId(number) {
    return number.toString().padStart(3, '0');
}

/**
 * Shuffles an array in place using Fisher-Yates algorithm.
 * @param {Array<any>} array The array to shuffle.
 * @returns {Array<any>} The shuffled array (same instance).
 */
export function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}
