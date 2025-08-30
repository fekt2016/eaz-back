// Backend routes (Node.js/Express example)
const express = require('express');
const router = express.Router();
const {
  searchProducts,
  getSearchSuggestions,
} = require('../Controllers/searchController');

// Use route parameters instead of query parameters
router.get('/:query', searchProducts);
router.get('/suggestions/:query', getSearchSuggestions);

module.exports = router;
