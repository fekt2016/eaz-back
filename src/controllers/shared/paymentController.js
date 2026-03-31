const Payment = require('../../models/payment/paymentModel');
const Order = require('../../models/order/orderModel');
const PaymentRequest = require('../../models/payment/paymentRequestModel');
const Seller = require('../../models/user/sellerModel');
const Transaction = require('../../models/transaction/transactionModel');
const PaymentMethod = require('../../models/payment/PaymentMethodModel');
const User = require('../../models/user/userModel');
const SellerOrder = require('../../models/order/sellerOrderModel');
const handleFactory = require('../shared/handleFactory');
const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const { sendPaymentNotification } = require('../../utils/helpers/notificationService');
const axios = require('axios');
const mongoose = require('mongoose');
const { logSellerRevenue } = require('../../services/historyLogger');
const payoutService = require('../../services/payoutService');
const logger = require('../../utils/logger');

const sendBuyerPaymentSuccessPush = async (order, transaction, source) => {
  try {
    const pushNotificationService = require('../../services/pushNotificationService');
    const buyerId = order?.user?._id || order?.user;
    if (!buyerId) return;

    const paymentChannel =
      transaction?.channel ||
      transaction?.authorization?.channel ||
      order?.paymentMethod ||
      'paystack';

    await pushNotificationService.sendPushToUser(String(buyerId), {
      title: 'Payment Successful',
      body: `Payment for order #${order.orderNumber} was successful.`,
      data: {
        type: 'PAYMENT_SUCCESS',
        orderId: String(order._id),
        amount: Number(order.totalPrice || 0),
        currency: 'GHS',
        paymentChannel,
        paymentMethod: order.paymentMethod || 'paystack',
        source,
        referenceId: String(order._id),
      },
      priority: 'high',
    });
  } catch (pushError) {
    logger.error('[Payment Push] Failed to send PAYMENT_SUCCESS push:', pushError.message);
  }
};

const sendBuyerPaymentFailedPush = async (order, transaction, source) => {
  try {
    const pushNotificationService = require('../../services/pushNotificationService');
    const buyerId = order?.user?._id || order?.user;
    if (!buyerId) return;

    const paymentChannel =
      transaction?.channel ||
      transaction?.authorization?.channel ||
      order?.paymentMethod ||
      'paystack';

    await pushNotificationService.sendPushToUser(String(buyerId), {
      title: 'Payment Failed',
      body: `Payment for order #${order.orderNumber} could not be completed.`,
      data: {
        type: 'PAYMENT_FAILED',
        orderId: String(order._id),
        amount: Number(order.totalPrice || 0),
        currency: 'GHS',
        paymentChannel,
        paymentMethod: order.paymentMethod || 'paystack',
        source,
        referenceId: String(order._id),
      },
      priority: 'high',
    });
  } catch (pushError) {
    logger.error('[Payment Push] Failed to send PAYMENT_FAILED push:', pushError.message);
  }
};

const sendBuyerPaymentSuccessEmail = async (order, source) => {
  try {
    const emailDispatcher = require('../../emails/emailDispatcher');
    const buyerId = order?.user?._id || order?.user;
    if (!buyerId) return;

    const buyer = await User.findById(buyerId).select('name email').lean();
    if (!buyer?.email) return;

    await emailDispatcher.sendPaymentSuccess(buyer, order);
    logger.info(
      `[Payment Email] ✅ PAYMENT_SUCCESS email sent to ${buyer.email} (${source})`
    );
  } catch (emailError) {
    logger.error(
      '[Payment Email] Failed to send PAYMENT_SUCCESS email:',
      emailError.message
    );
  }
};

const sendBuyerPaymentFailedEmail = async (order, reason, source) => {
  try {
    const emailDispatcher = require('../../emails/emailDispatcher');
    const buyerId = order?.user?._id || order?.user;
    if (!buyerId) return;

    const buyer = await User.findById(buyerId).select('name email').lean();
    if (!buyer?.email) return;

    await emailDispatcher.sendPaymentFailed(buyer, order, reason);
    logger.info(
      `[Payment Email] ✅ PAYMENT_FAILED email sent to ${buyer.email} (${source})`
    );
  } catch (emailError) {
    logger.error(
      '[Payment Email] Failed to send PAYMENT_FAILED email:',
      emailError.message
    );
  }
};

const sendSellerOrderEmailsAfterPayment = async (orderId, source) => {
  try {
    const emailDispatcher = require('../../emails/emailDispatcher');
    const fullOrder = await Order.findById(orderId)
      .populate('orderItems')
      .populate({
        path: 'sellerOrder',
        populate: { path: 'seller', select: 'email name shopName' },
      })
      .lean();

    if (!fullOrder?.sellerOrder?.length) {
      return;
    }

    for (const sellerOrder of fullOrder.sellerOrder) {
      const seller = sellerOrder?.seller;
      if (!seller?.email) continue;

      try {
        await emailDispatcher.sendSellerNewOrder(seller, fullOrder);
        logger.info(
          `[Payment Email] ✅ Seller new-order email sent to ${seller.email} (${source})`
        );
      } catch (sellerEmailError) {
        logger.error(
          `[Payment Email] Failed seller new-order email (${source}) for ${seller.email}:`,
          sellerEmailError.message
        );
      }
    }
  } catch (error) {
    logger.error(
      `[Payment Email] Failed to prepare seller emails (${source}):`,
      error.message
    );
  }
};

const sendAdminOrderPaidAlertAfterPayment = async (orderId, source) => {
  try {
    const emailDispatcher = require('../../emails/emailDispatcher');
    const fullOrder = await Order.findById(orderId).lean();
    if (!fullOrder) return;

    await emailDispatcher.sendAdminOrderPaidAlert(fullOrder);
    logger.info(
      `[Payment Email] ✅ Admin paid-order alert sent (source: ${source}, order: ${orderId})`
    );
  } catch (error) {
    logger.error(
      `[Payment Email] Failed admin paid-order alert (${source}):`,
      error.message
    );
  }
};

exports.getAllPayment = handleFactory.getAll(Payment);
exports.getPayment = handleFactory.getOne(Payment);
exports.createPayment = handleFactory.createOne(Payment);
exports.deletePayment = handleFactory.deleteOne(Payment);
exports.updatePayment = handleFactory.updateOne(Payment);

