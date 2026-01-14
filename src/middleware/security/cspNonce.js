/**
 * SECURITY FIX #8 (Phase 3 Enhancement): CSP Nonce Generation
 * Generates nonces for inline scripts to replace 'unsafe-inline'
 */

const crypto = require('crypto');

/**
 * Generate a cryptographically secure nonce
 * @returns {string} Base64-encoded nonce
 */
exports.generateNonce = () => {
  return crypto.randomBytes(16).toString('base64');
};

/**
 * Middleware to generate and attach CSP nonce to request
 * Nonce is stored in res.locals for use in views/templates
 */
exports.attachNonce = (req, res, next) => {
  // Generate nonce for this request
  const nonce = exports.generateNonce();
  
  // Attach to response locals (for use in templates/views)
  res.locals.cspNonce = nonce;
  
  // Attach to request (for use in middleware)
  req.cspNonce = nonce;
  
  next();
};

/**
 * Get CSP nonce directive string
 * @param {string} nonce - The nonce value
 * @returns {string} CSP nonce directive
 */
exports.getNonceDirective = (nonce) => {
  return `'nonce-${nonce}'`;
};

