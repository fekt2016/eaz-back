const Order = require('../../models/order/orderModel');
const SellerOrder = require('../../models/order/sellerOrderModel');
const Seller = require('../../models/user/sellerModel');
const Transaction = require('../../models/transaction/transactionModel');
const Product = require('../../models/product/productModel');
const OrderItem = require('../../models/order/OrderItemModel');
const SellerRevenueHistory = require('../../models/history/sellerRevenueHistoryModel');
const mongoose = require('mongoose');
const AppError = require('../../utils/errors/appError');
const logger = require('../../utils/logger');
const { logSellerRevenue } = require('../historyLogger');
const shippingChargeService = require('../shippingChargeService');
const emailDispatcher = require('../../emails/emailDispatcher');

/** Platform store (EazShop) seller ID – orders with this seller credit actual suppliers via Product.supplierSeller */
const EAZSHOP_SELLER_ID = '6970b22eaba06cadfd4b8035';

/**
 * Load seller by ID including inactive (aggregate bypasses pre('find') so we can credit deactivated sellers).
 * @param {ObjectId|string} sellerId
 * @param {ClientSession} session
 * @returns {Promise<Object|null>} Plain seller object or null
 */
const getSellerByIdIncludingInactive = async (sellerId, session) => {
  if (!sellerId) return null;
  const id = mongoose.Types.ObjectId.isValid(sellerId) ? (typeof sellerId === 'string' ? sellerId : sellerId.toString()) : null;
  if (!id) return null;
  const docs = await Seller.aggregate([{ $match: { _id: new mongoose.Types.ObjectId(id) } }]).session(session).exec();
  return docs.length ? docs[0] : null;
};

/**
 * Calculate seller earnings for a seller order
 * @param {Object} sellerOrder - SellerOrder document
 * @returns {Number} - Seller earnings amount
 */
/**
 * Calculate seller earnings (dual VAT model, Ghana).
 *
 * BUSINESS RULE (your requirement):
 * - **Only the item amount** should be credited to the seller.
 * - **Shipping charges must NOT be credited** to the seller at all.
 *
 * Implementation:
 * - Ignore shipping completely in the payout formula.
 * - Commission and VAT on commission are applied **only on items**, not shipping.
 *
 * - vatCollectedBy === 'seller': seller is VAT registered → payout = subtotal − commission − VAT on commission.
 * - vatCollectedBy === 'platform': seller not registered → payout = basePrice − commission − VAT on commission.
 *
 * @param {Object} sellerOrder - SellerOrder document (must have vatCollectedBy, totalBasePrice, subtotal, shippingCost)
 * @returns {Number} - Amount to credit to seller (items only, no shipping)
 */
