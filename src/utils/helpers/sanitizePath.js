/**
 * Sanitize and validate redirect paths
 * Only allows internal routes to prevent open redirect vulnerabilities
 * 
 * @param {string} path - The redirect path to sanitize
 * @param {string} [defaultPath='/'] - Default path if path is invalid
 * @returns {string} - Sanitized path
 */
const sanitizePath = (path, defaultPath = '/') => {
  if (!path || typeof path !== 'string') {
    return defaultPath;
  }

  // Remove leading/trailing whitespace
  const trimmedPath = path.trim();

  // If empty, return default
  if (!trimmedPath) {
    return defaultPath;
  }

  // Prevent external redirects (security)
  if (trimmedPath.startsWith('http://') || trimmedPath.startsWith('https://')) {
    console.warn(`[sanitizePath] Blocked external redirect: ${trimmedPath}`);
    return defaultPath;
  }

  // Prevent javascript: and data: protocols
  if (trimmedPath.toLowerCase().startsWith('javascript:') || 
      trimmedPath.toLowerCase().startsWith('data:')) {
    console.warn(`[sanitizePath] Blocked dangerous protocol: ${trimmedPath}`);
    return defaultPath;
  }

  // Allowed base routes
  const allowedRoutes = [
    '/',
    '/home',
    '/checkout',
    '/cart',
    '/product',
    '/driver/dashboard',
    '/driver/checkout',
    '/account',
    '/orders',
    '/wishlist',
    '/profile',
    '/settings',
  ];

  // Check if path starts with any allowed route
  const isAllowed = allowedRoutes.some((route) => {
    // Exact match
    if (trimmedPath === route) {
      return true;
    }
    // Path starts with allowed route followed by / or end of string
    if (trimmedPath.startsWith(route + '/') || trimmedPath.startsWith(route + '?')) {
      return true;
    }
    return false;
  });

  if (!isAllowed) {
    console.warn(`[sanitizePath] Blocked unauthorized route: ${trimmedPath}`);
    return defaultPath;
  }

  // Ensure path starts with /
  if (!trimmedPath.startsWith('/')) {
    return '/' + trimmedPath;
  }

  return trimmedPath;
};

module.exports = sanitizePath;

