const Order = require('../../models/order/orderModel');
const SellerOrder = require('../../models/order/sellerOrderModel');
const Seller = require('../../models/user/sellerModel');
const Transaction = require('../../models/transaction/transactionModel');
const Product = require('../../models/product/productModel');
const OrderItem = require('../../models/order/OrderItemModel');
const mongoose = require('mongoose');
const AppError = require('../../utils/errors/appError');

/**
 * Calculate seller earnings for a seller order
 * @param {Object} sellerOrder - SellerOrder document
 * @returns {Number} - Seller earnings amount
 */
/**
 * Calculate seller earnings (VAT-exclusive base price only)
 * Seller receives base price (before VAT) - VAT must be remitted to GRA
 * @param {Object} sellerOrder - SellerOrder document
 * @returns {Number} - Seller earnings amount (base price - platform commission)
 */
const calculateSellerEarnings = async (sellerOrder) => {
  // Seller receives base price (VAT exclusive) + shipping
  // VAT components are NOT part of seller revenue (must be remitted)
  const basePrice = sellerOrder.totalBasePrice || 0; // Use base price (VAT exclusive)
  const shipping = sellerOrder.shippingCost || 0;
  const total = basePrice + shipping;
  
  // Get platform commission rate from settings (dynamic)
  const PlatformSettings = require('../../models/platform/platformSettingsModel');
  const settings = await PlatformSettings.getSettings();
  const commissionRate = sellerOrder.commissionRate !== undefined 
    ? sellerOrder.commissionRate 
    : (settings.platformCommissionRate || 0); // Use platform settings default
  const platformFee = total * commissionRate;
  const sellerEarnings = total - platformFee;
  
  return Math.round(sellerEarnings * 100) / 100; // Round to 2 decimal places
};

/**
 * Credit seller balance ONLY when order status is "delivered"
 * This is the ONLY place where sellers should be credited
 * Prevents double-crediting by checking sellerCredited flag
 * @param {String} orderId - Order ID
 * @param {String} updatedBy - User ID who updated the order
 * @returns {Promise<Object>} - Summary of balance updates
 */
