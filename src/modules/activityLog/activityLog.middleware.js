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
      if (!req || !req.user) {
        return;
      }

      // Validate required fields before logging
      const userId = req.user._id || req.user.id;
      if (!userId) {
        console.error('[ActivityLogger] Missing userId');
        return;
      }

      // Determine role from user - ensure it's a valid role
      let role = 'buyer';
      if (req.user.role === 'seller') {
        role = 'seller';
      } else if (req.user.role === 'admin') {
        role = 'admin';
      } else if (req.user.role === 'user' || req.user.role === 'buyer') {
        role = 'buyer';
      }

      // Ensure role is valid
      if (!['buyer', 'seller', 'admin'].includes(role)) {
        console.error('[ActivityLogger] Invalid role:', req.user.role);
        role = 'buyer'; // Default fallback
      }

      // Generate description - ensure it's never empty
      let description = action || 'Unknown action';
      if (descriptionCallback && typeof descriptionCallback === 'function') {
        try {
          const callbackDescription = descriptionCallback(req, res);
          if (callbackDescription && typeof callbackDescription === 'string' && callbackDescription.trim()) {
            description = callbackDescription;
          }
        } catch (error) {
          console.error('[ActivityLogger] Error in description callback:', error);
          // Keep default description
        }
      }

      // Ensure description is not empty
      if (!description || typeof description !== 'string' || !description.trim()) {
        description = action || 'Activity logged';
      }

      // Ensure action is provided
      if (!action || typeof action !== 'string' || !action.trim()) {
        console.error('[ActivityLogger] Missing or invalid action');
        return;
      }

      // Log asynchronously (don't block response)
      logActivityAsync({
        userId,
        role,
        action: action.trim(),
        description: description.trim(),
        req,
        metadata: {
          method: req.method || 'UNKNOWN',
          path: req.originalUrl || req.path || 'UNKNOWN',
          statusCode: res.statusCode || 200,
        },
      });
    };

    next();
  });
};

module.exports = activityLogger;

