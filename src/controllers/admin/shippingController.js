const ShippingCharge = require('../../models/ShippingCharge');
const shippingChargeService = require('../../services/shippingChargeService');
const AppError = require('../../utils/errors/appError');
const catchAsync = require('../../utils/helpers/catchAsync');

/**
 * @desc    Get all shipping charges
 * @route   GET /api/v1/admin/shipping/charges
 * @access  Private/Admin
 */
exports.getAllShippingCharges = catchAsync(async (req, res, next) => {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const skip = (page - 1) * limit;

    const filter = {};

    if (req.query.status) {
        filter.status = req.query.status;
    }
    if (req.query.dispatcherId) {
        filter.dispatcherId = req.query.dispatcherId;
    }
    if (req.query.orderId) {
        filter.orderId = req.query.orderId;
    }
    if (req.query.dateFrom || req.query.dateTo) {
        filter.createdAt = {};
        if (req.query.dateFrom) filter.createdAt.$gte = new Date(req.query.dateFrom);
        if (req.query.dateTo) filter.createdAt.$lte = new Date(req.query.dateTo);
    }

    const charges = await ShippingCharge.find(filter)
        .populate('orderId', 'orderNumber')
        .populate('buyerId', 'name')
        .populate('sellerId', 'shopName name')
        .populate('dispatcherId', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

    const total = await ShippingCharge.countDocuments(filter);

    res.status(200).json({
        success: true,
        count: charges.length,
        total,
        pagination: {
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        },
        data: charges,
    });
});

/**
 * @desc    Get shipping charge by order ID
 * @route   GET /api/v1/admin/shipping/charges/order/:orderId
 * @access  Private/Admin
 */
exports.getShippingChargeByOrder = catchAsync(async (req, res, next) => {
    const charge = await ShippingCharge.findOne({ orderId: req.params.orderId })
        .populate('orderId', 'orderNumber')
        .populate('buyerId', 'name')
        .populate('sellerId', 'shopName name')
        .populate('dispatcherId', 'name');

    if (!charge) {
        return next(new AppError('Shipping charge not found for this order', 404));
    }

    const { getRevenueForOrder } = require('../../services/platform/platformRevenueService');
    const shippingRevenue = await getRevenueForOrder(req.params.orderId);
    const shippingEntries = shippingRevenue.filter(r => r.feeType === 'shipping_cut');

    res.status(200).json({
        success: true,
        data: {
            ...charge.toObject(),
            platformRevenueEntries: shippingEntries
        },
    });
});

/**
 * @desc    Get shipping charges summary
 * @route   GET /api/v1/admin/shipping/charges/summary
 * @access  Private/Admin
 */
exports.getShippingChargesSummary = catchAsync(async (req, res, next) => {
    const { dateFrom, dateTo } = req.query;
    const summary = await shippingChargeService.getShippingChargesSummary(dateFrom, dateTo);

    const { getRevenueSummary } = require('../../services/platform/platformRevenueService');
    const revenueSummary = await getRevenueSummary({
        startDate: dateFrom,
        endDate: dateTo,
        feeType: 'shipping_cut'
    });

    res.status(200).json({
        success: true,
        data: {
            ...summary,
            platformShippingRevenue: revenueSummary.shippingRevenue,
            revenueByDay: revenueSummary.byDay
        },
    });
});

/**
 * @desc    Get current shipping rate
 * @route   GET /api/v1/admin/shipping/rate
 * @access  Private/Admin
 */
exports.getShippingRate = catchAsync(async (req, res, next) => {
    const rate = await shippingChargeService.getActiveShippingRate();

    res.status(200).json({
        success: true,
        data: rate,
    });
});

/**
 * @desc    Update platform shipping rate
 * @route   PUT /api/v1/admin/shipping/rate
 * @access  Private/Admin
 */
exports.updateShippingRate = catchAsync(async (req, res, next) => {
    const { platformCutPercentage } = req.body;

    if (platformCutPercentage === undefined || platformCutPercentage < 0 || platformCutPercentage > 100) {
        return next(new AppError('Please provide a valid platformCutPercentage between 0 and 100', 400));
    }

    const newRate = await shippingChargeService.updateShippingRate(platformCutPercentage, req.user);

    res.status(200).json({
        success: true,
        message: 'Shipping rate updated successfully',
        data: newRate,
    });
});

/**
 * @desc    Settle shipping charge
 * @route   PATCH /api/v1/admin/shipping/charges/:id/settle
 * @access  Private/Admin
 */
exports.settleShippingCharge = catchAsync(async (req, res, next) => {
    const charge = await shippingChargeService.markShippingChargeSettled(req.params.id, req.user);

    res.status(200).json({
        success: true,
        message: 'Shipping charge marked as settled',
        data: charge,
    });
});
