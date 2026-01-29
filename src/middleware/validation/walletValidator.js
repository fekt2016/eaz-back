/**
 * SECURITY FIX #5 (Phase 2 Enhancement): Input Validation for Wallet Operations
 * Prevents manipulation of wallet amounts and validates all wallet input
 */

const { body, validationResult } = require('express-validator');
const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');

// Validation rules for wallet top-up
exports.validateTopup = [
  body('amount')
    .notEmpty()
    .withMessage('Amount is required')
    .isFloat({ min: 1, max: 10000 })
    .withMessage('Amount must be between GH₵1 and GH₵10,000')
    .customSanitizer((value) => {
      const num = parseFloat(value);
      return isNaN(num) ? value : num.toFixed(2);
    }),

  body('email')
    .optional()
    .isEmail()
    .withMessage('Invalid email format')
    .normalizeEmail(),

  // Reject unknown fields (prevent mass assignment)
  body()
    .custom((value, { req }) => {
      const allowedFields = ['amount', 'email'];
      const receivedFields = Object.keys(req.body);
      const unknownFields = receivedFields.filter(field => !allowedFields.includes(field));
      
      if (unknownFields.length > 0) {
        throw new Error(`Unknown fields not allowed: ${unknownFields.join(', ')}`);
      }
      return true;
    }),
];

// Validation rules for wallet verification
exports.validateTopupVerification = [
  body('reference')
    .notEmpty()
    .withMessage('Payment reference is required')
    .isLength({ min: 10, max: 100 })
    .withMessage('Payment reference must be between 10 and 100 characters')
    .matches(/^[A-Za-z0-9\-_.]+$/)
    .withMessage('Payment reference contains invalid characters'),

  // Reject unknown fields
  body()
    .custom((value, { req }) => {
      const allowedFields = ['reference'];
      const receivedFields = Object.keys(req.body);
      const unknownFields = receivedFields.filter(field => !allowedFields.includes(field));
      
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

