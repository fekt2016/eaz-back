// AppError is not used in this file, but kept for potential future use
// const AppError = require('../../utils/errors/appError');
const { buildErrorResponse } = require('../../utils/helpers/responseHelper');

const sendErrorDev = (err, res) => {
  const payload = buildErrorResponse({
    message: err.message,
    statusCode: err.statusCode,
    errorCode: err.code || null,
    details: err.fieldErrors || null,
    status: err.status,
  });

  // In development, also include raw error & stack for easier debugging
  payload.error = err;
  payload.stack = err.stack;

  res.status(err.statusCode).json(payload);
};

const sendErrorProd = (err, res) => {
  // Operational, trusted error: send message to client
  if (err.isOperational) {
    // SECURITY FIX #7: Generic error messages in production
    // Don't leak internal details, account existence, or system structure
    let genericMessage = err.message;
    
    // Don't expose stack traces in production
    err.stack = undefined;
    
    // Generic error messages based on error type and status code
    const messageLower = err.message.toLowerCase();
    
    // Too many requests / rate limiting (e.g. login lockout)
    if (err.statusCode === 429) {
      // Keep the original, user-friendly message but avoid leaking internals
      // Example: "Too many failed login attempts. Account locked for 15 minutes."
      genericMessage = err.message || 'Too many requests. Please try again later.';
    }
    // Authentication and authorization errors
    else if (err.statusCode === 401 || err.statusCode === 403) {
      // Log original error message for debugging (production-safe)
      const logger = require('../../utils/logger');
      logger.warn('[Error Controller] 401/403 error', {
        statusCode: err.statusCode,
        originalMessage: err.message,
        messageLower: messageLower,
        isOperational: err.isOperational,
        timestamp: new Date().toISOString(),
      });
      
      // Preserve verification-related messages (important for user flow)
      if (messageLower.includes('not verified') || messageLower.includes('verify') || 
          messageLower.includes('verification') || messageLower.includes('unverified') ||
          messageLower.includes('email address first')) {
        genericMessage = err.message; // Keep original message for verification errors
        logger.info('[Error Controller] Preserving verification error message', {
          originalMessage: err.message,
          genericMessage: genericMessage,
        });
      } 
      // Preserve device limit messages (important for user action)
      else if (messageLower.includes('device limit') || messageLower.includes('too many devices') ||
               messageLower.includes('maximum number of devices') || messageLower.includes('log out from another device')) {
        genericMessage = err.message; // Keep original message for device limit errors
        logger.info('[Error Controller] Preserving device limit error message', {
          originalMessage: err.message,
          genericMessage: genericMessage,
        });
      } else if (messageLower.includes('user') || messageLower.includes('password') || 
          messageLower.includes('email') || messageLower.includes('login') ||
          messageLower.includes('credential') || messageLower.includes('token') ||
          messageLower.includes('otp') || messageLower.includes('invalid') ||
          messageLower.includes('wrong') || messageLower.includes('incorrect')) {
        genericMessage = 'Invalid credentials';
      } else if (messageLower.includes('unauthorized') || messageLower.includes('permission')) {
        genericMessage = 'You do not have permission to perform this action.';
      } else {
        genericMessage = 'Authentication failed. Please try again.';
        logger.warn('[Error Controller] Using generic 403 message', {
          originalMessage: err.message,
          reason: 'No matching pattern found',
        });
      }
    }
    // Not found errors (404)
    else if (err.statusCode === 404) {
      if (messageLower.includes('user') || messageLower.includes('account') ||
          messageLower.includes('email') || messageLower.includes('phone')) {
        genericMessage = 'Unable to process request';
      } else {
        genericMessage = 'Resource not found';
      }
    }
    // Bad request errors (400)
    else if (err.statusCode === 400) {
      if (messageLower.includes('already exists') || messageLower.includes('already registered') ||
          messageLower.includes('duplicate') || messageLower.includes('taken')) {
        genericMessage = 'Unable to process request';
      } else if (messageLower.includes('validation') || messageLower.includes('required') ||
                 messageLower.includes('missing')) {
        genericMessage = 'Invalid input. Please check your request and try again.';
      } else {
        genericMessage = 'Unable to process request';
      }
    }
    // Expired or invalid token errors
    else if (messageLower.includes('expired') || messageLower.includes('invalid')) {
      if (err.statusCode === 401 || err.statusCode === 403) {
        genericMessage = 'Invalid credentials';
      } else {
        genericMessage = 'Request expired or invalid. Please try again.';
      }
    }
    // Default for other operational errors
    else {
      genericMessage = 'Unable to process request';
    }
    
    const payload = buildErrorResponse({
      message: genericMessage,
      statusCode: err.statusCode,
      errorCode: err.code || null,
      details: err.fieldErrors || null,
      status: err.status,
    });

    res.status(err.statusCode).json(payload);
  } else {
    // Programming or other unknown error: don't leak error details
    console.error('ERROR 💥', err);
    const payload = buildErrorResponse({
      message: 'Something went wrong!',
      statusCode: 500,
      status: 'error',
    });

    res.status(500).json(payload);
  }
};

const globalErrorHandler = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  if (process.env.NODE_ENV === 'development') {
    sendErrorDev(err, res);
  } else {
    sendErrorProd(err, res);
  }
};

module.exports = globalErrorHandler;
