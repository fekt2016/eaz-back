const express = require('express');
const notificationController = require('../../controllers/notification/notificationController');
const authController = require('../../controllers/buyer/authController');

const router = express.Router();

// All routes require authentication
router.use(authController.protect);

/**
 * @route   GET /api/v1/notifications
 * @desc    Get all notifications for authenticated user
 * @access  Private (Buyer/Seller/Admin)
 * @query   type, read, page, limit
 */
router.get('/', notificationController.getNotifications);

/**
 * @route   GET /api/v1/notifications/unread
 * @desc    Get unread notification count
 * @access  Private (Buyer/Seller/Admin)
 */
router.get('/unread', notificationController.getUnreadCount);

/**
 * @route   GET /api/v1/notifications/:id
 * @desc    Get single notification by ID
 * @access  Private (Buyer/Seller/Admin)
 */
router.get('/:id', notificationController.getNotification);

/**
 * @route   PATCH /api/v1/notifications/read/:id
 * @desc    Mark a notification as read
 * @access  Private (Buyer/Seller/Admin)
 */
router.patch('/read/:id', notificationController.markAsRead);

/**
 * @route   PATCH /api/v1/notifications/read-all
 * @desc    Mark all notifications as read
 * @access  Private (Buyer/Seller/Admin)
 */
router.patch('/read-all', notificationController.markAllAsRead);

/**
 * @route   POST /api/v1/notifications
 * @desc    Create a new notification (for admin broadcasts or system notifications)
 * @access  Private (Admin or System)
 */
router.post(
  '/',
  // Optionally restrict to admin only for creating notifications
  // authController.restrictTo('admin'),
  notificationController.createNotification
);

/**
 * @route   DELETE /api/v1/notifications/:id
 * @desc    Delete a notification
 * @access  Private (Buyer/Seller/Admin)
 */
router.delete('/:id', notificationController.deleteNotification);

module.exports = router;

