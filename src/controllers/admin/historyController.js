const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const WalletHistory = require('../../models/history/walletHistoryModel');
const SellerRevenueHistory = require('../../models/history/sellerRevenueHistoryModel');
const User = require('../../models/user/userModel');
const Seller = require('../../models/user/sellerModel');
const PaymentRequest = require('../../models/payment/paymentRequestModel'); // Required for populate to work
const Transaction = require('../../models/transaction/transactionModel');
const mongoose = require('mongoose');
const logger = require('../../utils/logger');

/**
 * GET /api/v1/admin/wallet-history
 * Admin view all buyer wallet history with filters
 */
exports.getAllWalletHistory = catchAsync(async (req, res, next) => {
  const logPrefix = '[getAllWalletHistory]';
  
  try {
    // ========== STEP 1: Initial Logging ==========
    logger.info(`${logPrefix} ========== START ==========`);
    logger.info(`${logPrefix} Request received at: ${new Date().toISOString()}`);
    logger.info(`${logPrefix} Method: ${req.method}`);
    logger.info(`${logPrefix} URL: ${req.originalUrl || req.url}`);
    logger.info(`${logPrefix} Query params:`, JSON.stringify(req.query, null, 2));
    
    // Log user info (sanitized)
    try {
      const userInfo = req.user ? {
        id: req.user.id || req.user._id,
        role: req.user.role,
        email: req.user.email || 'N/A',
        hasId: !!req.user.id,
        has_id: !!req.user._id,
      } : null;
      logger.info(`${logPrefix} User info:`, JSON.stringify(userInfo, null, 2));
    } catch (userLogError) {
      logger.error(`${logPrefix} Error logging user info:`, userLogError);
    }

    // ========== STEP 2: Authentication Check ==========
    try {
      logger.info(`${logPrefix} [STEP 2] Checking authentication...`);
      if (!req.user || !req.user.id || req.user.role !== 'admin') {
        logger.error(`${logPrefix} [STEP 2] Authentication failed:`, {
          hasUser: !!req.user,
          userId: req.user?.id || req.user?._id || 'N/A',
          role: req.user?.role || 'N/A',
        });
        return next(new AppError('Admin authentication required', 401));
      }
      logger.info(`${logPrefix} [STEP 2] Authentication passed`);
    } catch (authError) {
      logger.error(`${logPrefix} [STEP 2] Error during auth check:`, {
        error: authError.message,
        stack: authError.stack,
      });
      return next(new AppError('Authentication check failed', 500));
    }

    // ========== STEP 3: Helper Functions ==========
    logger.info(`${logPrefix} [STEP 3] Setting up helper functions...`);
    
    // Enhanced normalization function for query parameters
    const normalizeParam = (value) => {
      if (value === null || value === undefined) return null;
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed === '' || trimmed === 'null' || trimmed === 'undefined' || trimmed === 'NaN') {
          return null;
        }
        return trimmed;
      }
      return value;
    };

    // Helper for safe ObjectId validation - ensures 24-char hex string
    const isValidObjectId = (id) => {
      if (!id || typeof id !== 'string') return false;
      const trimmed = id.trim();
      if (trimmed.length !== 24) return false;
      return mongoose.isValidObjectId ? mongoose.isValidObjectId(trimmed) : mongoose.Types.ObjectId.isValid(trimmed);
    };

    // Safe ObjectId conversion with validation
    const safeObjectId = (id) => {
      if (!isValidObjectId(id)) return null;
      try {
        return new mongoose.Types.ObjectId(id);
      } catch (error) {
        return null;
      }
    };
    
    logger.info(`${logPrefix} [STEP 3] Helper functions ready`);

    // ========== STEP 4: Extract Query Parameters ==========
    let rawParams, normalizedParams;
    try {
      logger.info(`${logPrefix} [STEP 4] Extracting query parameters...`);
      
      const {
        page = 1,
        limit = 20,
        userId,
        type,
        adminId,
        startDate,
        endDate,
        search,
        minAmount,
        maxAmount,
        sortBy = 'createdAt',
        sortOrder = 'desc',
      } = req.query;

      rawParams = {
        page,
        limit,
        userId,
        type,
        adminId,
        startDate,
        endDate,
        search,
        minAmount,
        maxAmount,
        sortBy,
        sortOrder,
      };
      
      logger.info(`${logPrefix} [STEP 4] Raw params:`, JSON.stringify(rawParams, null, 2));
      
      // Normalize all parameters
      const normalizedUserId = normalizeParam(userId);
      const normalizedType = normalizeParam(type);
      const normalizedAdminId = normalizeParam(adminId);
      const normalizedStartDate = normalizeParam(startDate);
      const normalizedEndDate = normalizeParam(endDate);
      const normalizedSearch = normalizeParam(search);
      const normalizedMinAmount = normalizeParam(minAmount);
      const normalizedMaxAmount = normalizeParam(maxAmount);

      normalizedParams = {
        userId: normalizedUserId,
        type: normalizedType,
        adminId: normalizedAdminId,
        startDate: normalizedStartDate,
        endDate: normalizedEndDate,
        search: normalizedSearch,
        minAmount: normalizedMinAmount,
        maxAmount: normalizedMaxAmount,
        sortBy,
        sortOrder,
      };
      
      logger.info(`${logPrefix} [STEP 4] Normalized params:`, JSON.stringify(normalizedParams, null, 2));
    } catch (paramError) {
      logger.error(`${logPrefix} [STEP 4] Error extracting/normalizing params:`, {
        error: paramError.message,
        stack: paramError.stack,
      });
      return next(new AppError('Failed to process query parameters', 400));
    }

    // ========== STEP 5: Validate Pagination & Sort ==========
    let pageNum, limitNum, skip, sort;
    try {
      logger.info(`${logPrefix} [STEP 5] Validating pagination and sort...`);
      
      // Validate and parse pagination parameters
      pageNum = Math.max(1, parseInt(rawParams.page, 10) || 1);
      limitNum = Math.min(100, Math.max(1, parseInt(rawParams.limit, 10) || 20)); // Cap at 100
      skip = (pageNum - 1) * limitNum;

      logger.info(`${logPrefix} [STEP 5] Pagination:`, {
        rawPage: rawParams.page,
        rawLimit: rawParams.limit,
        pageNum,
        limitNum,
        skip,
      });

      // Validate sort parameters
      const allowedSortFields = ['createdAt', 'amount', 'type', 'updatedAt'];
      const sortField = allowedSortFields.includes(normalizedParams.sortBy) ? normalizedParams.sortBy : 'createdAt';
      const sortDirection = normalizedParams.sortOrder === 'asc' ? 1 : -1;
      sort = { [sortField]: sortDirection };

      logger.info(`${logPrefix} [STEP 5] Sort:`, {
        rawSortBy: rawParams.sortBy,
        rawSortOrder: rawParams.sortOrder,
        sortField,
        sortDirection,
        sort,
      });
    } catch (validationError) {
      logger.error(`${logPrefix} [STEP 5] Error validating pagination/sort:`, {
        error: validationError.message,
        stack: validationError.stack,
      });
      return next(new AppError('Invalid pagination or sort parameters', 400));
    }

    // ========== STEP 6: Build Query Object ==========
    let query = {};
    try {
      logger.info(`${logPrefix} [STEP 6] Building query object...`);

      // Filter by user ID - only apply if valid 24-char hex string
      if (normalizedParams.userId) {
        try {
          logger.info(`${logPrefix} [STEP 6.1] Processing userId filter: ${normalizedParams.userId}`);
          const userIdObjectId = safeObjectId(normalizedParams.userId);
          if (!userIdObjectId) {
            logger.error(`${logPrefix} [STEP 6.1] Invalid userId format: ${normalizedParams.userId}`);
            return next(new AppError(`Invalid user ID format. Must be a valid 24-character hex string. Received: ${normalizedParams.userId}`, 400));
          }
          query.userId = userIdObjectId;
          logger.info(`${logPrefix} [STEP 6.1] userId filter added: ${userIdObjectId}`);
        } catch (userIdError) {
          logger.error(`${logPrefix} [STEP 6.1] Error processing userId:`, {
            userId: normalizedParams.userId,
            error: userIdError.message,
            stack: userIdError.stack,
          });
          return next(new AppError(`Failed to process user ID: ${normalizedParams.userId}`, 400));
        }
      }

      // Filter by type (transaction type)
      if (normalizedParams.type) {
        try {
          logger.info(`${logPrefix} [STEP 6.2] Processing type filter: ${normalizedParams.type}`);
          query.type = normalizedParams.type;
          logger.info(`${logPrefix} [STEP 6.2] type filter added: ${normalizedParams.type}`);
        } catch (typeError) {
          logger.error(`${logPrefix} [STEP 6.2] Error processing type:`, {
            type: normalizedParams.type,
            error: typeError.message,
          });
          return next(new AppError(`Failed to process transaction type: ${normalizedParams.type}`, 400));
        }
      }

      // Filter by adminId - only apply if valid ObjectId
      if (normalizedParams.adminId) {
        try {
          logger.info(`${logPrefix} [STEP 6.3] Processing adminId filter: ${normalizedParams.adminId}`);
          const adminIdObjectId = safeObjectId(normalizedParams.adminId);
          if (!adminIdObjectId) {
            logger.error(`${logPrefix} [STEP 6.3] Invalid adminId format: ${normalizedParams.adminId}`);
            return next(new AppError(`Invalid admin ID format. Must be a valid 24-character hex string. Received: ${normalizedParams.adminId}`, 400));
          }
          query.adminId = adminIdObjectId;
          logger.info(`${logPrefix} [STEP 6.3] adminId filter added: ${adminIdObjectId}`);
        } catch (adminIdError) {
          logger.error(`${logPrefix} [STEP 6.3] Error processing adminId:`, {
            adminId: normalizedParams.adminId,
            error: adminIdError.message,
            stack: adminIdError.stack,
          });
          return next(new AppError(`Failed to process admin ID: ${normalizedParams.adminId}`, 400));
        }
      }

      // Filter by date range with validation
      if (normalizedParams.startDate || normalizedParams.endDate) {
        try {
          logger.info(`${logPrefix} [STEP 6.4] Processing date range filter...`);
          query.createdAt = {};
          if (normalizedParams.startDate) {
            const startDateObj = new Date(normalizedParams.startDate);
            if (!isNaN(startDateObj.getTime())) {
              query.createdAt.$gte = startDateObj;
              logger.info(`${logPrefix} [STEP 6.4] Start date added: ${startDateObj.toISOString()}`);
            } else {
              logger.warn(`${logPrefix} [STEP 6.4] Invalid start date: ${normalizedParams.startDate}`);
            }
          }
          if (normalizedParams.endDate) {
            const endDateObj = new Date(normalizedParams.endDate);
            if (!isNaN(endDateObj.getTime())) {
              query.createdAt.$lte = endDateObj;
              logger.info(`${logPrefix} [STEP 6.4] End date added: ${endDateObj.toISOString()}`);
            } else {
              logger.warn(`${logPrefix} [STEP 6.4] Invalid end date: ${normalizedParams.endDate}`);
            }
          }
          // Remove date filter if no valid dates
          if (Object.keys(query.createdAt).length === 0) {
            delete query.createdAt;
            logger.info(`${logPrefix} [STEP 6.4] No valid dates, removed date filter`);
          }
        } catch (dateError) {
          logger.error(`${logPrefix} [STEP 6.4] Error processing date range:`, {
            startDate: normalizedParams.startDate,
            endDate: normalizedParams.endDate,
            error: dateError.message,
            stack: dateError.stack,
          });
          return next(new AppError(`Failed to process date range. Start: ${normalizedParams.startDate}, End: ${normalizedParams.endDate}`, 400));
        }
      }

      // Filter by amount range with validation
      if (normalizedParams.minAmount !== null || normalizedParams.maxAmount !== null) {
        try {
          logger.info(`${logPrefix} [STEP 6.5] Processing amount range filter...`);
          query.amount = {};
          if (normalizedParams.minAmount !== null) {
            const min = parseFloat(normalizedParams.minAmount);
            if (!isNaN(min) && isFinite(min) && min >= 0) {
              query.amount.$gte = min;
              logger.info(`${logPrefix} [STEP 6.5] Min amount added: ${min}`);
            } else {
              logger.warn(`${logPrefix} [STEP 6.5] Invalid min amount: ${normalizedParams.minAmount}`);
            }
          }
          if (normalizedParams.maxAmount !== null) {
            const max = parseFloat(normalizedParams.maxAmount);
            if (!isNaN(max) && isFinite(max) && max >= 0) {
              query.amount.$lte = max;
              logger.info(`${logPrefix} [STEP 6.5] Max amount added: ${max}`);
            } else {
              logger.warn(`${logPrefix} [STEP 6.5] Invalid max amount: ${normalizedParams.maxAmount}`);
            }
          }
          // Remove amount filter if no valid values
          if (Object.keys(query.amount).length === 0) {
            delete query.amount;
            logger.info(`${logPrefix} [STEP 6.5] No valid amounts, removed amount filter`);
          }
        } catch (amountError) {
          logger.error(`${logPrefix} [STEP 6.5] Error processing amount range:`, {
            minAmount: normalizedParams.minAmount,
            maxAmount: normalizedParams.maxAmount,
            error: amountError.message,
            stack: amountError.stack,
          });
          return next(new AppError(`Failed to process amount range. Min: ${normalizedParams.minAmount}, Max: ${normalizedParams.maxAmount}`, 400));
        }
      }

      // ========== STEP 7: Build Search Query ==========
      const searchConditions = [];
      try {
        logger.info(`${logPrefix} [STEP 7] Building search query...`);
        
        // Search by reference and description
        if (normalizedParams.search) {
          logger.info(`${logPrefix} [STEP 7] Processing search term: ${normalizedParams.search}`);
          searchConditions.push(
            { reference: { $regex: normalizedParams.search, $options: 'i' } },
            { description: { $regex: normalizedParams.search, $options: 'i' } }
          );

          // If searching by user email/name, find user IDs first (only if userId not already specified)
          if (!normalizedParams.userId) {
            try {
              logger.info(`${logPrefix} [STEP 7.1] Searching for users by email/name...`);
              const users = await User.find({
                $or: [
                  { email: { $regex: normalizedParams.search, $options: 'i' } },
                  { name: { $regex: normalizedParams.search, $options: 'i' } },
                ],
              }).select('_id').limit(100).lean(); // Limit to prevent performance issues
              
              logger.info(`${logPrefix} [STEP 7.1] Found ${users.length} matching users`);
              
              if (users.length > 0) {
                const userIds = users.map(u => u._id).filter(id => id); // Filter out nulls
                if (userIds.length > 0) {
                  searchConditions.push({ userId: { $in: userIds } });
                  logger.info(`${logPrefix} [STEP 7.1] Added ${userIds.length} user IDs to search conditions`);
                }
              }
            } catch (searchError) {
              logger.error(`${logPrefix} [STEP 7.1] Error searching users:`, {
                search: normalizedParams.search,
                error: searchError.message,
                stack: searchError.stack,
              });
              // If user search fails, continue with other search conditions
              // Don't throw error, just skip user search
            }
          }
        }

        // Combine search conditions with existing query
        // MongoDB: { field1: value1, $or: [...] } means field1 === value1 AND (one of $or conditions)
        // This is the correct behavior - we want to filter by other criteria AND match search
        if (searchConditions.length > 0) {
          query.$or = searchConditions;
          logger.info(`${logPrefix} [STEP 7] Added ${searchConditions.length} search conditions to query`);
        } else {
          logger.info(`${logPrefix} [STEP 7] No search conditions to add`);
        }
      } catch (searchBuildError) {
        logger.error(`${logPrefix} [STEP 7] Error building search query:`, {
          error: searchBuildError.message,
          stack: searchBuildError.stack,
        });
        return next(new AppError('Failed to build search query', 500));
      }
      
      logger.info(`${logPrefix} [STEP 6] Final query object:`, JSON.stringify(query, null, 2));
    } catch (queryBuildError) {
      logger.error(`${logPrefix} [STEP 6] Error building query:`, {
        error: queryBuildError.message,
        stack: queryBuildError.stack,
      });
      return next(new AppError('Failed to build query object', 500));
    }

    // ========== STEP 8: Execute Database Query ==========
    let history, total;
    try {
      logger.info(`${logPrefix} [STEP 8] Executing database query...`);
      logger.info(`${logPrefix} [STEP 8] Query:`, JSON.stringify(query, null, 2));
      logger.info(`${logPrefix} [STEP 8] Sort:`, JSON.stringify(sort, null, 2));
      logger.info(`${logPrefix} [STEP 8] Pagination: skip=${skip}, limit=${limitNum}`);
      
      const queryStartTime = Date.now();
      [history, total] = await Promise.all([
        WalletHistory.find(query)
          .sort(sort)
          .skip(skip)
          .limit(limitNum)
          .populate('userId', 'name email phone')
          .populate('orderId', 'orderNumber totalPrice')
          .populate('refundId', 'status totalRefundAmount')
          .populate('adminId', 'name email')
          .lean(),
        WalletHistory.countDocuments(query),
      ]);
      const queryDuration = Date.now() - queryStartTime;
      
      logger.info(`${logPrefix} [STEP 8] Query completed in ${queryDuration}ms`);
      logger.info(`${logPrefix} [STEP 8] Results: Found ${history.length} records, Total: ${total}`);
    } catch (dbError) {
      logger.error(`${logPrefix} [STEP 8] Database error:`, {
        errorName: dbError.name,
        errorMessage: dbError.message,
        errorStack: dbError.stack,
        query: JSON.stringify(query, null, 2),
      });
      
      // Handle CastError and other MongoDB errors gracefully
      if (dbError.name === 'CastError' || dbError.name === 'BSONTypeError') {
        logger.error(`${logPrefix} [STEP 8] Cast/BSON error - invalid query parameters`);
        return next(new AppError(`Invalid query parameters. Please check your filters. Error: ${dbError.message}`, 400));
      }
      throw dbError; // Re-throw unexpected errors
    }

    // ========== STEP 9: Build Response ==========
    try {
      logger.info(`${logPrefix} [STEP 9] Building response...`);
      
      // Calculate pagination metadata
      const totalPages = Math.ceil(total / limitNum);

      const response = {
        status: 'success',
        results: history.length,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: totalPages,
          hasNext: pageNum < totalPages,
          hasPrev: pageNum > 1,
        },
        data: {
          history,
        },
      };
      
      logger.info(`${logPrefix} [STEP 9] Response built:`, {
        status: response.status,
        results: response.results,
        total: response.pagination.total,
        pages: response.pagination.pages,
      });

      // Return response with consistent structure
      logger.info(`${logPrefix} ========== SUCCESS ==========`);
      res.status(200).json(response);
    } catch (responseError) {
      logger.error(`${logPrefix} [STEP 9] Error building response:`, {
        error: responseError.message,
        stack: responseError.stack,
      });
      return next(new AppError('Failed to build response', 500));
    }
  } catch (error) {
    // Top-level catch for any unexpected errors
    logger.error(`${logPrefix} ========== TOP-LEVEL ERROR ==========`);
    logger.error(`${logPrefix} Error type:`, error.constructor.name);
    logger.error(`${logPrefix} Error message:`, error.message);
    logger.error(`${logPrefix} Error stack:`, error.stack);
    // Safely stringify error object - handle circular references
    try {
      const errorProps = Object.getOwnPropertyNames(error);
      const errorObj = {};
      errorProps.forEach(key => {
        try {
          errorObj[key] = error[key];
        } catch (e) {
          errorObj[key] = '[Cannot serialize]';
        }
      });
      logger.error(`${logPrefix} Full error object:`, JSON.stringify(errorObj, null, 2));
    } catch (stringifyError) {
      logger.error(`${logPrefix} Error serialization failed:`, stringifyError.message);
    }
    
    // This prevents small errors from bubbling into "Invalid ID Format"
    if (error instanceof AppError) {
      logger.info(`${logPrefix} Error is AppError, passing to error handler`);
      return next(error);
    }
    // Log unexpected errors for debugging
    return next(new AppError(`An error occurred while fetching wallet history: ${error.message}`, 500));
  }
});

