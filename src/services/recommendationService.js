const Product = require('../models/product/productModel');
const UserActivity = require('../models/analytics/userActivityModel');
const ProductRelations = require('../models/analytics/productRelationsModel');
const TrendingProducts = require('../models/analytics/trendingProductsModel');
const Order = require('../models/order/orderModel');
const OrderItems = require('../models/order/OrderItemModel');
const axios = require('axios');
const logger = require('../utils/logger');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_EMBEDDING_URL = 'https://api.openai.com/v1/embeddings';
const AI_ENABLED = process.env.AI_SEARCH_ENABLED === 'true' && !!OPENAI_API_KEY;

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Generate embedding for a product using OpenAI
 */
async function generateProductEmbedding(product) {
  if (!AI_ENABLED) return null;

  try {
    const text = `${product.name} ${product.description || ''} ${product.brand || ''} ${(product.tags || []).join(' ')} ${(product.keywords || []).join(' ')}`.trim();
    
    const response = await axios.post(
      OPENAI_EMBEDDING_URL,
      {
        model: 'text-embedding-3-small',
        input: text,
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    return response.data.data[0].embedding;
  } catch (error) {
    logger.error('[Recommendation] Error generating embedding:', error.message);
    return null;
  }
}

/**
 * A. Related Products (Similarity-Based)
 * Match: category, subcategory, brand, attributes, price range
 */
async function getRelatedProducts(productId, limit = 10) {
  try {
    const product = await Product.findById(productId).select('parentCategory subCategory brand price minPrice maxPrice attributes tags status');
    
    if (!product || product.status !== 'active') {
      return [];
    }

    // Build similarity query
    const matchCriteria = {
      _id: { $ne: productId },
      status: 'active',
      $or: [],
    };

    // Category match (highest weight)
    if (product.parentCategory) {
      matchCriteria.$or.push({ parentCategory: product.parentCategory });
    }
    if (product.subCategory) {
      matchCriteria.$or.push({ subCategory: product.subCategory });
    }

    // Brand match
    if (product.brand) {
      matchCriteria.$or.push({ brand: product.brand });
    }

    // Price range match (±30%)
    if (product.price) {
      const priceRange = product.price * 0.3;
      matchCriteria.$or.push({
        $or: [
          { price: { $gte: product.price - priceRange, $lte: product.price + priceRange } },
          { minPrice: { $gte: product.price - priceRange, $lte: product.price + priceRange } },
        ],
      });
    }

    // If no criteria, return empty
    if (matchCriteria.$or.length === 0) {
      return [];
    }

    const relatedProducts = await Product.find(matchCriteria)
      .select('name imageCover price minPrice maxPrice brand ratingsAverage totalSold status slug')
      .limit(limit * 2) // Get more to score and filter
      .lean();

    // Score products by similarity
    const scoredProducts = relatedProducts.map((p) => {
      let score = 0;
      
      // Category match (40 points)
      if (p.parentCategory?.toString() === product.parentCategory?.toString()) score += 40;
      if (p.subCategory?.toString() === product.subCategory?.toString()) score += 30;
      
      // Brand match (20 points)
      if (p.brand === product.brand) score += 20;
      
      // Price similarity (10 points)
      if (product.price && p.price) {
        const priceDiff = Math.abs(p.price - product.price) / product.price;
        if (priceDiff <= 0.1) score += 10;
        else if (priceDiff <= 0.3) score += 5;
      }
      
      // Popularity boost (ratings + sales)
      score += (p.ratingsAverage || 0) * 2;
      score += Math.min(p.totalSold || 0, 100) * 0.1;
      
      return { ...p, _similarityScore: score };
    });

    // Sort by score and return top results
    return scoredProducts
      .sort((a, b) => b._similarityScore - a._similarityScore)
      .slice(0, limit)
      .map(({ _similarityScore, ...product }) => product);
  } catch (error) {
    logger.error('[Recommendation] Error getting related products:', error);
    return [];
  }
}

/**
 * B. Customers Also Bought
 * Build analytics from orders and recommend co-purchased items
 */
async function getAlsoBoughtProducts(productId, limit = 10) {
  try {
    // Find all order items containing this product
    const orderItemsWithProduct = await OrderItems.find({
      product: productId,
    })
      .select('order')
      .lean();

    const orderIds = [...new Set(orderItemsWithProduct.map(item => item.order.toString()))];

    if (orderIds.length === 0) {
      // Fallback to related products if no purchase data
      return await getRelatedProducts(productId, limit);
    }

    // Get all products from those orders (excluding the current product)
    const allOrderItems = await OrderItems.find({
      order: { $in: orderIds },
      product: { $ne: productId },
    })
      .populate('product', 'name imageCover price minPrice maxPrice brand ratingsAverage totalSold status slug')
      .lean();

    // Count frequency of co-purchased products
    const productFrequency = {};
    allOrderItems.forEach((item) => {
      if (item.product && item.product.status === 'active') {
        const prodId = item.product._id.toString();
        productFrequency[prodId] = (productFrequency[prodId] || 0) + item.quantity;
      }
    });

    // Convert to array and sort by frequency
    const alsoBought = Object.entries(productFrequency)
      .map(([id, frequency]) => {
        const item = allOrderItems.find(oi => oi.product?._id.toString() === id);
        return item ? { ...item.product, _frequency: frequency } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b._frequency - a._frequency)
      .slice(0, limit)
      .map(({ _frequency, ...product }) => product);

    // Update ProductRelations for future use
    for (const product of alsoBought) {
      const prodId = product._id?.toString() || product.id?.toString();
      if (prodId && productFrequency[prodId]) {
        await ProductRelations.findOneAndUpdate(
          {
            productId,
            relatedProductId: prodId,
            relationType: 'also_bought',
          },
          {
            productId,
            relatedProductId: prodId,
            relationType: 'also_bought',
            frequency: productFrequency[prodId],
            score: Math.min(productFrequency[prodId] / 10, 1),
            lastUpdated: new Date(),
          },
          { upsert: true, new: true }
        );
      }
    }

    return alsoBought.length > 0 ? alsoBought : await getRelatedProducts(productId, limit);
  } catch (error) {
    logger.error('[Recommendation] Error getting also bought products:', error);
    return await getRelatedProducts(productId, limit);
  }
}

/**
 * C. You May Also Like (Personalized)
 * Based on user browsing history, wishlist, cart, viewed categories, price ranges
 */
async function getPersonalizedRecommendations(userId, limit = 10) {
  try {
    if (!userId) {
      return [];
    }

    // Get user activity
    const userActivities = await UserActivity.find({ userId })
      .sort({ createdAt: -1 })
      .limit(100)
      .populate('productId', 'parentCategory subCategory brand price tags status')
      .lean();

    if (userActivities.length === 0) {
      // No activity, return trending products
      return await getTrendingProducts(limit);
    }

    // Analyze user preferences
    const categoryFrequency = {};
    const brandFrequency = {};
    const priceRanges = [];
    const viewedProducts = new Set();

    userActivities.forEach((activity) => {
      const product = activity.productId;
      if (!product || product.status !== 'active') return;

      viewedProducts.add(product._id.toString());

      // Category preferences
      if (product.parentCategory) {
        const catId = product.parentCategory.toString();
        categoryFrequency[catId] = (categoryFrequency[catId] || 0) + 1;
      }
      if (product.subCategory) {
        const subCatId = product.subCategory.toString();
        categoryFrequency[subCatId] = (categoryFrequency[subCatId] || 0) + 0.5;
      }

      // Brand preferences
      if (product.brand) {
        brandFrequency[product.brand] = (brandFrequency[product.brand] || 0) + 1;
      }

      // Price range
      if (product.price) {
        priceRanges.push(product.price);
      }
    });

    // Calculate average price and range
    const avgPrice = priceRanges.length > 0
      ? priceRanges.reduce((a, b) => a + b, 0) / priceRanges.length
      : null;
    const priceVariance = priceRanges.length > 0
      ? Math.sqrt(priceRanges.reduce((sum, price) => sum + Math.pow(price - avgPrice, 2), 0) / priceRanges.length)
      : null;

    // Get top categories and brands
    const topCategories = Object.entries(categoryFrequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id]) => id);

    const topBrands = Object.entries(brandFrequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([brand]) => brand);

    // Build recommendation query
    const matchCriteria = {
      _id: { $nin: Array.from(viewedProducts).map(id => require('mongoose').Types.ObjectId(id)) },
      status: 'active',
      $or: [],
    };

    // Category match
    if (topCategories.length > 0) {
      matchCriteria.$or.push(
        { parentCategory: { $in: topCategories } },
        { subCategory: { $in: topCategories } }
      );
    }

    // Brand match
    if (topBrands.length > 0) {
      matchCriteria.$or.push({ brand: { $in: topBrands } });
    }

    // Price range match
    if (avgPrice && priceVariance) {
      matchCriteria.$or.push({
        $or: [
          { price: { $gte: avgPrice - priceVariance * 2, $lte: avgPrice + priceVariance * 2 } },
          { minPrice: { $gte: avgPrice - priceVariance * 2, $lte: avgPrice + priceVariance * 2 } },
        ],
      });
    }

    if (matchCriteria.$or.length === 0) {
      return await getTrendingProducts(limit);
    }

    const recommendations = await Product.find(matchCriteria)
      .select('name imageCover price minPrice maxPrice brand ratingsAverage totalSold status slug')
      .limit(limit * 2)
      .lean();

    // Score by user preferences
    const scored = recommendations.map((product) => {
      let score = 0;

      // Category match
      if (product.parentCategory && topCategories.includes(product.parentCategory.toString())) {
        score += categoryFrequency[product.parentCategory.toString()] * 10;
      }
      if (product.subCategory && topCategories.includes(product.subCategory.toString())) {
        score += categoryFrequency[product.subCategory.toString()] * 5;
      }

      // Brand match
      if (product.brand && topBrands.includes(product.brand)) {
        score += brandFrequency[product.brand] * 5;
      }

      // Price similarity
      if (avgPrice && product.price) {
        const priceDiff = Math.abs(product.price - avgPrice) / avgPrice;
        if (priceDiff <= 0.2) score += 10;
        else if (priceDiff <= 0.5) score += 5;
      }

      // Popularity
      score += (product.ratingsAverage || 0) * 2;
      score += Math.min(product.totalSold || 0, 50) * 0.1;

      return { ...product, _score: score };
    });

    return scored
      .sort((a, b) => b._score - a._score)
      .slice(0, limit)
      .map(({ _score, ...product }) => product);
  } catch (error) {
    logger.error('[Recommendation] Error getting personalized recommendations:', error);
    return await getTrendingProducts(limit);
  }
}

/**
 * D. Recently Viewed
 * Get from UserActivity model (backend) or localStorage (frontend)
 */
async function getRecentlyViewed(userId, limit = 10) {
  try {
    if (!userId) {
      return [];
    }

    const recentViews = await UserActivity.find({
      userId,
      action: 'view',
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('productId', 'name imageCover price minPrice maxPrice brand ratingsAverage totalSold status slug')
      .lean();

    return recentViews
      .map(activity => activity.productId)
      .filter(product => product && product.status === 'active');
  } catch (error) {
    logger.error('[Recommendation] Error getting recently viewed:', error);
    return [];
  }
}

/**
 * E. Trending Now
 * Aggregate views/purchases from last 24 hours
 */
async function getTrendingProducts(limit = 10) {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Get trending products from cache/DB
    let trending = await TrendingProducts.find({
      lastComputed: { $gte: twentyFourHoursAgo },
    })
      .sort({ trendingScore: -1 })
      .limit(limit)
      .populate('productId', 'name imageCover price minPrice maxPrice brand ratingsAverage totalSold status slug')
      .lean();

    // If no cached data or stale, compute fresh
    if (trending.length === 0) {
      trending = await computeTrendingProducts(limit);
    }

    return trending
      .map(t => t.productId)
      .filter(product => product && product.status === 'active');
  } catch (error) {
    logger.error('[Recommendation] Error getting trending products:', error);
    return [];
  }
}

/**
 * Compute trending products from last 24 hours
 */
async function computeTrendingProducts(limit = 10) {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Aggregate views
    const viewStats = await UserActivity.aggregate([
      {
        $match: {
          action: 'view',
          createdAt: { $gte: twentyFourHoursAgo },
        },
      },
      {
        $group: {
          _id: '$productId',
          views24h: { $sum: 1 },
        },
      },
    ]);

    // Aggregate purchases (from order items directly)
    // Note: MongoDB collection names are lowercase and pluralized
    const purchaseStats = await OrderItems.aggregate([
      {
        $lookup: {
          from: 'orders', // MongoDB collection name for Order model
          localField: 'order',
          foreignField: '_id',
          as: 'orderData',
        },
      },
      {
        $unwind: '$orderData',
      },
      {
        $match: {
          'orderData.createdAt': { $gte: twentyFourHoursAgo },
          'orderData.paymentStatus': { $in: ['paid', 'completed'] },
        },
      },
      {
        $group: {
          _id: '$product',
          purchases24h: { $sum: '$quantity' },
        },
      },
    ]);

    // Aggregate cart additions
    const cartStats = await UserActivity.aggregate([
      {
        $match: {
          action: 'add_to_cart',
          createdAt: { $gte: twentyFourHoursAgo },
        },
      },
      {
        $group: {
          _id: '$productId',
          addToCart24h: { $sum: 1 },
        },
      },
    ]);

    // Aggregate wishlist additions
    const wishlistStats = await UserActivity.aggregate([
      {
        $match: {
          action: 'add_to_wishlist',
          createdAt: { $gte: twentyFourHoursAgo },
        },
      },
      {
        $group: {
          _id: '$productId',
          wishlist24h: { $sum: 1 },
        },
      },
    ]);

    // Combine stats
    const productStats = {};
    
    viewStats.forEach(stat => {
      if (!productStats[stat._id]) productStats[stat._id] = {};
      productStats[stat._id].views24h = stat.views24h;
    });

    purchaseStats.forEach(stat => {
      if (!productStats[stat._id]) productStats[stat._id] = {};
      productStats[stat._id].purchases24h = stat.purchases24h;
    });

    cartStats.forEach(stat => {
      if (!productStats[stat._id]) productStats[stat._id] = {};
      productStats[stat._id].addToCart24h = stat.addToCart24h;
    });

    wishlistStats.forEach(stat => {
      if (!productStats[stat._id]) productStats[stat._id] = {};
      productStats[stat._id].wishlist24h = stat.wishlist24h;
    });

    // Calculate scores and update/insert TrendingProducts
    const trendingData = [];
    for (const [productId, stats] of Object.entries(productStats)) {
      const trending = await TrendingProducts.findOneAndUpdate(
        { productId },
        {
          productId,
          views24h: stats.views24h || 0,
          purchases24h: stats.purchases24h || 0,
          addToCart24h: stats.addToCart24h || 0,
          wishlist24h: stats.wishlist24h || 0,
          lastComputed: new Date(),
        },
        { upsert: true, new: true }
      );

      trending.calculateScore();
      await trending.save();
      trendingData.push(trending);
    }

    // Get top trending products
    const topTrending = await TrendingProducts.find({
      productId: { $in: trendingData.map(t => t.productId) },
    })
      .sort({ trendingScore: -1 })
      .limit(limit)
      .populate('productId')
      .lean();

    return topTrending;
  } catch (error) {
    logger.error('[Recommendation] Error computing trending products:', error);
    return [];
  }
}

/**
 * F. AI Semantic Recommendations
 * Use embeddings to find semantically similar products
 */
async function getAISimilarProducts(productId, limit = 10) {
  try {
    if (!AI_ENABLED) {
      // Fallback to related products
      return await getRelatedProducts(productId, limit);
    }

    const product = await Product.findById(productId).select('+embedding name description brand tags keywords embeddingUpdatedAt');
    
    if (!product || product.status !== 'active') {
      return [];
    }

    // Generate or update embedding if needed
    let embedding = product.embedding;
    const shouldUpdateEmbedding = !embedding || 
      !product.embeddingUpdatedAt || 
      (Date.now() - new Date(product.embeddingUpdatedAt).getTime() > 30 * 24 * 60 * 60 * 1000); // 30 days

    if (shouldUpdateEmbedding || !embedding) {
      embedding = await generateProductEmbedding(product);
      if (embedding) {
        await Product.findByIdAndUpdate(productId, {
          embedding,
          embeddingUpdatedAt: new Date(),
        });
      }
    }

    if (!embedding || embedding.length === 0) {
      return await getRelatedProducts(productId, limit);
    }

    // Find products with embeddings
    const allProducts = await Product.find({
      _id: { $ne: productId },
      status: 'active',
      embedding: { $exists: true, $ne: null },
    })
      .select('+embedding name imageCover price minPrice maxPrice brand ratingsAverage totalSold status slug')
      .limit(100) // Limit for performance
      .lean();

    // Calculate similarities
    const similarities = allProducts.map((p) => {
      const similarity = cosineSimilarity(embedding, p.embedding);
      return { ...p, _similarity: similarity };
    });

    // Sort by similarity and return top results
    return similarities
      .sort((a, b) => b._similarity - a._similarity)
      .slice(0, limit)
      .map(({ embedding, _similarity, ...product }) => product);
  } catch (error) {
    logger.error('[Recommendation] Error getting AI similar products:', error);
    return await getRelatedProducts(productId, limit);
  }
}

/**
 * Track user activity for recommendations
 */
async function trackUserActivity(userId, productId, action, metadata = {}) {
  try {
    await UserActivity.create({
      userId,
      productId,
      action,
      metadata,
      sessionId: metadata.sessionId,
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
    });
  } catch (error) {
    logger.error('[Recommendation] Error tracking user activity:', error);
  }
}

module.exports = {
  getRelatedProducts,
  getAlsoBoughtProducts,
  getPersonalizedRecommendations,
  getRecentlyViewed,
  getTrendingProducts,
  getAISimilarProducts,
  computeTrendingProducts,
  trackUserActivity,
  generateProductEmbedding,
};

