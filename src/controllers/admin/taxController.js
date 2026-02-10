/**
 * Admin Tax Controller
 * Handles VAT reporting and tax management for Ghana GRA compliance
 */

const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const Order = require('../../models/order/orderModel');
const SellerOrder = require('../../models/order/sellerOrderModel');
const TaxCollection = require('../../models/tax/taxCollectionModel');
const mongoose = require('mongoose');

/**
 * Get VAT Summary
 * GET /api/v1/admin/tax/vat-summary
 * Query params: startDate, endDate, sellerId, category
 */
exports.getVATSummary = catchAsync(async (req, res, next) => {
  const { startDate, endDate, sellerId, category } = req.query;

  // Build query
  const query = {};
  
  // Date filter
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) {
      query.createdAt.$gte = new Date(startDate);
    }
    if (endDate) {
      query.createdAt.$lte = new Date(endDate);
    }
  }

  // Seller filter
  if (sellerId) {
    query['sellerOrder.seller'] = mongoose.Types.ObjectId(sellerId);
  }

  // Get orders with tax breakdown
  const orders = await Order.find(query)
    .populate({
      path: 'sellerOrder',
      populate: {
        path: 'seller',
        select: 'name shopName email',
      },
    })
    .select('totalBasePrice totalVAT totalNHIL totalGETFund totalCovidLevy totalTax totalPrice createdAt sellerOrder');

  // Aggregate tax totals (including VAT withheld by platform for non-VAT-registered sellers)
  let totalBasePrice = 0;
  let totalVAT = 0;
  let totalNHIL = 0;
  let totalGETFund = 0;
  let totalCovidLevy = 0;
  let totalTax = 0;
  let totalSales = 0;
  let orderCount = 0;
  let vatWithheldByPlatform = 0;

  const sellerBreakdown = {};
  const categoryBreakdown = {};

  orders.forEach((order) => {
    totalBasePrice += order.totalBasePrice || 0;
    totalVAT += order.totalVAT || 0;
    totalNHIL += order.totalNHIL || 0;
    totalGETFund += order.totalGETFund || 0;
    totalCovidLevy += order.totalCovidLevy || 0;
    totalTax += order.totalTax || 0;
    totalSales += order.totalPrice || 0;
    orderCount++;

    if (order.sellerOrder && Array.isArray(order.sellerOrder)) {
      order.sellerOrder.forEach((so) => {
        if (so.vatCollectedBy === 'platform' && so.totalVatAmount != null) {
          vatWithheldByPlatform += so.totalVatAmount;
        }
        if (so.seller) {
          const sellerId = so.seller._id?.toString() || so.seller.toString();
          if (!sellerBreakdown[sellerId]) {
            sellerBreakdown[sellerId] = {
              sellerId,
              sellerName: so.seller.name || so.seller.shopName || 'Unknown',
              totalBasePrice: 0,
              totalVAT: 0,
              totalNHIL: 0,
              totalGETFund: 0,
              totalCovidLevy: 0,
              totalTax: 0,
              totalSales: 0,
              orderCount: 0,
              vatCollectedBy: so.vatCollectedBy || 'platform',
              vatWithheld: 0,
            };
          }
          sellerBreakdown[sellerId].totalBasePrice += so.totalBasePrice || 0;
          sellerBreakdown[sellerId].totalVAT += so.totalVAT || 0;
          sellerBreakdown[sellerId].totalNHIL += so.totalNHIL || 0;
          sellerBreakdown[sellerId].totalGETFund += so.totalGETFund || 0;
          sellerBreakdown[sellerId].totalCovidLevy += so.totalCovidLevy || 0;
          sellerBreakdown[sellerId].totalTax += so.totalTax || 0;
          sellerBreakdown[sellerId].totalSales += so.total || 0;
          sellerBreakdown[sellerId].orderCount++;
          if (so.vatCollectedBy === 'platform' && so.totalVatAmount != null) {
            sellerBreakdown[sellerId].vatWithheld += so.totalVatAmount;
          }
        }
      });
    }
  });

  // Round all values
  totalBasePrice = Math.round(totalBasePrice * 100) / 100;
  totalVAT = Math.round(totalVAT * 100) / 100;
  totalNHIL = Math.round(totalNHIL * 100) / 100;
  totalGETFund = Math.round(totalGETFund * 100) / 100;
  totalCovidLevy = Math.round(totalCovidLevy * 100) / 100;
  totalTax = Math.round(totalTax * 100) / 100;
  totalSales = Math.round(totalSales * 100) / 100;

  vatWithheldByPlatform = Math.round(vatWithheldByPlatform * 100) / 100;

  Object.keys(sellerBreakdown).forEach((sellerId) => {
    const seller = sellerBreakdown[sellerId];
    seller.totalBasePrice = Math.round(seller.totalBasePrice * 100) / 100;
    seller.totalVAT = Math.round(seller.totalVAT * 100) / 100;
    seller.totalNHIL = Math.round(seller.totalNHIL * 100) / 100;
    seller.totalGETFund = Math.round(seller.totalGETFund * 100) / 100;
    seller.totalCovidLevy = Math.round(seller.totalCovidLevy * 100) / 100;
    seller.totalTax = Math.round(seller.totalTax * 100) / 100;
    seller.totalSales = Math.round(seller.totalSales * 100) / 100;
    seller.vatWithheld = Math.round((seller.vatWithheld || 0) * 100) / 100;
  });

  // Get withholding tax summary
  const withholdingQuery = {};
  if (startDate || endDate) {
    withholdingQuery.dateCollected = {};
    if (startDate) {
      withholdingQuery.dateCollected.$gte = new Date(startDate);
    }
    if (endDate) {
      withholdingQuery.dateCollected.$lte = new Date(endDate);
    }
  }
  if (sellerId) {
    withholdingQuery.sellerId = mongoose.Types.ObjectId(sellerId);
  }

  const withholdingTaxes = await TaxCollection.find(withholdingQuery);
  const totalWithholdingCollected = withholdingTaxes.reduce((sum, tax) => sum + (tax.amount || 0), 0);
  const totalWithholdingRemitted = withholdingTaxes
    .filter(tax => tax.remitted)
    .reduce((sum, tax) => sum + (tax.amount || 0), 0);
  const totalWithholdingUnremitted = totalWithholdingCollected - totalWithholdingRemitted;

  res.status(200).json({
    status: 'success',
    period: {
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
    },
    summary: {
      totalBasePrice,
      totalVAT,
      totalNHIL,
      totalGETFund,
      totalCovidLevy,
      totalTax,
      totalSales,
      orderCount,
      vatWithheldByPlatform,
      totalWithholdingCollected: Math.round(totalWithholdingCollected * 100) / 100,
      totalWithholdingRemitted: Math.round(totalWithholdingRemitted * 100) / 100,
      totalWithholdingUnremitted: Math.round(totalWithholdingUnremitted * 100) / 100,
    },
    breakdown: {
      bySeller: Object.values(sellerBreakdown),
    },
  });
});