exports.creditSellerForOrder = async (orderId, updatedBy) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Find order with seller orders populated
    const order = await Order.findById(orderId)
      .populate({
        path: 'sellerOrder',
        populate: {
          path: 'seller',
          select: '_id balance withdrawableBalance',
        },
      })
      .session(session);

    if (!order) {
      throw new AppError('Order not found', 404);
    }

    // CRITICAL: Only credit when order is DELIVERED
    if (order.currentStatus !== 'delivered') {
      await session.abortTransaction();
      return {
        success: false,
        message: `Order is not delivered yet. Current status: ${order.currentStatus}. Sellers are only credited when order status is "delivered".`,
        updates: [],
      };
    }

    // Prevent double-crediting using sellerCredited flag
    if (order.sellerCredited) {
      await session.abortTransaction();
      return {
        success: false,
        message: 'Sellers have already been credited for this order',
        updates: [],
      };
    }

    const balanceUpdates = [];

    // Process each seller order
    for (const sellerOrderId of order.sellerOrder) {
      const sellerOrder = await SellerOrder.findById(sellerOrderId)
        .populate('seller')
        .session(session);

      if (!sellerOrder) continue;

      const sellerId = sellerOrder.seller._id || sellerOrder.seller;

      // Additional check: Verify transaction doesn't already exist (extra safety)
      const existingTransaction = await Transaction.findOne({
        sellerOrder: sellerOrder._id,
        type: 'credit',
        status: 'completed',
      }).session(session);

      if (existingTransaction) {
        console.log(`[OrderService] Transaction already exists for seller ${sellerId} and order ${orderId}`);
        continue;
      }

      // Calculate seller earnings
      const sellerEarnings = await calculateSellerEarnings(sellerOrder);

      if (sellerEarnings <= 0) {
        console.log(`[OrderService] No earnings for seller ${sellerId} (amount: ${sellerEarnings})`);
        continue;
      }

      // Update seller balance
      const seller = await Seller.findById(sellerId).session(session);
      if (!seller) {
        console.log(`[OrderService] Seller ${sellerId} not found`);
        continue;
      }

      // Credit seller balance - Add seller earnings to seller.balance in seller model
      const oldBalance = seller.balance || 0;
      const oldWithdrawableBalance = seller.withdrawableBalance || 0;
      
      // Update seller balance: Add the seller earnings amount to the balance
      seller.balance = oldBalance + sellerEarnings;
      
      // Ensure withdrawableBalance is calculated correctly
      // The pre-save hook will also update it, but we calculate it explicitly here
      seller.calculateWithdrawableBalance();
      
      // Explicitly ensure withdrawableBalance is updated (balance - lockedBalance)
      const expectedWithdrawableBalance = Math.max(0, seller.balance - (seller.lockedBalance || 0));
      seller.withdrawableBalance = expectedWithdrawableBalance;
      
      console.log(`[OrderService] Seller ${sellerId} balance update in seller model:`);
      console.log(`  Old Balance: ${oldBalance}`);
      console.log(`  Seller Earnings: ${sellerEarnings}`);
      console.log(`  New Balance: ${seller.balance}`);
      console.log(`  WithdrawableBalance: ${oldWithdrawableBalance} → ${seller.withdrawableBalance}`);
      console.log(`  LockedBalance: ${seller.lockedBalance || 0}`);
      
      // Save the updated balance to the seller model
      await seller.save({ session });
      
      // Verify the save worked by re-fetching the seller
      const savedSeller = await Seller.findById(sellerId).session(session);
      if (savedSeller) {
        console.log(`[OrderService] ✅ Verified save - Seller balance in model: ${savedSeller.balance}, WithdrawableBalance: ${savedSeller.withdrawableBalance}`);
        if (savedSeller.balance !== seller.balance) {
          console.error(`[OrderService] ❌ ERROR: Balance mismatch! Expected: ${seller.balance}, Saved: ${savedSeller.balance}`);
        }
      } else {
        console.error(`[OrderService] ❌ ERROR: Could not verify save - Seller ${sellerId} not found after save`);
      }

      // Create transaction record
      const transaction = await Transaction.create(
        [
          {
            seller: sellerId,
            sellerOrder: sellerOrder._id,
            type: 'credit',
            amount: sellerEarnings,
            description: `Order Delivered — Seller Earnings Credited - Order #${order.orderNumber}`,
            status: 'completed',
            metadata: {
              orderId: orderId,
              orderNumber: order.orderNumber,
              subtotal: sellerOrder.subtotal, // VAT-inclusive subtotal
              basePrice: sellerOrder.totalBasePrice || 0, // VAT-exclusive (seller revenue)
              shippingCost: sellerOrder.shippingCost,
              // Tax breakdown
              totalVAT: sellerOrder.totalVAT || 0,
              totalNHIL: sellerOrder.totalNHIL || 0,
              totalGETFund: sellerOrder.totalGETFund || 0,
              totalCovidLevy: sellerOrder.totalCovidLevy || 0,
              totalTax: sellerOrder.totalTax || 0,
              commissionRate: sellerOrder.commissionRate !== undefined 
                ? sellerOrder.commissionRate 
                : (settings.platformCommissionRate || 0),
              platformFee: (() => {
                const rate = sellerOrder.commissionRate !== undefined 
                  ? sellerOrder.commissionRate 
                  : (settings.platformCommissionRate || 0);
                if (rate === 0) return 0;
                return sellerEarnings * rate / (1 - rate); // Calculate platform fee from earnings
              })(),
              updatedBy,
            },
          },
        ],
        { session }
      );

      // Update seller order payout status
      sellerOrder.payoutStatus = 'paid';
      sellerOrder.sellerPaymentStatus = 'paid';
      await sellerOrder.save({ session });

      balanceUpdates.push({
        sellerId: sellerId.toString(),
        sellerName: seller.name || seller.shopName || 'Unknown',
        amount: sellerEarnings,
        transactionId: transaction[0]._id,
      });

      console.log(`[OrderService] Credited ${sellerEarnings} to seller ${sellerId} for order ${orderId}`);
    }

    // Mark order as seller credited to prevent double-crediting
    order.sellerCredited = true;
    
    // Update seller payout status on order
    order.sellerPayoutStatus = 'paid';
    
    // Calculate total seller payouts for this order
    const totalSellerPayouts = balanceUpdates.reduce((sum, update) => sum + update.amount, 0);
    
    // Revenue should already be added at payment time (not at delivery)
    // Only increment delivered orders count and products sold here
    // DO NOT add revenue again - it was added when payment was received
    if (!order.revenueAdded) {
      // This should only happen for legacy orders or payment_on_delivery orders
      // For credit_balance and Paystack, revenue is added at payment time
      const PlatformStats = require('../../models/platform/platformStatsModel');
      const orderTotal = order.totalPrice || 0;
      
      if (orderTotal > 0) {
        const platformStats = await PlatformStats.getStats();
        // Only add revenue if it wasn't added at payment time
        // This handles payment_on_delivery orders
        platformStats.totalRevenue = (platformStats.totalRevenue || 0) + orderTotal;
        platformStats.totalDeliveredOrders = (platformStats.totalDeliveredOrders || 0) + 1;
        
        // Deduct seller payouts from admin revenue
        if (totalSellerPayouts > 0) {
          platformStats.totalRevenue = Math.max(0, platformStats.totalRevenue - totalSellerPayouts);
          console.log(`[OrderService] Deducted GH₵${totalSellerPayouts.toFixed(2)} seller payouts from admin revenue for order ${orderId}`);
        }
        
        // Add to daily revenue tracking
        platformStats.addDailyRevenue(new Date(), orderTotal, 1);
        
        // Calculate total products sold from order items
        const totalQty = order.totalQty || 0;
        if (totalQty > 0) {
          platformStats.totalProductsSold = (platformStats.totalProductsSold || 0) + totalQty;
        }
        
        platformStats.lastUpdated = new Date();
        await platformStats.save({ session });
        
        console.log(`[OrderService] Added GH₵${orderTotal.toFixed(2)} to platform revenue for order ${orderId} (payment_on_delivery), then deducted GH₵${totalSellerPayouts.toFixed(2)} for seller payouts. Net: GH₵${(orderTotal - totalSellerPayouts).toFixed(2)}`);
      }
      
      // Mark order as revenue added to prevent double-counting
      order.revenueAdded = true;
    } else {
      // Revenue already added at payment time - deduct seller payouts and increment delivered orders count
      const PlatformStats = require('../../models/platform/platformStatsModel');
      const platformStats = await PlatformStats.getStats();
      
      // Deduct seller payouts from admin revenue
      if (totalSellerPayouts > 0) {
        const oldRevenue = platformStats.totalRevenue || 0;
        platformStats.totalRevenue = Math.max(0, oldRevenue - totalSellerPayouts);
        console.log(`[OrderService] Deducted GH₵${totalSellerPayouts.toFixed(2)} seller payouts from admin revenue for order ${orderId}. Revenue: GH₵${oldRevenue.toFixed(2)} → GH₵${platformStats.totalRevenue.toFixed(2)}`);
      }
      
      platformStats.totalDeliveredOrders = (platformStats.totalDeliveredOrders || 0) + 1;
      
      // Add to daily revenue tracking (only order count, not revenue)
      platformStats.addDailyRevenue(new Date(), 0, 1);
      
      // Calculate total products sold from order items
      const totalQty = order.totalQty || 0;
      if (totalQty > 0) {
        platformStats.totalProductsSold = (platformStats.totalProductsSold || 0) + totalQty;
      }
      
      platformStats.lastUpdated = new Date();
      await platformStats.save({ session });
      
      console.log(`[OrderService] Revenue already added at payment time for order ${orderId}. Deducted GH₵${totalSellerPayouts.toFixed(2)} for seller payouts, incremented delivered orders count`);
    }
    
    // Log seller payout activity
    const { logActivityAsync } = require('../../modules/activityLog/activityLog.service');
    for (const update of balanceUpdates) {
      logActivityAsync({
        userId: update.sellerId,
        role: 'seller',
        action: 'SELLER_PAYOUT',
        description: `Seller payout of GH₵${update.amount.toFixed(2)} for order #${order.orderNumber}`,
        req: null,
        metadata: {
          orderId: orderId,
          orderNumber: order.orderNumber,
          sellerId: update.sellerId,
          amount: update.amount,
          type: 'seller_payout',
        },
      });
    }
    
    await order.save({ session });

    // Reduce product inventory when order is delivered
    // Get all order items for this order
    const OrderItem = require('../../models/order/OrderItemModel');
    const orderItems = await OrderItem.find({ 
      _id: { $in: order.orderItems } 
    }).session(session);

    // Check if inventory was already reduced (prevent double reduction)
    const inventoryReduced = order.metadata?.inventoryReduced || false;
    
    if (!inventoryReduced) {
      console.log(`[OrderService] Reducing inventory for order ${orderId}`);
      
      for (const orderItem of orderItems) {
        const product = await Product.findById(orderItem.product).session(session);
        if (!product) {
          console.log(`[OrderService] Product ${orderItem.product} not found, skipping inventory reduction`);
          continue;
        }

        // Find the variant if it exists
        if (orderItem.variant && product.variants && product.variants.length > 0) {
          const variant = product.variants.id(orderItem.variant);
          if (variant) {
            // Check if stock is sufficient
            if (variant.stock >= orderItem.quantity) {
              variant.stock -= orderItem.quantity;
              console.log(`[OrderService] Reduced ${orderItem.quantity} from variant ${variant._id} of product ${product._id}. New stock: ${variant.stock}`);
            } else {
              console.warn(`[OrderService] Insufficient stock for variant ${variant._id}. Stock: ${variant.stock}, Requested: ${orderItem.quantity}`);
              // Still reduce to prevent negative stock issues, but log warning
              variant.stock = Math.max(0, variant.stock - orderItem.quantity);
            }
          } else {
            console.warn(`[OrderService] Variant ${orderItem.variant} not found in product ${product._id}`);
          }
        } else {
          // If no variant, reduce from product stock (if it exists)
          if (product.stock !== undefined && product.stock !== null) {
            if (product.stock >= orderItem.quantity) {
              product.stock -= orderItem.quantity;
              console.log(`[OrderService] Reduced ${orderItem.quantity} from product ${product._id}. New stock: ${product.stock}`);
            } else {
              console.warn(`[OrderService] Insufficient stock for product ${product._id}. Stock: ${product.stock}, Requested: ${orderItem.quantity}`);
              product.stock = Math.max(0, product.stock - orderItem.quantity);
            }
          }
        }

        await product.save({ session });
      }

      // Mark inventory as reduced in order metadata
      if (!order.metadata) {
        order.metadata = {};
      }
      order.metadata.inventoryReduced = true;
      order.metadata.inventoryReducedAt = new Date();
      await order.save({ session });
      
      console.log(`[OrderService] Inventory reduction completed for order ${orderId}`);
    } else {
      console.log(`[OrderService] Inventory already reduced for order ${orderId}, skipping`);
    }

    await session.commitTransaction();

    return {
      success: true,
      message: `Updated balances for ${balanceUpdates.length} seller(s)`,
      updates: balanceUpdates,
    };
  } catch (error) {
    await session.abortTransaction();
    console.error('[OrderService] Error updating seller balances:', error);
    throw error;
  } finally {
    session.endSession();
  }
};

