const { logActivityAsync } = require('./activityLog.service');
const catchAsync = require('../../utils/helpers/catchAsync');

/**
 * Activity logging middleware
 * @param {String} action - Action name (e.g., "CREATE_PRODUCT")
 * @param {Function} descriptionCallback - Optional callback to generate description from request
 * @returns {Function} - Express middleware
 */
const activityLogger = (action, descriptionCallback = null) => {
  return catchAsync(async (req, res, next) => {
    // Log activity after the route handler completes
    const originalSend = res.json;
    const originalEnd = res.end;

    // Override res.json to log after response
    res.json = function (data) {
      logActivityAfterResponse();
      return originalSend.call(this, data);
    };

    // Override res.end for other response types
    res.end = function (chunk, encoding) {
      logActivityAfterResponse();
      return originalEnd.call(this, chunk, encoding);
    };

    const logActivityAfterResponse = () => {
      // Only log if user is authenticated
      if (!req.user) {
        return;
      }

      // Determine role from user
      let role = 'buyer';
      if (req.user.role === 'seller') {
        role = 'seller';
      } else if (req.user.role === 'admin') {
        role = 'admin';
      }

      // Generate description
      let description = action;
      if (descriptionCallback && typeof descriptionCallback === 'function') {
        try {
          description = descriptionCallback(req, res);
        } catch (error) {
          console.error('[ActivityLogger] Error in description callback:', error);
          description = action;
        }
      }

      // Log asynchronously (don't block response)
      logActivityAsync({
        userId: req.user._id || req.user.id,
        role,
        action,
        description,
        req,
        metadata: {
          method: req.method,
          path: req.originalUrl || req.path,
          statusCode: res.statusCode,
        },
      });
    };

    next();
  });
};

module.exports = activityLogger;

