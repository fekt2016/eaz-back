/**
 * Mobile App Guard Middleware
 * 
 * Conditionally disables risky features for mobile app requests
 * to prevent backend crashes while keeping web app functional.
 * 
 * Usage:
 *   if (req.clientApp === 'Saysay') {
 *     // Skip risky operation for mobile app
 *   }
 */

/**
 * Check if request is from mobile app
 */
const isMobileApp = (req) => {
  return req.headers['x-client-app'] === 'Saysay' || 
         req.headers['x-mobile'] === 'true' ||
         req.clientApp === 'Saysay';
};

/**
 * Check if request is from specific screen
 */
const isFromScreen = (req, screenName) => {
  return req.headers['x-client-screen'] === screenName ||
         req.clientScreen === screenName;
};

/**
 * Guard function to skip risky operations for mobile app
 * Returns true if operation should be skipped
 */
const shouldSkipForMobile = (req, options = {}) => {
  const {
    skipForMobile = false,
    skipForScreens = [],
    skipForRoutes = [],
  } = options;
  
  if (!isMobileApp(req)) {
    return false; // Not mobile app, don't skip
  }
  
  // Skip if configured to skip all mobile requests
  if (skipForMobile) {
    return true;
  }
  
  // Skip if from specific screen
  const currentScreen = req.clientScreen || req.headers['x-client-screen'];
  if (skipForScreens.includes(currentScreen)) {
    return true;
  }
  
  // Skip if route matches
  const currentRoute = req.path || req.url;
  if (skipForRoutes.some(route => currentRoute.includes(route))) {
    return true;
  }
  
  return false;
};

module.exports = {
  isMobileApp,
  isFromScreen,
  shouldSkipForMobile,
};

