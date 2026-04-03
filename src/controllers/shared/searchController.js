const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const Product = require('../../models/product/productModel');
const Category = require('../../models/category/categoryModel');
const Seller = require('../../models/user/sellerModel');
const SearchAnalytics = require('../../models/analytics/searchAnalyticsModel');
const aiSearchService = require('../../services/aiSearchService');
const logger = require('../../utils/logger');
const {
  normalizeQuery,
  tokenizeQuery,
  buildInclusiveKeywordQuery,
  buildSearchRegex,
  buildFuzzyRegexes,
  escapeRegex,
  expandKeywords,
} = require('../../utils/helpers/searchUtils');

const mergeBuyerSafeWithInclusiveSearch = (buyerSafeQuery, inclusiveFragment) => {
  if (!inclusiveFragment) return null;
  return { $and: [buyerSafeQuery, inclusiveFragment] };
};

const buildExpandedFuzzyRegexes = (terms = []) => {
  const seen = new Set();
  const patterns = [];

  terms.forEach((term) => {
    const regexes = buildFuzzyRegexes(term) || [];
    regexes.forEach((regex) => {
      if (!(regex instanceof RegExp)) return;
      const key = `${regex.source}/${regex.flags}`;
      if (!seen.has(key)) {
        seen.add(key);
        patterns.push(regex);
      }
    });
  });

  return patterns;
};

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
  const expandedKeywords = await expandKeywords(searchTerm, aiSearchService.isAIEnabled());
  const expandedTerms = [normalized, ...expandedKeywords].filter(Boolean);
  const expandedTokens = [...new Set(expandedTerms.flatMap((term) => tokenizeQuery(term)))];
  const expandedNameRegexes = buildExpandedFuzzyRegexes(expandedTerms);
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
    const [productResults, categoryResults, brandResults, tagResults, sellerResults, trendingSearches] =
      await Promise.all([
        // Product name matches (optimized with limit, using fuzzy logic for typo tolerance)
        Product.find({
          name: { $in: expandedNameRegexes },
          status: 'active',
          isVisible: true,
          isDeleted: { $ne: true }, // Exclude deleted products
          isDeletedByAdmin: { $ne: true }, // Exclude admin-deleted products
          isDeletedBySeller: { $ne: true }, // Exclude seller-deleted products
        })
          .select('name slug imageCover price')
          .limit(5)
          .sort({ averageRating: -1, totalSold: -1 }),

        // Categories
        Category.find({
          name: { $in: buildFuzzyRegexes(searchTerm) },
        })
          .select('name slug')
          .limit(5),

        // Brands (distinct with regex filter)
        Product.distinct('brand', {
          brand: buildSearchRegex(searchTerm, false),
          status: 'active',
          isVisible: true,
          isDeleted: { $ne: true }, // Exclude deleted products
        }),

        // Tags (using $in for exact matches)
        Product.distinct('tags', {
          tags: { $in: expandedTokens.length > 0 ? expandedTokens : tokens },
          status: 'active',
          isVisible: true,
          isDeleted: { $ne: true }, // Exclude deleted products
          isDeletedByAdmin: { $ne: true }, // Exclude admin-deleted products
          isDeletedBySeller: { $ne: true }, // Exclude seller-deleted products
        }),

        // Sellers
        Seller.find({
          shopName: { $in: expandedNameRegexes },
          status: 'active',
        })
          .select('shopName avatar')
          .limit(3),

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

    // Add seller suggestions
    sellerResults.forEach((seller) => {
      suggestions.push({
        type: 'seller',
        text: seller.shopName,
        url: `/sellers/${seller._id}`,
        image: seller.avatar,
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
    const expandedKeywords = await expandKeywords(searchTerm, aiSearchService.isAIEnabled());
    const expandedTerms = [normalized, ...expandedKeywords].filter(Boolean);
    const expandedTokens = [...new Set(expandedTerms.flatMap((term) => tokenizeQuery(term)))];
    const expandedNameRegexes = buildExpandedFuzzyRegexes(expandedTerms);

    // Parallel queries for suggestions
    const [productResults, categoryResults, brandResults, tagResults, sellerResults] =
      await Promise.all([
        Product.find({
          name: { $in: expandedNameRegexes },
          status: 'active',
          isVisible: true,
          isDeleted: { $ne: true }, // Exclude deleted products
          isDeletedByAdmin: { $ne: true }, // Exclude admin-deleted products
          isDeletedBySeller: { $ne: true }, // Exclude seller-deleted products
        })
          .select('name slug')
          .limit(5)
          .lean(),

        Category.find({
          name: { $in: buildFuzzyRegexes(searchTerm) },
        })
          .select('name slug')
          .limit(5)
          .lean(),

        Product.distinct('brand', {
          brand: buildSearchRegex(searchTerm, false),
          status: 'active',
          isVisible: true,
          isDeleted: { $ne: true }, // Exclude deleted products
        }),

        Product.distinct('tags', {
          tags: { $in: expandedTokens.length > 0 ? expandedTokens : tokens },
          status: 'active',
          isVisible: true,
          isDeleted: { $ne: true }, // Exclude deleted products
          isDeletedByAdmin: { $ne: true }, // Exclude admin-deleted products
          isDeletedBySeller: { $ne: true }, // Exclude seller-deleted products
        }),

        Seller.find({
          shopName: { $in: expandedNameRegexes },
          status: 'active',
        })
          .select('shopName avatar')
          .limit(3)
          .lean(),
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

    // Sellers
    sellerResults.forEach((seller) => {
      suggestions.push({
        type: 'seller',
        text: seller.shopName,
        url: `/sellers/${seller._id}`,
        image: seller.avatar,
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
    // Substring-inclusive search (matches tokens inside words, e.g. "phone" → "iPhone")
    const inclusiveFragment = buildInclusiveKeywordQuery(normalized);
    const query = mergeBuyerSafeWithInclusiveSearch(buyerSafeQuery, inclusiveFragment);

    if (query) {
      logger.info('[SEARCH] Inclusive product query executing');
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
    } else {
      totalProducts = 0;
      products = [];
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
    // Tag search — substring on tags array (each token must match some tag)
    const tokens = tokenizeQuery(normalized);
    if (tokens.length === 0) {
      totalProducts = 0;
      products = [];
    } else {
      const tagFragment =
        tokens.length === 1
          ? { tags: new RegExp(escapeRegex(tokens[0]), 'i') }
          : {
              $and: tokens.map((t) => ({
                tags: new RegExp(escapeRegex(t), 'i'),
              })),
            };
      const query = mergeBuyerSafeWithInclusiveSearch(buyerSafeQuery, tagFragment);

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
  } else if ((type === 'seller' || type === 'store') && (normalized || q)) {
    // Seller/Store search: Find matching sellers, then return their products
    const Seller = require('../../models/user/sellerModel');
    const matchedSellers = await Seller.find({
      shopName: { $in: buildFuzzyRegexes(q ? decodeURIComponent(q) : normalized) },
      status: 'active',
    }).select('_id');

    const sellerIds = matchedSellers.map(s => s._id);

    const query = {
      ...buyerSafeQuery,
      seller: { $in: sellerIds },
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
    // General free-text search — substring-inclusive on name, brand, description, tags, etc.
    const inclusiveFragment = buildInclusiveKeywordQuery(normalized);
    const query = mergeBuyerSafeWithInclusiveSearch(buyerSafeQuery, inclusiveFragment);

    if (query) {
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
    } else {
      totalProducts = 0;
      products = [];
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

  // Fetch matching stores/sellers
  let matchingSellers = [];
  if (normalized && page === 1) { // Only fetch on first page
    try {
      const Seller = require('../../models/user/sellerModel');
      const searchTerm = q ? decodeURIComponent(q) : '';
      matchingSellers = await Seller.find({
        shopName: { $in: buildFuzzyRegexes(searchTerm) },
        status: 'active',
      })
        .select('shopName avatar rating')
        .limit(3)
        .lean();
    } catch (err) {
      logger.error('Failed to fetch matching sellers:', err);
    }
  }

  res.status(200).json({
    success: true,
    results: products.length,
    totalProducts,
    currentPage: pagination.page,
    totalPages: pagination.totalPages,
    pagination, // Include full pagination metadata
    data: products,
    sellers: matchingSellers, // Add matching sellers for frontend display
    aiEnabled: aiSearchService.isAIEnabled(),
    aiUsed: queryIntent !== null,
    _meta: {
      originalQuery: q || '',
      enhancedQuery: searchQuery !== (q ? decodeURIComponent(q) : '') ? searchQuery : undefined,
      intent: queryIntent ? {
        type: queryIntent.intent,
        confidence: queryIntent.confidence,
        suggestedCategory: queryIntent.category,
        suggestedBrand: queryIntent.brand,
      } : undefined,
    },
  });
});
