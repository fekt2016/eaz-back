/**
 * SECURITY FIX #5 (Phase 2 Enhancement): Input Validation for Payment Operations
 * Prevents manipulation of payment amounts and validates all payment input
 */

const { body, validationResult } = require('express-validator');
const mongoose = require('mongoose');
const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');

// Validation rules for Paystack payment initialization
exports.validatePaystackInit = [
  body('orderId')
    .notEmpty()
    .withMessage('Order ID is required')
    .custom((value) => {
      if (!mongoose.Types.ObjectId.isValid(value)) {
        throw new Error('Invalid order ID format');
      }
      return true;
    }),

  body('email')
    .optional({ values: 'falsy' })
    .isEmail()
    .withMessage('Invalid email format')
    .normalizeEmail(),

  body('callbackBaseUrl')
    .optional({ values: 'falsy' })
    .isString()
    .withMessage('callbackBaseUrl must be a string')
    .isLength({ max: 2048 })
    .withMessage('callbackBaseUrl is too long'),

  body('amount')
    .optional()
    .isFloat({ min: 0.01 })
    .withMessage('Amount must be a positive number')
    .customSanitizer((value) => {
      if (value === undefined || value === null) return value;
      const num = parseFloat(value);
      return isNaN(num) ? value : num.toFixed(2);
    }),

  // Reject unknown fields (prevent mass assignment)
  body()
    .custom((value, { req }) => {
      const allowedFields = ['orderId', 'email', 'amount', 'callbackBaseUrl'];
      const receivedFields = Object.keys(req.body);
      const unknownFields = receivedFields.filter(field => !allowedFields.includes(field));
      
      if (unknownFields.length > 0) {
        throw new Error(`Unknown fields not allowed: ${unknownFields.join(', ')}`);
      }
      return true;
    }),
];

// Validation rules for payment verification
exports.validatePaymentVerification = [
  body('reference')
    .optional()
    .isLength({ min: 10, max: 100 })
    .withMessage('Payment reference must be between 10 and 100 characters')
    .matches(/^[A-Z0-9\-_]+$/)
    .withMessage('Payment reference contains invalid characters'),

  // Note: orderId and reference can come from query params for GET requests
  // This validator is for POST requests
];

// Validation rules for Paystack payment verification (POST)
exports.validatePaystackVerify = [
  body('reference')
    .notEmpty()
    .withMessage('Payment reference is required')
    .customSanitizer((value) =>
      typeof value === 'string' ? value.trim() : value
    )
    .isLength({ min: 10, max: 100 })
    .withMessage('Payment reference must be between 10 and 100 characters')
    .matches(/^[A-Za-z0-9\-_]+$/)
    .withMessage('Payment reference contains invalid characters'),

  body('orderId')
    .optional({ values: 'null' })
    .custom((value) => {
      if (value == null || value === '') return true;
      if (!mongoose.Types.ObjectId.isValid(value)) throw new Error('Invalid orderId format');
      return true;
    }),

  // Reject unknown fields (prevent mass assignment)
  body().custom((_, { req }) => {
    const allowedFields = ['reference', 'orderId'];
    const receivedFields = Object.keys(req.body || {});
    const unknownFields = receivedFields.filter(
      (field) => !allowedFields.includes(field)
    );
    if (unknownFields.length > 0) {
      throw new Error(`Unknown fields not allowed: ${unknownFields.join(', ')}`);
    }
    return true;
  }),
];

// Middleware to handle validation errors
exports.handleValidationErrors = catchAsync(async (req, res, next) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    // SECURITY FIX #6: Generic error message (don't leak validation details)
    const errorMessages = errors.array().map(err => err.msg);
    return next(new AppError(`Invalid input: ${errorMessages[0]}`, 400));
  }
  
  next();
});
