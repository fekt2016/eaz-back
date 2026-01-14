// AppError is not used in this file, but kept for potential future use
// const AppError = require('../../utils/errors/appError');

const sendErrorDev = (err, res) => {
  res.status(err.statusCode).json({
    status: err.status,
    error: err,
    message: err.message,
    stack: err.stack,
  });
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
    res.status(500).json({
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
