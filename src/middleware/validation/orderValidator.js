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
    .optional()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('SKU must be between 1 and 100 characters')
    .matches(/^[A-Z0-9\-_]+$/)
    .withMessage('SKU must contain only uppercase letters, numbers, hyphens, and underscores')
    .customSanitizer((value) => {
      // Ensure SKU is uppercase if provided
      return value && typeof value === 'string' ? value.toUpperCase().trim() : value;
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

  // Validate payment method
  body('paymentMethod')
    .notEmpty()
    .withMessage('Payment method is required')
    .isIn(['payment_on_delivery', 'mobile_money', 'bank', 'credit_balance'])
    .withMessage('Invalid payment method'),

  // Validate coupon code (optional)
  body('couponCode')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('Coupon code must be 50 characters or less')
    .matches(/^[A-Z0-9\-_]+$/)
    .withMessage('Coupon code must contain only uppercase letters, numbers, hyphens, and underscores'),

  // Validate coupon ID (optional)
  body('couponId')
    .optional()
    .custom((value) => {
      if (!mongoose.Types.ObjectId.isValid(value)) {
        throw new Error('Invalid coupon ID format');
      }
      return true;
    }),

  // Validate batch ID (optional)
  body('batchId')
    .optional()
    .custom((value) => {
      if (!mongoose.Types.ObjectId.isValid(value)) {
        throw new Error('Invalid batch ID format');
      }
      return true;
    }),

  // Validate delivery method
  body('deliveryMethod')
    .notEmpty()
    .withMessage('Delivery method is required')
    .isIn(['dispatch', 'pickup_center', 'seller_delivery'])
    .withMessage('Invalid delivery method. Must be dispatch, pickup_center, or seller_delivery'),

  // Validate pickup center ID (optional, required if deliveryMethod is pickup_center)
  body('pickupCenterId')
    .optional()
    .custom((value, { req }) => {
      // If deliveryMethod is pickup_center, pickupCenterId should be provided
      if (req.body.deliveryMethod === 'pickup_center' && !value) {
        throw new Error('Pickup center ID is required when delivery method is pickup_center');
      }
      // If provided, validate ObjectId format
      if (value && !mongoose.Types.ObjectId.isValid(value)) {
        throw new Error('Invalid pickup center ID format');
      }
      return true;
    }),

  // Validate delivery speed (optional, for dispatch method)
  body('deliverySpeed')
    .optional()
    .isIn(['standard', 'same_day'])
    .withMessage('Invalid delivery speed. Must be standard or same_day'),

  // Validate shipping type (optional, for dispatch method)
  body('shippingType')
    .optional()
    .isIn(['standard', 'same_day'])
    .withMessage('Invalid shipping type. Must be standard or same_day'),

  // Validate shipping fee (optional, for dispatch method)
  body('shippingFee')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Shipping fee must be a positive number')
    .toFloat(),

  // Reject unknown fields (prevent mass assignment)
  body()
    .custom((value, { req }) => {
      const allowedFields = [
        'orderItems',
        'address',
        'paymentMethod',
        'couponCode',
        'couponId',
        'batchId',
        'deliveryMethod',
        'pickupCenterId',
        'deliverySpeed',
        'shippingType',
        'shippingFee',
      ];
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

