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
  { path: '/api/v1/categories/parents', methods: ['GET'] },
  { path: '/api/v1/wishlist/sync', methods: ['POST'] },
  { path: '/api/v1/product/category-counts', methods: ['GET'] },
  { path: '/api/v1/users/register', methods: ['POST'] },
  { path: '/api/v1/users/signup', methods: ['POST'] },
  { path: '/api/v1/users/login', methods: ['POST'] },
  { path: '/api/v1/users/send-otp', methods: ['POST'] },
  { path: '/api/v1/users/verify-otp', methods: ['POST'] },
  { path: '/api/v1/users/forgot-password', methods: ['POST'] },
  { path: '/api/v1/users/reset-password/:token', methods: ['PATCH'] },
  { path: '/api/v1/admin/login', methods: ['POST'] },
  { path: '/api/v1/admin/register', methods: ['POST'] },
  { path: '/api/v1/admin/verify-email', methods: ['POST'] },
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
    admin: Admin,
    seller: Seller,
  };

  return models[decoded.role]?.findById(decoded.id);
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