// Initialize Paystack payment for mobile money
exports.initializePaystack = catchAsync(async (req, res, next) => {
  // SECURITY: Never log payment inputs in production.
  // In dev we only log non-sensitive keys to help troubleshoot payload shape.
  if (process.env.NODE_ENV === 'development') {
    logger.debug('[initializePaystack] DEBUG keys:', Object.keys(req.body || {}));
  }

  const { orderId, email, callbackBaseUrl } = req.body;

  // SECURITY: Do NOT accept amount from request body - always calculate from order
  // Enhanced validation
  const missingFields = [];
  if (!orderId) missingFields.push('orderId');

  if (missingFields.length > 0) {
    logger.warn('[initializePaystack] Missing required fields:', missingFields);
    return next(
      new AppError(
        'Invalid request. Please provide all required information.',
        400
      )
    );
  }

  // Verify order exists and belongs  // Fetch order to verify amount
  const order = await Order.findById(orderId).populate('user', 'email name');

  if (!order) {
    return next(new AppError('Requested resource not found', 404));
  }

  // SECURITY FIX: Verify order is payable before allowing payment initialization.
  // Allow retries for any unpaid state, but block clearly non-payable states.
  const paymentStatus = String(order.paymentStatus || '').toLowerCase();
  const status = String(order.status || '').toLowerCase();
  const orderStatus = String(order.orderStatus || '').toLowerCase();
  const isAlreadyPaid = ['paid', 'completed'].includes(paymentStatus);
  const isRefunded = ['refunded', 'partial_refund'].includes(paymentStatus);
  const isCancelled =
    status === 'cancelled' || orderStatus === 'cancelled';

  if (isAlreadyPaid || isRefunded || isCancelled) {
    logger.warn('[Payment Init] Order is not payable in current state:', {
      paymentStatus: order.paymentStatus,
      status: order.status,
      orderStatus: order.orderStatus,
    });
    return next(new AppError('This order cannot be paid in its current state.', 400));
  }

  // Resolve payer email safely:
  // 1) request body email
  // 2) populated order.user.email
  // 3) DB lookup by order.user
  let payerEmail = typeof email === 'string' ? email.trim() : '';
  if (!payerEmail) {
    payerEmail = order.user?.email || '';
  }
  if (!payerEmail) {
    const buyerDoc = await User.findById(order.user).select('email').lean();
    payerEmail = buyerDoc?.email || '';
  }
  if (!payerEmail) {
    return next(new AppError('Unable to initialize payment at this time. Please update your account email and try again.', 400));
  }

  // SECURITY FIX #15: Server-side amount validation
  // NEVER trust frontend amount - always use server-side order values.
  const toNumber = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  };

  const serverAmount =
    toNumber(order.totalPrice) ||
    toNumber(order.totalAmount) ||
    (toNumber(order.subtotal) + toNumber(order.shippingCost) - toNumber(order.discountAmount));

  // SECURITY: Avoid logging order/payment details.

  // CRITICAL: Validate that order has a valid totalPrice
  if (!serverAmount || serverAmount === null || serverAmount === undefined || isNaN(serverAmount)) {
    logger.warn('[Payment Init] Invalid order totalPrice:', serverAmount);
    logger.warn('[Payment Init] Order details snapshot:', {
      totalPrice: order.totalPrice,
      subtotal: order.subtotal,
      shippingCost: order.shippingCost,
      orderItems: order.orderItems?.length || 0,
    });
    return next(new AppError('Invalid request. Please try again or contact support.', 400));
  }

  if (serverAmount <= 0) {
    logger.warn('[Payment Init] Order totalPrice is <= 0:', serverAmount);
    logger.warn('[Payment Init] Order details snapshot:', {
      totalPrice: order.totalPrice,
      subtotal: order.subtotal,
      shippingCost: order.shippingCost,
      discountAmount: order.discountAmount,
      orderItems: order.orderItems?.length || 0,
    });
    return next(new AppError('Invalid request. Please try again or contact support.', 400));
  }

  // SECURITY: Ignore any amount sent in request body - always use server-calculated amount
  // Frontend should not send amount at all, but if it does, we ignore it for security

  // SECURITY: Use server amount for Paystack, not frontend amount
  const paystackAmount = Math.round(serverAmount * 100); // Convert to kobo/pesewas

  // CRITICAL: Validate Paystack amount is valid (must be > 0 after conversion)
  if (!paystackAmount || paystackAmount <= 0 || isNaN(paystackAmount)) {
    logger.warn('[Payment Init] Invalid Paystack amount calculated:', {
      serverAmount,
      paystackAmount,
    });
    return next(new AppError('Invalid request. Please try again or contact support.', 400));
  }

  // SECURITY: do not log identifiers/authorization info.

  // Handle populated user object (from .populate('user'))
  const orderUserId = order.user?._id
    ? order.user._id.toString()
    : order.user?.id
      ? order.user.id.toString()
      : order.user?.toString() || String(order.user);

  const requestUserId = req.user?._id
    ? req.user._id.toString()
    : req.user?.id?.toString() || String(req.user.id);

  if (orderUserId !== requestUserId) {
    if (process.env.NODE_ENV === 'development') {
      logger.debug('[Payment Init] Authorization failed: user mismatch');
    }
    return next(new AppError('You do not have permission to perform this action', 403));
  }

  // Get Paystack secret key from environment
  const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
  if (!PAYSTACK_SECRET_KEY) {
    return next(new AppError('Service temporarily unavailable. Please contact support.', 500));
  }

  // Prepare Paystack initialization request payload
  // IMPORTANT: Paystack behavior with callback_url:
  // - If callback_url has NO query params: Paystack appends ?reference=xxx&trxref=xxx
  // - If callback_url HAS query params: Paystack appends &reference=xxx&trxref=xxx
  //
  // Callback must point to the customer app (e.g. https://saiisai.com), never to admin.
  // We accept any valid http(s) URL that is not admin-like. No hardcoded localhost.

  const rejectAdmin = (u) => {
    if (!u || typeof u !== 'string') return true;
    const s = u.toLowerCase();
    return s.includes('admin') || s.includes('eazadmin') || s.includes(':5174');
  };

  const isPublicCallbackHost = (normalizedUrl) => {
    if (!normalizedUrl) return false;
    try {
      const parsed = new URL(normalizedUrl);
      const host = parsed.hostname.toLowerCase();
      const isIpv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host);
      const isIpv6 = host.includes(':');

      if (
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '0.0.0.0' ||
        host.endsWith('.local')
      ) {
        return false;
      }

      // Private LAN ranges are not reachable by Paystack callbacks.
      if (
        /^10\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
      ) {
        return false;
      }

      // Force domain-based callbacks for Paystack (avoid raw IP redirects).
      if (isIpv4 || isIpv6) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  };

  const normalizeCallbackBaseUrl = (candidateUrl) => {
    if (!candidateUrl || typeof candidateUrl !== 'string') return null;

    const trimmed = candidateUrl.trim().replace(/\/$/, '');
    if (!trimmed) return null;
    if (!/^https?:\/\//i.test(trimmed)) return null;

    try {
      const parsed = new URL(trimmed);
      const host = parsed.hostname.toLowerCase();
      const isLocalHost =
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '0.0.0.0';

      // Paystack/browser redirects are more reliable with TLS in non-local envs.
      if (parsed.protocol === 'http:' && !isLocalHost) {
        parsed.protocol = 'https:';
      }

      return parsed.toString().replace(/\/$/, '');
    } catch (error) {
      logger.warn(
        '[Paystack Initialize] Invalid callback base URL candidate ignored'
      );
      return null;
    }
  };

  const envCallback = process.env.PAYSTACK_CALLBACK_BASE_URL;
  const envFrontend = process.env.FRONTEND_URL;
  const envMain = process.env.MAIN_APP_URL;
  const envEazmain = process.env.EAZMAIN_URL;

  logger.info('[Paystack Initialize] 🔍 Environment Variables:', {
    PAYSTACK_CALLBACK_BASE_URL: envCallback ? '[SET]' : 'NOT SET',
    FRONTEND_URL: envFrontend || 'NOT SET',
    MAIN_APP_URL: envMain || 'NOT SET',
    EAZMAIN_URL: envEazmain || 'NOT SET',
    NODE_ENV: process.env.NODE_ENV || 'undefined',
  });

  // Priority: request callbackBaseUrl > PAYSTACK_CALLBACK_BASE_URL > FRONTEND_URL
  // > MAIN_APP_URL > EAZMAIN_URL
  // Accept any valid http(s) URL that is not admin-like (e.g. https://saiisai.com works).
  let baseUrl = null;
  const candidateSources = [
    { value: callbackBaseUrl, source: 'request.callbackBaseUrl' },
    { value: envCallback, source: 'PAYSTACK_CALLBACK_BASE_URL' },
    { value: envFrontend, source: 'FRONTEND_URL' },
    { value: envMain, source: 'MAIN_APP_URL' },
    { value: envEazmain, source: 'EAZMAIN_URL' },
  ];

  for (const { value, source } of candidateSources) {
    const candidate = value;
    const normalized = normalizeCallbackBaseUrl(candidate);
    if (!normalized) continue;
    if (rejectAdmin(normalized)) {
      logger.warn('[Paystack Initialize] Skipping admin-like URL:', normalized);
      continue;
    }
    if (!isPublicCallbackHost(normalized)) {
      logger.warn(
        '[Paystack Initialize] Skipping non-public/non-domain callback URL:',
        normalized
      );
      continue;
    }
    baseUrl = normalized;
    logger.info(`[Paystack Initialize] ✅ Using base URL from ${source}:`, baseUrl);
    break;
  }

  // Production-only fallback: if no env is set, use customer domain so payments don't break.
  // Still no localhost – only when NODE_ENV=production.
  if (!baseUrl && process.env.NODE_ENV === 'production') {
    baseUrl = process.env.PAYSTACK_CALLBACK_DEFAULT || 'https://saiisai.com';
    logger.info('[Paystack Initialize] ✅ Using production default base URL:', baseUrl);
  }

  // Development fallback: if no env is set and we're in development, use localhost:5173
  if (!baseUrl && (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV)) {
    baseUrl = 'http://localhost:5173';
    logger.info('[Paystack Initialize] ✅ Using development default base URL:', baseUrl);
  }

  if (!baseUrl) {
    logger.error(
      '[Paystack Initialize] ❌ No valid frontend URL configured. ' +
      'Set PAYSTACK_CALLBACK_BASE_URL or FRONTEND_URL (and ensure it is not an admin URL).'
    );
    return next(
      new AppError(
        'Payment configuration error. Please contact support.',
        500
      )
    );
  }

  // FINAL VALIDATION: if baseUrl looks like an admin URL, treat it as a
  // misconfiguration and fail instead of silently forcing localhost.
  if (
    baseUrl.includes('/admin') ||
    baseUrl.includes('eazadmin') ||
    baseUrl.includes(':5174') ||
    baseUrl.toLowerCase().includes('admin')
  ) {
    logger.error(
      '[Paystack Initialize] ❌ Base URL points to an admin host. ' +
      'Please set PAYSTACK_CALLBACK_BASE_URL/FRONTEND_URL to the customer domain (e.g. https://saiisai.com).',
      baseUrl
    );
    return next(
      new AppError(
        'Payment configuration error. Please contact support.',
        500
      )
    );
  }

  // Remove trailing slash and ensure clean URL
  const cleanBaseUrl = baseUrl.replace(/\/$/, '');

  // Final sanity check - ensure we're using port 5173 (eazmain), not 5174 (admin)
  if (cleanBaseUrl.includes(':5174')) {
    logger.error('[Paystack Initialize] ❌ CRITICAL: URL still contains admin port 5174!');
    const safeBaseUrl = cleanBaseUrl.replace(/:5174/g, ':5173');
    logger.info('[Paystack Initialize] ✅ Replaced admin port with eazmain port:', safeBaseUrl);
    baseUrl = safeBaseUrl;
  } else {
    baseUrl = cleanBaseUrl;
  }

  // Construct callback URL with orderId parameter.
  // Paystack will append: &reference=xxx&trxref=xxx (since we already have ?orderId=)
  // baseUrl is already validated and cleaned above, so use it directly.
  const callbackUrl = `${baseUrl}/order-confirmation?orderId=${order._id}`;

  // SECURITY: Never log callback URLs or order identifiers.
  // In development we only log which base URL was selected.
  if (process.env.NODE_ENV === 'development') {
    logger.info('[Paystack Initialize] Environment variables check:', {
      MAIN_APP_URL: process.env.MAIN_APP_URL || 'NOT SET',
      EAZMAIN_URL: process.env.EAZMAIN_URL || 'NOT SET',
      FRONTEND_URL: process.env.FRONTEND_URL || 'NOT SET',
      ADMIN_URL: process.env.ADMIN_URL || 'NOT SET',
      selectedBaseUrl: baseUrl,
    });
  }

  // Final validation of the complete callback URL – if it looks like an admin
  // URL, fail fast instead of silently changing it.
  if (
    callbackUrl.includes('/admin') ||
    callbackUrl.includes('eazadmin') ||
    callbackUrl.includes(':5174') ||
    callbackUrl.toLowerCase().includes('admin')
  ) {
    logger.error(
      '[Paystack Initialize] ❌ CRITICAL ERROR: Callback URL points to admin app!',
      callbackUrl
    );
    return next(
      new AppError(
        'Payment configuration error. Please contact support.',
        500
      )
    );
  }

  if (process.env.NODE_ENV === 'development') {
    logger.info('[Paystack Initialize] Callback URL configured correctly (dev only)');
  }

  const payload = {
    email: payerEmail,
    amount: paystackAmount, // Use server-calculated amount in kobo/pesewas
    metadata: {
      orderId: order._id.toString(),
      custom_fields: [
        {
          display_name: 'Order ID',
          variable_name: 'order_id',
          value: order._id.toString(),
        },
      ],
    },
    callback_url: callbackUrl,
  };

  // SECURITY: avoid logging callback URLs / order IDs

  try {
    // Make request to Paystack using axios
    const response = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      payload,
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (response.data.status === true && response.data.data) {
      // Update order with payment reference
      order.paymentReference = response.data.data.reference;
      await order.save({ validateBeforeSave: false });

      res.status(200).json({
        status: 'success',
        data: {
          authorization_url: response.data.data.authorization_url,
        },
      });
    } else {
      return next(
        new AppError(
          response.data.message || 'Failed to initialize payment',
          400
        )
      );
    }
  } catch (error) {
    logger.error('Paystack API error:', error.response?.data || error.message);
    return next(
      new AppError(
        error.response?.data?.message || 'Payment initialization failed',
        500
      )
    );
  }
});

