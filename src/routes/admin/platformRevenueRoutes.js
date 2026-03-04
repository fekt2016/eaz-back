const express = require('express');
const { protect, restrictTo } = require('../../middlewares/authMiddleware');
const platformRevenueController = require('../../controllers/admin/platformRevenueController');

const router = express.Router();

// Require admin or superadmin privileges for revenue routes
router.use(protect);
router.use(restrictTo('admin', 'superadmin', 'finance'));

// Routes
router.get('/summary', platformRevenueController.getRevenueSummary);
router.get('/order/:orderId', platformRevenueController.getRevenueForOrder);
router.get('/export', platformRevenueController.exportRevenueData);
router.get('/fees', platformRevenueController.getAllPlatformFees);

module.exports = router;
