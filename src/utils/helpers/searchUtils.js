/**
 * Search Utilities
 * Functions for normalizing, cleaning, and processing search queries
 */

/**
 * Normalize and clean search query
 * Handles: multiple spaces, punctuation, accented characters, mixed case
 * @param {string} query - Raw search query
 * @returns {string} - Cleaned and normalized query
 */
exports.normalizeQuery = (query) => {
  if (!query || typeof query !== 'string') return '';

  // Trim whitespace
  let normalized = query.trim();

  // Remove extra spaces (replace multiple spaces with single space)
  normalized = normalized.replace(/\s+/g, ' ');

  // Remove special characters but keep spaces and alphanumeric
  // Keep common search-friendly characters like hyphens
  normalized = normalized.replace(/[^\w\s-]/g, ' ');

  // Remove accented characters (normalize to ASCII)
  normalized = normalized
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  // Convert to lowercase for consistency
  normalized = normalized.toLowerCase();

  // Remove leading/trailing spaces again after processing
  normalized = normalized.trim();

  return normalized;
};

/**
 * Tokenize search query into individual words
 * @param {string} query - Search query
 * @returns {string[]} - Array of tokens
 */
exports.tokenizeQuery = (query) => {
  const normalized = exports.normalizeQuery(query);
  if (!normalized) return [];

  // Split by spaces and filter out empty strings
  return normalized.split(/\s+/).filter((token) => token.length > 0);
};

/**
 * Clean query for regex search (removes special regex characters)
 * @param {string} query - Search query
 * @returns {string} - Escaped query safe for regex
 */
