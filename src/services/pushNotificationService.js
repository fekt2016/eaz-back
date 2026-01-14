const axios = require('axios');
const DeviceToken = require('../models/notification/deviceTokenModel');

/**
 * Push Notification Service
 * 
 * Sends push notifications using Expo Push API
 * https://exp.host/--/api/v2/push/send
 */

const EXPO_PUSH_API_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * Send push notification to a user
 * 
 * @param {String} userId - User ID
 * @param {Object} payload - Notification payload
 * @param {String} payload.title - Notification title
 * @param {String} payload.body - Notification body
 * @param {Object} payload.data - Additional data
 * @param {String} payload.data.type - Notification type: "order" | "wallet" | "support" | "security"
 * @param {String} payload.data.referenceId - Reference ID (orderId, transactionId, etc.)
 * 
 * @returns {Promise<Object>} - Response from Expo API
 */
const sendPushToUser = async (userId, payload) => {
  try {
    console.log(`[PushNotification] 📤 Attempting to send push notification to user ${userId}`);
    
    // Get all active device tokens for the user
    const deviceTokens = await DeviceToken.getActiveTokens(userId);

    console.log(`[PushNotification] 🔍 Found ${deviceTokens?.length || 0} active device token(s) for user ${userId}`);

    if (!deviceTokens || deviceTokens.length === 0) {
      console.warn(`[PushNotification] ⚠️ No active device tokens for user ${userId}`);
      console.warn(`[PushNotification] ⚠️ User may not have registered their device or token may be inactive`);
      return { success: false, message: 'No active device tokens' };
    }

    // Prepare notification messages for each device
    const messages = deviceTokens.map((deviceToken) => ({
      to: deviceToken.expoPushToken,
      sound: 'default',
      title: payload.title,
      body: payload.body,
      data: {
        type: payload.data?.type || 'system',
        referenceId: payload.data?.referenceId || null,
        ...payload.data,
      },
      priority: payload.priority || 'default',
      badge: payload.badge || 1,
    }));

    // Send to Expo Push API
    console.log(`[PushNotification] 📨 Sending ${messages.length} notification(s) to Expo Push API`);
    console.log(`[PushNotification] 📋 Notification details:`, {
      title: payload.title,
      body: payload.body,
      type: payload.data?.type,
      referenceId: payload.data?.referenceId,
    });
    
    const response = await axios.post(EXPO_PUSH_API_URL, messages, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
      },
    });
    
    console.log(`[PushNotification] 📬 Expo API response:`, {
      status: response.status,
      dataCount: response.data?.data?.length || 0,
    });

    // Check for errors in response
    const results = response.data?.data || [];
    const errors = results.filter((result) => result.status === 'error');

    if (errors.length > 0) {
      console.error('[PushNotification] Some notifications failed:', errors);
      
      // Deactivate invalid tokens
      for (const error of errors) {
        if (error.details?.error === 'DeviceNotRegistered') {
          const token = messages.find((msg) => msg.to === error.expoPushToken)?.to;
          if (token) {
            await DeviceToken.deactivateToken(userId, token);
            console.log(`[PushNotification] Deactivated invalid token: ${token.substring(0, 20)}...`);
          }
        }
      }
    }

    const successCount = results.length - errors.length;
    console.log(`[PushNotification] Sent ${successCount}/${messages.length} notifications to user ${userId}`);

    return {
      success: true,
      sent: successCount,
      total: messages.length,
      errors: errors.length,
    };
  } catch (error) {
    console.error('[PushNotification] Error sending push notification:', error);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Send push notification for order events
 */
const sendOrderNotification = async (userId, orderId, title, body, orderStatus = null) => {
  return await sendPushToUser(userId, {
    title,
    body,
    data: {
      type: 'order',
      referenceId: orderId,
      orderStatus,
    },
  });
};

/**
 * Send push notification for wallet events
 */
const sendWalletNotification = async (userId, transactionId, title, body, transactionType = null) => {
  return await sendPushToUser(userId, {
    title,
    body,
    data: {
      type: 'wallet',
      referenceId: transactionId,
      transactionType,
    },
  });
};

/**
 * Send push notification for support ticket events
 */
const sendSupportNotification = async (userId, ticketId, title, body) => {
  return await sendPushToUser(userId, {
    title,
    body,
    data: {
      type: 'support',
      referenceId: ticketId,
    },
  });
};

/**
 * Send push notification for security events
 */
const sendSecurityNotification = async (userId, title, body, eventType = null) => {
  return await sendPushToUser(userId, {
    title,
    body,
    priority: 'high',
    data: {
      type: 'security',
      eventType,
    },
  });
};

module.exports = {
  sendPushToUser,
  sendOrderNotification,
  sendWalletNotification,
  sendSupportNotification,
  sendSecurityNotification,
};