/**
 * Revert seller balance when order is cancelled or refunded
 * @param {String} orderId - Order ID
 * @param {String} reason - Reason for reversal
 * @returns {Promise<Object>} - Summary of balance reversals
 */
exports.revertSellerBalancesOnRefund = async (orderId, reason = 'Order Refunded') => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Find all credit transactions for this order
    const transactions = await Transaction.find({
      order: orderId,
      type: 'credit',
      status: 'completed',
    }).session(session);

    if (transactions.length === 0) {
      await session.abortTransaction();
      return {
        success: false,
        message: 'No transactions found to revert',
        reversals: [],
      };
    }

    const reversals = [];

    for (const transaction of transactions) {
      const seller = await Seller.findById(transaction.seller).session(session);
      if (!seller) continue;

      // Check if seller has sufficient balance
      if ((seller.balance || 0) < transaction.amount) {
        console.log(`[OrderService] Insufficient balance to revert for seller ${transaction.seller}`);
        continue;
      }

      // Deduct from seller balance
      seller.balance = (seller.balance || 0) - transaction.amount;
      await seller.save({ session });

      // Create reversal transaction
      const reversalTransaction = await Transaction.create(
        [
          {
            seller: transaction.seller,
            sellerOrder: transaction.sellerOrder,
            type: 'debit',
            amount: transaction.amount,
            description: `Reversal: ${reason} - Order #${transaction.metadata?.orderNumber || orderId}`,
            status: 'completed',
            metadata: {
              originalTransactionId: transaction._id,
              orderId: orderId, // Store order ID in metadata for reference
              reason,
            },
          },
        ],
        { session }
      );

      // Update seller order payout status
      if (transaction.sellerOrder) {
        const sellerOrder = await SellerOrder.findById(transaction.sellerOrder).session(session);
        if (sellerOrder) {
          sellerOrder.payoutStatus = 'hold';
          await sellerOrder.save({ session });
        }
      }

      reversals.push({
        sellerId: transaction.seller.toString(),
        amount: transaction.amount,
        reversalTransactionId: reversalTransaction[0]._id,
      });
    }

    await session.commitTransaction();

    return {
      success: true,
      message: `Reverted balances for ${reversals.length} seller(s)`,
      reversals,
    };
  } catch (error) {
    await session.abortTransaction();
    console.error('[OrderService] Error reverting seller balances:', error);
    throw error;
  } finally {
    session.endSession();
  }
};

