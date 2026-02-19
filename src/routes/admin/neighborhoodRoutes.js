const express = require('express');
const authController = require('../../controllers/buyer/authController');
const neighborhoodController = require('../../controllers/admin/neighborhoodController');

const router = express.Router();

// All routes require authentication and admin role
router.use(authController.protect);
router.use(authController.restrictTo('admin', 'superadmin'));

// CRUD operations
router
  .route('/')
  .get(neighborhoodController.getAllNeighborhoods)
  .post(neighborhoodController.createNeighborhood);

router.get('/statistics', neighborhoodController.getNeighborhoodStatistics);

router
  .route('/:id')
  .get(neighborhoodController.getNeighborhood)
  .patch(neighborhoodController.updateNeighborhood)
  .delete(neighborhoodController.deleteNeighborhood);

router.post('/:id/refresh-coordinates', neighborhoodController.refreshCoordinates);
router.patch('/:id/recalculate', neighborhoodController.recalculateNeighborhood);

module.exports = router;

