const express = require('express');
const router = express.Router();
const authController = require('../../controllers/buyer/authController');
const activityLogController = require('./activityLog.controller');
const { validateObjectId } = require('../../middleware/validateObjectId');

// All activity log routes require authentication and admin role
router.use(authController.protect);
router.use(authController.restrictTo('admin'));

// IMPORTANT: Specific routes must come BEFORE parameterized routes (/:id)
// Otherwise /stats, /cleanup, etc. will be matched by /:id

// Get all activity logs with filters
router.get('/', activityLogController.getActivityLogs);

// Get activity statistics
router.get('/stats', activityLogController.getActivityStats);

// Get suspicious activity logs
router.get('/suspicious', activityLogController.getSuspiciousActivity);

// Delete all activity logs
router.delete('/', activityLogController.deleteAllActivityLogs);

// Delete logs older than specified days
router.delete('/cleanup', activityLogController.cleanupOldLogs);

// Get activity logs by user ID (use query param: ?userId=...)
// This is handled by getActivityLogs with userId query param
router.get('/user/:userId', (req, res, next) => {
  req.query.userId = req.params.userId;
  return activityLogController.getActivityLogs(req, res, next);
});

// Get IP and device history for a user
router.get('/user/:userId/history', activityLogController.getUserSecurityHistory);

// Get activity logs by action type (use query param: ?search=... or filter by action)
// This is handled by getActivityLogs with search query param
router.get('/action/:action', (req, res, next) => {
  req.query.search = req.params.action;
  return activityLogController.getActivityLogs(req, res, next);
});

// Get activity log by ID (must be last to avoid matching specific routes)
router.get('/:id', validateObjectId('id'), activityLogController.getActivityLog);

// Delete single activity log by ID
router.delete('/:id', validateObjectId('id'), activityLogController.deleteActivityLog);

module.exports = router;
