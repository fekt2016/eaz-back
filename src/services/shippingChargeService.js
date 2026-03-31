const mongoose = require('mongoose');
const ShippingCharge = require('../models/ShippingCharge');
const PlatformShippingRate = require('../models/ShippingRate');
// Assuming AdminActionLog exists and maps to adminActionLogModel
const AdminActionLog = require('../models/admin/adminActionLogModel');

class ShippingChargeService {
    /**
     * 1. Get the current active shipping rate. 
     * Priority: PlatformFee (SHIPPING_CUT) > PlatformShippingRate > Default 20%
     * @returns {Object} { platformCutPercentage, source }
     */
    async getActiveShippingRate() {
        // Source 1: PlatformFee model (New Single Source of Truth)
        try {
            const PlatformFee = mongoose.model('PlatformFee');
            const shippingCutFee = await PlatformFee.findOne({
                code: 'SHIPPING_CUT',
                isActive: true
            });

            if (shippingCutFee) {
                return {
                    platformCutPercentage: shippingCutFee.value,
                    source: 'PlatformFee',
                    feeId: shippingCutFee._id
                };
            }
        } catch (err) {
            console.error('[ShippingRevenue] Error fetching PlatformFee:', err.message);
        }

        // Source 2: Legacy PlatformShippingRate collection
        let rate = await PlatformShippingRate.findOne({ isActive: true });
        if (rate) {
            return {
                platformCutPercentage: rate.platformCutPercentage,
                source: 'PlatformShippingRate',
                feeId: rate._id
            };
        }

        // Source 3: Code default (Last resort)
        console.warn('[ShippingRevenue] No shipping rate found in DB. Using default 20%. Run seeder to fix.');
        return { platformCutPercentage: 20, source: 'Default' };
    }

    /**
     * 2. Calculate the shipping charge details.
     * @param {Object} order 
     * @returns {Object} { totalShippingAmount, platformCut, dispatcherPayout, platformCutRate, source }
     */
    async calculateShippingCharge(order) {
        const rateInfo = await this.getActiveShippingRate();
        const platformCutPercentage = rateInfo.platformCutPercentage;

        // Fix 2: Field name standardization
        const totalShippingAmount =
            order.shippingFee ??      // primary field
            order.shippingCost ??     // fallback for legacy
            0;                        // safe default

        if (!order.shippingFee && !order.shippingCost) {
            console.warn(`[ShippingRevenue] No shipping fee found on order ${order._id}. Both shippingFee and shippingCost are missing or 0.`);
        }

        const platformCut = Math.round((totalShippingAmount * (platformCutPercentage / 100)) * 100) / 100;
        const dispatcherPayout = Math.round((totalShippingAmount - platformCut) * 100) / 100;

        console.log('[ShippingRevenue] Calculation', {
            orderId: order._id,
            totalShippingAmount,
            platformCutRate: platformCutPercentage,
            platformCut,
            source: rateInfo.source
        });

        return {
            totalShippingAmount,
            platformCut,
            dispatcherPayout,
            platformCutRate: platformCutPercentage,
            source: rateInfo.source,
            platformFeeId: rateInfo.source === 'PlatformFee' ? rateInfo.feeId : null
        };
    }

    /**
     * 3. Create a ShippingCharge record when an order is delivered.
     * @param {String|ObjectId} orderId 
     * @param {Object} session Mongoose session
     * @returns {Object} Created or existing ShippingCharge
     */
    async createShippingChargeRecord(orderId, session) {
        // Check if it already exists to prevent duplicates
        const chargeQuery = ShippingCharge.findOne({ orderId });
        if (session) chargeQuery.session(session);
        let existingCharge = await chargeQuery;
        if (existingCharge) {
            return existingCharge;
        }

        const Order = mongoose.model('Order');
        // Populate sellerOrder to get seller reference if needed
        const orderQuery = Order.findById(orderId).populate('sellerOrder');
        if (session) orderQuery.session(session);
        const order = await orderQuery;
        if (!order) {
            throw new Error('Order not found for shipping charge calculation');
        }

        console.log('[ShippingRevenue] Starting record creation', {
            orderId: order._id,
            orderNumber: order.orderNumber,
            shippingFee: order.shippingFee,
            shippingCost: order.shippingCost,
        });

        const calculation = await this.calculateShippingCharge(order);

        // Resolve sellerId defensively
        let sellerId = order.seller;
        if (!sellerId && order.shippingBreakdown && order.shippingBreakdown.length > 0) {
            sellerId = order.shippingBreakdown[0].sellerId;
        }
        if (!sellerId && order.sellerOrder && order.sellerOrder.length > 0) {
            const firstSellerOrder = order.sellerOrder[0];
            sellerId = firstSellerOrder.seller || firstSellerOrder; // handle populated or ID
        }

        if (!sellerId) {
            console.warn(`[ShippingRevenue] Could not resolve sellerId for order ${order._id}. Revenue recording might fail.`);
        }

        const newCharge = new ShippingCharge({
            orderId: order._id,
            buyerId: order.user,
            sellerId: sellerId, // Fixed: use resolved sellerId
            dispatcherId: order.dispatcher || order.dispatcherId, // handle potential naming variations
            totalShippingAmount: calculation.totalShippingAmount,
            platformCut: calculation.platformCut,
            dispatcherPayout: calculation.dispatcherPayout,
            platformCutRate: calculation.platformCutRate,
            status: 'pending',
            calculatedAt: Date.now(),
            orderDeliveredAt: Date.now()
        });

        const saveOptions = session ? { session } : {};
        const savedCharge = await newCharge.save(saveOptions);

        // Record revenue for the platform's cut of the shipping fee
        try {
            const { recordRevenue } = require('./platform/platformRevenueService');
            const { getFeeByCode } = require('./platform/platformFeeService');

            // Standardize to UPPERCASE to match seeder
            const shippingFeeConfig = await getFeeByCode('SHIPPING_CUT');

            if (!shippingFeeConfig) {
                console.error(`[ShippingRevenue] SHIPPING_CUT fee config not found or inactive. Cannot record revenue for order ${order._id}. Run the platform fee seeder to fix this.`);
            } else if (calculation.platformCut <= 0) {
                console.warn(`[ShippingRevenue] Platform cut is 0 or negative for order ${order._id}. shippingFee: ${calculation.totalShippingAmount}, rate: ${shippingFeeConfig.value}%`);
            } else {
                const revenueRecord = await recordRevenue({
                    orderId: order._id,
                    platformFeeId: shippingFeeConfig._id,
                    feeCode: 'SHIPPING_CUT',
                    feeName: shippingFeeConfig.name,
                    feeType: 'shipping_cut',
                    calculationMethod: shippingFeeConfig.calculationMethod,
                    rateApplied: shippingFeeConfig.value,
                    baseAmount: calculation.totalShippingAmount,
                    revenueAmount: calculation.platformCut,
                    paidBy: 'seller',
                    sellerId: order.seller,
                    chargeEvent: 'on_order_delivered',
                    sourceModel: 'ShippingCharge',
                    sourceId: savedCharge._id,
                });

                console.log('[ShippingRevenue] Revenue recorded', {
                    revenueId: revenueRecord._id,
                    amount: revenueRecord.revenueAmount,
                    orderId: order._id
                });
            }
        } catch (error) {
            console.error('[ShippingRevenue] Error recording shipping cut revenue:', error);
        }

        return savedCharge;
    }

