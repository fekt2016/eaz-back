/**
 * SCREEN TRACKER MIDDLEWARE
 * 
 * Logs incoming mobile app requests with screen information
 * Extracts x-client-app, x-client-screen, and x-client-screen-params headers
 * Stores last mobile request in global.lastMobileRequest for crash handlers
 */

const screenTracker = (req, res, next) => {
  const clientApp = req.headers['x-client-app'];
  const clientScreen = req.headers['x-client-screen'];
  const clientScreenParams = req.headers['x-client-screen-params'];
  
  if (clientApp === 'Saysay' || clientScreen) {
    let screenParams = null;
    if (clientScreenParams) {
      try {
        screenParams = JSON.parse(clientScreenParams);
      } catch (e) { 
        // Ignore parse errors
      }
    }
    
    console.log(`\n📱 [SCREEN_TRACKER] Mobile App Request`);
    console.log(`   App: ${clientApp || 'Unknown'}`);
    console.log(`   Screen: ${clientScreen || 'Unknown'}`);
    if (screenParams && Object.keys(screenParams).length > 0) {
      console.log(`   Params: ${JSON.stringify(screenParams)}`);
    }
    console.log(`   Method: ${req.method}`);
    console.log(`   Route: ${req.path || req.url}`);
    console.log(`   Timestamp: ${new Date().toISOString()}`);
    
    req.clientApp = clientApp;
    req.clientScreen = clientScreen;
    req.clientScreenParams = screenParams;
    
    if (typeof global !== 'undefined') {
      global.lastMobileRequest = {
        app: clientApp,
        screen: clientScreen,
        params: screenParams,
        method: req.method,
        route: req.path || req.url,
        timestamp: new Date().toISOString(),
      };
    }
  }
  next();
};

module.exports = screenTracker;
