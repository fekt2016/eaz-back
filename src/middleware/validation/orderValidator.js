/**
 * SECURITY FIX #5: Input Validation for Order Creation
 * Prevents mass assignment and validates all order input
 */

const { body, validationResult } = require('express-validator');
const mongoose = require('mongoose');
const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');

// Validation rules for order creation
exports.validateOrder = [
  // Validate orderItems array
  body('orderItems')
    .isArray({ min: 1 })
    .withMessage('Order must contain at least one item')
    .custom((items) => {
      if (!Array.isArray(items)) {
        throw new Error('orderItems must be an array');
      }
      if (items.length === 0) {
        throw new Error('Order must contain at least one item');
      }
      if (items.length > 100) {
        throw new Error('Order cannot contain more than 100 items');
      }
      return true;
    }),

  // Validate each order item
  body('orderItems.*.product')
    .notEmpty()
    .withMessage('Product ID is required for all items')
    .custom((value) => {
      if (!mongoose.Types.ObjectId.isValid(value)) {
        throw new Error('Invalid product ID format');
      }
      return true;
    }),

  body('orderItems.*.quantity')
    .isInt({ min: 1, max: 1000 })
    .withMessage('Quantity must be between 1 and 1000')
    .toInt(),

  body('orderItems.*.sku')
    .notEmpty()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('SKU is required and must be between 1 and 100 characters')
    .matches(/^[A-Z0-9\-_]+$/)
    .withMessage('SKU must contain only uppercase letters, numbers, hyphens, and underscores')
    .customSanitizer((value) => {
      // Ensure SKU is uppercase
      return typeof value === 'string' ? value.toUpperCase().trim() : value;
    }),

  // Validate address
  body('address')
    .notEmpty()
    .withMessage('Shipping address is required')
    .custom((value) => {
      if (!mongoose.Types.ObjectId.isValid(value)) {
        throw new Error('Invalid address ID format');
      }
      return true;
    }),

  // Validate coupon code (optional)
  body('couponCode')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('Coupon code must be 50 characters or less')
    .matches(/^[A-Z0-9\-_]+$/)
    .withMessage('Coupon code must contain only uppercase letters, numbers, hyphens, and underscores'),

  // Reject unknown fields (prevent mass assignment)
  body()
    .custom((value, { req }) => {
      const allowedFields = ['orderItems', 'address', 'couponCode', 'paymentMethod'];
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

