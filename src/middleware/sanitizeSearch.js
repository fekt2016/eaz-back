const AppError = require('../utils/errors/appError');

/** Keys that must not appear in req.query (prototype pollution / NoSQLi) */
const FORBIDDEN_QUERY_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Strip prototype-pollution and dangerous keys from req.query.
 * Use on routes that build DB queries or merge req.query into objects.
 */
exports.stripQueryPollution = (req, res, next) => {
  if (req.query && typeof req.query === 'object') {
    FORBIDDEN_QUERY_KEYS.forEach((key) => {
      delete req.query[key];
    });
    // Also delete any key that looks like a MongoDB operator
    Object.keys(req.query).forEach((key) => {
      if (key.startsWith('$') || (typeof key === 'string' && key.includes('.'))) {
        delete req.query[key];
      }
    });
  }
  next();
};

/**
 * SECURITY FIX #22: Search Query Sanitization Middleware
 * Prevents NoSQL injection, XSS, template injection, and excessively long queries
 */

exports.sanitizeSearchQuery = (req, res, next) => {
    const { q, query, search, keyword } = req.query;
    const searchTerm = q || query || search || keyword;

    if (!searchTerm) {
        return next();
    }

    // Convert to string
    const searchString = String(searchTerm);

    // SECURITY: Enforce maximum length (100 chars)
    const MAX_LENGTH = 100;
    if (searchString.length > MAX_LENGTH) {
        return next(new AppError(`Search query too long (max ${MAX_LENGTH} characters)`, 400));
    }

    // SECURITY: Remove dangerous characters that could cause NoSQL injection
    // Keep only: letters, numbers, spaces, hyphens, underscores
    const sanitized = searchString.replace(/[^\w\s-]/g, '').trim();

    // SECURITY: Block empty queries after sanitization
    if (!sanitized || sanitized.length === 0) {
        return next(new AppError('Invalid search query', 400));
    }

    // Replace original query with sanitized version
    if (req.query.q) req.query.q = sanitized;
    if (req.query.query) req.query.query = sanitized;
    if (req.query.search) req.query.search = sanitized;
    if (req.query.keyword) req.query.keyword = sanitized;

    next();
};