const calculateSellerEarnings = async (sellerOrder) => {
  const PlatformSettings = require('../../models/platform/platformSettingsModel');
  const settings = await PlatformSettings.getSettings();

  const platformCommissionRate = settings.platformCommissionRate || 0;
  const vatRateForCommission = settings.vatRate ?? 0.15;

  // Use explicit commissionRate on sellerOrder when present; otherwise platform default
  const commissionRate = sellerOrder.commissionRate !== undefined
    ? sellerOrder.commissionRate
    : platformCommissionRate;

  // 1) Determine the revenue base for the seller (items only, no shipping)
  //    - For VAT-registered sellers: subtotal is VAT-inclusive item amount seen by buyer.
  //    - For non-VAT: totalBasePrice is item revenue before VAT (platform withholds VAT).
  const isVatSeller = sellerOrder.vatCollectedBy === 'seller';
  const itemRevenue = isVatSeller
    ? (sellerOrder.subtotal || 0)          // VAT-inclusive items
    : (sellerOrder.totalBasePrice || 0);   // VAT-exclusive items

  // 2) Commission is charged ONLY on item revenue (no shipping)
  const commissionAmount = Math.round(itemRevenue * commissionRate * 100) / 100;

  // 3) VAT on commission (platform's commission is itself VAT-able)
  const vatOnComm = Math.round(commissionAmount * vatRateForCommission * 100) / 100;

  // 4) Seller earnings = item revenue − commission − VAT on commission
  const earnings = itemRevenue - commissionAmount - vatOnComm;

  // Round to 2 decimals
  return Math.round(earnings * 100) / 100;
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

    // CRITICAL: Only credit when order is DELIVERED (currentStatus, or legacy orderStatus/status)
    const isDelivered =
      order.currentStatus === 'delivered' ||
      order.currentStatus === 'delievered' ||
      order.orderStatus === 'delievered' ||
      order.status === 'completed';
    if (!isDelivered) {
      await session.abortTransaction();
      return {
        success: false,
        message: `Order is not delivered yet. Current status: ${order.currentStatus}. Sellers are only credited when order status is "delivered".`,
        updates: [],
      };
    }
    // Normalize: if delivered only via legacy fields, set currentStatus so document is consistent
    if (order.currentStatus !== 'delivered' && order.currentStatus !== 'delievered') {
      order.currentStatus = 'delivered';
      order.orderStatus = 'delievered';
      order.FulfillmentStatus = 'delievered';
      order.status = 'completed';
    }

    // Process each seller order (sellerOrder may be populated docs or IDs)
    const sellerOrderRefs = Array.isArray(order.sellerOrder) ? order.sellerOrder : [];
    const sellerOrderIds = sellerOrderRefs.map((ref) => ref && (ref._id || ref)).filter(Boolean);

    // Prevent double-crediting: if sellerCredited is true, only skip when we have proof (a completed credit transaction)
    if (order.sellerCredited && sellerOrderIds.length > 0) {
      const existingCreditCount = await Transaction.countDocuments({
        sellerOrder: { $in: sellerOrderIds },
        type: 'credit',
        status: 'completed',
      }).session(session);
      if (existingCreditCount > 0) {
        // Sync payout status to 'paid' for SellerOrders that were credited but still show pending
        for (const soId of sellerOrderIds) {
          const hasTransaction = await Transaction.exists({
            sellerOrder: soId,
            type: 'credit',
            status: 'completed',
          }).session(session);
          if (hasTransaction) {
            const so = await SellerOrder.findById(soId).session(session);
            if (so && (so.payoutStatus !== 'paid' || so.sellerPaymentStatus !== 'paid')) {
              so.payoutStatus = 'paid';
              so.sellerPaymentStatus = 'paid';
              await so.save({ session });
              logger.info(`[OrderService] Synced SellerOrder ${soId} payout status to paid (order ${orderId})`);
            }
          }
        }
        if (order.sellerPayoutStatus !== 'paid') {
          order.sellerPayoutStatus = 'paid';
          await order.save({ session });
        }
        await session.commitTransaction();
        return {
          success: false,
          message: 'Sellers have already been credited for this order; payout status synced to paid',
          updates: [],
        };
      }
      logger.info(`[OrderService] Order ${orderId} had sellerCredited=true but no credit transactions; crediting (fixing inconsistent state)`);
    }

    if (sellerOrderRefs.length === 0) {
      await session.abortTransaction();
      return {
        success: false,
        message: 'Order has no seller orders to credit',
        updates: [],
      };
    }

    // Load platform settings once (used in Transaction metadata and logSellerRevenue)
    const PlatformSettings = require('../../models/platform/platformSettingsModel');
    const settings = await PlatformSettings.getSettings();

    const balanceUpdates = [];
    for (const ref of sellerOrderRefs) {
      const sellerOrderId = ref && (ref._id || ref);
      if (!sellerOrderId) continue;
      // Do NOT populate seller: we need the raw ObjectId so inactive sellers are still credited
      const sellerOrder = await SellerOrder.findById(sellerOrderId).session(session);

      if (!sellerOrder) {
        logger.warn(`[OrderService] Skipping credit for order ${orderId}: SellerOrder ${sellerOrderId} not found`);
        continue;
      }
      const rawSellerRef = sellerOrder.seller;
      if (!rawSellerRef) {
        logger.warn(`[OrderService] Skipping credit for order ${orderId}: SellerOrder ${sellerOrderId} has no seller reference`);
        continue;
      }
      const sellerId = rawSellerRef._id || rawSellerRef;
      const sellerIdStr = sellerId.toString();

      // Additional check: Verify transaction doesn't already exist (extra safety)
      const existingTransaction = await Transaction.findOne({
        sellerOrder: sellerOrder._id,
        type: 'credit',
        status: 'completed',
      }).session(session);

      if (existingTransaction) {
        logger.warn(`[OrderService] Skipping credit for seller ${sellerId} (order ${orderId}): transaction already exists - seller may have been credited earlier`);
        continue;
      }

      // --- Platform store (EazShop): identify by seller ID or sellerType; credit actual suppliers (Product.supplierSeller).
      // Additionally, credit EazShop itself when there is no supplierSeller configured (platform-owned stock)
      // or when a portion of the earnings is not mapped to any supplier (unassignedShare). ---
      const isEazShopOrder = sellerIdStr === EAZSHOP_SELLER_ID || (sellerOrder.sellerType && String(sellerOrder.sellerType).toLowerCase() === 'eazshop');
      if (isEazShopOrder) {
        const totalEarnings = await calculateSellerEarnings(sellerOrder);
        if (totalEarnings <= 0) {
          logger.warn(`[OrderService] EazShop SellerOrder ${sellerOrderId} has zero/negative earnings, skipping`);
          continue;
        }
        const itemIds = Array.isArray(sellerOrder.items) ? sellerOrder.items : [];
        if (itemIds.length === 0) {
          logger.warn(`[OrderService] EazShop SellerOrder ${sellerOrderId} has no items, skipping`);
          continue;
        }
        const orderItems = await OrderItem.find({ _id: { $in: itemIds } }).session(session).lean();
        const totalBasePrice = (sellerOrder.totalBasePrice || 0) || 1;
        const supplierToAmount = new Map(); // supplierId (string) -> raw amount to credit (sum of shares)
        let unassignedShare = 0;
        for (const item of orderItems) {
          const itemBase = (item.basePrice || 0) * (item.quantity || 1);
          const share = totalBasePrice > 0 ? (itemBase / totalBasePrice) * totalEarnings : totalEarnings / orderItems.length;
          const product = await Product.findById(item.product).select('supplierSeller name').session(session).lean();
          const supplierId = product?.supplierSeller ? (product.supplierSeller._id || product.supplierSeller).toString() : null;
          if (supplierId) {
            supplierToAmount.set(supplierId, (supplierToAmount.get(supplierId) || 0) + share);
          } else {
            unassignedShare += share;
            logger.warn(`[OrderService] EazShop product has no supplierSeller – set Product.supplierSeller so the supplier can be credited. Product id=${item.product}, name=${product?.name || 'n/a'}`);
          }
        }

        // If there are NO suppliers at all but there is unassignedShare, this is effectively
        // EazShop-owned inventory. Credit EazShop itself for the full seller earnings.
        if (supplierToAmount.size === 0 && unassignedShare > 0) {
          const amount = Math.round(unassignedShare * 100) / 100;
          const eazshopSeller = await getSellerByIdIncludingInactive(sellerId, session);
          if (!eazshopSeller) {
            logger.warn(`[OrderService] EazShop seller ${sellerIdStr} not found, skipping credit of ${amount} for order ${orderId}`);
          } else {
            const oldBal = eazshopSeller.balance || 0;
            const newBal = Math.round((oldBal + amount) * 100) / 100;
            const newWithdrawable = Math.max(0, newBal - (eazshopSeller.lockedBalance || 0));
            await Seller.updateOne(
              { _id: sellerId },
              { $set: { balance: newBal, withdrawableBalance: newWithdrawable } },
              { session }
            );
            const [tx] = await Transaction.create([{
              seller: sellerId,
              order: orderId,
              sellerOrder: sellerOrder._id,
              source: 'order_delivery',
              type: 'credit',
              amount,
              description: `Order Delivered (EazShop) — EazShop credited (no supplierSeller) - Order #${order.orderNumber}`,
              status: 'completed',
              metadata: {
                orderNumber: order.orderNumber,
                platformStore: true,
                updatedBy,
                eazshopCreditReason: 'no_supplier_seller',
              },
            }], { session });
            try {
              await logSellerRevenue({
                sellerId,
                amount,
                type: 'ORDER_EARNING',
                description: `EazShop earnings from platform store order #${order.orderNumber}`,
                reference: `ORDER-${order.orderNumber}-${sellerIdStr}`,
                orderId: mongoose.Types.ObjectId(orderId),
                balanceBefore: oldBal,
                balanceAfter: newBal,
                session,
                metadata: { orderNumber: order.orderNumber, platformStore: true, noSupplierSeller: true },
              });
            } catch (e) {
              logger.error(`[OrderService] logSellerRevenue failed for EazShop ${sellerIdStr}:`, e.message);
            }
            balanceUpdates.push({
              sellerId: sellerIdStr,
              sellerName: eazshopSeller.name || eazshopSeller.shopName || 'EazShop',
              amount,
              transactionId: tx?._id,
            });
            sellerOrder.payoutStatus = 'paid';
            sellerOrder.sellerPaymentStatus = 'paid';
            await sellerOrder.save({ session });
          }
          // Nothing else to credit in this sellerOrder, continue to next
          continue;
        }

        // Build audit breakdown: amount each supplier is entitled to (rounded)
        const supplierBreakdown = {};
        for (const [supId, rawAmount] of supplierToAmount) {
          supplierBreakdown[supId] = Math.round(rawAmount * 100) / 100;
        }
        if (unassignedShare > 0) {
          supplierBreakdown._unassigned = Math.round(unassignedShare * 100) / 100;
        }
        // Credit each supplier (round amount per supplier to avoid cumulative rounding errors)
        let creditedAny = false;
        for (const [supId, rawAmount] of supplierToAmount) {
          const amount = Math.round(rawAmount * 100) / 100;
          if (amount <= 0) continue;
          const existingSupTx = await Transaction.findOne({
            sellerOrder: sellerOrder._id,
            seller: supId,
            type: 'credit',
            status: 'completed',
          }).session(session);
          if (existingSupTx) {
            logger.warn(`[OrderService] Supplier ${supId} already credited for EazShop SellerOrder ${sellerOrderId}`);
            creditedAny = true;
            continue;
          }
          const supplier = await getSellerByIdIncludingInactive(supId, session);
          if (!supplier) {
            logger.warn(`[OrderService] Supplier ${supId} not found, skipping credit for EazShop order`);
            continue;
          }
          const oldBal = supplier.balance || 0;
          const newBal = Math.round((oldBal + amount) * 100) / 100;
          const newWithdrawable = Math.max(0, newBal - (supplier.lockedBalance || 0));
          await Seller.updateOne(
            { _id: supId },
            { $set: { balance: newBal, withdrawableBalance: newWithdrawable } },
            { session }
          );
          const [tx] = await Transaction.create([{
            seller: supId,
            order: orderId,
            sellerOrder: sellerOrder._id,
            source: 'order_delivery',
            type: 'credit',
            amount,
            description: `Order Delivered (EazShop) — Supplier credited - Order #${order.orderNumber}`,
            status: 'completed',
            metadata: {
              orderNumber: order.orderNumber,
              platformStore: true,
              updatedBy,
              supplierAmountEntitled: amount,
              supplierBreakdown,
            },
          }], { session });
          try {
            await logSellerRevenue({
              sellerId: supId,
              amount,
              type: 'ORDER_EARNING',
              description: `Earnings from EazShop order #${order.orderNumber}`,
              reference: `ORDER-${order.orderNumber}-${supId}`,
              orderId: mongoose.Types.ObjectId(orderId),
              balanceBefore: oldBal,
              balanceAfter: newBal,
              session,
              metadata: { orderNumber: order.orderNumber, platformStore: true },
            });
          } catch (e) {
            logger.error(`[OrderService] logSellerRevenue failed for supplier ${supId}:`, e.message);
          }
          balanceUpdates.push({ sellerId: supId, sellerName: supplier.name || supplier.shopName || 'Supplier', amount, transactionId: tx?._id });
          creditedAny = true;
          logger.info(`[OrderService] Credited supplier ${supId} amount ${amount} for EazShop order ${orderId}`);
        }

        // If part of the earnings was not mapped to any supplier (unassignedShare),
        // credit that remainder to EazShop itself so 100% of the seller earnings are accounted for.
        if (unassignedShare > 0) {
          const amount = Math.round(unassignedShare * 100) / 100;
          const eazshopSeller = await getSellerByIdIncludingInactive(sellerId, session);
          if (!eazshopSeller) {
            logger.warn(`[OrderService] EazShop seller ${sellerIdStr} not found for unassignedShare ${amount}, skipping credit for order ${orderId}`);
          } else {
            const oldBal = eazshopSeller.balance || 0;
            const newBal = Math.round((oldBal + amount) * 100) / 100;
            const newWithdrawable = Math.max(0, newBal - (eazshopSeller.lockedBalance || 0));
            await Seller.updateOne(
              { _id: sellerId },
              { $set: { balance: newBal, withdrawableBalance: newWithdrawable } },
              { session }
            );
            const [tx] = await Transaction.create([{
              seller: sellerId,
              order: orderId,
              sellerOrder: sellerOrder._id,
              source: 'order_delivery',
              type: 'credit',
              amount,
              description: `Order Delivered (EazShop) — EazShop credited (unassigned share) - Order #${order.orderNumber}`,
              status: 'completed',
              metadata: {
                orderNumber: order.orderNumber,
                platformStore: true,
                updatedBy,
                eazshopCreditReason: 'unassigned_share',
                supplierBreakdown,
              },
            }], { session });
            try {
              await logSellerRevenue({
                sellerId,
                amount,
                type: 'ORDER_EARNING',
                description: `EazShop earnings (unassigned share) from platform store order #${order.orderNumber}`,
                reference: `ORDER-${order.orderNumber}-${sellerIdStr}-UNASSIGNED`,
                orderId: mongoose.Types.ObjectId(orderId),
                balanceBefore: oldBal,
                balanceAfter: newBal,
                session,
                metadata: { orderNumber: order.orderNumber, platformStore: true, unassignedShare: true },
              });
            } catch (e) {
              logger.error(`[OrderService] logSellerRevenue failed for EazShop (unassigned share) ${sellerIdStr}:`, e.message);
            }
            balanceUpdates.push({
              sellerId: sellerIdStr,
              sellerName: eazshopSeller.name || eazshopSeller.shopName || 'EazShop',
              amount,
              transactionId: tx?._id,
            });
            creditedAny = true;
            logger.info(`[OrderService] Credited EazShop ${sellerIdStr} amount ${amount} (unassigned share) for EazShop order ${orderId}`);
          }
        }

        if (creditedAny) {
          sellerOrder.payoutStatus = 'paid';
          sellerOrder.sellerPaymentStatus = 'paid';
          await sellerOrder.save({ session });
        }
        continue;
      }

      // Calculate seller earnings (regular seller, not platform store)
      const sellerEarnings = await calculateSellerEarnings(sellerOrder);

      if (sellerEarnings <= 0) {
        logger.warn(`[OrderService] Skipping credit for seller ${sellerId} (order ${orderId}): zero or negative earnings (${sellerEarnings}) - check sellerOrder totalBasePrice/shippingCost/commission`);
        continue;
      }

      // Load seller including inactive (aggregate bypasses pre('find') so deactivated sellers still get credited)
      const seller = await getSellerByIdIncludingInactive(sellerId, session);
      if (!seller) {
        logger.warn(`[OrderService] Skipping credit for seller ${sellerId} (order ${orderId}): seller document not found`);
        continue;
      }

      const oldBalance = seller.balance || 0;
      const oldWithdrawableBalance = seller.withdrawableBalance || 0;
      const sellerName = seller.name || seller.shopName || sellerId;
      const newBalance = Math.round((oldBalance + sellerEarnings) * 100) / 100;
      const newWithdrawableBalance = Math.max(0, newBalance - (seller.lockedBalance || 0));

      logger.info(`[OrderService] Seller ${sellerId} (${sellerName}) balance update: ${oldBalance} + ${sellerEarnings} → ${newBalance}`);
      console.log(`[OrderService] SELLER BALANCE (order ${order.orderNumber}): sellerId=${sellerId} (${sellerName}) | oldBalance=${oldBalance} | earnings=${sellerEarnings} | newBalance=${newBalance}`);

      await Seller.updateOne(
        { _id: sellerId },
        { $set: { balance: newBalance, withdrawableBalance: newWithdrawableBalance } },
        { session }
      );

      // Create transaction record (include VAT withheld for admin audit when seller not VAT registered)
      const vatCollectedBy = sellerOrder.vatCollectedBy || 'platform';
      const totalVatAmount = sellerOrder.totalVatAmount != null ? sellerOrder.totalVatAmount : 0;
      const vatWithheld = vatCollectedBy === 'platform' ? totalVatAmount : 0;

      const transaction = await Transaction.create(
        [
          {
            seller: sellerId,
            order: orderId,
            sellerOrder: sellerOrder._id,
            source: 'order_delivery',
            type: 'credit',
            amount: sellerEarnings,
            description: `Order Delivered — Seller Earnings Credited - Order #${order.orderNumber}`,
            status: 'completed',
            metadata: {
              orderNumber: order.orderNumber,
              subtotal: sellerOrder.subtotal,
              basePrice: sellerOrder.totalBasePrice || 0,
              shippingCost: sellerOrder.shippingCost,
              totalVAT: sellerOrder.totalVAT || 0,
              totalNHIL: sellerOrder.totalNHIL || 0,
              totalGETFund: sellerOrder.totalGETFund || 0,
              totalTax: sellerOrder.totalTax || 0,
              vatCollectedBy,
              totalVatAmount,
              vatWithheld,
              commissionRate: sellerOrder.commissionRate !== undefined
                ? sellerOrder.commissionRate
                : (settings.platformCommissionRate || 0),
              platformFee: (() => {
                const rate = sellerOrder.commissionRate !== undefined
                  ? sellerOrder.commissionRate
                  : (settings.platformCommissionRate || 0);
                if (rate === 0) return 0;
                return sellerEarnings * rate / (1 - rate);
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

      // Log seller revenue history with correct balance values
      const balanceBeforeValue = oldBalance;
      const balanceAfterValue = newBalance;

      try {
        await logSellerRevenue({
          sellerId,
          amount: sellerEarnings,
          type: 'ORDER_EARNING',
          description: `Earnings received from order #${order.orderNumber}`,
          reference: `ORDER-${order.orderNumber}-${sellerId}`,
          orderId: mongoose.Types.ObjectId(orderId),
          balanceBefore: balanceBeforeValue,
          balanceAfter: balanceAfterValue,
          session,
          metadata: {
            orderNumber: order.orderNumber,
            sellerEarnings,
            commissionRate: sellerOrder.commissionRate !== undefined
              ? sellerOrder.commissionRate
              : (settings.platformCommissionRate || 0),
            basePrice: sellerOrder.totalBasePrice || 0,
            shippingCost: sellerOrder.shippingCost,
          },
        });
        logger.info(`[OrderService] ✅ Seller revenue history logged for seller ${sellerId}`);
      } catch (historyError) {
        // Log error but don't fail the transaction
        logger.error(`[OrderService] Failed to log seller revenue history (non-critical); for seller ${sellerId}:`, {
          error: historyError.message,
          stack: historyError.stack,
        });
      }

      logger.info(`[OrderService] Credited ${sellerEarnings} to seller ${sellerId} for order ${orderId}`);
    }

    // Only mark order as seller credited if we actually credited at least one seller
    // Otherwise backfill (or retry) can credit later; do not set sellerCredited so it stays eligible
    const noSellersCredited = balanceUpdates.length === 0;
    if (noSellersCredited) {
      logger.warn(`[OrderService] No sellers were credited for order ${orderId} (all skipped: already credited, zero earnings, or seller not found). Order left unmarked so backfill can retry.`);
      // IMPORTANT: Do NOT abort here — we still need to record shipping revenue for the platform.
      // Fall-through to shipping charge recording below.
    }

    // Only mark order as seller credited if we actually credited at least one seller
    if (!noSellersCredited) {
      order.sellerCredited = true;
      order.sellerPayoutStatus = 'paid';
    }

    // Calculate total seller payouts for this order
    const totalSellerPayouts = noSellersCredited ? 0 : balanceUpdates.reduce((sum, update) => sum + update.amount, 0);

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
          logger.info(`[OrderService] Deducted GH₵${totalSellerPayouts.toFixed(2)} seller payouts from admin revenue for order ${orderId}`);
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

        logger.info(`[OrderService] Added GH₵${orderTotal.toFixed(2)} to platform revenue for order ${orderId} (payment_on_delivery), then deducted GH₵${totalSellerPayouts.toFixed(2)} for seller payouts. Net: GH₵${(orderTotal - totalSellerPayouts).toFixed(2)}`);
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
        logger.info(`[OrderService] Deducted GH₵${totalSellerPayouts.toFixed(2)} seller payouts from admin revenue for order ${orderId}. Revenue: GH₵${oldRevenue.toFixed(2)} → GH₵${platformStats.totalRevenue.toFixed(2)}`);
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

      logger.info(`[OrderService] Revenue already added at payment time for order ${orderId}. Deducted GH₵${totalSellerPayouts.toFixed(2)} for seller payouts, incremented delivered orders count`);
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

    try {
      // Create shipping charge record — always run for delivered orders, independently of seller payout status
      await shippingChargeService.createShippingChargeRecord(orderId, session);
      order.shippingChargeRecorded = true;
      logger.info(`[OrderService] Created shipping charge record for delivered order ${orderId}`);
    } catch (shippingErr) {
      // Must not block the delivery completion
      logger.error(`[OrderService] Failed to create shipping charge for order ${orderId}: ${shippingErr.message}`);
    }

    // If no sellers were credited, commit whatever we have (shipping revenue) and return a partial-success
    if (noSellersCredited) {
      await order.save({ session });
      await session.commitTransaction();
      return {
        success: false,
        message: 'No sellers were credited (already credited, zero earnings, or seller not found). Order not marked as sellerCredited so backfill can retry. Shipping revenue was recorded.',
        updates: [],
      };
    }

    await order.save({ session });

    // NOTE: Stock reduction happens AFTER payment confirmation, not on delivery
    // Stock is reduced in paymentController.verifyPaystackPayment and paymentController.paystackWebhook
    // This function only credits seller balances when order is delivered
    const inventoryReduced = order.metadata?.inventoryReduced || false;
    if (!inventoryReduced) {
      console.warn(`[OrderService] ⚠️ Order ${orderId} delivered but inventory was not reduced. This may indicate a payment flow issue.`);
      // Don't reduce stock here - stock should have been reduced after payment
      // If it wasn't, it's a bug that needs investigation
    }

    await session.commitTransaction();

    // Post-commit: send seller credit emails (best-effort, non-blocking).
    try {
      const creditBySeller = new Map();
      for (const update of balanceUpdates) {
        if (!update?.sellerId) continue;
        const current = creditBySeller.get(update.sellerId) || 0;
        creditBySeller.set(update.sellerId, current + Number(update.amount || 0));
      }
      const sellerIds = [...creditBySeller.keys()];
      if (sellerIds.length > 0) {
        const sellers = await Seller.find({ _id: { $in: sellerIds } })
          .select('_id email name shopName')
          .lean();
        const sellerById = new Map(
          sellers.map((s) => [s._id.toString(), s]),
        );
        const User = require('../../models/user/userModel');
        const buyer = await User.findById(order.user)
          .select('_id email name')
          .lean();

        setImmediate(async () => {
          // Buyer delivery email
          if (buyer?.email) {
            try {
              await emailDispatcher.sendOrderDelivered(order, buyer);
            } catch (buyerEmailError) {
              logger.error(
                `[OrderService] Failed sending buyer delivered email for order ${orderId}: ${buyerEmailError?.message || buyerEmailError}`,
              );
            }
          }

          // Seller credit emails
          for (const [sellerId, amount] of creditBySeller.entries()) {
            const seller = sellerById.get(sellerId);
            if (!seller?.email || Number(amount) <= 0) continue;
            try {
              await emailDispatcher.sendSellerCreditAlert(
                seller,
                order,
                Math.round(Number(amount) * 100) / 100,
              );
            } catch (emailError) {
              logger.error(
                `[OrderService] Failed sending seller credit email to ${sellerId}: ${emailError?.message || emailError}`,
              );
            }
          }
        });
      }
    } catch (postCommitEmailError) {
      logger.error(
        `[OrderService] Error preparing seller credit emails for order ${orderId}: ${postCommitEmailError?.message || postCommitEmailError}`,
      );
    }

    // After commit: re-fetch sellers and log balance so we verify persistence (no session)
    for (const u of balanceUpdates) {
      const sellerAfter = await Seller.findById(u.sellerId).select('balance withdrawableBalance name shopName').lean();
      if (sellerAfter) {
        console.log(`[OrderService] AFTER COMMIT - Seller ${u.sellerId} (${sellerAfter.name || sellerAfter.shopName}): balance=${sellerAfter.balance}, withdrawableBalance=${sellerAfter.withdrawableBalance}`);
      } else {
        console.warn(`[OrderService] AFTER COMMIT - Seller ${u.sellerId} not found`);
      }
    }

    return {
      success: true,
      message: `Updated balances for ${balanceUpdates.length} seller(s)`,
      updates: balanceUpdates,
    };
  } catch (error) {
    await session.abortTransaction();
    logger.error('[OrderService] Error updating seller balances:', error);
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
        logger.info(`[OrderService] Insufficient balance to revert for seller ${transaction.seller}`);
        continue;
      }

      // Get balance before reversal
      const balanceBefore = seller.balance || 0;

      // Deduct from seller balance
      seller.balance = balanceBefore - transaction.amount;
      await seller.save({ session });

      // Log seller revenue history with correct balance values
      const order = await Order.findById(orderId).session(session);
      const balanceAfter = seller.balance;

      try {
        await logSellerRevenue({
          sellerId: transaction.seller,
          amount: -transaction.amount, // Negative for deduction
          type: 'REFUND_DEDUCTION',
          description: `Refund deduction for order #${order?.orderNumber || orderId}`,
          reference: `REFUND-${orderId}-${transaction.seller}-${Date.now()}`,
          orderId: mongoose.Types.ObjectId(orderId),
          balanceBefore,
          balanceAfter,
          session,
          metadata: {
            reason,
            originalTransactionId: transaction._id.toString(),
            orderNumber: order?.orderNumber,
          },
        });
        logger.info(`[OrderService] ✅ Seller revenue history logged for refund - seller ${transaction.seller}`);
      } catch (historyError) {
        logger.error(`[OrderService] Failed to log seller revenue history (non-critical); for seller ${transaction.seller}:`, {
          error: historyError.message,
          stack: historyError.stack,
        });
      }

      // Create reversal transaction
      const reversalTransaction = await Transaction.create(
        [
          {
            seller: transaction.seller,
            order: orderId,
            sellerOrder: transaction.sellerOrder,
            source: 'refund_reversal',
            type: 'debit',
            amount: transaction.amount,
            description: `Reversal: ${reason} - Order #${transaction.metadata?.orderNumber || orderId}`,
            status: 'completed',
            metadata: {
              originalTransactionId: transaction._id,
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

    try {
      await shippingChargeService.refundShippingCharge(orderId, session);
      logger.info(`[OrderService] Marked shipping charge as refunded for order ${orderId}`);
    } catch (shippingErr) {
      logger.error(`[OrderService] Failed to refund shipping charge for order ${orderId}: ${shippingErr.message}`);
    }

    await session.commitTransaction();

    return {
      success: true,
      message: `Reverted balances for ${reversals.length} seller(s)`,
      reversals,
    };
  } catch (error) {
    await session.abortTransaction();
    logger.error('[OrderService] Error reverting seller balances:', error);
    throw error;
  } finally {
    session.endSession();
  }
};

/**
 * Revert seller balance for specific items in an order (item-level refund)
 * @param {String} orderId - Order ID
 * @param {Array} refundItems - Array of { orderItemId, sellerId, refundAmount, quantity }
 * @param {String} reason - Reason for reversal
 * @returns {Promise<Object>} - Summary of balance reversals
 */
exports.revertSellerBalancesForItems = async (orderId, refundItems, reason = 'Item Refunded') => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (!refundItems || refundItems.length === 0) {
      await session.abortTransaction();
      return {
        success: false,
        message: 'No items to revert',
        reversals: [],
      };
    }

    const reversals = [];
    const sellerRefundMap = new Map(); // Group by seller

    // Group refunds by seller
    for (const item of refundItems) {
      const sellerId = item.sellerId.toString();
      if (!sellerRefundMap.has(sellerId)) {
        sellerRefundMap.set(sellerId, {
          sellerId: item.sellerId,
          totalAmount: 0,
          items: [],
        });
      }
      const sellerRefund = sellerRefundMap.get(sellerId);
      sellerRefund.totalAmount += item.refundAmount;
      sellerRefund.items.push(item);
    }

    // Process each seller
    for (const [sellerIdStr, sellerRefund] of sellerRefundMap) {
      const seller = await Seller.findById(sellerRefund.sellerId).session(session);
      if (!seller) {
        logger.info(`[OrderService] Seller ${sellerIdStr} not found for item refund`);
        continue;
      }

      const refundAmount = sellerRefund.totalAmount;

      // Get balance before reversal
      const balanceBefore = seller.balance || 0;

      // Check if seller has sufficient balance
      if (balanceBefore < refundAmount) {
        // If insufficient, track negative balance
        const deficit = refundAmount - balanceBefore;
        seller.balance = 0;
        seller.negativeBalance = (seller.negativeBalance || 0) + deficit;
        logger.info(`[OrderService] Insufficient balance for seller ${sellerIdStr}. Deficit: ${deficit}. Negative balance: ${seller.negativeBalance}`);
      } else {
        // Deduct from seller balance
        seller.balance = balanceBefore - refundAmount;
      }
      await seller.save({ session });

      // Log seller revenue history with correct balance values
      const order = await Order.findById(orderId).session(session);
      const balanceAfter = seller.balance;

      try {
        await logSellerRevenue({
          sellerId: sellerRefund.sellerId,
          amount: -refundAmount, // Negative for deduction
          type: 'REFUND_DEDUCTION',
          description: `Refund deduction for order #${order?.orderNumber || orderId} (${sellerRefund.items.length} items)`,
          reference: `REFUND-ITEMS-${orderId}-${sellerIdStr}-${Date.now()}`,
          orderId: mongoose.Types.ObjectId(orderId),
          balanceBefore,
          balanceAfter,
          session,
          metadata: {
            reason,
            refundItems: sellerRefund.items.map(item => ({
              orderItemId: item.orderItemId?.toString(),
              quantity: item.quantity,
              refundAmount: item.refundAmount,
            })),
            orderNumber: order?.orderNumber,
          },
        });
        logger.info(`[OrderService] ✅ Seller revenue history logged for item refund - seller ${sellerIdStr}`);
      } catch (historyError) {
        logger.error(`[OrderService] Failed to log seller revenue history (non-critical); for seller ${sellerIdStr}:`, {
          error: historyError.message,
          stack: historyError.stack,
        });
      }

      // Find the original credit transaction for this seller and order
      const originalTransaction = await Transaction.findOne({
        order: orderId,
        seller: sellerRefund.sellerId,
        type: 'credit',
        status: 'completed',
      }).sort({ createdAt: -1 }).session(session);

      // Create reversal transaction
      const reversalTransaction = await Transaction.create(
        [
          {
            seller: sellerRefund.sellerId,
            sellerOrder: originalTransaction?.sellerOrder || null,
            order: orderId,
            source: 'refund_reversal',
            type: 'debit',
            amount: refundAmount,
            description: `Item Refund: ${reason} - Order #${orderId}`,
            status: 'completed',
            metadata: {
              originalTransactionId: originalTransaction?._id || null,
              reason,
              refundItems: sellerRefund.items.map(item => ({
                orderItemId: item.orderItemId,
                quantity: item.quantity,
                refundAmount: item.refundAmount,
              })),
            },
          },
        ],
        { session }
      );

      // Update seller order payout status if needed
      if (originalTransaction?.sellerOrder) {
        const sellerOrder = await SellerOrder.findById(originalTransaction.sellerOrder).session(session);
        if (sellerOrder) {
          // Check if all items in sellerOrder are refunded
          const allItemsRefunded = sellerRefund.items.every(item => {
            return sellerOrder.items.some(soItem => soItem.toString() === item.orderItemId.toString());
          });
          if (allItemsRefunded) {
            sellerOrder.payoutStatus = 'hold';
            await sellerOrder.save({ session });
          }
        }
      }

      reversals.push({
        sellerId: sellerIdStr,
        amount: refundAmount,
        reversalTransactionId: reversalTransaction[0]._id,
        items: sellerRefund.items,
      });
    }

    try {
      // If full order effectively refunded, we can mark shipping as refunded.
      // But item-level refund is tricky, so we always try to refund shipping charge 
      // when items are refunded (it will only effect if shipping charge exists).
      // Let's rely on refundShippingCharge failing gracefully if not exist.
      await shippingChargeService.refundShippingCharge(orderId, session);
      logger.info(`[OrderService] Marked shipping charge as refunded for order ${orderId} (item-level)`);
    } catch (shippingErr) {
      logger.error(`[OrderService] Failed to refund shipping charge for order ${orderId} (item-level): ${shippingErr.message}`);
    }

    await session.commitTransaction();

    return {
      success: true,
      message: `Reverted balances for ${reversals.length} seller(s)`,
      reversals,
    };
  } catch (error) {
    await session.abortTransaction();
    logger.error('[OrderService] Error reverting seller balances for items:', error);
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

  const PlatformSettings = require('../../models/platform/platformSettingsModel');
  const settings = await PlatformSettings.getSettings();

  const earnings = [];

  for (const sellerOrderId of order.sellerOrder) {
    const sellerOrder = await SellerOrder.findById(sellerOrderId);
    if (!sellerOrder) continue;

    const sellerEarnings = await calculateSellerEarnings(sellerOrder);
    const basePrice = sellerOrder.totalBasePrice || 0; // VAT-exclusive
    const shipping = sellerOrder.shippingCost || 0;
    const total = basePrice + shipping; // Seller revenue (VAT exclusive)
    const commissionRate = sellerOrder.commissionRate !== undefined
      ? sellerOrder.commissionRate
      : (settings.platformCommissionRate || 0);
    const platformFee = total * commissionRate;

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

/**
 * Backfill seller credits for orders that were marked delivered but never credited
 * (e.g. due to the "logger is not defined" bug). Finds orders with currentStatus
 * 'delivered' and sellerCredited !== true, then calls creditSellerForOrder for each.
 * @param {String} adminId - Admin user ID performing the backfill
 * @param {Object} options - { limit: number } max orders to process (default 100)
 * @returns {Promise<Object>} - { processed, credited, skipped, errors }
 */
exports.backfillSellerCreditsForDeliveredOrders = async (adminId, options = {}) => {
  const limit = Math.min(Math.max(Number(options.limit) || 100, 1), 500);
  // Include all delivered orders (including sellerCredited: true so we fix inconsistent state when no transaction exists)
  const query = {
    $or: [
      { currentStatus: { $in: ['delivered', 'delievered'] } },
      { orderStatus: 'delievered' },
      { status: 'completed' },
    ],
  };
  const orders = await Order.find(query).select('_id orderNumber sellerCredited').sort({ updatedAt: 1 }).limit(limit).lean();

  logger.info('[OrderService] Backfill: found %d delivered order(s) to process (limit=%d)', orders.length, limit);

  const result = { processed: 0, credited: 0, skipped: 0, errors: [] };

  for (const o of orders) {
    result.processed += 1;
    const orderLabel = o.orderNumber || o._id.toString();
    try {
      const creditResult = await exports.creditSellerForOrder(o._id.toString(), adminId);
      if (creditResult.success) {
        result.credited += 1;
        logger.info(`[OrderService] Backfill: credited sellers for order #${orderLabel}`);
      } else {
        result.skipped += 1;
        const msg = creditResult.message || 'Unknown';
        result.errors.push({
          orderId: o._id,
          orderNumber: o.orderNumber,
          message: msg,
        });
        logger.warn(`[OrderService] Backfill: order #${orderLabel} skipped - ${msg}`);
      }
    } catch (err) {
      result.skipped += 1;
      const errMsg = err.message || String(err);
      result.errors.push({
        orderId: o._id,
        orderNumber: o.orderNumber,
        message: errMsg,
      });
      logger.error(`[OrderService] Backfill: error crediting order #${orderLabel}:`, err);
    }
  }

  return result;
};

/**
 * Reconcile delivered orders where revenue history exists but credit transaction is missing.
 * This fixes inconsistent states where audit history was written but seller balance credit
 * transaction was never committed.
 *
 * @param {String} adminId - Admin user ID performing reconciliation
 * @param {Object} options - { limit: number } max orders to process (default 100, max 500)
 * @returns {Promise<Object>} - { processed, reconciled, skipped, errors }
 */
exports.reconcileDeliveredOrdersMissingCreditTx = async (
  adminId,
  options = {}
) => {
  const limit = Math.min(Math.max(Number(options.limit) || 100, 1), 500);
  const dryRun = options.dryRun === true;

  // Candidates: orders that have ORDER_EARNING history rows
  const candidateOrderIds = await SellerRevenueHistory.distinct('orderId', {
    type: 'ORDER_EARNING',
    orderId: { $ne: null },
  });

  if (!candidateOrderIds.length) {
    return { processed: 0, reconciled: 0, skipped: 0, errors: [] };
  }

  // Only delivered/completed orders are eligible for seller credit
  const deliveredOrders = await Order.find({
    _id: { $in: candidateOrderIds },
    $or: [
      { currentStatus: { $in: ['delivered', 'delievered'] } },
      { orderStatus: 'delievered' },
      { status: 'completed' },
    ],
  })
    .select('_id orderNumber sellerOrder sellerCredited')
    .sort({ updatedAt: 1 })
    .limit(limit)
    .lean();

  const result = {
    processed: 0,
    reconciled: 0,
    skipped: 0,
    dryRun,
    candidates: [],
    errors: [],
  };

  for (const order of deliveredOrders) {
    result.processed += 1;
    const sellerOrderRefs = Array.isArray(order.sellerOrder) ? order.sellerOrder : [];
    const sellerOrderIds = sellerOrderRefs
      .map((ref) => (ref && (ref._id || ref) ? (ref._id || ref) : null))
      .filter(Boolean);

    // If no seller orders, skip
    if (!sellerOrderIds.length) {
      result.skipped += 1;
      result.errors.push({
        orderId: order._id,
        orderNumber: order.orderNumber,
        message: 'No sellerOrder records found',
      });
      continue;
    }

    // Check whether a completed credit transaction already exists
    const creditCount = await Transaction.countDocuments({
      sellerOrder: { $in: sellerOrderIds },
      type: 'credit',
      status: 'completed',
    });

    if (creditCount > 0) {
      result.skipped += 1;
      continue;
    }

    if (dryRun) {
      result.reconciled += 1;
      result.candidates.push({
        orderId: order._id,
        orderNumber: order.orderNumber,
        sellerOrderIds,
        reason: 'ORDER_EARNING history exists but no completed credit transaction',
      });
      continue;
    }

    try {
      const creditResult = await exports.creditSellerForOrder(
        order._id.toString(),
        adminId
      );
      if (creditResult.success) {
        result.reconciled += 1;
      } else {
        result.skipped += 1;
        result.errors.push({
          orderId: order._id,
          orderNumber: order.orderNumber,
          message: creditResult.message || 'Credit attempt skipped',
        });
      }
    } catch (err) {
      result.skipped += 1;
      result.errors.push({
        orderId: order._id,
        orderNumber: order.orderNumber,
        message: err.message || String(err),
      });
    }
  }

  return result;
};

/**
 * Reconcile a single delivered order where ORDER_EARNING history exists
 * but completed seller credit transaction is missing.
 *
 * @param {String} orderId - Target order ID
 * @param {String} adminId - Admin user ID performing reconciliation
 * @param {Object} options - { dryRun?: boolean }
 * @returns {Promise<Object>} - reconciliation result for one order
 */
exports.reconcileSingleDeliveredOrderMissingCreditTx = async (
  orderId,
  adminId,
  options = {}
) => {
  const dryRun = options.dryRun === true;
  const reconciliationType = options.reconciliationType || 'missing_credit_tx';

  const buildOrderAmountSnapshot = (orderDoc, sellerOrders = []) => {
    const orderAmounts = {
      subtotal: Number(orderDoc?.subtotal || 0),
      shippingPrice: Number(orderDoc?.shippingPrice || 0),
      totalVAT: Number(orderDoc?.totalVAT || 0),
      totalNHIL: Number(orderDoc?.totalNHIL || 0),
      totalGETFund: Number(orderDoc?.totalGETFund || 0),
      totalTax: Number(orderDoc?.totalTax || 0),
      totalPrice: Number(orderDoc?.totalPrice || 0),
    };

    const sellerOrderBreakdown = sellerOrders.map((so) => {
      const totalBasePrice = Number(so.totalBasePrice || 0);
      const subtotal = Number(so.subtotal || 0);
      const shippingCost = Number(so.shippingCost || 0);
      const totalTax = Number(
        so.totalTax ??
          (Number(so.totalVAT || 0) +
            Number(so.totalNHIL || 0) +
            Number(so.totalGETFund || 0)),
      );
      const commissionRate = Number(so.commissionRate || 0);
      const vatOnCommissionRate = 0.15;
      const itemRevenue =
        so.vatCollectedBy === 'seller' ? subtotal : totalBasePrice;
      const commissionAmount =
        Math.round(itemRevenue * commissionRate * 100) / 100;
      const vatOnCommission =
        Math.round(commissionAmount * vatOnCommissionRate * 100) / 100;
      const expectedCredit =
        Math.round((itemRevenue - commissionAmount - vatOnCommission) * 100) /
        100;
      const sellerTaxes = {
        totalVAT: Number(so.totalVAT || 0),
        totalNHIL: Number(so.totalNHIL || 0),
        totalGETFund: Number(so.totalGETFund || 0),
        totalTax,
      };
      const platformFee = {
        commissionRate,
        commissionAmount,
        vatOnCommission,
        totalPlatformFee: Math.round(
          (commissionAmount + vatOnCommission) * 100,
        ) / 100,
      };

      return {
        sellerOrderId: so._id,
        sellerId: so.seller?._id || so.seller || null,
        vatCollectedBy: so.vatCollectedBy || 'platform',
        totalBasePrice,
        subtotal,
        shippingCost,
        sellerTaxes,
        platformFee,
        // Backward-compatible flat fields
        commissionRate,
        totalVAT: sellerTaxes.totalVAT,
        totalNHIL: sellerTaxes.totalNHIL,
        totalGETFund: sellerTaxes.totalGETFund,
        totalTax: sellerTaxes.totalTax,
        commissionAmount: platformFee.commissionAmount,
        vatOnCommission: platformFee.vatOnCommission,
        totalPlatformFee: platformFee.totalPlatformFee,
        expectedCredit,
      };
    });

    const sellerTotals = {
      totalExpectedCredit: Math.round(
        sellerOrderBreakdown.reduce(
          (sum, row) => sum + Number(row.expectedCredit || 0),
          0,
        ) * 100,
      ) / 100,
      totalSellerOrderTax: Math.round(
        sellerOrderBreakdown.reduce(
          (sum, row) => sum + Number(row.totalTax || 0),
          0,
        ) * 100,
      ) / 100,
      totalSellerOrderShipping: Math.round(
        sellerOrderBreakdown.reduce(
          (sum, row) => sum + Number(row.shippingCost || 0),
          0,
        ) * 100,
      ) / 100,
      totalPlatformFee: Math.round(
        sellerOrderBreakdown.reduce(
          (sum, row) => sum + Number(row.totalPlatformFee || 0),
          0,
        ) * 100,
      ) / 100,
      totalCommissionAmount: Math.round(
        sellerOrderBreakdown.reduce(
          (sum, row) => sum + Number(row.commissionAmount || 0),
          0,
        ) * 100,
      ) / 100,
      totalVatOnCommission: Math.round(
        sellerOrderBreakdown.reduce(
          (sum, row) => sum + Number(row.vatOnCommission || 0),
          0,
        ) * 100,
      ) / 100,
    };

    return {
      order: orderAmounts,
      sellerTotals,
      sellerOrders: sellerOrderBreakdown,
    };
  };

  const reconcileTaxAddBack = async (targetOrderId) => {
    const orderDoc = await Order.findById(targetOrderId)
      .select(
        '_id orderNumber currentStatus orderStatus status sellerOrder subtotal shippingPrice totalVAT totalNHIL totalGETFund totalTax totalPrice',
      )
      .lean();

    if (!orderDoc) {
      return {
        success: false,
        dryRun,
        reconciled: false,
        message: 'Order not found',
      };
    }

    const isDeliveredOrder =
      orderDoc.currentStatus === 'delivered' ||
      orderDoc.currentStatus === 'delievered' ||
      orderDoc.orderStatus === 'delievered' ||
      orderDoc.status === 'completed';

    if (!isDeliveredOrder) {
      return {
        success: false,
        dryRun,
        reconciled: false,
        message: 'Order is not delivered/completed',
      };
    }

    const sellerOrderIds = (Array.isArray(orderDoc.sellerOrder)
      ? orderDoc.sellerOrder
      : []
    )
      .map((ref) => (ref && (ref._id || ref) ? ref._id || ref : null))
      .filter(Boolean);

    if (!sellerOrderIds.length) {
      return {
        success: false,
        dryRun,
        reconciled: false,
        message: 'Order has no sellerOrder references',
      };
    }

    const sellerOrders = await SellerOrder.find({
      _id: { $in: sellerOrderIds },
    }).lean();
    const amountSnapshot = buildOrderAmountSnapshot(orderDoc, sellerOrders);

    const candidates = [];
    for (const so of sellerOrders) {
      const sellerId = so.seller?._id || so.seller;
      if (!sellerId) continue;

      // "Tax removed from seller amount" => add back only withheld tax flows.
      if (so.vatCollectedBy !== 'platform') continue;

      const taxAmount = Math.round(
        Number(
          so.totalTax ??
            (Number(so.totalVAT || 0) +
              Number(so.totalNHIL || 0) +
              Number(so.totalGETFund || 0)),
        ) * 100,
      ) / 100;

      if (taxAmount <= 0) continue;

      const alreadyAdjusted = await Transaction.exists({
        sellerOrder: so._id,
        seller: sellerId,
        type: 'credit',
        status: 'completed',
        'metadata.reconciliationType': 'tax_addback',
      });

      if (alreadyAdjusted) continue;

      candidates.push({
        sellerOrderId: so._id,
        sellerId: sellerId.toString(),
        orderNumber: orderDoc.orderNumber,
        amount: taxAmount,
        components: {
          totalVAT: Number(so.totalVAT || 0),
          totalNHIL: Number(so.totalNHIL || 0),
          totalGETFund: Number(so.totalGETFund || 0),
          totalTax: Number(so.totalTax || 0),
        },
      });
    }

    if (dryRun) {
      return {
        success: true,
        dryRun: true,
        reconciled: candidates.length > 0,
        message:
          candidates.length > 0
            ? `Tax add-back can be applied to ${candidates.length} seller order(s)`
            : 'No eligible seller orders for tax add-back',
        data: {
          orderId: orderDoc._id,
          orderNumber: orderDoc.orderNumber,
          reconciliationType: 'tax_addback',
          amountSnapshot,
          candidates,
        },
      };
    }

    if (!candidates.length) {
      return {
        success: true,
        dryRun: false,
        reconciled: false,
        message: 'No eligible seller orders for tax add-back',
        data: {
          orderId: orderDoc._id,
          orderNumber: orderDoc.orderNumber,
          reconciliationType: 'tax_addback',
          amountSnapshot,
          candidates: [],
        },
      };
    }

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const applied = [];

      for (const c of candidates) {
        // Re-check inside transaction for idempotency under concurrency.
        const existsInTx = await Transaction.exists({
          sellerOrder: c.sellerOrderId,
          seller: c.sellerId,
          type: 'credit',
          status: 'completed',
          'metadata.reconciliationType': 'tax_addback',
        }).session(session);
        if (existsInTx) continue;

        const sellerDoc = await getSellerByIdIncludingInactive(c.sellerId, session);
        if (!sellerDoc) continue;

        const oldBal = Number(sellerDoc.balance || 0);
        const newBal = Math.round((oldBal + c.amount) * 100) / 100;
        const newWithdrawable = Math.max(
          0,
          newBal - Number(sellerDoc.lockedBalance || 0),
        );

        await Seller.updateOne(
          { _id: c.sellerId },
          { $set: { balance: newBal, withdrawableBalance: newWithdrawable } },
          { session },
        );

        const [tx] = await Transaction.create(
          [
            {
              seller: c.sellerId,
              order: orderDoc._id,
              sellerOrder: c.sellerOrderId,
              source: 'admin_adjustment',
              type: 'credit',
              amount: c.amount,
              description: `Tax add-back reconciliation - Order #${c.orderNumber}`,
              status: 'completed',
              metadata: {
                orderNumber: c.orderNumber,
                reconciliationType: 'tax_addback',
                components: c.components,
                updatedBy: adminId,
              },
            },
          ],
          { session },
        );

        await logSellerRevenue({
          sellerId: c.sellerId,
          amount: c.amount,
          type: 'ADMIN_ADJUST',
          description: `Tax add-back reconciliation for order #${c.orderNumber}`,
          reference: `TAX-ADDBACK-${c.orderNumber}-${c.sellerOrderId}`,
          orderId: new mongoose.Types.ObjectId(orderDoc._id),
          adminId: new mongoose.Types.ObjectId(adminId),
          balanceBefore: oldBal,
          balanceAfter: newBal,
          session,
          metadata: {
            reconciliationType: 'tax_addback',
            sellerOrderId: c.sellerOrderId,
            components: c.components,
          },
        });

        applied.push({
          ...c,
          transactionId: tx?._id,
          balanceBefore: oldBal,
          balanceAfter: newBal,
        });
      }

      await session.commitTransaction();
      return {
        success: true,
        dryRun: false,
        reconciled: applied.length > 0,
        message:
          applied.length > 0
            ? `Applied tax add-back for ${applied.length} seller order(s)`
            : 'No tax add-back was applied (already reconciled)',
        data: {
          orderId: orderDoc._id,
          orderNumber: orderDoc.orderNumber,
          reconciliationType: 'tax_addback',
          amountSnapshot,
          applied,
        },
      };
    } catch (e) {
      await session.abortTransaction();
      return {
        success: false,
        dryRun: false,
        reconciled: false,
        message: e.message || 'Failed to apply tax add-back reconciliation',
      };
    } finally {
      session.endSession();
    }
  };

  if (reconciliationType === 'tax_addback') {
    return reconcileTaxAddBack(orderId);
  }

  const TAX_RECON_MAP = {
    tax_vat_addback: { field: 'totalVAT', label: 'VAT', direction: 'add' },
    tax_vat_deduct: { field: 'totalVAT', label: 'VAT', direction: 'deduct' },
    tax_nhil_addback: { field: 'totalNHIL', label: 'NHIL', direction: 'add' },
    tax_nhil_deduct: { field: 'totalNHIL', label: 'NHIL', direction: 'deduct' },
    tax_getfund_addback: { field: 'totalGETFund', label: 'GETFund', direction: 'add' },
    tax_getfund_deduct: { field: 'totalGETFund', label: 'GETFund', direction: 'deduct' },
  };

  const reconcileTaxSingle = async (targetOrderId) => {
    const config = TAX_RECON_MAP[reconciliationType];
    if (!config) return null;

    const { field, label, direction } = config;
    const isAdd = direction === 'add';

    const orderDoc = await Order.findById(targetOrderId)
      .select(
        '_id orderNumber currentStatus orderStatus status sellerOrder subtotal shippingPrice totalVAT totalNHIL totalGETFund totalTax totalPrice',
      )
      .lean();

    if (!orderDoc) {
      return {
        success: false,
        dryRun,
        reconciled: false,
        message: 'Order not found',
      };
    }

    const isDeliveredOrder =
      orderDoc.currentStatus === 'delivered' ||
      orderDoc.currentStatus === 'delievered' ||
      orderDoc.orderStatus === 'delievered' ||
      orderDoc.status === 'completed';

    if (!isDeliveredOrder) {
      return {
        success: false,
        dryRun,
        reconciled: false,
        message: 'Order is not delivered/completed',
      };
    }

    const sellerOrderIds = (Array.isArray(orderDoc.sellerOrder)
      ? orderDoc.sellerOrder
      : []
    )
      .map((ref) => (ref && (ref._id || ref) ? ref._id || ref : null))
      .filter(Boolean);

    if (!sellerOrderIds.length) {
      return {
        success: false,
        dryRun,
        reconciled: false,
        message: 'Order has no sellerOrder references',
      };
    }

    const sellerOrders = await SellerOrder.find({
      _id: { $in: sellerOrderIds },
    }).lean();
    const amountSnapshot = buildOrderAmountSnapshot(orderDoc, sellerOrders);

    const candidates = [];
    for (const so of sellerOrders) {
      const sellerId = so.seller?._id || so.seller;
      if (!sellerId) continue;

      const taxAmount = Math.round(Number(so[field] || 0) * 100) / 100;
      if (taxAmount <= 0) continue;

      if (isAdd) {
        if (so.vatCollectedBy !== 'platform') continue;
      } else {
        if (so.vatCollectedBy === 'seller') continue;
      }

      const metaKey = `metadata.reconciliationType`;
      const existingCredit = await Transaction.exists({
        sellerOrder: so._id,
        seller: sellerId,
        type: isAdd ? 'credit' : 'debit',
        status: 'completed',
        [metaKey]: reconciliationType,
      });
      if (existingCredit) continue;

      candidates.push({
        sellerOrderId: so._id,
        sellerId: sellerId.toString(),
        orderNumber: orderDoc.orderNumber,
        amount: taxAmount,
        taxField: field,
        taxLabel: label,
      });
    }

    const actionLabel = isAdd ? 'Add' : 'Deduct';
    if (dryRun) {
      return {
        success: true,
        dryRun: true,
        reconciled: candidates.length > 0,
        message:
          candidates.length > 0
            ? `${label} ${actionLabel}: would apply to ${candidates.length} seller order(s)`
            : `No eligible seller orders for ${label} ${actionLabel.toLowerCase()}`,
        data: {
          orderId: orderDoc._id,
          orderNumber: orderDoc.orderNumber,
          reconciliationType,
          amountSnapshot,
          candidates,
        },
      };
    }

    if (!candidates.length) {
      return {
        success: true,
        dryRun: false,
        reconciled: false,
        message: `No eligible seller orders for ${label} ${actionLabel.toLowerCase()}`,
        data: {
          orderId: orderDoc._id,
          orderNumber: orderDoc.orderNumber,
          reconciliationType,
          amountSnapshot,
          candidates: [],
        },
      };
    }

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const applied = [];

      for (const c of candidates) {
        const existsInTx = await Transaction.exists({
          sellerOrder: c.sellerOrderId,
          seller: c.sellerId,
          type: isAdd ? 'credit' : 'debit',
          status: 'completed',
          'metadata.reconciliationType': reconciliationType,
        }).session(session);
        if (existsInTx) continue;

        const sellerDoc = await getSellerByIdIncludingInactive(c.sellerId, session);
        if (!sellerDoc) continue;

        const oldBal = Number(sellerDoc.balance || 0);
        let newBal;
        if (isAdd) {
          newBal = Math.round((oldBal + c.amount) * 100) / 100;
        } else {
          newBal = Math.round((oldBal - c.amount) * 100) / 100;
          if (newBal < 0) {
            logger.warn(`[reconcileTaxSingle] Seller ${c.sellerId} would go negative (${oldBal} - ${c.amount}). Skipping.`);
            continue;
          }
        }
        const newWithdrawable = Math.max(
          0,
          newBal - Number(sellerDoc.lockedBalance || 0),
        );

        await Seller.updateOne(
          { _id: c.sellerId },
          { $set: { balance: newBal, withdrawableBalance: newWithdrawable } },
          { session },
        );

        const txType = isAdd ? 'credit' : 'debit';
        const txAmount = c.amount;
        const desc = isAdd
          ? `${label} add-back - Order #${c.orderNumber}`
          : `${label} deduct - Order #${c.orderNumber}`;

        const [tx] = await Transaction.create(
          [
            {
              seller: c.sellerId,
              order: orderDoc._id,
              sellerOrder: c.sellerOrderId,
              source: 'admin_adjustment',
              type: txType,
              amount: txAmount,
              description: desc,
              status: 'completed',
              metadata: {
                orderNumber: c.orderNumber,
                reconciliationType,
                taxField: c.taxField,
                taxLabel: c.taxLabel,
                updatedBy: adminId,
              },
            },
          ],
          { session },
        );

        const historyAmount = isAdd ? txAmount : -txAmount;
        await logSellerRevenue({
          sellerId: c.sellerId,
          amount: historyAmount,
          type: 'ADMIN_ADJUST',
          description: `${label} ${actionLabel.toLowerCase()} reconciliation - Order #${c.orderNumber}`,
          reference: `TAX-${label.toUpperCase()}-${actionLabel.toUpperCase()}-${c.orderNumber}-${c.sellerOrderId}`,
          orderId: new mongoose.Types.ObjectId(orderDoc._id),
          adminId: new mongoose.Types.ObjectId(adminId),
          balanceBefore: oldBal,
          balanceAfter: newBal,
          session,
          metadata: {
            reconciliationType,
            sellerOrderId: c.sellerOrderId,
            taxField: c.taxField,
            taxLabel: c.taxLabel,
          },
        });

        applied.push({
          ...c,
          transactionId: tx?._id,
          balanceBefore: oldBal,
          balanceAfter: newBal,
        });
      }

      await session.commitTransaction();
      return {
        success: true,
        dryRun: false,
        reconciled: applied.length > 0,
        message:
          applied.length > 0
            ? `Applied ${label} ${actionLabel.toLowerCase()} for ${applied.length} seller order(s)`
            : `No ${label} ${actionLabel.toLowerCase()} applied (already reconciled or insufficient balance)`,
        data: {
          orderId: orderDoc._id,
          orderNumber: orderDoc.orderNumber,
          reconciliationType,
          amountSnapshot,
          applied,
        },
      };
    } catch (e) {
      await session.abortTransaction();
      return {
        success: false,
        dryRun: false,
        reconciled: false,
        message: e.message || `Failed to apply ${label} ${actionLabel.toLowerCase()}`,
      };
    } finally {
      session.endSession();
    }
  };

  const taxSingleResult = TAX_RECON_MAP[reconciliationType]
    ? await reconcileTaxSingle(orderId)
    : null;
  if (taxSingleResult) return taxSingleResult;

  const reconcileSellerAmountAdjustment = async (targetOrderId) => {
    const amount = Number(options.adjustmentAmount);
    const targetSellerId = options.sellerId ? String(options.sellerId).trim() : null;

    if (Number.isNaN(amount) || amount <= 0) {
      return {
        success: false,
        dryRun,
        reconciled: false,
        message: 'Valid adjustment amount (positive number) is required for seller amount reconciliation',
      };
    }

    const roundedAmount = Math.round(amount * 100) / 100;

    const orderDoc = await Order.findById(targetOrderId)
      .select(
        '_id orderNumber currentStatus orderStatus status sellerOrder subtotal shippingPrice totalVAT totalNHIL totalGETFund totalTax totalPrice',
      )
      .lean();

    if (!orderDoc) {
      return {
        success: false,
        dryRun,
        reconciled: false,
        message: 'Order not found',
      };
    }

    const isDeliveredOrder =
      orderDoc.currentStatus === 'delivered' ||
      orderDoc.currentStatus === 'delievered' ||
      orderDoc.orderStatus === 'delievered' ||
      orderDoc.status === 'completed';

    if (!isDeliveredOrder) {
      return {
        success: false,
        dryRun,
        reconciled: false,
        message: 'Order is not delivered/completed',
      };
    }

    const sellerOrderIds = (Array.isArray(orderDoc.sellerOrder)
      ? orderDoc.sellerOrder
      : []
    )
      .map((ref) => (ref && (ref._id || ref) ? ref._id || ref : null))
      .filter(Boolean);

    if (!sellerOrderIds.length) {
      return {
        success: false,
        dryRun,
        reconciled: false,
        message: 'Order has no sellerOrder references',
      };
    }

    const sellerOrders = await SellerOrder.find({
      _id: { $in: sellerOrderIds },
    })
      .populate('seller', '_id name shopName email')
      .lean();

    const amountSnapshot = buildOrderAmountSnapshot(orderDoc, sellerOrders);

    let targetSellerOrder = null;
    let targetSeller = null;

    if (targetSellerId) {
      for (const so of sellerOrders) {
        const sid = so.seller?._id || so.seller;
        if (sid && String(sid) === targetSellerId) {
          targetSellerOrder = so;
          targetSeller = so.seller;
          break;
        }
      }
      if (!targetSellerOrder) {
        return {
          success: false,
          dryRun,
          reconciled: false,
          message: `Seller ${targetSellerId} is not part of this order. Order has ${sellerOrders.length} seller(s).`,
          data: { amountSnapshot, sellersInOrder: sellerOrders.map((so) => ({
            sellerId: (so.seller?._id || so.seller)?.toString?.(),
            sellerName: so.seller?.name || so.seller?.shopName,
          })) },
        };
      }
    } else {
      if (sellerOrders.length > 1) {
        return {
          success: false,
          dryRun,
          reconciled: false,
          message: 'Order has multiple sellers. Specify sellerId to reconcile a specific seller.',
          data: {
            amountSnapshot,
            sellersInOrder: sellerOrders.map((so) => ({
              sellerId: (so.seller?._id || so.seller)?.toString?.(),
              sellerName: so.seller?.name || so.seller?.shopName,
            })),
          },
        };
      }
      targetSellerOrder = sellerOrders[0];
      targetSeller = targetSellerOrder.seller;
    }

    const sellerIdStr = (targetSeller?._id || targetSeller)?.toString?.();
    if (!sellerIdStr) {
      return {
        success: false,
        dryRun,
        reconciled: false,
        message: 'Could not resolve seller for this seller order',
      };
    }

    const sellerOrderId = targetSellerOrder._id;

    if (dryRun) {
      return {
        success: true,
        dryRun: true,
        reconciled: true,
        message: `Would credit GH₵${roundedAmount.toFixed(2)} to seller ${sellerIdStr} (${targetSeller?.name || targetSeller?.shopName || 'Unknown'})`,
        data: {
          orderId: orderDoc._id,
          orderNumber: orderDoc.orderNumber,
          reconciliationType: 'seller_amount_adjustment',
          amountSnapshot,
          adjustment: {
            amount: roundedAmount,
            sellerId: sellerIdStr,
            sellerName: targetSeller?.name || targetSeller?.shopName || 'Unknown',
            sellerOrderId,
          },
        },
      };
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const sellerDoc = await getSellerByIdIncludingInactive(sellerIdStr, session);
      if (!sellerDoc) {
        await session.abortTransaction();
        return {
          success: false,
          dryRun: false,
          reconciled: false,
          message: `Seller ${sellerIdStr} not found`,
        };
      }

      const oldBal = Number(sellerDoc.balance || 0);
      const newBal = Math.round((oldBal + roundedAmount) * 100) / 100;
      const newWithdrawable = Math.max(
        0,
        newBal - Number(sellerDoc.lockedBalance || 0),
      );

      await Seller.updateOne(
        { _id: sellerIdStr },
        { $set: { balance: newBal, withdrawableBalance: newWithdrawable } },
        { session },
      );

      const [tx] = await Transaction.create(
        [
          {
            seller: sellerIdStr,
            order: orderDoc._id,
            sellerOrder: sellerOrderId,
            source: 'admin_adjustment',
            type: 'credit',
            amount: roundedAmount,
            description: `Admin reconciliation: seller amount adjustment - Order #${orderDoc.orderNumber}`,
            status: 'completed',
            metadata: {
              orderNumber: orderDoc.orderNumber,
              reconciliationType: 'seller_amount_adjustment',
              adminId: new mongoose.Types.ObjectId(adminId),
              updatedBy: adminId,
            },
          },
        ],
        { session },
      );

      await logSellerRevenue({
        sellerId: sellerIdStr,
        amount: roundedAmount,
        type: 'ADMIN_ADJUST',
        description: `Admin reconciliation: seller amount adjustment for order #${orderDoc.orderNumber}`,
        reference: `ADJUST-${orderDoc.orderNumber}-${sellerIdStr}-${Date.now()}`,
        orderId: new mongoose.Types.ObjectId(orderDoc._id),
        adminId: new mongoose.Types.ObjectId(adminId),
        balanceBefore: oldBal,
        balanceAfter: newBal,
        session,
        metadata: {
          reconciliationType: 'seller_amount_adjustment',
          sellerOrderId,
          adjustmentAmount: roundedAmount,
        },
      });

      await session.commitTransaction();

      return {
        success: true,
        dryRun: false,
        reconciled: true,
        message: `Credited GH₵${roundedAmount.toFixed(2)} to seller ${sellerIdStr}`,
        data: {
          orderId: orderDoc._id,
          orderNumber: orderDoc.orderNumber,
          reconciliationType: 'seller_amount_adjustment',
          amountSnapshot,
          adjustment: {
            amount: roundedAmount,
            sellerId: sellerIdStr,
            sellerName: sellerDoc.name || sellerDoc.shopName || 'Unknown',
            sellerOrderId,
            transactionId: tx?._id,
            balanceBefore: oldBal,
            balanceAfter: newBal,
          },
        },
      };
    } catch (e) {
      await session.abortTransaction();
      return {
        success: false,
        dryRun: false,
        reconciled: false,
        message: e.message || 'Failed to apply seller amount reconciliation',
      };
    } finally {
      session.endSession();
    }
  };

  if (reconciliationType === 'seller_amount_adjustment') {
    return reconcileSellerAmountAdjustment(orderId);
  }

  const buildCreditSnapshot = async (sellerOrderIds) => {
    const txs = await Transaction.find({
      sellerOrder: { $in: sellerOrderIds },
      type: 'credit',
      status: 'completed',
    })
      .sort({ createdAt: -1 })
      .populate('seller', 'name shopName email balance withdrawableBalance')
      .select('_id seller sellerOrder amount description createdAt')
      .lean();

    const totalCreditedAmount = txs.reduce(
      (sum, tx) => sum + (tx.amount || 0),
      0
    );

    const transactions = txs.map((tx) => ({
      transactionId: tx._id,
      sellerOrderId: tx.sellerOrder,
      amount: tx.amount || 0,
      createdAt: tx.createdAt,
      description: tx.description,
      seller: {
        id: tx.seller?._id || tx.seller,
        name: tx.seller?.name || tx.seller?.shopName || 'Unknown',
        email: tx.seller?.email || null,
        balance: tx.seller?.balance ?? null,
        withdrawableBalance: tx.seller?.withdrawableBalance ?? null,
      },
    }));

    return {
      totalTransactions: transactions.length,
      totalCreditedAmount: Math.round(totalCreditedAmount * 100) / 100,
      transactions,
    };
  };

  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    return {
      success: false,
      dryRun,
      reconciled: false,
      message: 'Invalid order ID format',
    };
  }

  const order = await Order.findById(orderId)
    .select(
      '_id orderNumber currentStatus orderStatus status sellerOrder subtotal shippingPrice totalVAT totalNHIL totalGETFund totalTax totalPrice',
    )
    .lean();

  if (!order) {
    return {
      success: false,
      dryRun,
      reconciled: false,
      message: 'Order not found',
    };
  }

  const isDelivered =
    order.currentStatus === 'delivered' ||
    order.currentStatus === 'delievered' ||
    order.orderStatus === 'delievered' ||
    order.status === 'completed';

  if (!isDelivered) {
    return {
      success: false,
      dryRun,
      reconciled: false,
      message: 'Order is not delivered/completed',
    };
  }

  const hasEarningHistory = await SellerRevenueHistory.exists({
    orderId: order._id,
    type: 'ORDER_EARNING',
  });

  const sellerOrderRefs = Array.isArray(order.sellerOrder) ? order.sellerOrder : [];
  const sellerOrderIds = sellerOrderRefs
    .map((ref) => (ref && (ref._id || ref) ? (ref._id || ref) : null))
    .filter(Boolean);

  const sellerOrders = await SellerOrder.find({
    _id: { $in: sellerOrderIds },
  })
    .select(
      '_id seller vatCollectedBy commissionRate totalBasePrice subtotal shippingCost totalVAT totalNHIL totalGETFund totalTax',
    )
    .lean();
  const amountSnapshot = buildOrderAmountSnapshot(order, sellerOrders);

  if (!sellerOrderIds.length) {
    return {
      success: false,
      dryRun,
      reconciled: false,
      message: 'Order has no sellerOrder references',
    };
  }

  const existingCredits = await Transaction.countDocuments({
    sellerOrder: { $in: sellerOrderIds },
    type: 'credit',
    status: 'completed',
  });

  if (existingCredits > 0) {
    const creditSnapshot = await buildCreditSnapshot(sellerOrderIds);
    return {
      success: true,
      dryRun,
      reconciled: false,
      message: 'Completed seller credit transaction already exists',
      data: {
        orderId: order._id,
        orderNumber: order.orderNumber,
        creditSnapshot,
        amountSnapshot,
      },
    };
  }

  if (dryRun) {
    return {
      success: true,
      dryRun: true,
      reconciled: true,
      message: hasEarningHistory
        ? 'Order is eligible for reconciliation'
        : 'Order is eligible for reconciliation (no ORDER_EARNING history found; proceeding via transaction checks)',
      data: {
        orderId: order._id,
        orderNumber: order.orderNumber,
        sellerOrderIds,
        historyFound: Boolean(hasEarningHistory),
        amountSnapshot,
      },
    };
  }

  const creditResult = await exports.creditSellerForOrder(order._id.toString(), adminId);
  const creditSnapshot = await buildCreditSnapshot(sellerOrderIds);
  return {
    success: !!creditResult.success,
    dryRun: false,
    reconciled: !!creditResult.success,
    message: creditResult.message || 'Reconciliation attempt completed',
    data: {
      orderId: order._id,
      orderNumber: order.orderNumber,
      historyFound: Boolean(hasEarningHistory),
      updates: creditResult.updates || [],
      creditSnapshot,
      amountSnapshot,
    },
  };
};

/**
 * Reconcile a single order by identifier (ObjectId OR orderNumber)
 * @param {String} identifier
 * @param {String} adminId
 * @param {Object} options
 * @returns {Promise<Object>}
 */
exports.reconcileSingleByIdentifier = async (
  identifier,
  adminId,
  options = {}
) => {
  const value = String(identifier || '').trim();
  if (!value) {
    return {
      success: false,
      dryRun: options.dryRun === true,
      reconciled: false,
      message: 'Order identifier is required',
    };
  }

  let order = null;
  if (mongoose.Types.ObjectId.isValid(value)) {
    order = await Order.findById(value).select('_id').lean();
  }
  if (!order) {
    order = await Order.findOne({ orderNumber: value }).select('_id').lean();
  }
  if (!order) {
    order = await Order.findOne({ trackingNumber: value }).select('_id').lean();
  }

  if (!order?._id) {
    return {
      success: false,
      dryRun: options.dryRun === true,
      reconciled: false,
      message: `Order not found for identifier: ${value}. Use order ID, order number, or tracking number.`,
    };
  }

  return exports.reconcileSingleDeliveredOrderMissingCreditTx(
    order._id.toString(),
    adminId,
    options
  );
};

module.exports = {
  creditSellerForOrder: exports.creditSellerForOrder,
  updateSellerBalancesOnOrderCompletion: exports.creditSellerForOrder, // Alias for backward compatibility
  revertSellerBalancesOnRefund: exports.revertSellerBalancesOnRefund,
  revertSellerBalancesForItems: exports.revertSellerBalancesForItems, // New: item-level refund reversal
  getSellerEarningsForOrder: exports.getSellerEarningsForOrder,
  calculateSellerEarnings,
  backfillSellerCreditsForDeliveredOrders: exports.backfillSellerCreditsForDeliveredOrders,
  reconcileDeliveredOrdersMissingCreditTx:
    exports.reconcileDeliveredOrdersMissingCreditTx,
  reconcileSingleDeliveredOrderMissingCreditTx:
    exports.reconcileSingleDeliveredOrderMissingCreditTx,
  reconcileSingleByIdentifier: exports.reconcileSingleByIdentifier,
};

