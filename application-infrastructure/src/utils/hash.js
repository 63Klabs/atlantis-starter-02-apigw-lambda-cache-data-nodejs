const crypto = require('crypto');

/**
 * Hash a string using SHA256 and return the last 8 characters
 * @param {string} input - The string to hash
 * @returns {string} The last 8 characters of the SHA256 hash
 */
const hashLast8 = (input) => {
    return crypto.createHash('sha256').update(input).digest('hex').slice(-8);
};

module.exports = { hashLast8 };