/**
 * Get Unremitted VAT
 * GET /api/v1/admin/tax/unremitted
 * Shows VAT that has been collected but not yet remitted to GRA
 */
exports.getUnremittedVAT = catchAsync(async (req, res, next) => {
  const { startDate, endDate } = req.query;

  // Build query for orders that have been paid but VAT not remitted
  const query = {
    paymentStatus: { $in: ['paid', 'completed'] },
    status: { $in: ['confirmed', 'processing', 'shipped', 'delivered', 'completed'] },
  };

  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) {
      query.createdAt.$gte = new Date(startDate);
    }
    if (endDate) {
      query.createdAt.$lte = new Date(endDate);
    }
  }

  const orders = await Order.find(query)
    .select('orderNumber totalVAT totalNHIL totalGETFund totalCovidLevy totalTax totalPrice createdAt paymentStatus status');

  let totalUnremittedVAT = 0;
  let totalUnremittedNHIL = 0;
  let totalUnremittedGETFund = 0;
  let totalUnremittedCovidLevy = 0;
  let totalUnremittedTax = 0;

  const unremittedOrders = orders.map((order) => {
    totalUnremittedVAT += order.totalVAT || 0;
    totalUnremittedNHIL += order.totalNHIL || 0;
    totalUnremittedGETFund += order.totalGETFund || 0;
    totalUnremittedCovidLevy += order.totalCovidLevy || 0;
    totalUnremittedTax += order.totalTax || 0;

    return {
      orderNumber: order.orderNumber,
      orderId: order._id,
      totalVAT: order.totalVAT || 0,
      totalNHIL: order.totalNHIL || 0,
      totalGETFund: order.totalGETFund || 0,
      totalCovidLevy: order.totalCovidLevy || 0,
      totalTax: order.totalTax || 0,
      totalPrice: order.totalPrice || 0,
      createdAt: order.createdAt,
      paymentStatus: order.paymentStatus,
      status: order.status,
    };
  });

  // Round totals
  totalUnremittedVAT = Math.round(totalUnremittedVAT * 100) / 100;
  totalUnremittedNHIL = Math.round(totalUnremittedNHIL * 100) / 100;
  totalUnremittedGETFund = Math.round(totalUnremittedGETFund * 100) / 100;
  totalUnremittedCovidLevy = Math.round(totalUnremittedCovidLevy * 100) / 100;
  totalUnremittedTax = Math.round(totalUnremittedTax * 100) / 100;

  res.status(200).json({
    status: 'success',
    period: {
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
    },
    summary: {
      totalUnremittedVAT,
      totalUnremittedNHIL,
      totalUnremittedGETFund,
      totalUnremittedCovidLevy,
      totalUnremittedTax,
      orderCount: unremittedOrders.length,
    },
    orders: unremittedOrders,
  });
});

