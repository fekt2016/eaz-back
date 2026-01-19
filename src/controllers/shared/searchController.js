const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const Product = require('../../models/product/productModel');
const Category = require('../../models/category/categoryModel');
const SearchAnalytics = require('../../models/analytics/searchAnalyticsModel');
const aiSearchService = require('../../services/aiSearchService');
const logger = require('../../utils/logger');
const {
  normalizeQuery,
  tokenizeQuery,
  buildTextSearchQuery,
  buildFallbackQuery,
  buildSearchRegex,
  escapeRegex,
  calculateRelevanceScore,
  expandKeywords,
} = require('../../utils/helpers/searchUtils');

/**
 * @desc    Get search suggestions (autocomplete)
 * @route   GET /api/v1/search/suggestions/:query
 * @access  Public
 */
exports.getSearchSuggestions = catchAsync(async (req, res) => {
  const { query } = req.params;
  const { limit = 10 } = req.query;

  if (!query || query.length < 2) {
    return res.status(200).json({
      success: true,
      data: [],
    });
  }

  const searchTerm = decodeURIComponent(query);
  
  // Enhance query with AI if available
  let enhancedQuery = searchTerm;
  if (aiSearchService.isAIEnabled()) {
    try {
      enhancedQuery = await aiSearchService.enhanceQuery(searchTerm);
    } catch (error) {
      logger.warn('[Search] AI query enhancement failed, using original:', error.message);
    }
  }
  
  const normalized = normalizeQuery(enhancedQuery);

  if (!normalized || normalized.length < 2) {
    return res.status(200).json({
      success: true,
      data: [],
    });
  }

  const tokens = tokenizeQuery(normalized);
  const suggestions = [];

  try {
    // Get AI-powered suggestions if available
    let aiSuggestions = [];
    if (aiSearchService.isAIEnabled()) {
      try {
        aiSuggestions = await aiSearchService.generateSearchSuggestions(normalized, 3);
        // Add AI suggestions to the suggestions array
        aiSuggestions.forEach((suggestion) => {
          suggestions.push({
            type: 'ai-suggestion',
            text: suggestion,
            url: `/products/search?q=${encodeURIComponent(suggestion)}`,
          });
        });
      } catch (error) {
        logger.warn('[Search] AI suggestions failed:', error.message);
      }
    }

    // Parallel queries for better performance
    const [productResults, categoryResults, brandResults, tagResults, trendingSearches] =
      await Promise.all([
        // Product name matches (optimized with limit)
        Product.find({
          name: buildSearchRegex(searchTerm, false),
          status: 'active',
        })
          .select('name slug imageCover price')
          .limit(5)
          .sort({ averageRating: -1, totalSold: -1 }),

        // Categories
        Category.find({
          name: buildSearchRegex(searchTerm, false),
        })
          .select('name slug')
          .limit(5),

        // Brands (distinct with regex filter)
        Product.distinct('brand', {
          brand: buildSearchRegex(searchTerm, false),
          status: 'active',
        }),

        // Tags (using $in for exact matches)
        Product.distinct('tags', {
          tags: { $in: tokens },
          status: 'active',
        }),

        // Trending searches (optional)
        SearchAnalytics.getSimilarKeywords(normalized, 3).catch(() => []),
      ]);

    // Add product suggestions
    productResults.forEach((product) => {
      suggestions.push({
        type: 'product',
        text: product.name,
        url: `/products/search?type=product&q=${encodeURIComponent(product.name)}`,
        image: product.imageCover,
        price: product.price,
      });
    });

    // Add category suggestions
    categoryResults.forEach((category) => {
      suggestions.push({
        type: 'category',
        text: category.name,
        url: `/products/search?type=category&q=${encodeURIComponent(category.name)}`,
      });
    });

    // Add brand suggestions
    brandResults
      .filter((b) => b && typeof b === 'string')
      .slice(0, 5)
      .forEach((brand) => {
        suggestions.push({
          type: 'brand',
          text: brand.charAt(0).toUpperCase() + brand.slice(1),
          url: `/products/search?type=brand&q=${encodeURIComponent(brand)}`,
        });
      });

    // Add tag suggestions
    tagResults
      .filter((tag) => tag && typeof tag === 'string')
      .slice(0, 5)
      .forEach((tag) => {
        suggestions.push({
          type: 'tag',
          text: tag,
          url: `/products/search?type=tag&q=${encodeURIComponent(tag)}`,
        });
      });

    // Add trending searches
    trendingSearches.forEach((trend) => {
      if (trend.keyword !== normalized) {
        suggestions.push({
          type: 'trending',
          text: trend.keyword,
          url: `/products/search?q=${encodeURIComponent(trend.keyword)}`,
        });
      }
    });

    // Deduplicate and limit
    const uniqueSuggestions = suggestions
      .reduce((acc, current) => {
        const exists = acc.find(
          (item) => item.text === current.text && item.type === current.type,
        );
        if (!exists) acc.push(current);
        return acc;
      }, [])
      .slice(0, parseInt(limit));

    res.status(200).json({
      success: true,
      data: uniqueSuggestions,
      aiEnabled: aiSearchService.isAIEnabled(),
      aiUsed: aiSuggestions.length > 0,
      _meta: {
        originalQuery: searchTerm,
        enhancedQuery: enhancedQuery !== searchTerm ? enhancedQuery : undefined,
        totalSuggestions: uniqueSuggestions.length,
        aiSuggestions: aiSuggestions.length,
      },
    });
  } catch (error) {
    logger.error('Search suggestion error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch suggestions',
    });
  }
});

