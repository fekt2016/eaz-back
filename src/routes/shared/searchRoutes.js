const express = require('express');
const router = express.Router();
const { searchProducts,
  getSearchSuggestions,
  searchProductsResults, } = require('../../controllers/shared/searchController');
const {
  sanitizeSearchQuery,
  sanitizeSearchParam,
} = require('../../middleware/sanitizeSearch');

// For filtered/product/category/brand/tag results (using query params)
router.get('/results', sanitizeSearchQuery, searchProductsResults);

// For free-text search (e.g. /search/query/iphone)
router.get('/query/:query', sanitizeSearchParam('query'), searchProducts);

// For typeahead/autocomplete suggestions
router.get(
  '/suggestions/:query',
  sanitizeSearchParam('query'),
  getSearchSuggestions
);

module.exports = router;;