    /**
     * 4. Mark a dispatcher payout as settled by admin.
     * @param {String|ObjectId} shippingChargeId 
     * @param {Object} adminUser Admin user object with _id, name, email, role
     * @returns {Object} Updated ShippingCharge
     */
    async markShippingChargeSettled(shippingChargeId, adminUser) {
        const adminId = adminUser._id || adminUser;
        const charge = await ShippingCharge.findById(shippingChargeId);
        if (!charge) {
            throw new Error('Shipping charge not found');
        }

        charge.status = 'settled';
        charge.settledAt = Date.now();
        await charge.save();

        // Log the action
        await AdminActionLog.create({
            actionType: 'SHIPPING_SETTLED',
            metadata: { shippingChargeId },
            adminId,
            name: adminUser.name,
            email: adminUser.email,
            role: adminUser.role
        });

        return charge;
    }

    /**
     * 5. Refund standard shipping charges if an order is refunded.
     * @param {String|ObjectId} orderId 
     * @param {Object} session Mongoose session
     * @returns {Object} Updated ShippingCharge
     */
    async refundShippingCharge(orderId, session) {
        const charge = await ShippingCharge.findOne({ orderId }).session(session);
        if (!charge) {
            return null;
        }

        charge.status = 'refunded';
        await charge.save({ session });
        return charge;
    }

    /**
     * 6. Retrieve summary stats.
     * @param {Date} dateFrom 
     * @param {Date} dateTo 
     * @returns {Object} Summary metrics
     */
    async getShippingChargesSummary(dateFrom, dateTo) {
        const matchStage = {};
        if (dateFrom || dateTo) {
            matchStage.createdAt = {};
            if (dateFrom) matchStage.createdAt.$gte = new Date(dateFrom);
            if (dateTo) matchStage.createdAt.$lte = new Date(dateTo);
        }

        const result = await ShippingCharge.aggregate([
            { $match: matchStage },
            {
                $group: {
                    _id: null,
                    totalShippingRevenue: { $sum: '$totalShippingAmount' },
                    totalPlatformCut: { $sum: '$platformCut' },
                    totalDispatcherPayouts: { $sum: '$dispatcherPayout' },
                    totalOrders: { $sum: 1 },
                    totalDispatcherPayoutPending: {
                        $sum: { $cond: [{ $eq: ['$status', 'pending'] }, '$dispatcherPayout', 0] }
                    },
                    totalDispatcherPayoutPaid: {
                        $sum: { $cond: [{ $eq: ['$status', 'settled'] }, '$dispatcherPayout', 0] }
                    }
                }
            }
        ]);

        if (result.length === 0) {
            return {
                totalShippingRevenue: 0,
                totalPlatformCut: 0,
                totalDispatcherPayouts: 0,
                totalOrders: 0,
                totalDispatcherPayoutPending: 0,
                totalDispatcherPayoutPaid: 0
            };
        }

        const stats = result[0];
        delete stats._id;
        return stats;
    }

    /**
     * 7. Update platform shipping percentage.
     * @param {Number} platformCutPercentage (0-100)
     * @param {Object} adminUser Admin user object with _id, name, email, role
     * @returns {Object} New active rate
     */
    async updateShippingRate(platformCutPercentage, adminUser) {
        const adminId = adminUser._id || adminUser;
        if (platformCutPercentage < 0 || platformCutPercentage > 100) {
            throw new Error('Platform cut percentage must be between 0 and 100');
        }

        // Creating new rate will handle deactivating others through pre-save hook
        const newRate = await PlatformShippingRate.create({
            platformCutPercentage,
            isActive: true,
            updatedBy: adminId
        });

        await AdminActionLog.create({
            actionType: 'SHIPPING_RATE_UPDATE',
            metadata: { newRate: platformCutPercentage },
            adminId,
            name: adminUser.name,
            email: adminUser.email,
            role: adminUser.role
        });

        return newRate;
    }
}

module.exports = new ShippingChargeService();
