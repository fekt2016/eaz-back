const express = require('express');
const authController = require('../../controllers/buyer/authController');
const { SUPERADMIN_ONLY } = require('../../config/rolePermissions');
const distanceAnalyzerController = require('../../controllers/admin/distanceAnalyzerController');

const router = express.Router();

// All routes require authentication and admin role
router.use(authController.protect);
router.use(authController.restrictTo(...SUPERADMIN_ONLY));

router.get('/all-zones-distance', distanceAnalyzerController.analyzeAllZones);
router.post('/analyze-and-save', distanceAnalyzerController.analyzeAndSave);
router.get('/records', distanceAnalyzerController.getDistanceRecords);

module.exports = router;