/**
 * @desc    Search products with autocomplete suggestions (typeahead)
 * @route   GET /api/v1/search/query/:query
 * @access  Public
 */
exports.searchProducts = catchAsync(async (req, res, next) => {
  try {
    const q = req.params.query;

    if (!q || q.length < 2) {
      return res.json([]);
    }

    let searchTerm = decodeURIComponent(q);
    
    // Enhance query with AI if available
    if (aiSearchService.isAIEnabled()) {
      try {
        searchTerm = await aiSearchService.enhanceQuery(searchTerm);
      } catch (error) {
        logger.warn('[Search] AI query enhancement failed, using original:', error.message);
      }
    }
    
    const normalized = normalizeQuery(searchTerm);

    if (!normalized || normalized.length < 2) {
      return res.json([]);
    }

    const tokens = tokenizeQuery(normalized);

    // Parallel queries for suggestions
    const [productResults, categoryResults, brandResults, tagResults] =
      await Promise.all([
        Product.find({
          name: buildSearchRegex(searchTerm, false),
          status: 'active',
        })
          .select('name slug')
          .limit(5)
          .lean(),

        Category.find({
          name: buildSearchRegex(searchTerm, false),
        })
          .select('name slug')
          .limit(5)
          .lean(),

        Product.distinct('brand', {
          brand: buildSearchRegex(searchTerm, false),
          status: 'active',
        }),

        Product.distinct('tags', {
          tags: { $in: tokens },
          status: 'active',
        }),
      ]);

    const suggestions = [];

    // Products
    productResults.forEach((product) => {
      suggestions.push({
        type: 'product',
        text: product.name,
        url: `/products/search?type=product&q=${encodeURIComponent(product.name)}`,
      });
    });

    // Categories
    categoryResults.forEach((category) => {
      suggestions.push({
        type: 'category',
        text: category.name,
        url: `/products/search?type=category&q=${encodeURIComponent(category.name)}`,
      });
    });

    // Brands
    brandResults
      .filter((b) => typeof b === 'string' && b.toLowerCase().includes(normalized))
      .slice(0, 5)
      .forEach((brand) => {
        suggestions.push({
          type: 'brand',
          text: brand.charAt(0).toUpperCase() + brand.slice(1),
          url: `/products/search?type=brand&q=${encodeURIComponent(brand)}`,
        });
      });

    // Tags
    tagResults
      .filter((tag) => tag && typeof tag === 'string')
      .slice(0, 5)
      .forEach((tag) => {
        suggestions.push({
          type: 'tag',
          text: tag,
          url: `/products/search?type=tag&q=${encodeURIComponent(tag)}`,
        });
      });

    // Deduplicate + limit
    const uniqueSuggestions = suggestions
      .reduce((acc, current) => {
        const exists = acc.find(
          (item) => item.text === current.text && item.type === current.type,
        );
        if (!exists) acc.push(current);
        return acc;
      }, [])
      .slice(0, 10);

    res.status(200).json({
      suggestions: uniqueSuggestions,
      aiEnabled: aiSearchService.isAIEnabled(),
      query: normalized,
    });
  } catch (error) {
    logger.error('Search products error:', error);
    res.status(500).json({ error: 'Failed to fetch search results' });
  }
});

