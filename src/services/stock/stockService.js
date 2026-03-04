const mongoose = require('mongoose');
const Product = require('../../models/product/productModel');

/**
 * stockService.js
 * Single source of truth for all stock operations.
 * Used by Buyer, Seller, and Admin apps.
 * All operations are atomic using $inc + $gte guards (where applicable).
 */

/**
 * Reduce stock for all items in an order.
 * Works for both variant and simple products.
 * Must be called at ORDER CREATION for ALL payment methods.
 * @param {Array} items - Array of items with productId, variantId (optional), and quantity
 * @param {ClientSession} session - MongoDB session for transactions
 */
exports.reduceOrderStock = async (items, session) => {
  for (const item of items) {
    const productId = item.productId || item.product;
    const variantId = item.variantId || item.variant;
    const sku = item.sku;
    const quantity = item.quantity;

    if (sku || variantId) {
      // Atomic reduction for variant products (using SKU or ID)
      const query = { _id: productId };
      if (sku) {
        query['variants.sku'] = sku;
      } else {
        query['variants._id'] = variantId;
      }
      query['variants.stock'] = { $gte: quantity };

      const result = await Product.findOneAndUpdate(
        query,
        { $inc: { 'variants.$.stock': -quantity } },
        { new: true, session }
      );

      if (!result) {
        throw new Error(
          `Insufficient stock: variant ${sku || variantId} needs ${quantity} units`
        );
      }
    } else {
      // Atomic reduction for simple products
      const result = await Product.findOneAndUpdate(
        {
          _id: productId,
          stock: { $gte: quantity }
        },
        { $inc: { stock: -quantity } },
        { new: true, session }
      );
      if (!result) {
        throw new Error(
          `Insufficient stock: product ${productId} needs ${quantity} units`
        );
      }
    }
  }
};

/**
 * Restore stock when an order is cancelled or refunded.
 * Must be called for ALL payment methods on cancellation.
 * @param {Array} items - Array of items with productId, variantId (optional), and quantity
 * @param {ClientSession} session - MongoDB session for transactions
 */
exports.restoreOrderStock = async (items, session) => {
  for (const item of items) {
    const productId = item.productId || item.product;
    const variantId = item.variantId || item.variant;
    const sku = item.sku;
    const quantity = item.quantity;

    if (sku || variantId) {
      const query = { _id: productId };
      if (sku) {
        query['variants.sku'] = sku;
      } else {
        query['variants._id'] = variantId;
      }

      await Product.findOneAndUpdate(
        query,
        { $inc: { 'variants.$.stock': quantity } },
        { session }
      );
    } else {
      await Product.findOneAndUpdate(
        { _id: productId },
        { $inc: { stock: quantity } },
        { session }
      );
    }
  }
};

/**
 * Atomically set stock level (admin use only).
 * @param {string} productId
 * @param {string|null} variantId - null for simple products
 * @param {number} newStock - absolute stock level to set
 * @param {ClientSession} session
 */
exports.setStockLevel = async (
  productId,
  variantId,
  newStock,
  session
) => {
  if (newStock < 0) throw new Error('Stock cannot be negative');

  if (variantId) {
    return Product.findOneAndUpdate(
      { _id: productId, 'variants._id': variantId },
      { $set: { 'variants.$.stock': newStock } },
      { new: true, session }
    );
  }
  return Product.findOneAndUpdate(
    { _id: productId },
    { $set: { stock: newStock } },
    { new: true, session }
  );
};