// Verify Paystack payment and update order status
exports.verifyPaystackPayment = catchAsync(async (req, res, next) => {
  const { reference, orderId } = req.body || {};

  // Validate input (basic guard; full validation is done in middleware)
  if (!reference) return next(new AppError('Invalid request.', 400));

  // Get Paystack secret key from environment
  const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
  if (!PAYSTACK_SECRET_KEY) {
    return next(new AppError('Service temporarily unavailable. Please contact support.', 500));
  }

  const buyerId = req.user?.id ?? req.user?._id;
  if (!buyerId) {
    return next(new AppError('You are not logged in! Please log in to get access.', 401));
  }

  try {
    logger.info('[Payment Verification] Verifying Paystack payment');

    // Verify payment with Paystack
    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        },
      }
    );

    logger.info(`[Payment Verification] Paystack response status: ${response.data?.status}`);

    // Check if Paystack returned an error
    if (response.data.status === false) {
      const errorMessage = response.data.message || 'Payment verification failed';
      logger.error(`[Payment Verification] Paystack returned error: ${errorMessage}`);
      return next(new AppError(errorMessage, 400));
    }

    // Check if response has the expected structure
    if (!response.data || response.data.status !== true || !response.data.data) {
      logger.error('[Payment Verification] Invalid Paystack response structure');
      return next(new AppError('Request could not be processed. Please try again.', 400));
    }

    const transaction = response.data.data;
    logger.info(`[Payment Verification] Transaction status: ${transaction.status}`);

    // Find order by reference or orderId
    let order;
    if (orderId) {
      order = await Order.findById(orderId);
      if (process.env.NODE_ENV === 'development') {
        logger.info(`[Payment Verification] Found order by ID (dev): ${order ? order._id : 'not found'}`);
      }
    } else {
      // Find order by payment reference
      order = await Order.findOne({ paymentReference: reference });
      if (process.env.NODE_ENV === 'development') {
        logger.info(
          `[Payment Verification] Found order by reference (dev): ${order ? order._id : 'not found'}`
        );
      }
    }

    if (!order) {
      if (process.env.NODE_ENV === 'development') {
        logger.debug('[Payment Verification] Order not found (dev)');
      }
      return next(new AppError('Requested resource not found', 404));
    }

    // Check if payment was successful
    if (transaction.status === 'success') {
      // SECURITY: Prevent IDOR. Only allow the logged-in buyer to transition
      // their own order to paid/confirmed.
      const orderOwnerId = order.user?._id ? order.user._id : order.user;
      if (!orderOwnerId || orderOwnerId.toString() !== buyerId.toString()) {
        return next(new AppError('You are not authorized to perform this action', 403));
      }

      // SECURITY: If Paystack included an orderId in metadata, ensure it matches.
      const transactionOrderId = transaction?.metadata?.orderId;
      if (transactionOrderId && order._id.toString() !== transactionOrderId.toString()) {
        return next(new AppError('Payment order mismatch', 400));
      }

      if (process.env.NODE_ENV === 'development') {
        logger.info('[Payment Verification] Payment successful (dev)');
      }

      // Prevent double updates - if already paid/completed, return existing order
      if (['paid', 'completed'].includes(order.paymentStatus)) {
        const hasCancelledStatus =
          order.status === 'cancelled' ||
          order.currentStatus === 'cancelled' ||
          order.orderStatus === 'cancelled';

        // Self-heal legacy/inconsistent records: paid orders must not remain cancelled.
        if (hasCancelledStatus) {
          order.status = 'confirmed';
          order.currentStatus = 'confirmed';
          order.orderStatus = 'confirmed';
          await order.save({ validateBeforeSave: false });
        }

        if (process.env.NODE_ENV === 'development') {
          logger.info('[Payment Verification] Order already paid/completed (dev)');
        }
        return res.status(200).json({
          success: true,
          status: 'success',
          message: 'Payment already verified',
          orderId: order._id.toString(),
          data: {
            order: {
              _id: order._id,
              orderNumber: order.orderNumber,
              trackingNumber: order.trackingNumber,
              paymentStatus: order.paymentStatus,
              status: order.status,
              currentStatus: order.currentStatus,
              orderStatus: order.orderStatus,
            },
          },
        });
      }

      // Update order payment status
      order.paymentStatus = 'paid';
      order.paymentReference = reference;
      order.paymentMethod = 'paystack';

      // Update order status to confirmed (IMPORTANT - this is what admin/seller see)
      order.status = 'confirmed';
      order.currentStatus = 'confirmed';
      order.orderStatus = 'confirmed'; // CRITICAL: Set to confirmed for admin/seller pages

      // Set seller payout status to pending (will be paid on delivery)
      order.sellerPayoutStatus = 'pending';

      // Store revenue amount
      order.revenueAmount = order.totalPrice || 0;

      // Store transaction details
      order.transactionId = transaction.id?.toString();
      order.paidAt = transaction.paid_at ? new Date(transaction.paid_at) : new Date();

      // Update tracking system: Add confirmed entry if not already present
      order.trackingHistory = order.trackingHistory || [];

      // Check if confirmed entry already exists
      const hasConfirmed = order.trackingHistory.some(
        entry => entry.status === 'confirmed'
      );

      if (!hasConfirmed) {
        // Add confirmed entry (order is confirmed after payment)
        order.trackingHistory.push({
          status: 'confirmed',
          message: 'Your order has been confirmed and payment received.',
          location: '',
          updatedBy: order.user,
          updatedByModel: 'User',
          timestamp: order.paidAt || new Date(),
        });
      }

      // Add revenue to admin revenue immediately (at payment time)
      if (!order.revenueAdded) {
        const PlatformStats = require('../../models/platform/platformStatsModel');
        const orderTotal = order.totalPrice || 0;

        if (orderTotal > 0) {
          const platformStats = await PlatformStats.getStats();
          platformStats.totalRevenue = (platformStats.totalRevenue || 0) + orderTotal;
          platformStats.addDailyRevenue(new Date(), orderTotal, 0); // 0 for orders count (will be incremented on delivery)
          platformStats.lastUpdated = new Date();
          await platformStats.save();

          // Store revenue amount on order
          order.revenueAmount = orderTotal;
          order.revenueAdded = true;

          logger.info(`[Payment Verification] Added GH₵${orderTotal} to platform revenue for order ${order._id}`);
        }
      }

      // Log payment activity
      const { logActivityAsync } = require('../../modules/activityLog/activityLog.service');
      logActivityAsync({
        userId: order.user,
        role: 'buyer',
        action: 'PAYMENT',
        description: `Payment of GH₵${order.totalPrice?.toFixed(2) || '0.00'} via Paystack for order #${order.orderNumber}`,
        req,
        metadata: {
          orderId: order._id,
          orderNumber: order.orderNumber,
          paymentMethod: 'paystack',
          amount: order.totalPrice,
          type: 'payment',
        },
      });

      await order.save({ validateBeforeSave: false });
      if (process.env.NODE_ENV === 'development') {
        logger.info('[Payment Verification] Order updated successfully (dev)');
      }

      await sendBuyerPaymentSuccessPush(order, transaction, 'verify');

      // Stock was already reduced at order creation.

      // Update product totalSold count after payment is confirmed
      const orderController = require('./orderController');
      try {
        await orderController.updateProductTotalSold(order);
        if (process.env.NODE_ENV === 'development') {
          logger.debug('[Payment Verification] Updated product totalSold (dev)');
        }
      } catch (soldError) {
        // Log error but don't fail payment - sold count update is non-critical
        logger.error('[Payment Verification] Error updating product totalSold:', {
          message: soldError?.message,
        });
      }

      // Sync SellerOrder status and payment status (DO NOT credit sellers - they get paid on delivery)
      try {
        const { syncSellerOrderStatus } = require('../../utils/helpers/syncSellerOrderStatus');
        const SellerOrder = require('../../models/order/sellerOrderModel');

        // Sync SellerOrder status to 'confirmed'
        const syncResult = await syncSellerOrderStatus(order._id, 'confirmed');
        logger.info(`[Payment Verification] SellerOrder status sync result:`, syncResult);

        // Update SellerOrder payment status (but DO NOT credit seller balance - that happens on delivery)
        const sellerOrders = await SellerOrder.find({ order: order._id });

        for (const sellerOrder of sellerOrders) {
          // Update SellerOrder payment status and status
          if (sellerOrder.sellerPaymentStatus !== 'paid') {
            sellerOrder.sellerPaymentStatus = 'paid';
            sellerOrder.status = 'confirmed'; // Set to confirmed for seller to see
            sellerOrder.paymentReference = reference;
            sellerOrder.paidAt = order.paidAt;
            await sellerOrder.save({ validateBeforeSave: false });
            if (process.env.NODE_ENV === 'development') {
              logger.info('[Payment Verification] SellerOrder updated (dev)');
            }
          }
        }

        // NOTE: Sellers are NOT credited here - they are credited when order is delivered
        // This prevents seller payout before delivery
      } catch (error) {
        logger.error('[Payment Verification] Error syncing SellerOrder:', error);
        // Don't fail the payment verification if SellerOrder sync fails, but log it
      }

      // Fetch full order with populated fields for response
      const fullOrder = await Order.findById(order._id)
        .populate('user', 'name email')
        .populate('orderItems')
        .lean();

      // Capture snapshot for post-response email (populated before res.json)
      const orderForEmail = fullOrder;
      const savedOrderId = order._id;
      const wasEmailSent = order.confirmationEmailSent;
      const orderUser = order.user;

      // Fire email AFTER the response is sent (after confirmation page renders)
      res.on('finish', () => {
        if (!wasEmailSent) {
          setImmediate(async () => {
            try {
              const emailDispatcher = require('../../emails/emailDispatcher');
              const emailUser = await User.findById(orderUser).select('name email').lean();
              if (emailUser && emailUser.email) {
                await emailDispatcher.sendOrderConfirmation(orderForEmail || { _id: savedOrderId }, emailUser, 'paystack');
                logger.info(`[Payment Verification] ✅ Order confirmation email sent to ${emailUser.email}`);
                // Mark as sent to prevent duplicate from webhook
                Order.findByIdAndUpdate(savedOrderId, { $set: { confirmationEmailSent: true } })
                  .catch(err => logger.error('[Payment Verification] Failed to set confirmationEmailSent:', err.message));
              }

              await sendSellerOrderEmailsAfterPayment(savedOrderId, 'verify');
              await sendAdminOrderPaidAlertAfterPayment(savedOrderId, 'verify');
            } catch (emailErr) {
              logger.error('[Payment Verification] Post-response email failed:', emailErr.message);
            }
          });
        } else {
          logger.info(`[Payment Verification] Email already sent for order ${savedOrderId}, skipping.`);
        }
      });

      res.status(200).json({
        success: true,
        status: 'success',
        message: 'Payment verified successfully',
        orderId: order._id.toString(),
        data: {
          order: {
            _id: order._id,
            orderNumber: order.orderNumber,
            trackingNumber: order.trackingNumber,
            paymentStatus: order.paymentStatus,
            status: order.status,
            currentStatus: order.currentStatus,
            orderStatus: order.orderStatus, // Include orderStatus for admin/seller pages
            sellerPayoutStatus: order.sellerPayoutStatus,
            revenueAmount: order.revenueAmount,
            ...fullOrder,
          },
          transaction: {
            reference: transaction.reference,
            amount: transaction.amount / 100, // Convert from kobo/pesewas
            status: transaction.status,
          },
        },
      });
    } else {
      // Payment failed or pending
      logger.info(`[Payment Verification] Payment not successful. Status: ${transaction.status}`);
      order.paymentStatus = transaction.status === 'failed' ? 'failed' : 'pending';
      await order.save();
      if (transaction.status === 'failed') {
        await sendBuyerPaymentFailedPush(order, transaction, 'verify');
        await sendBuyerPaymentFailedEmail(
          order,
          transaction.gateway_response || transaction.message,
          'verify'
        );
      }

      const statusMessage = transaction.status === 'pending'
        ? 'Payment is still pending. Please wait for confirmation.'
        : 'Payment was not successful';

      return next(new AppError(statusMessage, 400));
    }
  } catch (error) {
    const debug = process.env.NODE_ENV === 'development'
      ? { reference, orderId }
      : {};
    logger.error('[Payment Verification] Error details:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
      ...debug,
    });

    // Handle specific Paystack API errors
    if (error.response?.status === 404) {
      return next(new AppError('Requested resource not found', 404));
    }

    if (error.response?.status === 401) {
      return next(new AppError('Service temporarily unavailable. Please contact support.', 500));
    }

    // Return more specific error message
    const errorMessage = error.response?.data?.message
      || error.message
      || 'Payment verification failed. Please try again or contact support.';

    return next(new AppError(errorMessage, error.response?.status || 500));
  }
});

