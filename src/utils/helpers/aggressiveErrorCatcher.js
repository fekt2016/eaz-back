/**
 * AGGRESSIVE ERROR CATCHER
 * 
 * This module sets up comprehensive error catching to ensure
 * NO error escapes without being logged.
 * 
 * Call this at the very start of server.js
 */

const setupAggressiveErrorCatching = () => {
  console.log('\n🔍 [AggressiveErrorCatcher] Setting up comprehensive error catching...\n');

  // Catch unhandled promise rejections
  // CRITICAL: Handle Redis/ioredis errors gracefully - don't crash the app
  // 🛡️ SAFE MODE: Never exit in development
  process.on('unhandledRejection', (reason, promise) => {
    // Check if this is a Redis connection error - these are expected when Redis is down
    if (reason && typeof reason === 'object') {
      const errorCode = reason.code || reason.errno;
      const errorMessage = reason.message || String(reason);
      
      // Redis connection errors are expected when Redis is unavailable
      if (
        errorCode === 'ECONNREFUSED' ||
        errorCode === 'ENOTFOUND' ||
        errorCode === 'ETIMEDOUT' ||
        errorMessage.includes('ECONNREFUSED') ||
        errorMessage.includes('Redis') ||
        errorMessage.includes('ioredis')
      ) {
        // Log but don't treat as fatal - Redis is optional
        console.warn('\n⚠️  [UnhandledRejection] Redis connection error (expected when Redis is down):');
        console.warn('   Error:', errorMessage);
        console.warn('   Code:', errorCode);
        console.warn('   → App continues without Redis. This is normal if Redis is not running.\n');
        return; // Don't crash - Redis is optional
      }
    }
    
    // For other unhandled rejections, log fully
    console.error('\n🚨🚨🚨 UNHANDLED REJECTION CAUGHT (SAFE MODE - Server Continues) 🚨🚨🚨');
    console.error('================================================');
    console.error('Reason:', reason);
    console.error('Reason type:', typeof reason);
    console.error('Reason message:', reason?.message);
    console.error('Reason code:', reason?.code);
    
    // 📱 CRITICAL: Log last mobile app request
    if (typeof global !== 'undefined' && global.lastMobileRequest) {
      console.error('\n📱 LAST MOBILE APP REQUEST BEFORE REJECTION:');
      console.error('  App:', global.lastMobileRequest.app || 'Unknown');
      console.error('  Screen:', global.lastMobileRequest.screen || 'Unknown');
      console.error('  Route:', global.lastMobileRequest.route);
      console.error('  Method:', global.lastMobileRequest.method);
      console.error('  ⚠️  THIS SCREEN MAY HAVE TRIGGERED THE REJECTION!');
    }
    
    if (reason?.message && reason.message.includes('ERR_INVALID_ARG_TYPE')) {
      console.error('\n🎯🎯🎯 ERR_INVALID_ARG_TYPE FOUND! 🎯🎯🎯');
      console.error('================================================');
      if (typeof global !== 'undefined' && global.lastMobileRequest) {
        console.error('📱 CRASH SOURCE IDENTIFIED:');
        console.error('  Screen:', global.lastMobileRequest.screen);
        console.error('  Route:', global.lastMobileRequest.route);
        console.error('  ⚠️  DISABLE THIS SCREEN OR ITS API CALLS IMMEDIATELY!');
      }
    }
    
    if (reason?.stack) {
      console.error('\nStack Trace:');
      console.error(reason.stack);
    }
    console.error('================================================');
    console.error('🛡️  SAFE MODE: Server continues running (no process.exit)');
    console.error('🛡️  Backend remains alive for debugging');
    console.error('================================================\n');
  });

  // Catch uncaught exceptions
  // 🛡️ SAFE MODE: Never exit in development
  process.on('uncaughtException', (error) => {
    console.error('\n🚨🚨🚨 UNCAUGHT EXCEPTION CAUGHT (SAFE MODE - Server Continues) 🚨🚨🚨');
    console.error('================================================');
    console.error('Error:', error);
    console.error('Error name:', error?.name);
    console.error('Error message:', error?.message);
    console.error('Error code:', error?.code);
    
    // 📱 CRITICAL: Log last mobile app request
    if (typeof global !== 'undefined' && global.lastMobileRequest) {
      console.error('\n📱 LAST MOBILE APP REQUEST BEFORE EXCEPTION:');
      console.error('  App:', global.lastMobileRequest.app || 'Unknown');
      console.error('  Screen:', global.lastMobileRequest.screen || 'Unknown');
      console.error('  Route:', global.lastMobileRequest.route);
      console.error('  Method:', global.lastMobileRequest.method);
      console.error('  ⚠️  THIS SCREEN MAY HAVE TRIGGERED THE EXCEPTION!');
    }
    
    if (error?.message && error.message.includes('ERR_INVALID_ARG_TYPE')) {
      console.error('\n🎯🎯🎯 ERR_INVALID_ARG_TYPE FOUND! 🎯🎯🎯');
      console.error('================================================');
      if (typeof global !== 'undefined' && global.lastMobileRequest) {
        console.error('📱 CRASH SOURCE IDENTIFIED:');
        console.error('  Screen:', global.lastMobileRequest.screen);
        console.error('  Route:', global.lastMobileRequest.route);
        console.error('  ⚠️  DISABLE THIS SCREEN OR ITS API CALLS IMMEDIATELY!');
      }
    }
    
    if (error?.stack) {
      console.error('\nStack Trace:');
      console.error(error.stack);
    }
    console.error('================================================');
    console.error('🛡️  SAFE MODE: Server continues running (no process.exit)');
    console.error('🛡️  Backend remains alive for debugging');
    console.error('================================================\n');
  });

  // Catch warnings (sometimes errors are logged as warnings)
  process.on('warning', (warning) => {
    if (warning.message && warning.message.includes('ERR_INVALID_ARG_TYPE')) {
      console.error('\n🚨 WARNING WITH ERR_INVALID_ARG_TYPE:');
      console.error(warning);
    }
  });

  console.log('✅ [AggressiveErrorCatcher] Error catching setup complete\n');
};

module.exports = setupAggressiveErrorCatching;

