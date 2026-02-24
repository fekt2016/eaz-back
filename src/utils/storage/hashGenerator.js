const crypto = require('crypto');

/**
 * Generates a SHA-256 hash of a buffer
 * @param {Buffer} buffer - The file buffer to hash
 * @returns {String} Hex-encoded SHA-256 hash
 */
const generateHash = (buffer) => {
    if (!buffer || !Buffer.isBuffer(buffer)) {
        throw new Error('Valid buffer is required for hash generation');
    }
    return crypto.createHash('sha256').update(buffer).digest('hex');
};

module.exports = {
    generateHash,
};