// Paystack webhook handler (for server-to-server callbacks)
// SECURITY FIX #8: Signature verification is now handled by verifyPaystackWebhook middleware
exports.paystackWebhook = catchAsync(async (req, res, next) => {
  const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

  if (!PAYSTACK_SECRET_KEY) {
    return next(new AppError('Service temporarily unavailable. Please contact support.', 500));
  }

  // Parse webhook event (body is already parsed and verified by verifyPaystackWebhook middleware)
  const event = req.body;

  // Handle successful payment event
  if (event && event.event === 'charge.success') {
    const transaction = event.data;
    if (transaction) {
      const reference = transaction.reference;
      const orderId = transaction.metadata?.orderId;
      const transactionType = transaction.metadata?.type;

      // Handle wallet top-up
      if (transactionType === 'wallet_topup' && transaction.status === 'success') {
        if (process.env.NODE_ENV === 'development') {
          logger.info(`[Paystack Webhook] Processing wallet top-up (dev)`);
        }

        try {
          const walletService = require('../../services/walletService');
          const userId = transaction.metadata?.userId;
          const amount = transaction.amount / 100; // Convert from smallest currency unit

          if (!userId) {
            logger.error('[Paystack Webhook] User ID not found in wallet top-up metadata');
            return res.status(200).json({ received: true });
          }

          // Credit wallet (idempotency check is inside creditWallet)
          const result = await walletService.creditWallet(
            userId,
            amount,
            'CREDIT_TOPUP',
            `Wallet top-up via Paystack - ${reference}`,
            reference,
            {
              paystackReference: reference,
              paystackTransactionId: transaction.id?.toString(),
              email: transaction.customer?.email,
            }
          );

          if (result.isDuplicate) {
            logger.info(`[Paystack Webhook] Wallet top-up ${reference} already processed`);
          } else {
            logger.info(`[Paystack Webhook] Wallet top-up successful: GH₵${amount} credited to user ${userId}`);
          }

          return res.status(200).json({ received: true });
        } catch (error) {
          logger.error('[Paystack Webhook] Error processing wallet top-up:', error);
          // Don't fail webhook, but log error
          return res.status(200).json({ received: true });
        }
      }

      // Handle order payment
      // Find order
      let order;
      if (orderId) {
        order = await Order.findById(orderId);
      } else if (reference) {
        order = await Order.findOne({ paymentReference: reference });
      }

      if (order && transaction.status === 'success') {
        if (process.env.NODE_ENV === 'development') {
          logger.info('[Paystack Webhook] Processing successful payment (dev)');
        }

        // Prevent double updates - if already paid, skip
        if (['paid', 'completed'].includes(order.paymentStatus)) {
          const hasCancelledStatus =
            order.status === 'cancelled' ||
            order.currentStatus === 'cancelled' ||
            order.orderStatus === 'cancelled';

          // Self-heal legacy/inconsistent records: paid orders must not remain cancelled.
          if (hasCancelledStatus) {
            order.status = 'confirmed';
            order.currentStatus = 'confirmed';
            order.orderStatus = 'confirmed';
            await order.save({ validateBeforeSave: false });
          }

          if (process.env.NODE_ENV === 'development') {
            logger.info('[Paystack Webhook] Payment already paid/completed (dev)');
          }
          return res.status(200).json({ received: true });
        }

        // Update order payment status
        order.paymentStatus = 'paid';
        order.paymentReference = reference;
        order.transactionId = transaction.id?.toString();
        order.paidAt = transaction.paid_at ? new Date(transaction.paid_at) : new Date();
        order.paymentMethod = 'paystack';

        // Update order status to confirmed (IMPORTANT - this is what admin/seller see)
        order.status = 'confirmed';
        order.currentStatus = 'confirmed';
        order.orderStatus = 'confirmed'; // CRITICAL: Set to confirmed for admin/seller pages

        // Set seller payout status to pending (will be paid on delivery)
        order.sellerPayoutStatus = 'pending';

        // Store revenue amount
        order.revenueAmount = order.totalPrice || 0;

        // Update tracking system: Add confirmed entry if not already present
        order.trackingHistory = order.trackingHistory || [];

        // Check if confirmed entry already exists
        const hasConfirmed = order.trackingHistory.some(
          entry => entry.status === 'confirmed'
        );

        if (!hasConfirmed) {
          // Add confirmed entry (order is confirmed after payment)
          order.trackingHistory.push({
            status: 'confirmed',
            message: 'Your order has been confirmed and payment received.',
            location: '',
            updatedBy: order.user,
            updatedByModel: 'User',
            timestamp: order.paidAt || new Date(),
          });
        }

        // Add revenue to admin revenue immediately (at payment time)
        if (!order.revenueAdded) {
          const PlatformStats = require('../../models/platform/platformStatsModel');
          const orderTotal = order.totalPrice || 0;

          if (orderTotal > 0) {
            const platformStats = await PlatformStats.getStats();
            platformStats.totalRevenue = (platformStats.totalRevenue || 0) + orderTotal;
            platformStats.addDailyRevenue(new Date(), orderTotal, 0); // 0 for orders count (will be incremented on delivery)
            platformStats.lastUpdated = new Date();
            await platformStats.save();

            // Store revenue amount on order
            order.revenueAmount = orderTotal;
            order.revenueAdded = true;

            logger.info(`[Paystack Webhook] Added GH₵${orderTotal} to platform revenue for order ${order._id}`);
          }
        }

        // Log payment activity
        const { logActivityAsync } = require('../../modules/activityLog/activityLog.service');
        logActivityAsync({
          userId: order.user,
          role: 'buyer',
          action: 'PAYMENT',
          description: `Payment of GH₵${order.totalPrice?.toFixed(2) || '0.00'} via Paystack (webhook) for order #${order.orderNumber}`,
          req,
          metadata: {
            orderId: order._id,
            orderNumber: order.orderNumber,
            paymentMethod: 'paystack',
            amount: order.totalPrice,
            type: 'payment',
            source: 'webhook',
          },
        });

        await order.save({ validateBeforeSave: false });
        if (process.env.NODE_ENV === 'development') {
          logger.info('[Paystack Webhook] Order updated successfully (dev)');
        }

        await sendBuyerPaymentSuccessPush(order, transaction, 'webhook');

        // Capture email data for post-response sending
        const webhookOrderId = order._id;
        const webhookOrderUser = order.user;
        const webhookEmailAlreadySent = order.confirmationEmailSent;

        // Stock was already reduced at order creation.

        // Update product totalSold count after payment is confirmed
        const orderController = require('./orderController');
        try {
          await orderController.updateProductTotalSold(order);
          if (process.env.NODE_ENV === 'development') {
            logger.debug('[Paystack Webhook] Updated product totalSold (dev)');
          }
        } catch (soldError) {
          // Log error but don't fail webhook - sold count update is non-critical
          logger.error('[Paystack Webhook] Error updating product totalSold:', {
            message: soldError?.message,
          });
        }

        // Sync SellerOrder status and payment status (DO NOT credit sellers - they get paid on delivery)
        try {
          const { syncSellerOrderStatus } = require('../../utils/helpers/syncSellerOrderStatus');
          const SellerOrder = require('../../models/order/sellerOrderModel');

          // Sync SellerOrder status to 'confirmed'
          const syncResult = await syncSellerOrderStatus(order._id, 'confirmed');
          logger.info(`[Paystack Webhook] SellerOrder status sync result:`, syncResult);

          // Update SellerOrder payment status (but DO NOT credit seller balance - that happens on delivery)
          const sellerOrders = await SellerOrder.find({ order: order._id });

          for (const sellerOrder of sellerOrders) {
            // Update SellerOrder payment status and status
            if (sellerOrder.sellerPaymentStatus !== 'paid') {
              sellerOrder.sellerPaymentStatus = 'paid';
              sellerOrder.status = 'confirmed'; // Set to confirmed for seller to see
              sellerOrder.paymentReference = reference;
              sellerOrder.paidAt = order.paidAt;
              await sellerOrder.save({ validateBeforeSave: false });
              if (process.env.NODE_ENV === 'development') {
                logger.info('[Paystack Webhook] SellerOrder updated (dev)');
              }
            }
          }

          // NOTE: Sellers are NOT credited here - they are credited when order is delivered
          // This prevents seller payout before delivery
        } catch (error) {
          logger.error('[Paystack Webhook] Error syncing SellerOrder:', error);
          // Don't fail the webhook if SellerOrder sync fails, but log it
        }
      }
    }
  }

  // Handle failed payment event
  if (event && event.event === 'charge.failed') {
    const transaction = event.data;
    const reference = transaction?.reference;
    const orderId = transaction?.metadata?.orderId;

    let order;
    if (orderId) {
      order = await Order.findById(orderId);
    } else if (reference) {
      order = await Order.findOne({ paymentReference: reference });
    }

    if (order && order.paymentStatus !== 'paid') {
      order.paymentStatus = 'failed';
      await order.save({ validateBeforeSave: false });

      await sendBuyerPaymentFailedPush(order, transaction, 'webhook');
      await sendBuyerPaymentFailedEmail(
        order,
        transaction?.gateway_response || transaction?.message,
        'webhook'
      );
      logger.info(
        `[Paystack Webhook] Marked order ${order._id} payment as failed`
      );
    }

    return res.status(200).json({ received: true });
  }

  // Handle transfer events (payouts)
  if (event && (event.event === 'transfer.success' || event.event === 'transfer.failed' || event.event === 'transfer.reversed')) {
    const transfer = event.data;
    if (transfer) {
      const transferCode = transfer.transfer_code;
      const reference = transfer.reference;

      if (process.env.NODE_ENV === 'development') {
        logger.info(
          `[Paystack Webhook] Processing transfer event (dev): ${event.event}`
        );
      }

      try {
        const WithdrawalRequest = require('../../models/payout/withdrawalRequestModel');
        const PaymentRequest = require('../../models/payment/paymentRequestModel');

        // Find withdrawal request by transfer code or reference
        let withdrawalRequest = await WithdrawalRequest.findOne({
          $or: [
            { paystackTransferCode: transferCode },
            { paystackReference: reference },
            { _id: mongoose.isValidObjectId(reference) ? reference : new mongoose.Types.ObjectId() }
          ]
        });

        if (!withdrawalRequest) {
          withdrawalRequest = await PaymentRequest.findOne({
            $or: [
              { paystackTransferCode: transferCode },
              { paystackReference: reference },
              { _id: mongoose.isValidObjectId(reference) ? reference : new mongoose.Types.ObjectId() }
            ]
          });
        }

        if (withdrawalRequest) {
          logger.info(`[Paystack Webhook] Found withdrawal/payout request: ${withdrawalRequest._id}`);

          const transferStatus = {
            status: event.event === 'transfer.success' ? 'success' :
              event.event === 'transfer.failed' ? 'failed' : 'reversed',
            transfer_code: transferCode,
            reference: reference,
            requires_pin: false // Webhook success/fail means PIN stage is over
          };

          await payoutService.updateWithdrawalStatusFromPaystack(withdrawalRequest._id, transferStatus);
          logger.info(`[Paystack Webhook] Successfully updated withdrawal ${withdrawalRequest._id} status to ${transferStatus.status}`);
        } else {
          logger.warn(`[Paystack Webhook] Could not find withdrawal request for transfer ${transferCode} / ${reference}`);
        }
      } catch (error) {
        logger.error('[Paystack Webhook] Error processing transfer event:', error);
      }

      return res.status(200).json({ received: true });
    }
  }

  // Always return 200 to acknowledge receipt (even if processing failed)
  // Fire any pending email AFTER the response, not before
  res.on('finish', () => {
    if (typeof webhookOrderId !== 'undefined' && !webhookEmailAlreadySent) {
      setImmediate(async () => {
        try {
          const emailDispatcher = require('../../emails/emailDispatcher');
          const emailUser = await User.findById(webhookOrderUser).select('name email').lean();
          if (emailUser && emailUser.email) {
            await emailDispatcher.sendOrderConfirmation(
              { _id: webhookOrderId },
              emailUser,
              'paystack'
            );
            logger.info(`[Paystack Webhook] ✅ Order confirmation email sent to ${emailUser.email}`);
            Order.findByIdAndUpdate(webhookOrderId, { $set: { confirmationEmailSent: true } })
              .catch(err => logger.error('[Paystack Webhook] Failed to set confirmationEmailSent:', err.message));
          }
          await sendSellerOrderEmailsAfterPayment(webhookOrderId, 'webhook');
          await sendAdminOrderPaidAlertAfterPayment(webhookOrderId, 'webhook');
        } catch (emailErr) {
          logger.error('[Paystack Webhook] Post-response email failed:', emailErr.message);
        }
      });
    }
  });

  res.status(200).json({ received: true });
});