/**
 * Get Tax Rates (for reference)
 * GET /api/v1/admin/tax/rates
 */
exports.getTaxRates = catchAsync(async (req, res, next) => {
  const taxService = require('../../services/tax/taxService');
  const rates = await taxService.getTaxRates();

  res.status(200).json({
    status: 'success',
    data: {
      rates: {
        vat: {
          rate: rates.vat,
          percentage: (rates.vat * 100).toFixed(1) + '%',
          description: 'Value Added Tax',
        },
        nhil: {
          rate: rates.nhil,
          percentage: (rates.nhil * 100).toFixed(1) + '%',
          description: 'National Health Insurance Levy',
        },
        getfund: {
          rate: rates.getfund,
          percentage: (rates.getfund * 100).toFixed(1) + '%',
          description: 'Ghana Education Trust Fund Levy',
        },
        totalVATComponents: {
          rate: rates.totalVATComponents,
          percentage: (rates.totalVATComponents * 100).toFixed(0) + '%',
          description: 'Total VAT components (embedded in price)',
        },
        covidLevy: {
          rate: rates.covidLevy,
          percentage: (rates.covidLevy * 100).toFixed(0) + '%',
          description: 'COVID-19 Health Recovery Levy (added on top)',
        },
      },
      note: 'Prices are VAT-inclusive. VAT components (15%) are embedded in the price. COVID levy (1%) is added on top.',
    },
  });
});

/**
 * Mark withholding tax as remitted
 * POST /api/v1/admin/tax/mark-remitted
 * Body: { taxCollectionIds: [String], remittedBy: String }
 */