/**
 * GET /api/v1/admin/wallet-history/:userId
 * Admin view wallet history for a specific user
 */
exports.getUserWalletHistory = catchAsync(async (req, res, next) => {
  const { userId } = req.params;
  const {
    page = 1,
    limit = 20,
    type = null,
    startDate = null,
    endDate = null,
    sortBy = 'createdAt',
    sortOrder = 'desc',
  } = req.query;

  // Safe ObjectId validation
  const isValidObjectId = mongoose.isValidObjectId || mongoose.Types.ObjectId.isValid;
  if (!userId || !isValidObjectId(userId)) {
    return next(new AppError('Invalid user ID format', 400));
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

  const query = { userId: new mongoose.Types.ObjectId(userId) };

  if (type) {
    query.type = type;
  }

  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) {
      query.createdAt.$gte = new Date(startDate);
    }
    if (endDate) {
      query.createdAt.$lte = new Date(endDate);
    }
  }

  const [history, total, user] = await Promise.all([
    WalletHistory.find(query)
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .populate('orderId', 'orderNumber totalPrice')
      .populate('refundId', 'status totalRefundAmount')
      .populate('adminId', 'name email')
      .lean(),
    WalletHistory.countDocuments(query),
    User.findById(userId).select('name email phone').lean(),
  ]);

  if (!user) {
    return next(new AppError('User not found', 404));
  }

  res.status(200).json({
    status: 'success',
    results: history.length,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / parseInt(limit)),
    },
    data: {
      user,
      history,
    },
  });
});

