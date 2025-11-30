/**
 * Email Service - SendGrid Only
 * 
 * This service uses SendGrid exclusively for all email operations.
 * SendGrid must be configured with SENDGRID_API_KEY environment variable.
 */

// Brand Configuration (configurable via environment variables)
const BRAND_CONFIG = {
  name: process.env.APP_NAME || process.env.BRAND_NAME || 'EazShop',
  tagline: process.env.BRAND_TAGLINE || 'Online Marketplace',
  url: process.env.FRONTEND_URL || 'https://eazworld.com',
  supportEmail: process.env.SUPPORT_EMAIL || process.env.EMAIL_FROM || 'support@eazworld.com',
  fromName: process.env.EMAIL_FROM_NAME || 'EazShop',
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

module.exports = {
  sendEmail,
  sendWelcomeEmail,
  sendCustomEmail,
  sendAccountDeletionConfirmation,
  sendDataReadyEmail,
  sendLoginEmail,
  sendLoginOtpEmail,
  // Export SendGrid service directly
  get sendGridService() {
    return sendGridService;
  },
  // Export brand configuration
  get brandConfig() {
    return BRAND_CONFIG;
  },
};