/**
 * @desc    Search products with filters, pagination, and advanced search
 * @route   GET /api/v1/search/results
 * @access  Public
 */
exports.searchProductsResults = catchAsync(async (req, res, next) => {
  const {
    type,
    q,
    category,
    brand,
    minPrice,
    maxPrice,
    rating,
    inStock,
    onSale,
    sortBy = 'relevance',
    page = 1,
    limit = 20,
    categoryId, // For category-aware search
  } = req.query;

  // Extract user info for analytics (optional)
  const userId = req.user?.id || null;
  const userModel = req.user?.role === 'seller' ? 'Seller' : req.user?.role === 'admin' ? 'Admin' : 'User';

  // Normalize search query
  let searchQuery = q ? decodeURIComponent(q) : '';
  
  // Enhance query with AI if available
  if (searchQuery && aiSearchService.isAIEnabled()) {
    try {
      searchQuery = await aiSearchService.enhanceQuery(searchQuery);
    } catch (error) {
      logger.warn('[Search] AI query enhancement failed, using original:', error.message);
    }
  }
  
  const normalized = normalizeQuery(searchQuery);
  
  // Classify query intent with AI if available
  let queryIntent = null;
  let finalCategoryId = categoryId;
  let finalBrand = brand;
  
  if (normalized && aiSearchService.isAIEnabled()) {
    try {
      queryIntent = await aiSearchService.classifyQueryIntent(normalized);
      // Use AI-suggested category/brand if confidence is high
      if (queryIntent.confidence > 0.7) {
        if (queryIntent.category && !finalCategoryId && !category) {
          // Try to find matching category
          const categoryDoc = await Category.findOne({
            name: { $regex: `^${queryIntent.category.trim()}$`, $options: 'i' },
          });
          if (categoryDoc) {
            finalCategoryId = categoryDoc._id;
          }
        }
        if (queryIntent.brand && !finalBrand) {
          finalBrand = queryIntent.brand;
        }
      }
    } catch (error) {
      logger.warn('[Search] AI intent classification failed:', error.message);
    }
  }

  // Build base query
  const baseQuery = {
    status: 'active',
  };

  // Add category filter if provided (use AI-suggested category if available)
  if (finalCategoryId) {
    baseQuery.$or = [
      { parentCategory: finalCategoryId },
      { subCategory: finalCategoryId },
    ];
  } else if (categoryId) {
    baseQuery.$or = [
      { parentCategory: categoryId },
      { subCategory: categoryId },
    ];
  } else if (category) {
    const categoryDoc = await Category.findOne({
      name: { $regex: `^${category.trim()}$`, $options: 'i' },
    });
    if (categoryDoc) {
      baseQuery.$or = [
        { parentCategory: categoryDoc._id },
        { subCategory: categoryDoc._id },
      ];
    }
  }

  // Add brand filter (use AI-suggested brand if available)
  if (finalBrand) {
    baseQuery.brand = buildSearchRegex(finalBrand, false);
  } else if (brand) {
    baseQuery.brand = buildSearchRegex(brand, false);
  }

  // Add price range filter
  if (minPrice || maxPrice) {
    baseQuery.minPrice = {};
    if (minPrice) baseQuery.minPrice.$gte = parseFloat(minPrice);
    if (maxPrice) baseQuery.minPrice.$lte = parseFloat(maxPrice);
  }

  // Add rating filter
  if (rating) {
    baseQuery.ratingsAverage = { $gte: parseFloat(rating) };
  }

  // Add stock filter
  if (inStock === 'true' || inStock === true) {
    baseQuery.totalStock = { $gt: 0 };
  }

  // Add sale filter
  if (onSale === 'true' || onSale === true) {
    baseQuery.onSale = true;
  }

  // Apply buyer-safe filter (exclude unverified seller products)
  const { buildBuyerSafeQuery } = require('../../utils/helpers/productVisibility');
  const isAdmin = req.user?.role === 'admin';
  const isSeller = req.user?.role === 'seller';
  const buyerSafeQuery = buildBuyerSafeQuery(baseQuery, {
    user: req.user,
    isAdmin: isAdmin,
    isSeller: isSeller,
  });

  let products = [];
  let totalProducts = 0;

  // Handle different search types
  if (type === 'product' && normalized) {
    // Product name search with text index
    const textQuery = buildTextSearchQuery(normalized);
    if (textQuery) {
      // Merge text query with buyer-safe query
      const query = { ...buyerSafeQuery, ...textQuery };
      const countQuery = Product.countDocuments(query);
      const findQuery = Product.find(query)
        .select('-__v')
        .populate('parentCategory', 'name slug')
        .populate('subCategory', 'name slug');

      // Apply sorting
      switch (sortBy) {
        case 'price-low':
          findQuery.sort({ minPrice: 1 });
          break;
        case 'price-high':
          findQuery.sort({ minPrice: -1 });
          break;
        case 'rating':
          findQuery.sort({ ratingsAverage: -1, ratingsQuantity: -1 });
          break;
        case 'newest':
          findQuery.sort({ createdAt: -1 });
          break;
        default: // relevance
          findQuery.sort({ score: { $meta: 'textScore' } });
      }

      // Apply pagination
      const skip = (parseInt(page) - 1) * parseInt(limit);
      findQuery.skip(skip).limit(parseInt(limit));

      [totalProducts, products] = await Promise.all([countQuery, findQuery]);

      // If no results from text search, try fallback
      if (products.length === 0) {
        const fallbackQuery = buildFallbackQuery(normalized, {
          categoryId: categoryId || (category ? (await Category.findOne({ name: { $regex: `^${category.trim()}$`, $options: 'i' } }))?._id : null),
          brand,
          minPrice,
          maxPrice,
          inStock: inStock === 'true' || inStock === true,
          onSale: onSale === 'true' || onSale === true,
        });

        if (fallbackQuery) {
          // Merge fallback query with buyer-safe query
          const safeFallbackQuery = { ...buyerSafeQuery, ...fallbackQuery };
          const fallbackFindQuery = Product.find(safeFallbackQuery)
            .select('-__v')
            .populate('parentCategory', 'name slug')
            .populate('subCategory', 'name slug');

          // Apply same sorting
          switch (sortBy) {
            case 'price-low':
              fallbackFindQuery.sort({ minPrice: 1 });
              break;
            case 'price-high':
              fallbackFindQuery.sort({ minPrice: -1 });
              break;
            case 'rating':
              fallbackFindQuery.sort({ ratingsAverage: -1, ratingsQuantity: -1 });
              break;
            case 'newest':
              fallbackFindQuery.sort({ createdAt: -1 });
              break;
            default:
              // Sort by relevance score
              fallbackFindQuery.sort({ totalSold: -1, ratingsAverage: -1 });
          }

          const skip = (parseInt(page) - 1) * parseInt(limit);
          fallbackFindQuery.skip(skip).limit(parseInt(limit));

          [totalProducts, products] = await Promise.all([
            Product.countDocuments(safeFallbackQuery),
            fallbackFindQuery,
          ]);
        }
      }
    }
  } else if (type === 'category' && category) {
    // Category search
    const categoryDoc = await Category.findOne({
      name: { $regex: `^${category.trim()}$`, $options: 'i' },
    });

    if (categoryDoc) {
      const query = {
        ...buyerSafeQuery,
        $or: [
          { parentCategory: categoryDoc._id },
          { subCategory: categoryDoc._id },
        ],
      };

      const countQuery = Product.countDocuments(query);
      const findQuery = Product.find(query)
        .select('-__v')
        .populate('parentCategory', 'name slug')
        .populate('subCategory', 'name slug');

      // Apply sorting
      switch (sortBy) {
        case 'price-low':
          findQuery.sort({ minPrice: 1 });
          break;
        case 'price-high':
          findQuery.sort({ minPrice: -1 });
          break;
        case 'rating':
          findQuery.sort({ ratingsAverage: -1, ratingsQuantity: -1 });
          break;
        case 'newest':
          findQuery.sort({ createdAt: -1 });
          break;
        default:
          findQuery.sort({ totalSold: -1, ratingsAverage: -1 });
      }

      const skip = (parseInt(page) - 1) * parseInt(limit);
      findQuery.skip(skip).limit(parseInt(limit));

      [totalProducts, products] = await Promise.all([countQuery, findQuery]);
    }
  } else if (type === 'brand' && brand) {
    // Brand search
    const query = {
      ...buyerSafeQuery,
      brand: buildSearchRegex(brand, false),
    };

    const countQuery = Product.countDocuments(query);
    const findQuery = Product.find(query)
      .select('-__v')
      .populate('parentCategory', 'name slug')
      .populate('subCategory', 'name slug');

    switch (sortBy) {
      case 'price-low':
        findQuery.sort({ minPrice: 1 });
        break;
      case 'price-high':
        findQuery.sort({ minPrice: -1 });
        break;
      case 'rating':
        findQuery.sort({ ratingsAverage: -1, ratingsQuantity: -1 });
        break;
      case 'newest':
        findQuery.sort({ createdAt: -1 });
        break;
      default:
        findQuery.sort({ totalSold: -1, ratingsAverage: -1 });
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    findQuery.skip(skip).limit(parseInt(limit));

    [totalProducts, products] = await Promise.all([countQuery, findQuery]);
  } else if (type === 'tag' && normalized) {
    // Tag search
    const tokens = tokenizeQuery(normalized);
    const query = {
      ...buyerSafeQuery,
      tags: { $in: tokens },
    };

    const countQuery = Product.countDocuments(query);
    const findQuery = Product.find(query)
      .select('-__v')
      .populate('parentCategory', 'name slug')
      .populate('subCategory', 'name slug');

    switch (sortBy) {
      case 'price-low':
        findQuery.sort({ minPrice: 1 });
        break;
      case 'price-high':
        findQuery.sort({ minPrice: -1 });
        break;
      case 'rating':
        findQuery.sort({ ratingsAverage: -1, ratingsQuantity: -1 });
        break;
      case 'newest':
        findQuery.sort({ createdAt: -1 });
        break;
      default:
        findQuery.sort({ totalSold: -1, ratingsAverage: -1 });
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    findQuery.skip(skip).limit(parseInt(limit));

    [totalProducts, products] = await Promise.all([countQuery, findQuery]);
  } else if (normalized) {
    // General free-text search
    const textQuery = buildTextSearchQuery(normalized);
    let query = { ...buyerSafeQuery };

    if (textQuery) {
      query = { ...query, ...textQuery };
    } else {
      // Fallback to regex if text search not available
      const fallbackQueryResult = buildFallbackQuery(normalized, {
        categoryId: categoryId || (category ? (await Category.findOne({ name: { $regex: `^${category.trim()}$`, $options: 'i' } }))?._id : null),
        brand,
        minPrice,
        maxPrice,
        inStock: inStock === 'true' || inStock === true,
        onSale: onSale === 'true' || onSale === true,
      });
      query = fallbackQueryResult ? { ...buyerSafeQuery, ...fallbackQueryResult } : buyerSafeQuery;
    }

    const countQuery = Product.countDocuments(query);
    const findQuery = Product.find(query)
      .select('-__v')
      .populate('parentCategory', 'name slug')
      .populate('subCategory', 'name slug');

    // Apply sorting
    switch (sortBy) {
      case 'price-low':
        findQuery.sort({ minPrice: 1 });
        break;
      case 'price-high':
        findQuery.sort({ minPrice: -1 });
        break;
      case 'rating':
        findQuery.sort({ ratingsAverage: -1, ratingsQuantity: -1 });
        break;
      case 'newest':
        findQuery.sort({ createdAt: -1 });
        break;
      default: // relevance
        if (textQuery) {
          findQuery.sort({ score: { $meta: 'textScore' } });
        } else {
          findQuery.sort({ totalSold: -1, ratingsAverage: -1 });
        }
    }

    // Apply pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    findQuery.skip(skip).limit(parseInt(limit));

    [totalProducts, products] = await Promise.all([countQuery, findQuery]);

    // If no results and we used text search, try fallback
    if (products.length === 0 && textQuery) {
      const fallbackQuery = buildFallbackQuery(normalized, {
        categoryId: categoryId || (category ? (await Category.findOne({ name: { $regex: `^${category.trim()}$`, $options: 'i' } }))?._id : null),
        brand,
        minPrice,
        maxPrice,
        inStock: inStock === 'true' || inStock === true,
        onSale: onSale === 'true' || onSale === true,
      });

      if (fallbackQuery) {
        // Merge fallback query with buyer-safe query
        const safeFallbackQuery = { ...buyerSafeQuery, ...fallbackQuery };
        const fallbackFindQuery = Product.find(safeFallbackQuery)
          .select('-__v')
          .populate('parentCategory', 'name slug')
          .populate('subCategory', 'name slug');

        switch (sortBy) {
          case 'price-low':
            fallbackFindQuery.sort({ minPrice: 1 });
            break;
          case 'price-high':
            fallbackFindQuery.sort({ minPrice: -1 });
            break;
          case 'rating':
            fallbackFindQuery.sort({ ratingsAverage: -1, ratingsQuantity: -1 });
            break;
          case 'newest':
            fallbackFindQuery.sort({ createdAt: -1 });
            break;
          default:
            fallbackFindQuery.sort({ totalSold: -1, ratingsAverage: -1 });
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        fallbackFindQuery.skip(skip).limit(parseInt(limit));

        [totalProducts, products] = await Promise.all([
          Product.countDocuments(safeFallbackQuery),
          fallbackFindQuery,
        ]);
      }
    }
  } else {
    // No search query, return empty or all products with filters
    const query = buyerSafeQuery;
    const countQuery = Product.countDocuments(query);
    const findQuery = Product.find(query)
      .select('-__v')
      .populate('parentCategory', 'name slug')
      .populate('subCategory', 'name slug');

    switch (sortBy) {
      case 'price-low':
        findQuery.sort({ minPrice: 1 });
        break;
      case 'price-high':
        findQuery.sort({ minPrice: -1 });
        break;
      case 'rating':
        findQuery.sort({ ratingsAverage: -1, ratingsQuantity: -1 });
        break;
      case 'newest':
        findQuery.sort({ createdAt: -1 });
        break;
      default:
        findQuery.sort({ totalSold: -1, ratingsAverage: -1 });
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    findQuery.skip(skip).limit(parseInt(limit));

    [totalProducts, products] = await Promise.all([countQuery, findQuery]);
  }

  // Record search analytics (async, don't wait)
  if (normalized && normalized.length >= 2) {
    SearchAnalytics.recordSearch(
      normalized,
      userId,
      userModel,
      totalProducts,
    ).catch((err) => {
      logger.error('Failed to record search analytics:', err);
    });
  }

  // Calculate pagination with backend logic
  const { buildPaginationResponse } = require('../../utils/helpers/paginationUtils');
  const pagination = buildPaginationResponse(page, limit, totalProducts, {
    delta: 2,
    maxVisible: 5,
  });

  res.status(200).json({
    success: true,
    results: products.length,
    totalProducts,
    currentPage: pagination.page,
    totalPages: pagination.totalPages,
    pagination, // Include full pagination metadata
    data: products,
    aiEnabled: aiSearchService.isAIEnabled(),
    aiUsed: queryIntent !== null,
    _meta: {
      originalQuery: q || '',
      enhancedQuery: searchQuery !== (q || '') ? searchQuery : undefined,
      intent: queryIntent ? {
        type: queryIntent.intent,
        confidence: queryIntent.confidence,
        suggestedCategory: queryIntent.category,
        suggestedBrand: queryIntent.brand,
      } : undefined,
    },
  });
});
