const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const { getRevenueSummary, getRevenueForOrder, exportRevenue } = require('../../services/platform/platformRevenueService');
const PlatformFee = require('../../models/platform/platformFeeModel');

/**
 * @desc    Get Platform Revenue Summary
 * @route   GET /api/v1/admin/platform-revenue/summary
 * @access  Private/Admin
 */
exports.getRevenueSummary = catchAsync(async (req, res, next) => {
    const { startDate, endDate, feeType, feeCode } = req.query;

    const summary = await getRevenueSummary({ startDate, endDate, feeType, feeCode });

    res.status(200).json({
        success: true,
        data: summary
    });
});

/**
 * @desc    Get Revenue for a specific Order
 * @route   GET /api/v1/admin/platform-revenue/order/:orderId
 * @access  Private/Admin
 */
exports.getRevenueForOrder = catchAsync(async (req, res, next) => {
    const { orderId } = req.params;

    // In a real scenario we'd check if orderId is a valid ObjectId,
    // but the service handles it by querying MongoDB.
    const revenueEntries = await getRevenueForOrder(orderId);

    res.status(200).json({
        success: true,
        data: revenueEntries
    });
});

/**
 * @desc    Export Revenue data (CSV or PDF)
 * @route   GET /api/v1/admin/platform-revenue/export
 * @access  Private/Admin
 */
exports.exportRevenueData = catchAsync(async (req, res, next) => {
    const { startDate, endDate, feeType, format } = req.query;

    if (!format || !['csv', 'pdf'].includes(format.toLowerCase())) {
        return next(new AppError('Please provide a valid export format (csv or pdf)', 400));
    }

    const exportData = await exportRevenue({ startDate, endDate, feeType, format });

    if (format.toLowerCase() === 'csv') {
        // Build basic CSV string (could use json2csv, but doing manual map for simplicity)
        if (exportData.length === 0) {
            return res.status(200).send('No data available');
        }

        const headers = Object.keys(exportData[0]).join(',');
        const rows = exportData.map(row =>
            Object.values(row).map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')
        ).join('\n');

        const csvContent = `${headers}\n${rows}`;

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=platform_revenue_export.csv');
        return res.status(200).send(csvContent);
    }

    if (format.toLowerCase() === 'pdf') {
        // Without pdfkit/puppeteer loaded natively, we return the JSON structured 
        // for the frontend or another service to render the PDF.
        // A complete implementation would stream a generated PDF here.
        res.setHeader('Content-Type', 'application/json');
        return res.status(200).json({
            success: true,
            message: 'PDF data structure generated. Feed into PDF generator.',
            data: exportData
        });
    }
});

/**
 * @desc    Get All Platform Fees
 * @route   GET /api/v1/admin/platform-revenue/fees
 * @access  Private/Admin
 */
exports.getAllPlatformFees = catchAsync(async (req, res, next) => {
    const fees = await PlatformFee.find();

    res.status(200).json({
        success: true,
        data: fees
    });
});
