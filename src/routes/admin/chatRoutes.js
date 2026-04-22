const express = require('express');
const chatController = require('../../controllers/shared/chatController');
const authController = require('../../controllers/buyer/authController');
const { LIVE_SUPPORT_CHAT_AGENT_ROLES } = require('../../config/rolePermissions');

const router = express.Router();

router.use(authController.protect);
router.use(authController.restrictTo(...LIVE_SUPPORT_CHAT_AGENT_ROLES));

router.get('/conversations', chatController.getAllConversations);
router.get('/stats', chatController.getChatStats);
router.get('/conversations/:id/messages', chatController.getConversationMessages);
router.patch('/conversations/:id/close', chatController.closeConversation);
router.patch('/conversations/:id/reopen', chatController.reopenConversation);

module.exports = router;