// ============================================================================
// PAYMENT REQUEST CONTROLLERS (Seller Withdrawal Requests)
// ============================================================================

/**
 * Create a new payment request (withdrawal request)
 * @route   POST /api/payment-requests
 * @access  Protected (Seller)
 */
exports.createPaymentRequest = catchAsync(async (req, res, next) => {
  const seller = req.user;
  const { amount, paymentMethod, paymentDetails } = req.body;

  try {
    // Use shared service function
    const paymentRequestService = require('../../services/paymentRequestService');
    const logger = require('../../utils/logger');
    const paymentRequest = await paymentRequestService.createPaymentRequest(
      seller,
      amount,
      paymentMethod,
      paymentDetails
    );

    res.status(201).json({
      status: 'success',
      data: {
        paymentRequest,
      },
    });
  } catch (error) {
    // Pass AppError directly, wrap others
    if (error instanceof AppError) {
      return next(error);
    }
    return next(new AppError(error.message || 'Failed to create payment request', 500));
  }
});

/**
 * Get seller's payment requests
 * @route   GET /api/payment-requests
 * @access  Protected (Seller)
 */
exports.getSellerRequests = catchAsync(async (req, res, next) => {
  const seller = req.user;
  // Only return active requests for sellers (hide deactivated ones)
  const requests = await PaymentRequest.find({
    seller: seller.id,
    isActive: { $ne: false } // Include null/undefined (legacy requests) and true, exclude false
  }).sort('-createdAt');

  res.status(200).json({
    status: 'success',
    results: requests.length,
    data: {
      requests,
    },
  });
});

