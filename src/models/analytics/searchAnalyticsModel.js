const mongoose = require('mongoose');

/**
 * SearchAnalytics Model
 * Tracks search queries for trending searches and analytics
 */
const searchAnalyticsSchema = new mongoose.Schema(
  {
    keyword: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    normalizedKeyword: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    count: {
      type: Number,
      default: 1,
    },
    lastSearched: {
      type: Date,
      default: Date.now,
    },
    firstSearched: {
      type: Date,
      default: Date.now,
    },
    // Store user search history (optional, can be disabled for privacy)
    searchHistory: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          refPath: 'userModel',
        },
        userModel: {
          type: String,
          enum: ['User', 'Seller', 'Admin'],
        },
        searchedAt: {
          type: Date,
          default: Date.now,
        },
        resultsCount: {
          type: Number,
          default: 0,
        },
      },
    ],
  },
  {
    timestamps: true,
  },
);




// Static method to record a search
searchAnalyticsSchema.statics.recordSearch = async function (
  keyword,
  userId = null,
  userModel = null,
  resultsCount = 0,
) {
  const { normalizeQuery } = require('../../utils/helpers/searchUtils');
  const normalized = normalizeQuery(keyword);

  if (!normalized || normalized.length < 2) return null;

  // Find or create search analytics entry
  const searchAnalytics = await this.findOneAndUpdate(
    { normalizedKeyword: normalized },
    {
      $inc: { count: 1 },
      $set: { lastSearched: Date.now() },
      $setOnInsert: {
        keyword: keyword.toLowerCase(),
        firstSearched: Date.now(),
      },
    },
    { upsert: true, new: true },
  );

  // Optionally store user search history (can be disabled for privacy)
  if (userId && userModel) {
    searchAnalytics.searchHistory.push({
      userId,
      userModel,
      searchedAt: Date.now(),
      resultsCount,
    });

    // Keep only last 100 search history entries per keyword
    if (searchAnalytics.searchHistory.length > 100) {
      searchAnalytics.searchHistory = searchAnalytics.searchHistory.slice(-100);
    }

    await searchAnalytics.save();
  }

  return searchAnalytics;
};

// Static method to get trending searches
searchAnalyticsSchema.statics.getTrending = async function (limit = 10, days = 7) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  return this.find({
    lastSearched: { $gte: cutoffDate },
  })
    .sort({ count: -1, lastSearched: -1 })
    .limit(limit)
    .select('keyword count lastSearched')
    .lean();
};

// Static method to get recent searches
searchAnalyticsSchema.statics.getRecent = async function (limit = 10) {
  return this.find()
    .sort({ lastSearched: -1 })
    .limit(limit)
    .select('keyword lastSearched')
    .lean();
};

// Static method to get similar keywords
searchAnalyticsSchema.statics.getSimilarKeywords = async function (keyword, limit = 5) {
  const { normalizeQuery, tokenizeQuery } = require('../../utils/helpers/searchUtils');
  const normalized = normalizeQuery(keyword);
  const tokens = tokenizeQuery(normalized);

  if (tokens.length === 0) return [];

  // Find keywords that contain any of the tokens
  const regexPattern = tokens.join('|');
  return this.find({
    normalizedKeyword: { $regex: regexPattern, $options: 'i' },
    normalizedKeyword: { $ne: normalized }, // Exclude exact match
  })
    .sort({ count: -1 })
    .limit(limit)
    .select('keyword count')
    .lean();
};

const SearchAnalytics = mongoose.model('SearchAnalytics', searchAnalyticsSchema);

module.exports = SearchAnalytics;

