const express = require('express');
const historyController = require('../../controllers/buyer/browserHistoryController');
const authController = require('../../controllers/buyer/authController');

const router = express.Router();

// Protect all routes after this middleware
router.use(authController.protect, authController.restrictTo('user'));

router
  .route('/')
  .post(historyController.addHistoryItem)
  .get(historyController.getMyHistory)
  .delete(historyController.deleteHistoryItem);

router.route('/clear-all').delete(historyController.clearMyHistory);

// router.route('/:id').delete(historyController.deleteHistoryItem);

router.route('/multiple').delete(historyController.deleteMultipleHistoryItems);

module.exports = router;;