/**
 * Get payment request by ID (seller)
 * @route   GET /api/payment-requests/:id
 * @access  Protected (Seller)
 */
exports.getRequestById = catchAsync(async (req, res, next) => {
  const request = await PaymentRequest.findOne({
    _id: req.params.id,
    seller: req.user.id,
  });

  if (!request) {
    return next(new AppError('Requested resource not found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      request,
    },
  });
});

/**
 * Get payment request by ID (admin)
 * @route   GET /api/payment-requests/admin/:id
 * @access  Protected (Admin)
 */
exports.getPaymentRequestByIdAdmin = catchAsync(async (req, res, next) => {
  const request = await PaymentRequest.findById(req.params.id)
    .populate('seller', 'name email phone shopName')
    .populate('user', 'name email phone');

  if (!request) {
    return next(new AppError('Requested resource not found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      request,
    },
  });
});

/**
 * Get pending payment requests (admin)
 * @route   GET /api/payment-requests/admin/pending
 * @access  Protected (Admin)
 */
exports.getPendingRequests = catchAsync(async (req, res, next) => {
  const requests = await PaymentRequest.find({ status: 'pending' })
    .populate('seller', 'name email phone')
    .sort('createdAt');

  res.status(200).json({
    status: 'success',
    results: requests.length,
    data: {
      requests,
    },
  });
});

