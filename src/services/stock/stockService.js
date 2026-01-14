const mongoose = require('mongoose');
const Product = require('../../models/product/productModel');
const AppError = require('../../utils/errors/appError');

/**
 * Centralized Stock Service
 * Handles all stock reduction logic for orders
 * Ensures atomic updates and prevents race conditions
 */

/**
 * Reduce stock for a single order item
 * 
 * CRITICAL RULE: SKU is the single source of truth. Variant objects must NEVER be used.
 * 
 * @param {Object} orderItem - Order item with product, sku, and quantity
 * @param {Object} session - MongoDB session for transactions
 * @returns {Promise<Object>} - Result with success status and details
 */
const reduceItemStock = async (orderItem, session = null) => {
  const productId = orderItem.product?._id || orderItem.product;
  const quantity = orderItem.quantity;
  const itemSku = orderItem.sku ? orderItem.sku.trim().toUpperCase() : null;

  // Log variant object if present (for debugging) but DO NOT use it
  if (orderItem.variant) {
    console.warn('[stockService] ⚠️ VARIANT OBJECT DETECTED in reduceItemStock (will be ignored):', {
      productId,
      variantType: typeof orderItem.variant,
      variantValue: typeof orderItem.variant === 'object' ? '[Object]' : orderItem.variant,
      message: 'Variant objects are not allowed. Using SKU only.',
    });
  }

  if (!productId || !quantity || quantity <= 0) {
    throw new AppError('Invalid order item: missing product or quantity', 400);
  }

  // Fetch product
  const product = await Product.findById(productId).session(session || null);
  if (!product) {
    throw new AppError(`Product ${productId} not found`, 400);
  }

  // Handle variant-based products
  if (product.variants && product.variants.length > 0) {
    // CRITICAL: Product has variants - SKU is REQUIRED
    if (!itemSku) {
      throw new AppError(
        `Product "${product.name}" has variants but no SKU was provided. SKU is required for variant products.`,
        400
      );
    }

    // Find variant by SKU ONLY (no variantId, no variant object)
    const variant = product.variants.find(
      (v) => v.sku && v.sku.trim().toUpperCase() === itemSku
    );

    if (!variant) {
      const availableSkus = product.variants
        .map(v => v.sku || 'N/A')
        .filter(sku => sku !== 'N/A')
        .join(', ');
      
      throw new AppError(
        `Variant SKU "${itemSku}" not found in product "${product.name}". Available SKUs: ${availableSkus || 'None'}`,
        400
      );
    }

    // Atomic stock reduction using variant _id (MongoDB positional operator requires _id)
    const variantObjectId = variant._id;
    const currentStock = variant.stock || 0;
    
    const updateResult = await Product.findOneAndUpdate(
      {
        _id: productId,
        'variants._id': variantObjectId,
        'variants.stock': { $gte: quantity }, // Only update if stock is sufficient
      },
      {
        $inc: { 'variants.$.stock': -quantity },
      },
      { session: session || null, new: true }
    );

    if (!updateResult) {
      throw new AppError(
        `Insufficient stock for SKU "${variant.sku || itemSku}" in product "${product.name}". Available: ${currentStock}, Requested: ${quantity}`,
        400
      );
    }

    console.log(`[stockService] ✅ Reduced ${quantity} from variant SKU "${variant.sku || itemSku}" of product ${product.name}. Old stock: ${currentStock}, New stock: ${currentStock - quantity}`);

    // Update product status based on total variant stock
    const updatedProduct = await Product.findById(productId).session(session || null);
    const totalStock = updatedProduct.variants.reduce((sum, variant) => sum + (variant.stock || 0), 0);
    
    if (totalStock === 0 && updatedProduct.status !== 'draft') {
      updatedProduct.status = 'out_of_stock';
      await updatedProduct.save({ session: session || null });
      console.log(`[stockService] Product ${product.name} marked as out_of_stock`);
    } else if (totalStock > 0 && updatedProduct.status === 'out_of_stock') {
      updatedProduct.status = 'active';
      await updatedProduct.save({ session: session || null });
      console.log(`[stockService] Product ${product.name} marked as active`);
    }

    return {
      success: true,
      productId: productId.toString(),
      productName: product.name,
      sku: variant.sku || itemSku,
      quantityReduced: quantity,
    };
  } else {
    // Simple product without variants - reduce product-level stock
    const productStock = product.stock || product.totalStock || product.defaultStock;
    
    if (productStock === undefined || productStock === null) {
      throw new AppError(
        `Product "${product.name}" has no variants and no stock field. Cannot reduce stock.`,
        400
      );
    }

    if (productStock < quantity) {
      throw new AppError(
        `Insufficient stock for product "${product.name}". Available: ${productStock}, Requested: ${quantity}`,
        400
      );
    }

    // Reduce product-level stock
    product.stock = (product.stock || 0) - quantity;
    await product.save({ session: session || null });

    console.log(`[stockService] ✅ Reduced ${quantity} from product ${product.name}. Old stock: ${productStock}, New stock: ${productStock - quantity}`);

    return {
      success: true,
      productId: productId.toString(),
      productName: product.name,
      sku: null,
      quantityReduced: quantity,
    };
  }
};