/**
 * GET /api/v1/admin/revenue-history
 * Admin view all seller revenue history with filters
 */
exports.getAllSellerRevenueHistory = catchAsync(async (req, res, next) => {
  try {
    // Ensure admin is authenticated
    if (!req.user || !req.user.id || req.user.role !== 'admin') {
      return next(new AppError('Admin authentication required', 401));
    }

    // Enhanced normalization function for query parameters
    const normalizeParam = (value) => {
      if (value === null || value === undefined) return null;
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed === '' || trimmed === 'null' || trimmed === 'undefined' || trimmed === 'NaN') {
          return null;
        }
        return trimmed;
      }
      return value;
    };

    // Helper for safe ObjectId validation - ensures 24-char hex string
    const isValidObjectId = (id) => {
      if (!id || typeof id !== 'string') return false;
      const trimmed = id.trim();
      if (trimmed.length !== 24) return false;
      return mongoose.isValidObjectId ? mongoose.isValidObjectId(trimmed) : mongoose.Types.ObjectId.isValid(trimmed);
    };

    // Safe ObjectId conversion with validation
    const safeObjectId = (id) => {
      if (!isValidObjectId(id)) return null;
      try {
        return new mongoose.Types.ObjectId(id);
      } catch (error) {
        return null;
      }
    };

    const {
      page = 1,
      limit = 20,
      sellerId,
      type,
      startDate,
      endDate,
      search,
      minAmount,
      maxAmount,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    // Normalize all parameters
    const normalizedSellerId = normalizeParam(sellerId);
    const normalizedType = normalizeParam(type);
    const normalizedStartDate = normalizeParam(startDate);
    const normalizedEndDate = normalizeParam(endDate);
    const normalizedSearch = normalizeParam(search);
    const normalizedMinAmount = normalizeParam(minAmount);
    const normalizedMaxAmount = normalizeParam(maxAmount);

    // Validate and parse pagination parameters
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20)); // Cap at 100
    const skip = (pageNum - 1) * limitNum;

    // Validate sort parameters
    const allowedSortFields = ['createdAt', 'amount', 'type', 'updatedAt'];
    const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'createdAt';
    const sortDirection = sortOrder === 'asc' ? 1 : -1;
    const sort = { [sortField]: sortDirection };

    const query = {};

    // Filter by seller ID - only apply if valid 24-char hex string
    if (normalizedSellerId) {
      const sellerIdObjectId = safeObjectId(normalizedSellerId);
      if (!sellerIdObjectId) {
        return next(new AppError('Invalid seller ID format. Must be a valid 24-character hex string.', 400));
      }
      query.sellerId = sellerIdObjectId;
    }

    // Filter by type (transaction type)
    if (normalizedType) {
      query.type = normalizedType;
    }

    // Filter by date range with validation
    if (normalizedStartDate || normalizedEndDate) {
      query.createdAt = {};
      if (normalizedStartDate) {
        const startDateObj = new Date(normalizedStartDate);
        if (!isNaN(startDateObj.getTime())) {
          query.createdAt.$gte = startDateObj;
        }
      }
      if (normalizedEndDate) {
        const endDateObj = new Date(normalizedEndDate);
        if (!isNaN(endDateObj.getTime())) {
          query.createdAt.$lte = endDateObj;
        }
      }
      // Remove date filter if no valid dates
      if (Object.keys(query.createdAt).length === 0) {
        delete query.createdAt;
      }
    }

    // Filter by amount range with validation
    if (normalizedMinAmount !== null || normalizedMaxAmount !== null) {
      query.amount = {};
      if (normalizedMinAmount !== null) {
        const min = parseFloat(normalizedMinAmount);
        if (!isNaN(min) && isFinite(min) && min >= 0) {
          query.amount.$gte = min;
        }
      }
      if (normalizedMaxAmount !== null) {
        const max = parseFloat(normalizedMaxAmount);
        if (!isNaN(max) && isFinite(max) && max >= 0) {
          query.amount.$lte = max;
        }
      }
      // Remove amount filter if no valid values
      if (Object.keys(query.amount).length === 0) {
        delete query.amount;
      }
    }

    // Build search query - properly combine with other filters
    const searchConditions = [];
    
    // Search by reference and description
    if (normalizedSearch) {
      searchConditions.push(
        { reference: { $regex: normalizedSearch, $options: 'i' } },
        { description: { $regex: normalizedSearch, $options: 'i' } }
      );

      // If searching by seller name/shop, find seller IDs first (only if sellerId not already specified)
      if (!normalizedSellerId) {
        try {
          const sellers = await Seller.find({
            $or: [
              { name: { $regex: normalizedSearch, $options: 'i' } },
              { shopName: { $regex: normalizedSearch, $options: 'i' } },
              { email: { $regex: normalizedSearch, $options: 'i' } },
            ],
          }).select('_id').limit(100).lean(); // Limit to prevent performance issues
          
          if (sellers.length > 0) {
            const sellerIds = sellers.map(s => s._id).filter(id => id); // Filter out nulls
            if (sellerIds.length > 0) {
              searchConditions.push({ sellerId: { $in: sellerIds } });
            }
          }
        } catch (searchError) {
          // If seller search fails, continue with other search conditions
          // Don't throw error, just skip seller search
        }
      }
    }

    // Combine search conditions with existing query
    // MongoDB: { field1: value1, $or: [...] } means field1 === value1 AND (one of $or conditions)
    // This is the correct behavior - we want to filter by other criteria AND match search
    if (searchConditions.length > 0) {
      query.$or = searchConditions;
    }

    // Debug: Log query for troubleshooting (remove in production if needed)
    logger.info('SellerRevenueHistory Query:', JSON.stringify(query, null, 2));

    // Execute queries with error handling
    let history, total;
    try {
      [history, total] = await Promise.all([
        SellerRevenueHistory.find(query)
          .sort(sort)
          .skip(skip)
          .limit(limitNum)
          .populate('sellerId', 'name shopName email')
          .populate('orderId', 'orderNumber totalPrice')
          .populate('refundId', 'status totalRefundAmount')
          .populate('payoutRequestId', 'status amount')
          .populate('adminId', 'name email')
          .lean(),
        SellerRevenueHistory.countDocuments(query),
      ]);
      
      logger.info(`SellerRevenueHistory Query Results: Found ${history.length} records, Total: ${total}`);
    } catch (dbError) {
      // Handle CastError and other MongoDB errors gracefully
      if (dbError.name === 'CastError' || dbError.name === 'BSONTypeError') {
        return next(new AppError('Invalid query parameters. Please check your filters.', 400));
      }
      throw dbError; // Re-throw unexpected errors
    }

    // Calculate pagination metadata
    const totalPages = Math.ceil(total / limitNum);

    // Return response with consistent structure
    res.status(200).json({
      status: 'success',
      results: history.length,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: totalPages,
        hasNext: pageNum < totalPages,
        hasPrev: pageNum > 1,
      },
      data: {
        history,
      },
    });
  } catch (error) {
    // Top-level catch for any unexpected errors
    if (error instanceof AppError) {
      return next(error);
    }
    // Log unexpected errors for debugging
    logger.error('Error in getAllSellerRevenueHistory:', error);
    return next(new AppError('An error occurred while fetching seller revenue history', 500));
  }
});

