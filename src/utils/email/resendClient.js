const { Resend } = require('resend');
const logger = require('../logger');

let resendClient = null;
let resendConfigured = false;

function initializeResend() {
  if (resendConfigured) return resendClient;

  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    logger.error('[ResendClient] ❌ RESEND_API_KEY not set in environment variables!');
    return null;
  }

  try {
    resendClient = new Resend(apiKey);
    resendConfigured = true;
    logger.info('[ResendClient] ✅ Resend client configured');
    return resendClient;
  } catch (error) {
    logger.error('[ResendClient] ❌ Failed to configure Resend:', error.message);
    resendClient = null;
    resendConfigured = false;
    return null;
  }
}

function getResend() {
  if (!resendConfigured || !resendClient) {
    return initializeResend();
  }
  return resendClient;
}

module.exports = {
  getResend,
};