/**
 * Get seller earnings summary for an order
 * @param {String} orderId - Order ID
 * @returns {Promise<Array>} - Array of seller earnings
 */
exports.getSellerEarningsForOrder = async (orderId) => {
  const order = await Order.findById(orderId).populate({
    path: 'sellerOrder',
    populate: {
      path: 'seller',
      select: 'name shopName',
    },
  });

  if (!order) {
    throw new AppError('Order not found', 404);
  }

  const earnings = [];

  for (const sellerOrderId of order.sellerOrder) {
    const sellerOrder = await SellerOrder.findById(sellerOrderId);
    if (!sellerOrder) continue;

    const sellerEarnings = await calculateSellerEarnings(sellerOrder);
    const basePrice = sellerOrder.totalBasePrice || 0; // VAT-exclusive
    const shipping = sellerOrder.shippingCost || 0;
    const total = basePrice + shipping; // Seller revenue (VAT exclusive)
    const platformFee = total * (sellerOrder.commissionRate || 0);

    earnings.push({
      sellerId: sellerOrder.seller._id || sellerOrder.seller,
      sellerName: sellerOrder.seller?.name || sellerOrder.seller?.shopName || 'Unknown',
      subtotal: sellerOrder.subtotal || 0, // VAT-inclusive (for display)
      basePrice: basePrice, // VAT-exclusive (seller revenue)
      shippingCost: shipping,
      // Tax breakdown
      totalVAT: sellerOrder.totalVAT || 0,
      totalNHIL: sellerOrder.totalNHIL || 0,
      totalGETFund: sellerOrder.totalGETFund || 0,
      totalCovidLevy: sellerOrder.totalCovidLevy || 0,
      totalTax: sellerOrder.totalTax || 0,
      total,
      commissionRate,
      platformFee,
      sellerEarnings,
      payoutStatus: sellerOrder.payoutStatus,
    });
  }

  return earnings;
};

// Keep old function name for backward compatibility, but it now only credits on delivered
exports.updateSellerBalancesOnOrderCompletion = exports.creditSellerForOrder;

module.exports = {
  creditSellerForOrder: exports.creditSellerForOrder,
  updateSellerBalancesOnOrderCompletion: exports.creditSellerForOrder, // Alias for backward compatibility
  revertSellerBalancesOnRefund: exports.revertSellerBalancesOnRefund,
  getSellerEarningsForOrder: exports.getSellerEarningsForOrder,
  calculateSellerEarnings,
};

