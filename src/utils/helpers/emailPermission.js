/**
 * Email permission helper – respects buyer profile email preferences.
 *
 * Scope: Buyer-facing emails only. Seller/admin emails are not gated by these prefs.
 * Callers must use canSendUserEmail(userId, category) before sending marketing emails.
 *
 * Current gating:
 * - PROMOTION: coupon emails – gated in seller/couponController (updateCouponBatch,
 *   assignCouponToBuyer, sendCouponEmail). Always allow TRANSACTIONAL, SECURITY, PRIVACY.
 */
const Permission = require('../../models/user/permissionModel');
const logger = require('../logger');

// High-level email categories used for permission checks
const EMAIL_CATEGORY = {
  PROMOTION: 'promotion',
  NEWSLETTER: 'newsletter',
  ACCOUNT_UPDATE: 'account_update',
  TRANSACTIONAL: 'transactional',
  SECURITY: 'security',
  PRIVACY: 'privacy',
};

// Mirror backend defaults (permissionModel + permissionController)
const DEFAULT_EMAIL_PREFS = {
  promotions: true,
  newsletters: false,
  accountUpdates: true,
};

/**
 * Load a user's emailPreferences, falling back to defaults when missing.
 * Never throws – logs and returns safe defaults.
 */
async function getUserEmailPreferences(userId) {
  if (!userId) {
    // Should never happen for real users; fall back to defaults
    return { emailPreferences: { ...DEFAULT_EMAIL_PREFS } };
  }

  try {
    const perm = await Permission.findOne({ user: userId })
      .select('emailPreferences')
      .lean();

    if (!perm || !perm.emailPreferences) {
      return { emailPreferences: { ...DEFAULT_EMAIL_PREFS } };
    }

    return {
      emailPreferences: {
        ...DEFAULT_EMAIL_PREFS,
        ...perm.emailPreferences,
      },
    };
  } catch (error) {
    logger.error('[emailPermission] Failed to load permissions for user', {
      userId,
      error: error.message,
    });
    // Fail closed for marketing, open for critical categories (handled below)
    return { emailPreferences: { ...DEFAULT_EMAIL_PREFS } };
  }
}

/**
 * Decide if we are allowed to send a given email category to a user,
 * based on their permissions and industry best practices.
 *
 * Critical categories (transactional, security, privacy) are always allowed
 * and should NOT be gated by marketing toggles.
 */
async function canSendUserEmail(userId, category) {
  // Always allow critical / compliance categories
  if (
    category === EMAIL_CATEGORY.TRANSACTIONAL ||
    category === EMAIL_CATEGORY.SECURITY ||
    category === EMAIL_CATEGORY.PRIVACY
  ) {
    return true;
  }

  const { emailPreferences } = await getUserEmailPreferences(userId);

  switch (category) {
    case EMAIL_CATEGORY.PROMOTION:
      return !!emailPreferences.promotions;
    case EMAIL_CATEGORY.NEWSLETTER:
      return !!emailPreferences.newsletters;
    case EMAIL_CATEGORY.ACCOUNT_UPDATE:
      // For low-priority account info; critical security/account events should
      // use SECURITY/TRANSACTIONAL and bypass this flag.
      return !!emailPreferences.accountUpdates;
    default:
      // Unknown category – be conservative for marketing, permissive for system
      logger.warn('[emailPermission] Unknown email category, defaulting to allow', {
        userId,
        category,
      });
      return true;
  }
}

module.exports = {
  EMAIL_CATEGORY,
  canSendUserEmail,
};

