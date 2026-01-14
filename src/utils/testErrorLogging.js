/**
 * TEMPORARY TEST FILE - Remove after debugging
 * 
 * This file helps test if error logging is working.
 * Add this route to test error catching:
 * 
 * router.get('/test-error', testErrorLogging);
 */

const fs = require('fs');
const catchAsync = require('./helpers/catchAsync');

/**
 * Test route to verify error logging works
 * GET /api/v1/test-error
 */
exports.testErrorLogging = catchAsync(async (req, res, next) => {
  console.log('\n🧪 TEST: Triggering ERR_INVALID_ARG_TYPE error...\n');
  
  try {
    // This will throw ERR_INVALID_ARG_TYPE
    const testObject = { path: '/some/path' }; // Object, not string
    fs.unlinkSync(testObject); // ❌ Will throw error
  } catch (error) {
    console.error('\n🚨 TEST ERROR CAUGHT:');
    console.error('Error message:', error.message);
    console.error('Error name:', error.name);
    console.error('Error code:', error.code);
    console.error('Stack trace:', error.stack);
    console.error('\n');
    
    // Re-throw to test Express error handler
    throw error;
  }
});

/**
 * Test route for background job error
 * This simulates what happens in a background job
 */
exports.testBackgroundJobError = async () => {
  console.log('\n🧪 TEST: Triggering ERR_INVALID_ARG_TYPE in background job...\n');
  
  try {
    const fs = require('fs');
    const testObject = { path: '/some/path' };
    fs.unlinkSync(testObject); // ❌ Will throw error
  } catch (error) {
    console.error('\n🚨 TEST BACKGROUND JOB ERROR CAUGHT:');
    console.error('Error message:', error.message);
    console.error('Error name:', error.name);
    console.error('Error code:', error.code);
    console.error('Stack trace:', error.stack);
    console.error('\n');
    
    throw error;
  }
};

