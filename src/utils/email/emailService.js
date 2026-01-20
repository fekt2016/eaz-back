const logger = require('../logger');
const resendService = require('./resendService');

/**
 * Email Service - Resend
 *
 * This service uses Resend exclusively for all email operations.
 */

// Brand Configuration (configurable via environment variables)
const BRAND_CONFIG = {
  name: process.env.APP_NAME || process.env.BRAND_NAME || 'Saiisai',
  tagline: process.env.BRAND_TAGLINE || 'Online Marketplace',
  url: process.env.FRONTEND_URL || 'https://saiisai.com',
  supportEmail: process.env.SUPPORT_EMAIL || process.env.EMAIL_FROM || 'support@saiisai.com',
  fromName: process.env.EMAIL_FROM_NAME || 'Saiisai',
};

// Log brand configuration
logger.info(`[EmailService] 📧 Brand: ${BRAND_CONFIG.name} | URL: ${BRAND_CONFIG.url}`);

const sendEmail = async (data) => {
  return resendService.sendEmail({
    to: data.email || data.to,
    subject: data.subject,
    text: data.message || data.text,
    html: data.html,
    from: data.from,
    fromName: data.fromName,
    cc: data.cc,
    bcc: data.bcc,
  });
};

const sendWelcomeEmail = async (email, name) => {
  return resendService.sendWelcomeEmail(email, name);
};

const sendCustomEmail = async (data) => {
  return resendService.sendCustomEmail(data);
};

const sendAccountDeletionConfirmation = async (toEmail, name) => {
  return resendService.sendAccountDeletionConfirmation(toEmail, name);
};

const sendDataReadyEmail = async (toEmail, downloadUrl, expiresAt, name) => {
  return resendService.sendDataReadyEmail(toEmail, downloadUrl, expiresAt, name);
};

const sendLoginEmail = async (toEmail, name, loginInfo) => {
  return resendService.sendLoginEmail(toEmail, name, loginInfo);
};

const sendLoginOtpEmail = async (toEmail, otp, name) => {
  return resendService.sendLoginOtpEmail(toEmail, otp, name);
};

// Additional helpers used elsewhere in the backend (wrap resendService to keep a single entry point)
const sendPasswordResetEmail = async (toEmail, resetToken, name) => {
  return resendService.sendPasswordResetEmail(toEmail, resetToken, name);
};

const sendOrderConfirmationEmail = async (toEmail, order, name) => {
  return resendService.sendOrderConfirmationEmail(toEmail, order, name);
};

const sendOrderDetailEmail = async (toEmail, order, name) => {
  return resendService.sendOrderDetailEmail(toEmail, order, name);
};

/**
 * Send SMS message (stub implementation)
 * 
 * NOTE: This is a placeholder function. SMS functionality needs to be implemented
 * using a proper SMS service provider (e.g., Twilio, AWS SNS, etc.).
 * 
 * Currently, this function logs the SMS message to the console for development.
 * In production, replace this with actual SMS service integration.
 * 
 * @param {Object} data - SMS data
 * @param {string} data.to - Recipient phone number
 * @param {string} data.message - SMS message content
 * @returns {Promise<Object>} SMS service response
 */
const sendSMS = async (data) => {
  const { to, message } = data;
  
  if (!to || !message) {
    throw new Error('SMS requires both "to" (phone number) and "message" fields.');
  }

  // TODO: Implement actual SMS service integration
  // Options:
  // 1. Twilio: https://www.twilio.com/docs/sms
  // 2. AWS SNS: https://docs.aws.amazon.com/sns/latest/dg/sms_publish-to-phone.html
  // 3. Other SMS providers
  
  // For now, log to console (development only)
  logger.info('[SMS Service] 📱 SMS would be sent:');
  logger.info(`  To: ${to}`);
  logger.info(`  Message: ${message}`);
  logger.info('[SMS Service] ⚠️  SMS service not implemented. Please integrate a proper SMS provider.');
  
  // Return a mock success response
  return {
    success: true,
    message: 'SMS logged (SMS service not implemented)',
    to,
    messageId: `mock-${Date.now()}`,
  };
};

module.exports = {
  sendEmail,
  sendWelcomeEmail,
  sendCustomEmail,
  sendAccountDeletionConfirmation,
  sendDataReadyEmail,
  sendLoginEmail,
  sendLoginOtpEmail,
  sendPasswordResetEmail,
  sendOrderConfirmationEmail,
  sendOrderDetailEmail,
  sendSMS,
  get brandConfig() {
    return BRAND_CONFIG;
  },
};
