/**
 * Mobile Deep Link Utility
 * 
 * Generates mobile-aware URLs that work with both web and mobile apps
 * Uses universal links (iOS) and app links (Android) which automatically
 * route to the app if installed, or fall back to web.
 */

/**
 * Generate URL for password reset
 * Works for both web and mobile (universal links)
 * @param {string} resetToken - Password reset token
 * @param {string} [baseUrl] - Base URL (defaults to FRONTEND_URL)
 * @returns {string} Reset password URL
 */
const generatePasswordResetUrl = (resetToken, baseUrl = null) => {
  const frontendUrl = baseUrl || process.env.FRONTEND_URL || process.env.MAIN_APP_URL || 'https://eazworld.com';
  return `${frontendUrl}/reset-password?token=${resetToken}`;
};

/**
 * Generate URL for OTP verification
 * @param {string} loginId - Email or phone
 * @param {string} otp - OTP code (optional, for direct verification)
 * @param {string} [baseUrl] - Base URL
 * @returns {string} OTP verification URL
 */
const generateOtpVerificationUrl = (loginId, otp = null, baseUrl = null) => {
  const frontendUrl = baseUrl || process.env.FRONTEND_URL || process.env.MAIN_APP_URL || 'https://eazworld.com';
  const params = new URLSearchParams({ loginId });
  if (otp) {
    params.append('otp', otp);
  }
  return `${frontendUrl}/verify-otp?${params.toString()}`;
};

/**
 * Generate URL for email verification
 * @param {string} token - Email verification token
 * @param {string} [baseUrl] - Base URL
 * @returns {string} Email verification URL
 */
const generateEmailVerificationUrl = (token, baseUrl = null) => {
  const frontendUrl = baseUrl || process.env.FRONTEND_URL || process.env.MAIN_APP_URL || 'https://eazworld.com';
  return `${frontendUrl}/verify-email?token=${token}`;
};

/**
 * Generate URL for 2FA enable
 * @param {string} token - 2FA setup token
 * @param {string} [baseUrl] - Base URL
 * @returns {string} 2FA enable URL
 */
const generate2FAEnableUrl = (token, baseUrl = null) => {
  const frontendUrl = baseUrl || process.env.FRONTEND_URL || process.env.MAIN_APP_URL || 'https://eazworld.com';
  return `${frontendUrl}/enable-2fa?token=${token}`;
};

/**
 * Generate URL for 2FA disable
 * @param {string} token - 2FA disable token
 * @param {string} [baseUrl] - Base URL
 * @returns {string} 2FA disable URL
 */
const generate2FADisableUrl = (token, baseUrl = null) => {
  const frontendUrl = baseUrl || process.env.FRONTEND_URL || process.env.MAIN_APP_URL || 'https://eazworld.com';
  return `${frontendUrl}/disable-2fa?token=${token}`;
};

module.exports = {
  generatePasswordResetUrl,
  generateOtpVerificationUrl,
  generateEmailVerificationUrl,
  generate2FAEnableUrl,
  generate2FADisableUrl,
};

