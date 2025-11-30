const express = require('express');
const activityLogController = require('./activityLog.controller');
const authController = require('../../controllers/buyer/authController');

const router = express.Router();

// All routes require admin authentication
router.use(authController.protect);
router.use(authController.restrictTo('admin'));

// Get paginated logs
router.get('/', activityLogController.getActivityLogs);

// Get statistics
router.get('/stats', activityLogController.getActivityStats);

// Get suspicious activity
router.get('/suspicious', activityLogController.getSuspiciousActivity);

// Get user security history
router.get('/user/:userId/history', activityLogController.getUserSecurityHistory);

// Get single log
router.get('/:id', activityLogController.getActivityLog);

// Delete single log
router.delete('/:id', activityLogController.deleteActivityLog);

// Delete all logs
router.delete('/', activityLogController.deleteAllActivityLogs);

// Cleanup old logs
router.delete('/cleanup/old', activityLogController.cleanupOldLogs);

module.exports = router;

