const recommendationService = require('../../services/recommendationService');
const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');

/**
 * GET /api/v1/products/:id/related
 * Get related products based on similarity
 */
exports.getRelatedProducts = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const limit = parseInt(req.query.limit) || 10;

  if (!id) {
    return next(new AppError('Product ID is required', 400));
  }

  const products = await recommendationService.getRelatedProducts(id, limit);

  res.status(200).json({
    status: 'success',
    results: products.length,
    data: {
      products,
    },
  });
});

/**
 * GET /api/v1/products/:id/also-bought
 * Get products that customers also bought
 */
exports.getAlsoBought = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const limit = parseInt(req.query.limit) || 10;

  if (!id) {
    return next(new AppError('Product ID is required', 400));
  }

  const products = await recommendationService.getAlsoBoughtProducts(id, limit);

  res.status(200).json({
    status: 'success',
    results: products.length,
    data: {
      products,
    },
  });
});

/**
 * GET /api/v1/products/:id/ai-similar
 * Get AI-powered semantically similar products
 */
exports.getAISimilar = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const limit = parseInt(req.query.limit) || 10;

  if (!id) {
    return next(new AppError('Product ID is required', 400));
  }

  const products = await recommendationService.getAISimilarProducts(id, limit);

  res.status(200).json({
    status: 'success',
    results: products.length,
    aiEnabled: process.env.AI_SEARCH_ENABLED === 'true' && !!process.env.OPENAI_API_KEY,
    data: {
      products,
    },
  });
});

/**
 * GET /api/v1/users/:id/personalized
 * Get personalized recommendations for a user
 */
exports.getPersonalized = catchAsync(async (req, res, next) => {
  const userId = req.params.id || req.user?._id;
  const limit = parseInt(req.query.limit) || 10;

  if (!userId) {
    return next(new AppError('User ID is required', 400));
  }

  const products = await recommendationService.getPersonalizedRecommendations(userId, limit);

  res.status(200).json({
    status: 'success',
    results: products.length,
    data: {
      products,
    },
  });
});

/**
 * GET /api/v1/users/:id/recently-viewed
 * Get recently viewed products for a user
 */
exports.getRecentlyViewed = catchAsync(async (req, res, next) => {
  const userId = req.params.id || req.user?._id;
  const limit = parseInt(req.query.limit) || 10;

  if (!userId) {
    return next(new AppError('User ID is required', 400));
  }

  const products = await recommendationService.getRecentlyViewed(userId, limit);

  res.status(200).json({
    status: 'success',
    results: products.length,
    data: {
      products,
    },
  });
});

/**
 * GET /api/v1/products/trending
 * Get trending products from last 24 hours
 */
exports.getTrending = catchAsync(async (req, res, next) => {
  const limit = parseInt(req.query.limit) || 10;

  const products = await recommendationService.getTrendingProducts(limit);

  res.status(200).json({
    status: 'success',
    results: products.length,
    data: {
      products,
    },
  });
});

/**
 * POST /api/v1/recommendations/track
 * Track user activity for recommendations
 */
exports.trackActivity = catchAsync(async (req, res, next) => {
  const { productId, action, metadata } = req.body;
  const userId = req.user?._id;

  if (!productId || !action) {
    return next(new AppError('Product ID and action are required', 400));
  }

  await recommendationService.trackUserActivity(
    userId,
    productId,
    action,
    {
      ...metadata,
      sessionId: req.sessionId || metadata?.sessionId,
      ipAddress: req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress,
      userAgent: req.headers['user-agent'],
    }
  );

  res.status(200).json({
    status: 'success',
    message: 'Activity tracked successfully',
  });
});