/**
 * Reduce stock for all items in an order
 * @param {Object} order - Order document with orderItems
 * @param {Object} session - MongoDB session for transactions
 * @returns {Promise<Object>} - Result with success status and details
 */
exports.reduceOrderStock = async (order, session = null) => {
  try {
    // Check if stock was already reduced (prevent double reduction)
    if (order.metadata?.inventoryReduced) {
      console.log(`[stockService] ⚠️ Stock already reduced for order ${order._id} at ${order.metadata.inventoryReducedAt}`);
      return {
        success: true,
        alreadyReduced: true,
        message: 'Stock was already reduced for this order',
      };
    }

    // Populate orderItems if not already populated
    let orderItems;
    if (order.orderItems && order.orderItems[0] && order.orderItems[0].product) {
      // Already populated - check if SKU is present
      orderItems = order.orderItems;
      
      // CRITICAL: Ensure SKU is present on all items (it should be from schema)
      for (const item of orderItems) {
        if (!item.sku) {
          console.warn(`[stockService] ⚠️ Order item missing SKU - attempting to fetch from database:`, {
            itemId: item._id,
            productId: item.product?._id || item.product,
          });
          
          // Fetch the full order item from database to get SKU
          const OrderItems = require('../../models/order/OrderItemModel');
          const fullItem = await OrderItems.findById(item._id || item)
            .select('product variant quantity sku')
            .session(session || null);
          
          if (fullItem && fullItem.sku) {
            item.sku = fullItem.sku;
            console.log(`[stockService] ✅ Retrieved SKU from database: ${fullItem.sku}`);
          } else {
            console.error(`[stockService] ❌ Order item ${item._id || item} has no SKU in database`);
          }
        }
      }
    } else {
      // Need to populate - CRITICAL: Include 'sku' in select
      const Order = require('../../models/order/orderModel');
      const populatedOrder = await Order.findById(order._id)
        .populate({
          path: 'orderItems',
          select: 'product variant quantity sku', // CRITICAL: Include 'sku' field
        })
        .session(session || null);
      orderItems = populatedOrder.orderItems;
    }

    if (!orderItems || orderItems.length === 0) {
      console.log(`[stockService] ⚠️ No order items found for order ${order._id}`);
      return {
        success: true,
        message: 'No order items to process',
      };
    }

    // Reduce stock for each item
    const results = [];
    const errors = [];

    for (const orderItem of orderItems) {
      try {
        const result = await reduceItemStock(orderItem, session);
        results.push(result);
      } catch (error) {
        console.error(`[stockService] ❌ Error reducing stock for order item:`, error.message);
        errors.push({
          productId: orderItem.product?._id || orderItem.product,
          sku: orderItem.sku || 'N/A',
          error: error.message,
        });
      }
    }

    // If any errors occurred, throw an error
    if (errors.length > 0) {
      throw new AppError(
        `Failed to reduce stock for ${errors.length} item(s): ${errors.map(e => e.error).join('; ')}`,
        400
      );
    }

    // Mark inventory as reduced in order metadata
    if (!order.metadata) {
      order.metadata = {};
    }
    order.metadata.inventoryReduced = true;
    order.metadata.inventoryReducedAt = new Date();

    if (session) {
      await order.save({ session, validateBeforeSave: false });
    } else {
      await order.save({ validateBeforeSave: false });
    }

    console.log(`[stockService] ✅ Stock reduced successfully for order ${order._id}. Processed ${results.length} item(s)`);

    return {
      success: true,
      orderId: order._id.toString(),
      itemsProcessed: results.length,
      results,
    };
  } catch (error) {
    console.error(`[stockService] ❌ Error reducing stock for order ${order._id}:`, error);
    throw error; // Re-throw to allow caller to handle
  }
};

/**
 * Validate stock availability for order items (without reducing)
 * Used during order creation to check if order can be placed
 * 
 * CRITICAL RULE: SKU is the single source of truth. Variant objects must NEVER be used.
 * 
 * @param {Array} orderItems - Array of order items with product, sku, quantity
 * @param {Object} session - MongoDB session for transactions
 * @returns {Promise<Object>} - Validation result
 */
