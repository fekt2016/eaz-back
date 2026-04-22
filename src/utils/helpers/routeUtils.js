const NodeCache = require('node-cache');
const publicRouteCache = new NodeCache({ stdTTL: 300 });
const TokenBlacklist = require('../../models/user/tokenBlackListModal');
const { promisify } = require('util');
const jwt = require('jsonwebtoken');

const User = require('../../models/user/userModel');
const Admin = require('../../models/user/adminModel');
const Seller = require('../../models/user/sellerModel');

const publicRoutes = [
  { path: '/api/v1/product', methods: ['GET'] },
  { path: '/api/v1/product/eazshop', methods: ['GET'] }, // Public EazShop products
  { path: '/api/v1/categories/parents', methods: ['GET'] },
  { path: '/api/v1/wishlist/sync', methods: ['POST'] },
  { path: '/api/v1/product/category-counts', methods: ['GET'] },
  { path: '/api/v1/neighborhoods', methods: ['GET'] }, // Public neighborhood routes
  { path: '/api/v1/neighborhoods/search', methods: ['GET'] },
  { path: '/api/v1/neighborhoods/city', methods: ['GET'] },
  { path: '/api/v1/users/register', methods: ['POST'] },
  { path: '/api/v1/users/signup', methods: ['POST'] },
  { path: '/api/v1/users/login', methods: ['POST'] },
  { path: '/api/v1/users/send-otp', methods: ['POST'] },
  { path: '/api/v1/users/verify-otp', methods: ['POST'] },
  { path: '/api/v1/users/verify-account', methods: ['POST'] },
  { path: '/api/v1/users/resend-otp', methods: ['POST'] },
  { path: '/api/v1/users/forgot-password', methods: ['POST'] },
  { path: '/api/v1/users/reset-password/:token', methods: ['PATCH'] },
  { path: '/api/v1/admin/login', methods: ['POST'] },
  { path: '/api/v1/admin/verify-email', methods: ['POST'] },
  { path: '/api/v1/seller/login', methods: ['POST'] },
  { path: '/api/v1/seller/register', methods: ['POST'] },
  { path: '/api/v1/seller/signup', methods: ['POST'] },
  { path: '/api/v1/seller/send-otp', methods: ['POST'] },
  { path: '/api/v1/seller/verify-otp', methods: ['POST'] },
  { path: '/api/v1/seller/verify-account', methods: ['POST'] },
  { path: '/api/v1/seller/resend-otp', methods: ['POST'] },
  { path: '/api/v1/seller/forgot-password', methods: ['POST'] },
  { path: '/api/v1/seller/reset-password', methods: ['POST'] },
  { path: '/api/v1/seller/forgotPassword', methods: ['POST'] },
  { path: '/api/v1/shipping/quote', methods: ['POST'] }, // Public shipping quote calculation
  { path: '/api/v1/shipping/shipping-options', methods: ['POST'] }, // Public shipping options for checkout
  { path: '/api/v1/shipping/calc-shipping', methods: ['POST'] }, // Public shipping calculation
  { path: '/api/v1/shipping/pickup-centers', methods: ['GET'] }, // Public pickup centers
  // Analytics telemetry - mobile app doesn't send CSRF; low-risk view tracking
  { path: '/api/v1/analytics/views', methods: ['POST'] },
  { path: '/api/v1/analytics/screen-views', methods: ['POST'] },
  { path: '/api/v1/analytics/search', methods: ['POST'] },
  { path: '/api/v1/analytics/category-views', methods: ['POST'] },
  { path: '/api/v1/analytics/seller-views', methods: ['POST'] },
];

const escapeRegex = (string) => {
  return string.replace(/[-\/\\^$+?.()|[\]{}]/g, '\\$&');
};
const matchRoutePattern = (pattern, path) => {
  const normalizedPattern = pattern.replace(/\/$/, '') || '/';
  const regexPattern = `^${normalizedPattern.split('*').map(escapeRegex).join('.*')}$`;
  return new RegExp(regexPattern).test(path);
};
const isPublicRoute = (path, method) => {
  const cacheKey = `${method}:${path}`;

  // Check cache first
  if (publicRouteCache.has(cacheKey)) {
    return publicRouteCache.get(cacheKey);
  }

  // Compute if not in cache
  const result = publicRoutes.some(
    (route) =>
      route.methods.includes(method) && matchRoutePattern(route.path, path),
  );

  // Store in cache
  publicRouteCache.set(cacheKey, result);
  return result;
};
const extractToken = (authorizationHeader) => {
  return authorizationHeader?.startsWith('Bearer')
    ? authorizationHeader.split(' ')[1]
    : null;
};

const isTokenBlacklisted = async (token) => {
  const exists = await TokenBlacklist.exists({ token });
  return !!exists;
};
const verifyToken = async (token, currentPath) => {
  try {
    return {
      decoded: await promisify(jwt.verify)(token, process.env.JWT_SECRET),
      error: null,
    };
  } catch (err) {
    if (err.name === 'TokenExpiredError' && currentPath.includes('/logout')) {
      return { decoded: jwt.decode(token), error: null };
    }
    return { decoded: null, error: err };
  }
};
const findUserByToken = async (decoded) => {
  const models = {
    user: User,
    buyer: User,
    admin: Admin,
    superadmin: Admin,       // superadmin users are stored in Admin model
    support_agent: Admin,   // support_agent users are stored in Admin model
    moderator: Admin,       // legacy JWT role → treat as Admin doc lookup
    seller: Seller,
    official_store: Seller,  // official_store accounts are Seller documents
  };

  const rk = String(decoded.role || 'user').toLowerCase();
  let user = models[rk] ? await models[rk].findById(decoded.id) : null;

  // If role string was wrong/unknown but `id` exists in exactly one collection, resolve it.
  if (!user && decoded.id) {
    const [sellerDoc, userDoc] = await Promise.all([
      Seller.findById(decoded.id),
      User.findById(decoded.id),
    ]);
    if (sellerDoc && !userDoc) {
      user = sellerDoc;
    } else if (userDoc && !sellerDoc) {
      user = userDoc;
    } else if (sellerDoc && userDoc) {
      user = ['seller', 'official_store'].includes(rk) ? sellerDoc : userDoc;
    }
  }
  
  // CRITICAL: For admins, ALWAYS use the role from the token
  // The Admin model enum only allows 'admin', but tokens can have 'superadmin' or 'support_agent'
  // This ensures admin roles from the token are preserved and available for restrictTo middleware
  if (
    user &&
    decoded.role &&
    (decoded.role === 'admin' ||
      decoded.role === 'superadmin' ||
      decoded.role === 'support_agent' ||
      decoded.role === 'moderator')
  ) {
    // Override the role from database with the role from token
    // This handles cases where Admin model has role='admin' but token has role='superadmin'
    user.role = decoded.role === 'moderator' ? 'support_agent' : decoded.role;
  } else if (user && !user.role) {
    // If user doesn't have a role set, default to the role from token
    // This ensures the role is always available for restrictTo middleware
    user.role = decoded.role || 'user';
    // Save the role to the database if it was missing (but not for admins, as we set it above)
    if (
      decoded.role !== 'admin' &&
      decoded.role !== 'superadmin' &&
      decoded.role !== 'support_agent' &&
      decoded.role !== 'moderator'
    ) {
      await user.save({ validateBeforeSave: false });
    }
  }
  
  return user;
};

module.exports = {
  escapeRegex,
  matchRoutePattern,
  isPublicRoute,
  isTokenBlacklisted,
  extractToken,
  findUserByToken,
  verifyToken,
};
