const mongoose = require('mongoose');
const ShippingCharge = require('../models/ShippingCharge');
const PlatformShippingRate = require('../models/ShippingRate');
// Assuming AdminActionLog exists and maps to adminActionLogModel
const AdminActionLog = require('../models/admin/adminActionLogModel');

class ShippingChargeService {
    /**
     * 1. Get the current active shipping rate. Defaults to 20% if none exist.
     * @returns {Object} { platformCutPercentage, _id }
     */
    async getActiveShippingRate() {
        let rate = await PlatformShippingRate.findOne({ isActive: true });
        if (!rate) {
            return { platformCutPercentage: 20 };
        }
        return rate;
    }

    /**
     * 2. Calculate the shipping charge details.
     * @param {Object} order 
     * @returns {Object} { totalShippingAmount, platformCut, dispatcherPayout, platformCutRate }
     */
    async calculateShippingCharge(order) {
        const rate = await this.getActiveShippingRate();
        const platformCutPercentage = rate.platformCutPercentage;
        const totalShippingAmount = order.shippingCost || 0;

        const platformCut = totalShippingAmount * (platformCutPercentage / 100);
        const dispatcherPayout = totalShippingAmount - platformCut;

        return {
            totalShippingAmount,
            platformCut,
            dispatcherPayout,
            platformCutRate: platformCutPercentage
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
        let existingCharge = await ShippingCharge.findOne({ orderId }).session(session);
        if (existingCharge) {
            return existingCharge;
        }

        const Order = mongoose.model('Order');
        const order = await Order.findById(orderId).session(session);
        if (!order) {
            throw new Error('Order not found for shipping charge calculation');
        }

        const calculation = await this.calculateShippingCharge(order);

        const newCharge = new ShippingCharge({
            orderId: order._id,
            buyerId: order.user,
            sellerId: order.seller,
            dispatcherId: order.dispatcher,
            totalShippingAmount: calculation.totalShippingAmount,
            platformCut: calculation.platformCut,
            dispatcherPayout: calculation.dispatcherPayout,
            platformCutRate: calculation.platformCutRate,
            status: 'pending',
            calculatedAt: Date.now(),
            orderDeliveredAt: Date.now() // assuming this is called upon delivery
        });

        await newCharge.save({ session });

        // Record revenue for the platform's cut of the shipping fee
        try {
            const { recordRevenue } = require('./platform/platformRevenueService');
            const { getFeeByCode } = require('./platform/platformFeeService');

            const shippingFee = await getFeeByCode('SHIPPING_CUT');
            if (shippingFee && calculation.platformCut > 0) {
                await recordRevenue({
                    orderId: order._id,
                    platformFeeId: shippingFee._id,
                    feeCode: 'SHIPPING_CUT',
                    feeName: shippingFee.name,
                    feeType: 'shipping_cut',
                    calculationMethod: shippingFee.calculationMethod,
                    rateApplied: shippingFee.value || calculation.platformCutRate,
                    baseAmount: calculation.totalShippingAmount,
                    revenueAmount: calculation.platformCut,
                    paidBy: 'seller',
                    sellerId: order.seller,
                    chargeEvent: 'on_order_delivered',
                    sourceModel: 'ShippingCharge',
                    sourceId: newCharge._id,
                });
            }
        } catch (error) {
            console.error('Error recording shipping cut revenue:', error);
        }

        return newCharge;
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