exports.validateStockAvailability = async (orderItems, session = null) => {
  const validationErrors = [];

  // CRITICAL: Log what we're receiving for debugging
  console.log('[stockService] validateStockAvailability called with items:', orderItems.map(item => ({
    productId: item.product?._id || item.product,
    sku: item.sku,
    quantity: item.quantity,
    // Log variant object if it exists (for debugging) but DO NOT use it
    hasVariantObject: !!item.variant,
    variantType: item.variant ? (typeof item.variant === 'object' ? 'object' : 'string') : 'none',
  })));

  for (const item of orderItems) {
    const productId = item.product?._id || item.product;
    const quantity = item.quantity;
    const itemSku = item.sku ? item.sku.trim().toUpperCase() : null;

    // Log variant object if present (for debugging) but DO NOT use it
    if (item.variant) {
      console.warn('[stockService] ⚠️ VARIANT OBJECT DETECTED (will be ignored):', {
        productId,
        variantType: typeof item.variant,
        variantValue: typeof item.variant === 'object' ? '[Object]' : item.variant,
        message: 'Variant objects are not allowed. Using SKU only.',
      });
    }

    if (!productId || !quantity) {
      validationErrors.push({
        productId,
        error: 'Missing product or quantity',
      });
      continue;
    }

    if (!quantity || quantity <= 0) {
      validationErrors.push({
        productId,
        error: 'Invalid quantity. Must be greater than 0',
      });
      continue;
    }

    const product = await Product.findById(productId).session(session || null);
    if (!product) {
      validationErrors.push({
        productId,
        error: 'Product not found',
      });
      continue;
    }

    // Log for debugging
    console.log(`[stockService] Validating stock for product ${product.name}:`, {
      productId: productId.toString(),
      sku: itemSku,
      quantity,
      hasVariants: product.variants && product.variants.length > 0,
      variantCount: product.variants ? product.variants.length : 0,
    });

    // Handle products with variants
    if (product.variants && product.variants.length > 0) {
      // CRITICAL: Product has variants - SKU is REQUIRED
      if (!itemSku) {
        validationErrors.push({
          productId,
          productName: product.name,
          error: `Product "${product.name}" has variants but no SKU was provided. SKU is required for variant products.`,
        });
        continue;
      }

      // Find variant by SKU ONLY (no variantId, no variant object)
      const variant = product.variants.find(
        (v) => v.sku && v.sku.trim().toUpperCase() === itemSku
      );

      if (!variant) {
        const availableSkus = product.variants
          .map(v => v.sku || 'N/A')
          .filter(sku => sku !== 'N/A')
          .join(', ');
        
        validationErrors.push({
          productId,
          sku: itemSku,
          productName: product.name,
          availableSkus: availableSkus || 'None',
          error: `Variant SKU "${itemSku}" not found for product "${product.name}". Available SKUs: ${availableSkus || 'None'}`,
        });
        continue;
      }

      // Validate stock for found variant
      const availableStock = variant.stock || 0;
      if (availableStock < quantity) {
        validationErrors.push({
          productId,
          sku: variant.sku || itemSku,
          productName: product.name,
          variantName: variant.name || 'Unnamed variant',
          available: availableStock,
          requested: quantity,
          error: `Insufficient stock for SKU "${variant.sku || itemSku}". Available: ${availableStock}, Requested: ${quantity}`,
        });
      }
    } else {
      // Simple product without variants - validate against product-level stock
      // Check if product has a stock field at root level
      const productStock = product.stock || product.totalStock || product.defaultStock || 0;
      
      if (productStock < quantity) {
        validationErrors.push({
          productId,
          productName: product.name,
          available: productStock,
          requested: quantity,
          error: `Insufficient stock for product "${product.name}". Available: ${productStock}, Requested: ${quantity}`,
        });
      }
    }
  }

  if (validationErrors.length > 0) {
    return {
      valid: false,
      errors: validationErrors,
    };
  }

  return {
    valid: true,
    message: 'All items have sufficient stock',
  };
};

/**
 * Get total stock for a product (sum of all variant stocks)
 * @param {String} productId - Product ID
 * @returns {Promise<Number>} - Total stock count
 */
exports.getProductTotalStock = async (productId) => {
  const product = await Product.findById(productId).select('variants');
  if (!product) {
    return 0;
  }

  if (product.variants && product.variants.length > 0) {
    return product.variants.reduce((sum, variant) => sum + (variant.stock || 0), 0);
  }

  return 0;
};

/**
 * Get stock for a specific variant
 * @param {String} productId - Product ID
 * @param {String} variantId - Variant ID
 * @returns {Promise<Number>} - Variant stock count
 */
exports.getVariantStock = async (productId, variantId) => {
  const product = await Product.findById(productId).select('variants');
  if (!product) {
    return 0;
  }

  if (product.variants && product.variants.length > 0) {
    const variant = product.variants.id(variantId);
    return variant ? (variant.stock || 0) : 0;
  }

  return 0;
};

