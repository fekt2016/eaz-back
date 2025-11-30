const express = require('express');
const neighborhoodController = require('../../controllers/shared/neighborhoodController');

const router = express.Router();

// Public routes (no authentication required for neighborhood lookup)
router.get('/', neighborhoodController.getAllNeighborhoods);
router.get('/search', neighborhoodController.searchNeighborhoods);
router.get('/city/:city', neighborhoodController.getNeighborhoodsByCity);
router.get('/:id/map-url', neighborhoodController.getMapUrl); // Must come before /:id
router.get('/:id', neighborhoodController.getNeighborhood);

module.exports = router;

