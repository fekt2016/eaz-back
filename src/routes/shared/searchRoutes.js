const express = require('express');
const router = express.Router();
const {
  searchProducts,
  getSearchSuggestions,
  searchProductsResults,
} = require('../../controllers/shared/searchController');

// For filtered/product/category/brand/tag results (using query params)
router.get('/results', searchProductsResults);

// For free-text search (e.g. /search/query/iphone)
router.get('/query/:query', searchProducts);

// For typeahead/autocomplete suggestions
router.get('/suggestions/:query', getSearchSuggestions);

module.exports = router;