exports.markTaxRemitted = catchAsync(async (req, res, next) => {
  const { taxCollectionIds, remittedBy } = req.body;
  const adminId = req.user.id;

  if (!taxCollectionIds || !Array.isArray(taxCollectionIds) || taxCollectionIds.length === 0) {
    return next(new AppError('taxCollectionIds array is required', 400));
  }

  // Validate all IDs
  const validIds = taxCollectionIds.filter(id => mongoose.Types.ObjectId.isValid(id));
  if (validIds.length !== taxCollectionIds.length) {
    return next(new AppError('Invalid tax collection ID(s) provided', 400));
  }

  // Update tax collections
  const result = await TaxCollection.updateMany(
    { _id: { $in: validIds }, remitted: false },
    {
      $set: {
        remitted: true,
        remittedAt: new Date(),
        remittedBy: remittedBy || adminId,
      },
    }
  );

  res.status(200).json({
    status: 'success',
    message: `Marked ${result.modifiedCount} tax collection(s) as remitted`,
    data: {
      updatedCount: result.modifiedCount,
      totalRequested: taxCollectionIds.length,
    },
  });
});

/**
 * Get withholding tax collection details
 * GET /api/v1/admin/tax/withholding
 * Query params: startDate, endDate, sellerId, remitted
 */
exports.getWithholdingTax = catchAsync(async (req, res, next) => {
  const { startDate, endDate, sellerId, remitted } = req.query;

  const query = {};

  if (startDate || endDate) {
    query.dateCollected = {};
    if (startDate) {
      query.dateCollected.$gte = new Date(startDate);
    }
    if (endDate) {
      query.dateCollected.$lte = new Date(endDate);
    }
  }

  if (sellerId) {
    query.sellerId = mongoose.Types.ObjectId(sellerId);
  }

  if (remitted !== undefined) {
    query.remitted = remitted === 'true';
  }

  const taxCollections = await TaxCollection.find(query)
    .populate('sellerId', 'name shopName email')
    .populate('withdrawalId', 'amount amountRequested amountPaidToSeller')
    .populate('remittedBy', 'name email')
    .sort('-dateCollected');

  const summary = {
    totalCollected: 0,
    totalRemitted: 0,
    totalUnremitted: 0,
    byCategory: {
      individual: { collected: 0, remitted: 0 },
      company: { collected: 0, remitted: 0 },
    },
  };

  taxCollections.forEach((tax) => {
    summary.totalCollected += tax.amount || 0;
    if (tax.remitted) {
      summary.totalRemitted += tax.amount || 0;
    } else {
      summary.totalUnremitted += tax.amount || 0;
    }

    const category = tax.taxCategory || 'individual';
    summary.byCategory[category].collected += tax.amount || 0;
    if (tax.remitted) {
      summary.byCategory[category].remitted += tax.amount || 0;
    }
  });

  // Round all values
  summary.totalCollected = Math.round(summary.totalCollected * 100) / 100;
  summary.totalRemitted = Math.round(summary.totalRemitted * 100) / 100;
  summary.totalUnremitted = Math.round(summary.totalUnremitted * 100) / 100;
  summary.byCategory.individual.collected = Math.round(summary.byCategory.individual.collected * 100) / 100;
  summary.byCategory.individual.remitted = Math.round(summary.byCategory.individual.remitted * 100) / 100;
  summary.byCategory.company.collected = Math.round(summary.byCategory.company.collected * 100) / 100;
  summary.byCategory.company.remitted = Math.round(summary.byCategory.company.remitted * 100) / 100;

  res.status(200).json({
    status: 'success',
    period: {
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
    },
    summary,
    data: {
      taxCollections: taxCollections.map((tax) => ({
        _id: tax._id,
        seller: tax.sellerId,
        withdrawal: tax.withdrawalId,
        amount: tax.amount,
        rate: tax.rate,
        taxCategory: tax.taxCategory,
        dateCollected: tax.dateCollected,
        remitted: tax.remitted,
        remittedAt: tax.remittedAt,
        remittedBy: tax.remittedBy,
        metadata: tax.metadata,
      })),
    },
  });
});

