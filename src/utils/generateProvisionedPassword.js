const crypto = require('crypto');

/**
 * Cryptographically strong password for admin-provisioned accounts.
 * Excludes ambiguous characters (0/O, 1/l).
 * @param {number} [length=16]
 * @returns {string}
 */
function generateProvisionedPassword(length = 16) {
  const alphabet =
    'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789#%&*-_=+';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

module.exports = { generateProvisionedPassword };