/**
 * GET /api/v1/admin/transactions
 * Admin view all seller transactions (credits/debits) with optional filters.
 * This mirrors the seller-facing /seller/me/transactions endpoint, but allows
 * filtering by sellerId and viewing all sellers in one place.
 */
exports.getAllSellerTransactions = catchAsync(async (req, res, next) => {
  if (!req.user || !req.user.id || req.user.role !== 'admin') {
    return next(new AppError('Admin authentication required', 401));
  }

  const page = parseInt(req.query.page, 10) || 1;
  const limit = Math.min(100, Math.max(parseInt(req.query.limit, 10) || 20, 1));
  const skip = (page - 1) * limit;

  const filter = {};

  // Optional: filter by specific sellerId
  if (req.query.sellerId && mongoose.Types.ObjectId.isValid(req.query.sellerId)) {
    filter.seller = new mongoose.Types.ObjectId(req.query.sellerId);
  }

  // Optional: filter by transaction type (credit/debit)
  if (req.query.type) {
    const type = String(req.query.type).toLowerCase();
    if (type === 'credit' || type === 'debit') {
      filter.type = type;
    }
  }

  // Optional: filter by status
  if (req.query.status) {
    filter.status = req.query.status;
  }

  const [transactions, total] = await Promise.all([
    Transaction.find(filter)
      .populate('seller', 'name shopName email')
      .populate({
        path: 'sellerOrder',
        select: 'subtotal shippingCost tax',
        populate: {
          path: 'order',
          select: 'orderNumber totalPrice createdAt',
        },
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Transaction.countDocuments(filter),
  ]);

  const totalPages = Math.ceil(total / limit);

  // Match BalanceHistoryPage structure: data.history + pagination
  res.status(200).json({
    status: 'success',
    results: transactions.length,
    pagination: {
      page,
      limit,
      total,
      pages: totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
    data: {
      history: transactions,
    },
  });
});

/**
 * GET /api/v1/admin/revenue-history/:sellerId
 * Admin view revenue history for a specific seller
 */
exports.getSellerRevenueHistory = catchAsync(async (req, res, next) => {
  const { sellerId } = req.params;
  const {
    page = 1,
    limit = 20,
    type = null,
    startDate = null,
    endDate = null,
    sortBy = 'createdAt',
    sortOrder = 'desc',
  } = req.query;

    // Safe ObjectId validation
  const isValidObjectId = mongoose.isValidObjectId || mongoose.Types.ObjectId.isValid;
  if (!sellerId || !isValidObjectId(sellerId)) {
    return next(new AppError('Invalid seller ID format', 400));
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const query = { sellerId: new mongoose.Types.ObjectId(sellerId) };

  if (type) {
    query.type = type;
  }

  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) {
      query.createdAt.$gte = new Date(startDate);
    }
    if (endDate) {
      query.createdAt.$lte = new Date(endDate);
    }
  }

  const [history, total, seller] = await Promise.all([
    SellerRevenueHistory.find(query)
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .populate('orderId', 'orderNumber totalPrice')
      .populate('refundId', 'status totalRefundAmount')
      .populate('payoutRequestId', 'status amount')
      .populate('adminId', 'name email')
      .lean(),
    SellerRevenueHistory.countDocuments(query),
    Seller.findById(sellerId).select('name shopName email balance').lean(),
  ]);

  if (!seller) {
    return next(new AppError('Seller not found', 404));
  }

  res.status(200).json({
    status: 'success',
    results: history.length,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / parseInt(limit)),
    },
    data: {
      seller,
      history,
    },
  });
});

