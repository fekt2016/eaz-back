/**
 * Email Service - SendGrid Only
 * 
 * This service uses SendGrid exclusively for all email operations.
 * SendGrid must be configured with SENDGRID_API_KEY environment variable.
 */

// Brand Configuration (configurable via environment variables)
const BRAND_CONFIG = {
  name: process.env.APP_NAME || process.env.BRAND_NAME || 'Saysay',
  tagline: process.env.BRAND_TAGLINE || 'Online Marketplace',
  url: process.env.FRONTEND_URL || 'https://eazworld.com',
  supportEmail: process.env.SUPPORT_EMAIL || process.env.EMAIL_FROM || 'support@eazworld.com',
  fromName: process.env.EMAIL_FROM_NAME || 'Saysay',
};

let sendGridService = null;

// Initialize SendGrid service
try {
  sendGridService = require('./sendGridService');
  console.log('[EmailService] ✅ SendGrid email service loaded');
} catch (error) {
  console.error('[EmailService] ❌ Failed to load SendGrid service:', error.message);
  throw new Error('SendGrid email service is required but failed to load. Please ensure @sendgrid/mail is installed.');
}

// Validate SendGrid configuration
if (!process.env.SENDGRID_API_KEY) {
  console.error('[EmailService] ❌ SENDGRID_API_KEY not set in environment variables!');
  throw new Error('SENDGRID_API_KEY is required. Please set it in your environment variables.');
}

// Log brand configuration
console.log(`[EmailService] 📧 Brand: ${BRAND_CONFIG.name} | URL: ${BRAND_CONFIG.url}`);


const sendEmail = async (data) => {
  if (!sendGridService) {
    throw new Error('SendGrid service is not available. Please check your configuration.');
  }

  return sendGridService.sendEmail({
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
  if (!sendGridService) {
    throw new Error('SendGrid service is not available. Please check your configuration.');
  }
  return sendGridService.sendWelcomeEmail(email, name);
};


const sendCustomEmail = async (data) => {
  if (!sendGridService) {
    throw new Error('SendGrid service is not available. Please check your configuration.');
  }
  return sendGridService.sendCustomEmail(data);
};


const sendAccountDeletionConfirmation = async (toEmail, name) => {
  if (!sendGridService) {
    throw new Error('SendGrid service is not available. Please check your configuration.');
  }
  return sendGridService.sendAccountDeletionConfirmation(toEmail, name);
};

const sendDataReadyEmail = async (toEmail, downloadUrl, expiresAt, name) => {
  if (!sendGridService) {
    throw new Error('SendGrid service is not available. Please check your configuration.');
  }
  return sendGridService.sendDataReadyEmail(toEmail, downloadUrl, expiresAt, name);
};


const sendLoginEmail = async (toEmail, name, loginInfo) => {
  if (!sendGridService) {
    throw new Error('SendGrid service is not available. Please check your configuration.');
  }
  return sendGridService.sendLoginEmail(toEmail, name, loginInfo);
};


const sendLoginOtpEmail = async (toEmail, otp, name) => {
  if (!sendGridService) {
    throw new Error('SendGrid service is not available. Please check your configuration.');
  }
  return sendGridService.sendLoginOtpEmail(toEmail, otp, name);
};

const sendPasswordResetEmail = async (toEmail, resetToken, name = 'User') => {
  if (!sendGridService) {
    throw new Error('SendGrid service is not available. Please check your configuration.');
  }
  return sendGridService.sendPasswordResetEmail(toEmail, resetToken, name);
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
  console.log('[SMS Service] 📱 SMS would be sent:');
  console.log(`  To: ${to}`);
  console.log(`  Message: ${message}`);
  console.log('[SMS Service] ⚠️  SMS service not implemented. Please integrate a proper SMS provider.');
  
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
  sendSMS,
  // Export SendGrid service directly
  get sendGridService() {
    return sendGridService;
  },
  // Export brand configuration
  get brandConfig() {
    return BRAND_CONFIG;
  },
};
