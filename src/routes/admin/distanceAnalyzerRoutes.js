const express = require('express');
const authController = require('../../controllers/buyer/authController');
const distanceAnalyzerController = require('../../controllers/admin/distanceAnalyzerController');

const router = express.Router();

// All routes require authentication and admin role
router.use(authController.protect);
router.use(authController.restrictTo('admin'));

router.get('/all-zones-distance', distanceAnalyzerController.analyzeAllZones);
router.post('/analyze-and-save', distanceAnalyzerController.analyzeAndSave);
router.get('/records', distanceAnalyzerController.getDistanceRecords);

module.exports = router;