/**
 * Process payment request (admin)
 * @route   PUT /api/payment-requests/admin/:id/process
 * @access  Protected (Admin)
 */
exports.processPaymentRequest = catchAsync(async (req, res, next) => {
  const { status, transactionId, rejectionReason } = req.body;

  // Validate status
  if (!['paid', 'rejected'].includes(status)) {
    return next(
      new AppError('Invalid request. Please provide valid information.', 400),
    );
  }

  // Find payment request
  const paymentRequest = await PaymentRequest.findById(req.params.id).populate(
    'seller',
  );
  if (!paymentRequest) {
    return next(new AppError('Requested resource not found', 404));
  }

  // Only pending requests can be processed
  if (paymentRequest.status !== 'pending') {
    return next(
      new AppError('This action cannot be completed', 400),
    );
  }

  // Update payment request
  paymentRequest.status = status;
  paymentRequest.transactionId = transactionId || null;
  paymentRequest.rejectionReason = rejectionReason || null;
  paymentRequest.processedAt = new Date();

  const seller = paymentRequest.seller;

  // Handle funds based on status
  if (status === 'paid') {
    // Calculate fees (2%)
    const feeAmount = paymentRequest.amount * 0.02;
    const netAmount = paymentRequest.amount - feeAmount;

    // When withdrawal is approved/paid, deduct from both total balance and locked balance
    // This is when money actually leaves the seller's account
    const oldBalance = seller.balance || 0;
    const oldLockedBalance = seller.lockedBalance || 0;

    // Deduct from total balance (money actually leaves)
    seller.balance = oldBalance - paymentRequest.amount;
    // Deduct from locked balance (unlock the funds)
    seller.lockedBalance = Math.max(0, oldLockedBalance - paymentRequest.amount);

    // CRITICAL: Deduct from pendingBalance as well (it was moved there on creation)
    const oldPendingBalance = seller.pendingBalance || 0;
    seller.pendingBalance = Math.max(0, oldPendingBalance - paymentRequest.amount);

    // Recalculate withdrawableBalance
    seller.calculateWithdrawableBalance();
    const newWithdrawableBalance = Math.max(0, seller.balance - seller.lockedBalance - seller.pendingBalance);
    seller.withdrawableBalance = newWithdrawableBalance;

    logger.info(`[processPaymentRequest] Withdrawal approved and paid for seller ${seller._id}:`);
    logger.info(`  Total Balance: ${oldBalance} - ${paymentRequest.amount} = ${seller.balance}`);
    logger.info(`  Pending Balance: ${oldPendingBalance} - ${paymentRequest.amount} = ${seller.pendingBalance}`);
    logger.info(`  Available Balance: ${newWithdrawableBalance}`);

    // Log seller revenue history for approved payout
    try {
      await logSellerRevenue({
        sellerId: seller._id,
        amount: -paymentRequest.amount, // Negative for payout
        type: 'PAYOUT',
        description: `Withdrawal approved and paid: GH₵${paymentRequest.amount.toFixed(2)}`,
        reference: `PAYOUT-APPROVED-${paymentRequest._id}-${Date.now()}`,
        payoutRequestId: paymentRequest._id,
        balanceBefore: oldBalance,
        balanceAfter: seller.balance,
        metadata: {
          paymentRequestId: paymentRequest._id.toString(),
          amount: paymentRequest.amount,
          paymentMethod: paymentRequest.paymentMethod,
          status: 'paid',
          transactionId,
          pendingBalanceBefore: oldPendingBalance,
          pendingBalanceAfter: seller.pendingBalance
        },
      });
      logger.info(`[processPaymentRequest] ✅ Seller revenue history logged for approved payout - seller ${seller._id}`);
    } catch (historyError) {
      logger.error(`[processPaymentRequest] Failed to log seller revenue history (non-critical) for seller ${seller._id}:`, {
        error: historyError.message,
        stack: historyError.stack,
      });
    }

    seller.paymentHistory.push({
      amount: netAmount,
      method: paymentRequest.paymentMethod,
      transactionId,
    });

    // Simulate payment processing (in production, call payment gateway)
    await processPayment(
      paymentRequest.paymentMethod,
      paymentRequest.paymentDetails,
      netAmount,
    );

    // Update or create a transaction record for the withdrawal (debit)
    // Avoid duplicate transactions if one was already created as 'pending'
    const existingTx = await Transaction.findOne({
      seller: seller._id,
      payoutRequest: paymentRequest._id,
      type: 'debit'
    });

    if (existingTx) {
      existingTx.status = 'completed';
      existingTx.description = `Withdrawal Paid: GH₵${paymentRequest.amount.toFixed(2)} (${paymentRequest.paymentMethod})`;
      if (!existingTx.metadata) existingTx.metadata = {};
      existingTx.metadata.transactionId = transactionId;
      existingTx.metadata.processedAt = new Date();
      await existingTx.save();
      logger.info(`[processPaymentRequest] Updated existing transaction ${existingTx._id} to completed`);
    } else {
      await Transaction.create({
        seller: seller._id,
        amount: paymentRequest.amount,
        type: 'debit',
        description: `Withdrawal Paid: GH₵${paymentRequest.amount.toFixed(2)} (${paymentRequest.paymentMethod})`,
        status: 'completed',
        payoutRequest: paymentRequest._id, // Set the link
        metadata: {
          paymentRequestId: paymentRequest._id,
          transactionId: transactionId,
          paymentMethod: paymentRequest.paymentMethod,
          processedAt: new Date(),
        },
      });
      logger.info(`[processPaymentRequest] Created new transaction for withdrawal ${paymentRequest._id}`);
    }
  } else if (status === 'rejected') {
    // When withdrawal is rejected, unlock funds AND refund pendingBalance
    const oldBalance = seller.balance || 0;
    const oldLockedBalance = seller.lockedBalance || 0;
    const oldPendingBalance = seller.pendingBalance || 0;

    // Unlock balance (if it was locked)
    seller.lockedBalance = Math.max(0, oldLockedBalance - paymentRequest.amount);

    // Refund from pendingBalance back to available (it was moved to pending on creation)
    seller.pendingBalance = Math.max(0, oldPendingBalance - paymentRequest.amount);

    // Recalculate withdrawableBalance
    seller.calculateWithdrawableBalance();
    const newWithdrawableBalance = Math.max(0, seller.balance - seller.lockedBalance - seller.pendingBalance);
    seller.withdrawableBalance = newWithdrawableBalance;

    logger.info(`[processPaymentRequest] Withdrawal rejected for seller ${seller._id}:`);
    logger.info(`  Pending Balance: ${oldPendingBalance} - ${paymentRequest.amount} = ${seller.pendingBalance}`);
    logger.info(`  Available Balance: ${newWithdrawableBalance} (refunded)`);

    // Log the rejection reversal in revenue history
    try {
      await logSellerRevenue({
        sellerId: seller._id,
        amount: 0, // No balance change
        type: 'REVERSAL',
        description: `Withdrawal rejected - PendingBalance refund: GH₵${paymentRequest.amount.toFixed(2)}`,
        reference: `PAYOUT-REJECTED-${paymentRequest._id}-${Date.now()}`,
        payoutRequestId: paymentRequest._id,
        balanceBefore: oldBalance,
        balanceAfter: seller.balance,
        metadata: {
          paymentRequestId: paymentRequest._id.toString(),
          rejectionReason: rejectionReason || 'Rejected by admin',
          pendingBalanceBefore: oldPendingBalance,
          pendingBalanceAfter: seller.pendingBalance
        },
      });
    } catch (err) {
      logger.error(`[processPaymentRequest] Failed to log rejection history: ${err.message}`);
    }

    // Update or create a transaction record for the rejection
    const existingTx = await Transaction.findOne({
      seller: seller._id,
      payoutRequest: paymentRequest._id,
      type: 'debit'
    });

    if (existingTx) {
      existingTx.status = 'failed';
      existingTx.description = `Withdrawal Rejected: ${rejectionReason || 'No reason provided'}`;
      await existingTx.save();
    } else {
      // Typically we don't create a Debit transaction for a rejection if it was never approved,
      // but if a pending transaction exists, we fail it.
    }

    logger.info(`[processPaymentRequest] Withdrawal rejected for seller ${seller._id}:`);
    logger.info(`  Total Balance: ${seller.balance} (unchanged);`);
    logger.info(`  Locked Balance: ${oldLockedBalance} - ${paymentRequest.amount} = ${seller.lockedBalance}`);
    logger.info(`  Available Balance: ${newWithdrawableBalance}`);
  }

  await seller.save();
  const updatedRequest = await paymentRequest.save();

  // Send notification to seller
  await sendPaymentNotification(seller, status, updatedRequest);

  res.status(200).json({
    status: 'success',
    data: {
      paymentRequest: updatedRequest,
    },
  });
});

