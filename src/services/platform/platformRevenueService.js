const PlatformRevenue = require('../../models/platform/platformRevenueModel');

exports.recordRevenue = async ({
    orderId,
    platformFeeId,
    feeCode,
    feeName,
    feeType,
    calculationMethod,
    rateApplied,
    baseAmount,
    revenueAmount,
    currency = 'GHS',
    paidBy,
    buyerId,
    sellerId,
    chargeEvent,
    sourceModel,
    sourceId,
}) => {
    return PlatformRevenue.create({
        orderId,
        platformFeeId,
        feeCode,
        feeName,
        feeType,
        calculationMethod,
        rateApplied,
        baseAmount,
        revenueAmount,
        currency,
        paidBy,
        buyerId,
        sellerId,
        chargeEvent,
        sourceModel,
        sourceId,
    });
};

exports.reverseRevenue = async (orderId, reason) => {
    return PlatformRevenue.updateMany(
        { orderId, status: 'confirmed' },
        { status: 'reversed', reversedAt: new Date(), reversalReason: reason }
    );
};

exports.getRevenueSummary = async ({ startDate, endDate, feeType, feeCode }) => {
    const matchConfirmed = { status: 'confirmed' };
    const matchReversed = { status: 'reversed' };

    if (startDate || endDate) {
        const dateQuery = {};
        if (startDate) dateQuery.$gte = new Date(startDate);
        if (endDate) dateQuery.$lte = new Date(endDate);
        matchConfirmed.chargedAt = dateQuery;
        matchReversed.chargedAt = dateQuery;
    } else {
        // Default to last 30 days
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        matchConfirmed.chargedAt = { $gte: thirtyDaysAgo };
        matchReversed.chargedAt = { $gte: thirtyDaysAgo };
    }

    if (feeType) {
        matchConfirmed.feeType = feeType;
        matchReversed.feeType = feeType;
    }
    if (feeCode) {
        matchConfirmed.feeCode = feeCode;
        matchReversed.feeCode = feeCode;
    }

    const [confirmedStats, reversedStats, byFeeType, byFeeCode, byDay] = await Promise.all([
        PlatformRevenue.aggregate([
            { $match: matchConfirmed },
            { $group: { _id: null, total: { $sum: '$revenueAmount' } } }
        ]),
        PlatformRevenue.aggregate([
            { $match: matchReversed },
            { $group: { _id: null, total: { $sum: '$revenueAmount' } } }
        ]),
        PlatformRevenue.aggregate([
            { $match: matchConfirmed },
            {
                $group: {
                    _id: '$feeType',
                    totalAmount: { $sum: '$revenueAmount' },
                    count: { $sum: 1 }
                }
            }
        ]),
        PlatformRevenue.aggregate([
            { $match: matchConfirmed },
            {
                $group: {
                    _id: { feeCode: '$feeCode', feeName: '$feeName' },
                    totalAmount: { $sum: '$revenueAmount' },
                    count: { $sum: 1 }
                }
            }
        ]),
        PlatformRevenue.aggregate([
            { $match: matchConfirmed },
            {
                $group: {
                    _id: { $dateToString: { format: "%Y-%m-%d", date: "$chargedAt" } },
                    totalAmount: { $sum: '$revenueAmount' }
                }
            },
            { $sort: { _id: 1 } }
        ])
    ]);

    const totalRevenue = confirmedStats[0]?.total || 0;
    const refundedAmount = reversedStats[0]?.total || 0;
    const netRevenue = totalRevenue - refundedAmount;

    const typeMap = {};
    byFeeType.forEach(t => {
        typeMap[t._id] = t.totalAmount;
    });

    return {
        totalRevenue,
        byFeeType: byFeeType.map(t => ({
            feeType: t._id,
            totalAmount: t.totalAmount,
            count: t.count,
            percentage: totalRevenue > 0 ? (t.totalAmount / totalRevenue) * 100 : 0
        })),
        byFeeCode: byFeeCode.map(c => ({
            feeCode: c._id.feeCode,
            feeName: c._id.feeName,
            totalAmount: c.totalAmount,
            count: c.count
        })),
        byDay: byDay.map(d => ({
            date: d._id,
            totalAmount: d.totalAmount
        })),
        taxRevenue: typeMap['tax'] || 0,
        shippingRevenue: typeMap['shipping_cut'] || 0,
        commissionRevenue: typeMap['commission'] || 0,
        refundedAmount,
        netRevenue
    };
};

exports.getRevenueForOrder = async (orderId) => {
    return PlatformRevenue.find({ orderId }).sort({ chargedAt: -1 });
};

exports.exportRevenue = async ({ startDate, endDate, feeType, format }) => {
    // Return everything required by export, leaving the controller to generate files
    const match = { status: 'confirmed' };

    if (startDate || endDate) {
        const dateQuery = {};
        if (startDate) dateQuery.$gte = new Date(startDate);
        if (endDate) dateQuery.$lte = new Date(endDate);
        match.chargedAt = dateQuery;
    }
    if (feeType) match.feeType = feeType;

    const transactions = await PlatformRevenue.find(match).sort({ chargedAt: -1 }).lean();

    if (format === 'csv') {
        return transactions.map(t => ({
            date: t.chargedAt,
            orderId: t.orderId,
            feeCode: t.feeCode,
            feeName: t.feeName,
            feeType: t.feeType,
            baseAmount: t.baseAmount,
            rateApplied: t.rateApplied,
            revenueAmount: t.revenueAmount,
            currency: t.currency,
            paidBy: t.paidBy,
            chargeEvent: t.chargeEvent,
            status: t.status
        }));
    }

    // PDF format prep
    const summary = await exports.getRevenueSummary({ startDate, endDate, feeType });
    return {
        reportTitle: 'Platform Revenue Report',
        generatedAt: new Date(),
        dateRange: { from: startDate, to: endDate },
        summary: {
            totalRevenue: summary.totalRevenue,
            taxRevenue: summary.taxRevenue,
            shippingRevenue: summary.shippingRevenue,
            netRevenue: summary.netRevenue
        },
        breakdown: summary.byFeeType,
        transactions: transactions.map(t => ({
            date: t.chargedAt,
            orderId: t.orderId,
            feeCode: t.feeCode,
            feeName: t.feeName,
            feeType: t.feeType,
            baseAmount: t.baseAmount,
            rateApplied: t.rateApplied,
            revenueAmount: t.revenueAmount,
            currency: t.currency,
            paidBy: t.paidBy,
            chargeEvent: t.chargeEvent,
            status: t.status
        }))
    };
};