/**
 * GET /api/v1/admin/history/stats
 * Admin view aggregated statistics for wallet and revenue history
 */
exports.getHistoryStats = catchAsync(async (req, res, next) => {
  const { startDate = null, endDate = null } = req.query;

  const dateFilter = {};
  if (startDate || endDate) {
    dateFilter.createdAt = {};
    if (startDate) {
      dateFilter.createdAt.$gte = new Date(startDate);
    }
    if (endDate) {
      dateFilter.createdAt.$lte = new Date(endDate);
    }
  }

  // Wallet history stats
  const walletStats = await WalletHistory.aggregate([
    { $match: dateFilter },
    {
      $group: {
        _id: '$type',
        count: { $sum: 1 },
        totalAmount: { $sum: '$amount' },
        avgAmount: { $avg: '$amount' },
      },
    },
  ]);

  // Seller revenue stats
  const revenueStats = await SellerRevenueHistory.aggregate([
    { $match: dateFilter },
    {
      $group: {
        _id: '$type',
        count: { $sum: 1 },
        totalAmount: { $sum: '$amount' },
        avgAmount: { $avg: '$amount' },
      },
    },
  ]);

  // Total counts
  const [totalWalletTransactions, totalRevenueTransactions] = await Promise.all([
    WalletHistory.countDocuments(dateFilter),
    SellerRevenueHistory.countDocuments(dateFilter),
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      wallet: {
        totalTransactions: totalWalletTransactions,
        byType: walletStats,
      },
      revenue: {
        totalTransactions: totalRevenueTransactions,
        byType: revenueStats,
      },
    },
  });
});

