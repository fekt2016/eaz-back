/**
 * SECURITY FIX #10: Sanitize User-Generated Content
 * Prevents stored and reflected XSS attacks
 */

const xss = require('xss-clean');

/**
 * Sanitize text content - removes all HTML tags and XSS vectors
 * @param {string} input - User input to sanitize
 * @returns {string} - Sanitized text (HTML stripped)
 */
exports.sanitizeText = (input) => {
  if (!input || typeof input !== 'string') {
    return '';
  }

  // Remove HTML tags using regex (simple but effective)
  let sanitized = input
    .replace(/<[^>]*>/g, '') // Remove HTML tags
    .replace(/&[#\w]+;/g, '') // Remove HTML entities
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+\s*=/gi, '') // Remove event handlers (onclick, onerror, etc.)
    .trim();

  // Additional safety: limit length
  sanitized = sanitized.substring(0, 10000); // Max 10,000 characters

  return sanitized;
};

/**
 * Sanitize review comment
 * @param {string} comment - Review comment
 * @returns {string} - Sanitized comment
 */
exports.sanitizeReview = (comment) => {
  return exports.sanitizeText(comment);
};

/**
 * Sanitize support ticket message
 * @param {string} message - Support message
 * @returns {string} - Sanitized message
 */
exports.sanitizeSupportMessage = (message) => {
  return exports.sanitizeText(message);
};

/**
 * Sanitize product review title
 * @param {string} title - Review title
 * @returns {string} - Sanitized title
 */
exports.sanitizeTitle = (title) => {
  if (!title || typeof title !== 'string') {
    return '';
  }
  
  const sanitized = exports.sanitizeText(title);
  return sanitized.substring(0, 200); // Max 200 characters for titles
};

