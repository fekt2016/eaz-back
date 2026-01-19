<<<<<<< HEAD
// AppError is not used in this file, but kept for potential future use
// const AppError = require('../../utils/errors/appError');

const sendErrorDev = (err, res) => {
  res.status(err.statusCode).json({
=======
// Controllers/errorController.js
const AppError = require('../../utils/errors/appError');
const logger = require('../../utils/logger');

const handleCastErrorDB = (err) => {
  const message = `Invalid ${err.path}: ${err.value}`;
  return new AppError(message, 400);
};

const handleDuplicateFieldsDB = (err) => {
  let value = 'unknown';

  if (err.keyValue) {
    value = JSON.stringify(err.keyValue);
  } else if (err.errmsg) {
    const match = err.errmsg.match(/(["'])(?:(?=(\\?))\2.)*?\1/);
    value = match ? match[0] : 'unknown';
  }

  const message = `Duplicate field value: ${value}. Please use another value.`;
  return new AppError(message, 400);
};

const handleValidationErrorDB = (err) => {
  const errors = Object.values(err.errors).map((el) => el.message);
  const message = `Invalid input data. ${errors.join('. ')}`;
  return new AppError(message, 400);
};

const handleJsonWebTokenErrorJWT = () =>
  new AppError('Invalid token, please log in again.', 401);

const handleTokenExpiredError = () =>
  new AppError('Your token has expired! Please log in again.', 401);

const sendErrorDev = (err, res) => {
  const errorResponse = {
    success: false,
>>>>>>> 6d2bc77 (first ci/cd push)
    status: err.status,
    message: err.message,
    error: err,
    stack: err.stack,
<<<<<<< HEAD
  });
=======
  };

  // Include field-level errors if they exist
  if (err.fieldErrors) {
    errorResponse.fieldErrors = err.fieldErrors;
  }

  // Include custom error properties if they exist (for OTP expiration, etc.)
  if (err.code) errorResponse.code = err.code;
  if (err.isExpired !== undefined) errorResponse.isExpired = err.isExpired;
  if (err.isInvalid !== undefined) errorResponse.isInvalid = err.isInvalid;

  res.status(err.statusCode).json(errorResponse);
>>>>>>> 6d2bc77 (first ci/cd push)
};

const sendErrorProd = (err, res) => {
  // Operational, trusted error: send message to client
  if (err.isOperational) {
<<<<<<< HEAD
    // SECURITY FIX #7: Generic error messages in production
    // Don't leak internal details, account existence, or system structure
    let genericMessage = err.message;
    
    // Don't expose stack traces in production
    err.stack = undefined;
    
    // Generic error messages based on error type and status code
    const messageLower = err.message.toLowerCase();
    
    // Authentication and authorization errors
    if (err.statusCode === 401 || err.statusCode === 403) {
      if (messageLower.includes('user') || messageLower.includes('password') || 
          messageLower.includes('email') || messageLower.includes('login') ||
          messageLower.includes('credential') || messageLower.includes('token') ||
          messageLower.includes('otp') || messageLower.includes('invalid') ||
          messageLower.includes('wrong') || messageLower.includes('incorrect')) {
        genericMessage = 'Invalid credentials';
      } else if (messageLower.includes('unauthorized') || messageLower.includes('permission')) {
        genericMessage = 'You do not have permission to perform this action.';
      } else {
        genericMessage = 'Authentication failed. Please try again.';
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
    
    res.status(err.statusCode).json({
      status: err.status,
      message: genericMessage,
    });
  } else {
    // Programming or other unknown error: don't leak error details
    console.error('ERROR 💥', err);
=======
    // Operational errors: trusted errors we can send to client
    const errorResponse = {
      success: false,
      status: err.status,
      message: err.message,
    };

    // Include field-level errors if they exist (for validation errors)
    if (err.fieldErrors) {
      errorResponse.fieldErrors = err.fieldErrors;
    }

    res.status(err.statusCode).json(errorResponse);
    // SECURITY: Never send stack trace or error details in production
  } else {
    // Programming or unknown errors: don't leak error details
    logger.error('Internal server error', {
      message: err.message,
      stack: err.stack,
      name: err.name,
      code: err.code,
    });

    // SECURITY: Send generic message to client
>>>>>>> 6d2bc77 (first ci/cd push)
    res.status(500).json({
      success: false,
      status: 'error',
      message: 'Something went wrong!',
    });
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
