/**
 * Admin RBAC for `authController.restrictTo(...roles)` and permission checks.
 *
 * - ALL_ADMIN_ROLES: support_agent + admin + superadmin (auth, support, read-only lookups)
 * - OPS_ROLES: admin + superadmin (catalog, finance, mutations)
 * - LIVE_SUPPORT_CHAT_AGENT_ROLES: all staff who may answer live chat
 * - SUPERADMIN_ONLY: destructive / platform-critical configuration
 */

const ROLE_PERMISSIONS = {
  support_agent: [
    'support_tickets',
    'live_chat',
    'orders:read',
    'buyers:read',
    'sellers:read',
  ],
  admin: [
    'support_tickets',
    'live_chat',
    'orders',
    'buyers',
    'sellers',
    'products',
    'reviews',
    'testimonials',
    'categories',
    'refunds',
    'payments',
    'payouts',
    'tax',
    'settings',
    'users',
    'coupons',
    'ads',
    'flash_deals',
    'gift_cards',
    'shipping:read',
    'balance:read',
    'activity_logs:read',
    'analytics',
  ],
  superadmin: ['*'],
};

const hasPermission = (role, permission) => {
  if (role === 'superadmin') return true;
  const perms = ROLE_PERMISSIONS[role] || [];
  return (
    perms.includes(permission) ||
    perms.includes(String(permission).split(':')[0])
  );
};

const ALL_ADMIN_ROLES = ['support_agent', 'admin', 'superadmin'];
const OPS_ROLES = ['admin', 'superadmin'];
const LIVE_SUPPORT_CHAT_AGENT_ROLES = ALL_ADMIN_ROLES;
const SUPERADMIN_ONLY = ['superadmin'];

module.exports = {
  ROLE_PERMISSIONS,
  hasPermission,
  ALL_ADMIN_ROLES,
  OPS_ROLES,
  LIVE_SUPPORT_CHAT_AGENT_ROLES,
  SUPERADMIN_ONLY,
};