/**
 * Delete/Deactivate a payment request
 * Only allows deletion if status is "pending"
 * @route   DELETE /api/payment-requests/:id
 * @access  Protected (Seller)
 */
exports.deletePaymentRequest = catchAsync(async (req, res, next) => {
  const sellerId = req.user.id;
  const { id } = req.params;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const paymentRequest = await PaymentRequest.findOne({
      _id: id,
      seller: sellerId,
    }).session(session);

    if (!paymentRequest) {
      await session.abortTransaction();
      return next(new AppError('Requested resource not found', 404));
    }

    // Security check: Only allow deactivation if status is "pending"
    if (paymentRequest.status !== 'pending') {
      await session.abortTransaction();
      return next(
        new AppError(
          'You cannot cancel this payment request. Only pending requests can be cancelled.',
          400
        )
      );
    }

    // Security check: Prevent deactivating already deactivated requests
    if (paymentRequest.isActive === false) {
      await session.abortTransaction();
      return next(
        new AppError(
          'This payment request has already been cancelled.',
          400
        )
      );
    }

    // Security check: Prevent deactivation if already processed
    if (paymentRequest.processedAt || paymentRequest.approvedAt) {
      await session.abortTransaction();
      return next(
        new AppError(
          'This payment request has already been processed and cannot be cancelled.',
          400
        )
      );
    }

    // Security check: Prevent deactivation if Paystack transfer exists
    if (paymentRequest.paystackTransferId || paymentRequest.paystackTransferCode || paymentRequest.paystackReference) {
      await session.abortTransaction();
      return next(
        new AppError(
          'This payment request has already been processed. A Paystack transfer exists.',
          400
        )
      );
    }

    // Get seller
    const seller = await Seller.findById(sellerId).session(session);
    if (!seller) {
      await session.abortTransaction();
      return next(new AppError('Seller not found', 404));
    }

    // Deduct amount from pendingBalance when payment request is cancelled
    const amount = paymentRequest.amount || 0;
    const oldPendingBalance = seller.pendingBalance || 0;

    if (amount > oldPendingBalance) {
      await session.abortTransaction();
      return next(new AppError('Insufficient pending balance. Please contact support.', 400));
    }

    seller.pendingBalance = Math.max(0, oldPendingBalance - amount);

    // Recalculate withdrawableBalance explicitly
    seller.calculateWithdrawableBalance();
    const newWithdrawableBalance = Math.max(0, seller.balance - seller.lockedBalance - seller.pendingBalance);
    seller.withdrawableBalance = newWithdrawableBalance;

    logger.info(`[deletePaymentRequest] Pending balance deduction for seller ${sellerId}:`);
    logger.info(`  Total Balance: ${seller.balance} (unchanged);`);
    logger.info(`  Pending Balance: ${oldPendingBalance} - ${amount} = ${seller.pendingBalance}`);
    logger.info(`  Locked Balance: ${seller.lockedBalance} (unchanged);`);
    logger.info(`  Available Balance: ${newWithdrawableBalance}`);

    await seller.save({ session });

    // Verify the save worked
    const savedSeller = await Seller.findById(sellerId).session(session).select('balance lockedBalance pendingBalance withdrawableBalance');
    if (savedSeller) {
      logger.info(`[deletePaymentRequest] ✅ Verified save - Balance: ${savedSeller.balance}, LockedBalance: ${savedSeller.lockedBalance}, PendingBalance: ${savedSeller.pendingBalance}, WithdrawableBalance: ${savedSeller.withdrawableBalance}`);
    }

    // Create a "refund" transaction record
    await Transaction.create(
      [
        {
          seller: sellerId,
          amount: paymentRequest.amount,
          type: 'credit',
          description: `Withdrawal Request Deactivated - Refund for Request #${paymentRequest._id}`,
          status: 'completed',
          metadata: {
            withdrawalRequestId: paymentRequest._id,
            action: 'deactivation_refund',
            deactivatedAt: new Date(),
          },
        },
      ],
      { session }
    );

    // Deactivate the payment request instead of deleting it
    paymentRequest.isActive = false;
    paymentRequest.deactivatedAt = new Date();
    await paymentRequest.save({ session });

    await session.commitTransaction();

    res.status(200).json({
      status: 'success',
      message: 'Payment request cancelled successfully. Amount refunded to your balance.',
      data: null,
    });
  } catch (error) {
    await session.abortTransaction();
    logger.error('[deletePaymentRequest] Error:', error);

    if (error instanceof AppError) {
      return next(error);
    }

    return next(new AppError('Failed to delete payment request', 500));
  } finally {
    session.endSession();
  }
});

// Helper functions for payment processing
async function processPayment(method, details, amount) {
  // In production, integrate with actual payment gateways
  if (method.includes('momo')) {
    // Simulate mobile money payment
    return simulateMobileMoneyPayment(details.mobileMoney.phone, amount);
  } else if (method === 'bank') {
    // Simulate bank transfer
    return simulateBankTransfer(details.bank.accountNumber, amount);
  }

  // For cash payments, just log
  logger.info(`Processing cash payment of GHS ${amount.toFixed(2)}`);
  return { success: true };
}

async function simulateMobileMoneyPayment(phone, amount) {
  logger.info(`Sending GHS ${amount.toFixed(2)} to ${phone} via mobile money`);
  // Actual integration would use something like:
  // const result = await momoProvider.sendPayment(phone, amount);
  return { success: true, transactionId: `MM_${Date.now()}` };
}

async function simulateBankTransfer(accountNumber, amount) {
  logger.info(
    `Transferring GHS ${amount.toFixed(2)} to account ${accountNumber}`,
  );
  // Actual integration would use bank API
  return { success: true, transactionId: `BANK_${Date.now()}` };
}
