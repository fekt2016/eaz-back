// Controllers/errorController.js
const AppError = require('../../utils/errors/appError');

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
    status: err.status,
    error: err,
    message: err.message,
    stack: err.stack,
  };

  // Include custom error properties if they exist (for OTP expiration, etc.)
  if (err.code) errorResponse.code = err.code;
  if (err.isExpired !== undefined) errorResponse.isExpired = err.isExpired;
  if (err.isInvalid !== undefined) errorResponse.isInvalid = err.isInvalid;

  res.status(err.statusCode).json(errorResponse);
};

const sendErrorProd = (err, res) => {
  // SECURITY FIX #18/#19: Production error sanitization
  if (err.isOperational) {
    // Operational errors: trusted errors we can send to client
    res.status(err.statusCode).json({
      status: err.status,
      message: err.message,
      // SECURITY: Never send stack trace or error details in production
    });
  } else {
    // Programming or unknown errors: don't leak error details
    console.error('❌ ERROR:', err); // Log full error server-side only

    // SECURITY: Send generic message to client
    res.status(500).json({
      status: 'error',
      message: 'Something went wrong. Please try again later.',
      // SECURITY: No stack trace, no error details, no internal info
    });
  }
};

const globalErrorHandler = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  if (process.env.NODE_ENV === 'development') {
    sendErrorDev(err, res);
  } else if (process.env.NODE_ENV === 'production') {
    let error = { ...err };
    error.message = err.message;
    error.name = err.name;
    error.code = err.code;
    error.errmsg = err.errmsg;
    error.keyValue = err.keyValue;

    if (error.name === 'CastError') error = handleCastErrorDB(error);
    if (error.code === 11000) error = handleDuplicateFieldsDB(error);
    if (error.name === 'ValidationError')
      error = handleValidationErrorDB(error);
    if (error.name === 'JsonWebTokenError')
      error = handleJsonWebTokenErrorJWT();
    if (error.name === 'TokenExpiredError') error = handleTokenExpiredError();

    sendErrorProd(error, res);
  }
};

module.exports = globalErrorHandler;;
