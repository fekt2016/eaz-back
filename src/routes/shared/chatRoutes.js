const express = require('express');
const chatController = require('../../controllers/shared/chatController');
const authController = require('../../controllers/buyer/authController');

const router = express.Router();

// Public — guest session history (identified by UUID token, no cookie)
router.get('/guest/messages', chatController.getGuestMessages);

// Authenticated routes
router.use(authController.protect);
router.get('/conversation', chatController.getOrCreateConversation);
router.get('/messages', chatController.getMyMessages);

module.exports = router;