exports.escapeRegex = (query) => {
  if (!query || typeof query !== 'string') return '';
  return query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

/**
 * Build optimized regex pattern for partial matching
 * @param {string} query - Search query
 * @param {boolean} anchored - Whether to anchor at start
 * @returns {RegExp} - Optimized regex pattern
 */
exports.buildSearchRegex = (query, anchored = false) => {
  const cleaned = exports.normalizeQuery(query);
  if (!cleaned) return null;

  const escaped = exports.escapeRegex(cleaned);
  const pattern = anchored ? `^${escaped}` : escaped;

  return new RegExp(pattern, 'i'); // Case-insensitive
};

/**
 * Expand search keywords (hybrid: AI + rule-based)
 * Uses AI if available, falls back to rule-based expansion
 * Example: "phone cover" -> ["phone cover", "phone case", "iphone case", "samsung case"]
 * @param {string} query - Search query
 * @param {boolean} useAI - Whether to use AI expansion (default: true if available)
 * @returns {Promise<string[]>} - Array of expanded search terms
 */
exports.expandKeywords = async (query, useAI = true) => {
  const normalized = exports.normalizeQuery(query);
  if (!normalized) return [];

  // Try AI expansion first if enabled
  if (useAI) {
    try {
      const aiSearchService = require('../../services/aiSearchService');
      if (aiSearchService.isAIEnabled()) {
        const aiExpanded = await aiSearchService.expandKeywordsWithAI(normalized);
        if (aiExpanded && aiExpanded.length > 1) {
          return aiExpanded;
        }
      }
    } catch (error) {
      console.warn('[Search Utils] AI expansion failed, using rule-based:', error.message);
    }
  }

  // Fallback to rule-based expansion
  const tokens = exports.tokenizeQuery(normalized);
  const expanded = [normalized]; // Always include original

  // Simple expansion rules
  const expansionMap = {
    cover: ['case', 'protector', 'shield'],
    phone: ['iphone', 'samsung', 'mobile'],
    case: ['cover', 'protector'],
    bag: ['handbag', 'purse', 'tote'],
    shoe: ['sneaker', 'footwear', 'boot'],
  };

  // Try to expand each token
  tokens.forEach((token) => {
    if (expansionMap[token]) {
      expansionMap[token].forEach((expansion) => {
        const expandedQuery = normalized.replace(token, expansion);
        if (expandedQuery !== normalized) {
          expanded.push(expandedQuery);
        }
      });
    }
  });

  // Remove duplicates
  return [...new Set(expanded)];
};

/**
 * Check if query is numeric-only
 * @param {string} query - Search query
 * @returns {boolean} - True if query is numeric
 */
exports.isNumericQuery = (query) => {
  if (!query) return false;
  return /^\d+$/.test(query.trim());
};

/**
 * Build MongoDB text search query with field boosting
 * @param {string} query - Search query
 * @returns {Object} - MongoDB $text search query
 */
exports.buildTextSearchQuery = (query) => {
  const normalized = exports.normalizeQuery(query);
  if (!normalized || normalized.length < 2) return null;

  return {
    $text: {
      $search: normalized,
      $caseSensitive: false,
      $diacriticSensitive: false,
    },
  };
};

/**
 * Build fallback regex query for when $text search returns no results
 * @param {string} query - Search query
 * @param {Object} options - Additional options
 * @returns {Object} - MongoDB query object
 */
exports.buildFallbackQuery = (query, options = {}) => {
  const { categoryId, brand, minPrice, maxPrice, inStock, onSale } = options;
  const normalized = exports.normalizeQuery(query);
  if (!normalized) return null;

  const tokens = exports.tokenizeQuery(normalized);
  if (tokens.length === 0) return null;

  // Build $or conditions for partial matching
  const orConditions = [];

  // Title matching (highest priority)
  tokens.forEach((token) => {
    orConditions.push({ name: { $regex: token, $options: 'i' } });
  });

  // Brand matching
  if (tokens.length > 0) {
    orConditions.push({ brand: { $regex: tokens.join('|'), $options: 'i' } });
  }

  // Tags matching
  orConditions.push({ tags: { $in: tokens } });

  // Description matching (lower priority)
  orConditions.push({ description: { $regex: tokens.join('|'), $options: 'i' } });

  const queryObj = {
    $or: orConditions,
    status: 'active',
  };

  // Add filters
  if (categoryId) {
    // Combine category filter with search conditions
    queryObj.$and = [
      {
        $or: [
          { parentCategory: categoryId },
          { subCategory: categoryId },
        ],
      },
      { $or: orConditions },
    ];
  }

  if (brand) {
    queryObj.brand = { $regex: brand, $options: 'i' };
  }

  if (minPrice !== undefined || maxPrice !== undefined) {
    queryObj.$or = queryObj.$or || [];
    queryObj.minPrice = {};
    if (minPrice !== undefined) queryObj.minPrice.$gte = minPrice;
    if (maxPrice !== undefined) queryObj.minPrice.$lte = maxPrice;
  }

  if (inStock) {
    queryObj.totalStock = { $gt: 0 };
  }

  if (onSale) {
    queryObj.onSale = true;
  }

  return queryObj;
};

/**
 * Calculate search relevance score (for sorting)
 * @param {Object} product - Product document
 * @param {string} query - Search query
 * @returns {number} - Relevance score
 */
exports.calculateRelevanceScore = (product, query) => {
  const normalized = exports.normalizeQuery(query);
  const tokens = exports.tokenizeQuery(normalized);
  let score = 0;

  // Title match (highest weight)
  const titleLower = (product.name || '').toLowerCase();
  tokens.forEach((token) => {
    if (titleLower.includes(token)) {
      score += 10;
      if (titleLower.startsWith(token)) score += 5; // Bonus for start match
    }
  });

  // Brand match
  const brandLower = (product.brand || '').toLowerCase();
  if (brandLower.includes(normalized)) score += 8;

  // Tags match
  const tagsLower = (product.tags || []).map((t) => t.toLowerCase());
  tokens.forEach((token) => {
    if (tagsLower.includes(token)) score += 6;
  });

  // Description match (lower weight)
  const descLower = (product.description || '').toLowerCase();
  tokens.forEach((token) => {
    if (descLower.includes(token)) score += 2;
  });

  // Popularity boost
  if (product.totalSold) score += Math.log10(product.totalSold + 1);
  if (product.ratingsAverage) score += product.ratingsAverage * 0.5;

  return score;
};

