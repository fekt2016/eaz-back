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

exports.getAllPayment = handleFactory.getAll(Payment);
exports.getPayment = handleFactory.getOne(Payment);
exports.createPayment = handleFactory.createOne(Payment);
exports.deletePayment = handleFactory.deleteOne(Payment);
exports.updatePayment = handleFactory.updateOne(Payment);

// Initialize Paystack payment for mobile money
exports.initializePaystack = catchAsync(async (req, res, next) => {
  const { orderId, amount, email } = req.body;

  // Validate input
  if (!orderId || !amount || !email) {
    return next(new AppError('Order ID, amount, and email are required', 400));
  }

  // Verify order exists and belongs to user
  const order = await Order.findById(orderId);
  if (!order) {
    return next(new AppError('Order not found', 404));
  }

  if (order.user.toString() !== req.user.id.toString()) {
    return next(new AppError('You are not authorized to pay for this order', 403));
  }

  // Get Paystack secret key from environment
  const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
  if (!PAYSTACK_SECRET_KEY) {
    return next(new AppError('Paystack is not configured. Please contact support.', 500));
  }

  // Prepare Paystack initialization request payload
  // IMPORTANT: Paystack behavior with callback_url:
  // - If callback_url has NO query params: Paystack appends ?reference=xxx&trxref=xxx
  // - If callback_url HAS query params: Paystack appends &reference=xxx&trxref=xxx
  // 
  // CRITICAL: Paystack callback MUST ALWAYS point to eazmain (customer app), NEVER to eazadmin
  // FORCE use of eazmain port (5173) - this is the customer-facing app
  // NEVER use admin port (5174) for Paystack callbacks
  // We check environment variables but ALWAYS validate and force eazmain
  
  // Check environment variables for logging purposes
  const envMainAppUrl = process.env.MAIN_APP_URL;
  const envEazmainUrl = process.env.EAZMAIN_URL;
  const envFrontendUrl = process.env.FRONTEND_URL;
  
  console.log('[Paystack Initialize] 🔍 Environment Variables:', {
    MAIN_APP_URL: envMainAppUrl || 'NOT SET',
    EAZMAIN_URL: envEazmainUrl || 'NOT SET',
    FRONTEND_URL: envFrontendUrl || 'NOT SET',
  });
  
  // Try to use MAIN_APP_URL or EAZMAIN_URL if they're set and valid (point to eazmain)
  let baseUrl = null;
  if (envMainAppUrl && 
      !envMainAppUrl.includes('admin') && 
      !envMainAppUrl.includes('eazadmin') && 
      !envMainAppUrl.includes(':5174') &&
      (envMainAppUrl.includes(':5173') || envMainAppUrl.includes('eazmain'))) {
    baseUrl = envMainAppUrl;
    console.log('[Paystack Initialize] ✅ Using MAIN_APP_URL:', baseUrl);
  } else if (envEazmainUrl && 
             !envEazmainUrl.includes('admin') && 
             !envEazmainUrl.includes('eazadmin') && 
             !envEazmainUrl.includes(':5174')) {
    baseUrl = envEazmainUrl;
    console.log('[Paystack Initialize] ✅ Using EAZMAIN_URL:', baseUrl);
  } else if (envFrontendUrl && 
             !envFrontendUrl.includes('admin') && 
             !envFrontendUrl.includes('eazadmin') && 
             !envFrontendUrl.includes(':5174') &&
             (envFrontendUrl.includes(':5173') || envFrontendUrl.includes('eazmain'))) {
    baseUrl = envFrontendUrl;
    console.log('[Paystack Initialize] ✅ Using FRONTEND_URL (validated as eazmain):', baseUrl);
  }
  
  // ALWAYS default to eazmain port (5173) if no valid URL found
  // This is the customer app - NEVER use admin port (5174)
  if (!baseUrl) {
    baseUrl = 'http://localhost:5173';
    console.log('[Paystack Initialize] ✅ Using default eazmain URL (port 5173):', baseUrl);
  }
  
  // FINAL VALIDATION: Force to eazmain if URL points to admin
  if (baseUrl.includes('/admin') || 
      baseUrl.includes('eazadmin') || 
      baseUrl.includes(':5174') ||
      baseUrl.toLowerCase().includes('admin')) {
    console.error('[Paystack Initialize] ❌ CRITICAL: Base URL points to admin! Forcing to eazmain.');
    baseUrl = 'http://localhost:5173';
    console.log('[Paystack Initialize] ✅ FORCED to eazmain (port 5173):', baseUrl);
  }
  
  // Remove trailing slash and ensure clean URL
  const cleanBaseUrl = baseUrl.replace(/\/$/, '');
  
  // Final sanity check - ensure we're using port 5173 (eazmain), not 5174 (admin)
  if (cleanBaseUrl.includes(':5174')) {
    console.error('[Paystack Initialize] ❌ CRITICAL: URL still contains admin port 5174!');
    const safeBaseUrl = cleanBaseUrl.replace(/:5174/g, ':5173');
    console.log('[Paystack Initialize] ✅ Replaced admin port with eazmain port:', safeBaseUrl);
    baseUrl = safeBaseUrl;
  } else {
    baseUrl = cleanBaseUrl;
  }
  
  // Construct callback URL with orderId parameter
  // Paystack will append: &reference=xxx&trxref=xxx (since we already have ?orderId=)
  // Final URL: http://localhost:5173/order-confirmation?orderId=XXX&reference=YYY&trxref=YYY
  // baseUrl is already cleaned above, so use it directly
  const callbackUrl = `${baseUrl}/order-confirmation?orderId=${order._id}`;
  
  // CRITICAL: Log all environment variables for debugging BEFORE validation
  console.log('[Paystack Initialize] 🔍 Environment Variables Check:', {
    MAIN_APP_URL: process.env.MAIN_APP_URL || 'NOT SET',
    EAZMAIN_URL: process.env.EAZMAIN_URL || 'NOT SET',
    FRONTEND_URL: process.env.FRONTEND_URL || 'NOT SET',
    ADMIN_URL: process.env.ADMIN_URL || 'NOT SET',
    selectedBaseUrl: baseUrl,
    finalCallbackUrl: callbackUrl,
  });
  
  // Final validation of the complete callback URL
  // CRITICAL: If callback URL points to admin, FORCE it to eazmain instead of throwing error
  if (callbackUrl.includes('/admin') || 
      callbackUrl.includes('eazadmin') || 
      callbackUrl.includes(':5174') ||
      callbackUrl.toLowerCase().includes('admin')) {
    console.error('[Paystack Initialize] ❌ CRITICAL ERROR: Callback URL points to admin app!', callbackUrl);
    console.error('[Paystack Initialize] ⚠️ FORCING redirect to eazmain (port 5173) instead');
    
    // FORCE use of eazmain port (5173) - NEVER use admin port (5174)
    const forcedBaseUrl = 'http://localhost:5173';
    const forcedCallbackUrl = `${forcedBaseUrl}/order-confirmation?orderId=${order._id}`;
    console.log('[Paystack Initialize] ✅ Using FORCED safe callback URL:', forcedCallbackUrl);
    
    // Update callbackUrl to use the forced safe URL
    const safePayload = {
      email,
      amount: Math.round(amount),
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
      callback_url: forcedCallbackUrl, // Use forced safe URL
    };
    
    console.log('[Paystack Initialize] Paystack Payload (with forced URL):', safePayload.callback_url);
    
    try {
      const response = await axios.post(
        'https://api.paystack.co/transaction/initialize',
        safePayload,
        {
          headers: {
            Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (response.data.status === true && response.data.data) {
        order.paymentReference = response.data.data.reference;
        await order.save({ validateBeforeSave: false });

        res.status(200).json({
          status: 'success',
          data: {
            authorization_url: response.data.data.authorization_url,
          },
        });
        return; // Exit early
      } else {
        return next(
          new AppError(
            response.data.message || 'Failed to initialize payment',
            400
          )
        );
      }
    } catch (error) {
      console.error('Paystack API error:', error.response?.data || error.message);
      return next(
        new AppError(
          error.response?.data?.message || 'Payment initialization failed',
          500
        )
      );
    }
  }
  
  console.log('[Paystack Initialize] ✅ Callback URL configured correctly:', callbackUrl);
  console.log('[Paystack Initialize] Expected final URL:', `${callbackUrl}&reference=XXX&trxref=XXX`);
  console.log('[Paystack Initialize] ⚠️ VERIFY: This URL MUST point to eazmain (port 5173), NOT eazadmin (port 5174)');
  
  const payload = {
    email,
    amount: Math.round(amount), // Amount in kobo/pesewas
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
  
  console.log('[Paystack Initialize] Paystack Payload callback_url:', payload.callback_url);
  console.log('[Paystack Initialize] Order ID:', order._id.toString());

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
    console.error('Paystack API error:', error.response?.data || error.message);
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
  const { reference, orderId } = req.query;

  // Validate input
  if (!reference) {
    return next(new AppError('Payment reference is required', 400));
  }

  // Get Paystack secret key from environment
  const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
  if (!PAYSTACK_SECRET_KEY) {
    return next(new AppError('Paystack is not configured. Please contact support.', 500));
  }

  try {
    console.log(`[Payment Verification] Verifying payment with reference: ${reference}, orderId: ${orderId}`);

    // Verify payment with Paystack
    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        },
      }
    );

    console.log(`[Payment Verification] Paystack response status: ${response.data?.status}`);
    console.log(`[Payment Verification] Paystack response data:`, JSON.stringify(response.data, null, 2));

    // Check if Paystack returned an error
    if (response.data.status === false) {
      const errorMessage = response.data.message || 'Payment verification failed';
      console.error(`[Payment Verification] Paystack returned error: ${errorMessage}`);
      return next(new AppError(errorMessage, 400));
    }

    // Check if response has the expected structure
    if (!response.data || response.data.status !== true || !response.data.data) {
      console.error(`[Payment Verification] Invalid response structure:`, response.data);
      return next(new AppError('Invalid response from payment gateway', 400));
    }

    const transaction = response.data.data;
    console.log(`[Payment Verification] Transaction status: ${transaction.status}`);

    // Find order by reference or orderId
    let order;
    if (orderId) {
      order = await Order.findById(orderId);
      console.log(`[Payment Verification] Found order by ID: ${order ? order._id : 'not found'}`);
    } else {
      // Find order by payment reference
      order = await Order.findOne({ paymentReference: reference });
      console.log(`[Payment Verification] Found order by reference: ${order ? order._id : 'not found'}`);
    }

    if (!order) {
      console.error(`[Payment Verification] Order not found for reference: ${reference}, orderId: ${orderId}`);
      return next(new AppError('Order not found', 404));
    }

    // Check if payment was successful
    if (transaction.status === 'success') {
      console.log(`[Payment Verification] Payment successful for order: ${order._id}`);
      
      // Prevent double updates - if already paid, return existing order
      if (order.paymentStatus === 'paid') {
        console.log(`[Payment Verification] Order ${order._id} already paid, returning existing order`);
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
          
          console.log(`[Payment Verification] Added GH₵${orderTotal} to platform revenue for order ${order._id}`);
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
      console.log(`[Payment Verification] Order ${order._id} updated successfully - Status: confirmed`);
      
      // Reduce product stock after payment is confirmed
      const orderController = require('./orderController');
      await orderController.reduceOrderStock(order);

      // Sync SellerOrder status and payment status (DO NOT credit sellers - they get paid on delivery)
      try {
        const { syncSellerOrderStatus } = require('../../utils/helpers/syncSellerOrderStatus');
        const SellerOrder = require('../../models/order/sellerOrderModel');
        
        // Sync SellerOrder status to 'confirmed'
        const syncResult = await syncSellerOrderStatus(order._id, 'confirmed');
        console.log(`[Payment Verification] SellerOrder status sync result:`, syncResult);
        
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
            console.log(`[Payment Verification] Updated SellerOrder ${sellerOrder._id} - status: confirmed, paymentStatus: paid`);
          }
        }
        
        // NOTE: Sellers are NOT credited here - they are credited when order is delivered
        // This prevents seller payout before delivery
      } catch (error) {
        console.error('[Payment Verification] Error syncing SellerOrder:', error);
        // Don't fail the payment verification if SellerOrder sync fails, but log it
      }

      // Fetch full order with populated fields for response
      const fullOrder = await Order.findById(order._id)
        .populate('user', 'name email')
        .populate('orderItems')
        .lean();

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
      console.log(`[Payment Verification] Payment not successful. Status: ${transaction.status}`);
      order.paymentStatus = transaction.status === 'failed' ? 'failed' : 'pending';
      await order.save();

      const statusMessage = transaction.status === 'pending' 
        ? 'Payment is still pending. Please wait for confirmation.'
        : 'Payment was not successful';
      
      return next(new AppError(statusMessage, 400));
    }
  } catch (error) {
    console.error('[Payment Verification] Error details:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
      reference,
      orderId,
    });

    // Handle specific Paystack API errors
    if (error.response?.status === 404) {
      return next(new AppError('Payment reference not found. Please check your payment details.', 404));
    }

    if (error.response?.status === 401) {
      return next(new AppError('Payment gateway authentication failed. Please contact support.', 500));
    }

    // Return more specific error message
    const errorMessage = error.response?.data?.message 
      || error.message 
      || 'Payment verification failed. Please try again or contact support.';
    
    return next(new AppError(errorMessage, error.response?.status || 500));
  }
});

// Paystack webhook handler (for server-to-server callbacks)
exports.paystackWebhook = catchAsync(async (req, res, next) => {
  const hash = req.headers['x-paystack-signature'];
  const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

  if (!PAYSTACK_SECRET_KEY) {
    return next(new AppError('Paystack is not configured', 500));
  }

  // Parse webhook event (body is already parsed by express.json() middleware)
  // Note: For production, verify webhook signature using crypto
  const event = req.body;

  // Handle successful payment event
  if (event && event.event === 'charge.success') {
    const transaction = event.data;
    if (transaction) {
      const reference = transaction.reference;
      const orderId = transaction.metadata?.orderId;

      // Find order
      let order;
      if (orderId) {
        order = await Order.findById(orderId);
      } else if (reference) {
        order = await Order.findOne({ paymentReference: reference });
      }

      if (order && transaction.status === 'success') {
        console.log(`[Paystack Webhook] Processing successful payment for order: ${order._id}`);
        
        // Prevent double updates - if already paid, skip
        if (order.paymentStatus === 'paid') {
          console.log(`[Paystack Webhook] Order ${order._id} already paid, skipping update`);
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
            
            console.log(`[Paystack Webhook] Added GH₵${orderTotal} to platform revenue for order ${order._id}`);
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
        console.log(`[Paystack Webhook] Order ${order._id} updated successfully - Status: confirmed`);
        
        // Sync SellerOrder status and payment status (DO NOT credit sellers - they get paid on delivery)
        try {
          const { syncSellerOrderStatus } = require('../../utils/helpers/syncSellerOrderStatus');
          const SellerOrder = require('../../models/order/sellerOrderModel');
          
          // Sync SellerOrder status to 'confirmed'
          const syncResult = await syncSellerOrderStatus(order._id, 'confirmed');
          console.log(`[Paystack Webhook] SellerOrder status sync result:`, syncResult);
          
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
              console.log(`[Paystack Webhook] Updated SellerOrder ${sellerOrder._id} - status: confirmed, paymentStatus: paid`);
            }
          }
          
          // NOTE: Sellers are NOT credited here - they are credited when order is delivered
          // This prevents seller payout before delivery
        } catch (error) {
          console.error('[Paystack Webhook] Error syncing SellerOrder:', error);
          // Don't fail the webhook if SellerOrder sync fails, but log it
        }
      }
    }
  }

  // Always return 200 to acknowledge receipt (even if processing failed)
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

  // Validate amount
  if (amount <= 0) {
    return next(new AppError('Amount must be greater than 0', 400));
  }

  // Get current seller balance from seller model (including taxCategory)
  const currentSeller = await Seller.findById(seller.id).select('balance lockedBalance pendingBalance taxCategory');
  if (!currentSeller) {
    return next(new AppError('Seller not found', 404));
  }

  // Use balance directly from seller model
  const sellerBalance = currentSeller.balance || 0;

  // Calculate withdrawable balance (balance - lockedBalance - pendingBalance)
  const withdrawableBalance = Math.max(0, sellerBalance - (currentSeller.lockedBalance || 0) - (currentSeller.pendingBalance || 0));

  // Check available balance (use withdrawableBalance for validation)
  if (amount > withdrawableBalance) {
    return next(new AppError(`Insufficient balance. Available: GH₵${withdrawableBalance.toFixed(2)}`, 400));
  }

  // Use seller's saved payment methods if paymentDetails are not provided or incomplete
  let finalPaymentDetails = paymentDetails || {};
  
  // If paymentDetails is empty or incomplete, fetch from PaymentMethod model first, then fallback to seller.paymentMethods
  if (!paymentDetails || Object.keys(paymentDetails).length === 0) {
    // Try to find User account linked to seller (by email)
    let userAccount = null;
    if (currentSeller.email) {
      userAccount = await User.findOne({ email: currentSeller.email });
    }
    
    // Map payment method to PaymentMethod model type
    const paymentMethodToType = {
      'bank': 'bank_transfer',
      'mtn_momo': 'mobile_money',
      'vodafone_cash': 'mobile_money',
      'airtel_tigo_money': 'mobile_money',
    };
    
    // Map payment method to provider
    const paymentMethodToProvider = {
      'mtn_momo': 'MTN',
      'vodafone_cash': 'Vodafone',
      'airtel_tigo_money': 'AirtelTigo',
    };
    
    if (paymentMethod === 'bank') {
      // Try to get from PaymentMethod model first
      if (userAccount) {
        const paymentMethodDoc = await PaymentMethod.findOne({
          user: userAccount._id,
          type: 'bank_transfer',
          isDefault: true,
        });
        
        // If no default, get any bank transfer method
        if (!paymentMethodDoc) {
          const anyBankMethod = await PaymentMethod.findOne({
            user: userAccount._id,
            type: 'bank_transfer',
          });
          if (anyBankMethod && anyBankMethod.accountNumber && anyBankMethod.accountName && anyBankMethod.bankName) {
            finalPaymentDetails = {
              accountName: anyBankMethod.accountName,
              accountNumber: anyBankMethod.accountNumber,
              bankName: anyBankMethod.bankName,
              branch: anyBankMethod.branch || '',
            };
          }
        } else if (paymentMethodDoc.accountNumber && paymentMethodDoc.accountName && paymentMethodDoc.bankName) {
          finalPaymentDetails = {
            accountName: paymentMethodDoc.accountName,
            accountNumber: paymentMethodDoc.accountNumber,
            bankName: paymentMethodDoc.bankName,
            branch: paymentMethodDoc.branch || '',
          };
        }
      }
      
      // Fallback to seller's saved bank account details
      if (!finalPaymentDetails.accountNumber && currentSeller.paymentMethods?.bankAccount) {
        const bankAccount = currentSeller.paymentMethods.bankAccount;
        if (bankAccount.accountNumber && bankAccount.accountName && bankAccount.bankName) {
          finalPaymentDetails = {
            accountName: bankAccount.accountName,
            accountNumber: bankAccount.accountNumber,
            bankName: bankAccount.bankName,
            branch: bankAccount.branch || '',
          };
        }
      }
      
      if (!finalPaymentDetails.accountNumber) {
        return next(new AppError('Bank account details not found. Please add bank details in your payment methods.', 400));
      }
    } else if (['mtn_momo', 'vodafone_cash', 'airtel_tigo_money'].includes(paymentMethod)) {
      const provider = paymentMethodToProvider[paymentMethod];
      
      // Try to get from PaymentMethod model first
      if (userAccount && provider) {
        // Try default first
        let paymentMethodDoc = await PaymentMethod.findOne({
          user: userAccount._id,
          type: 'mobile_money',
          provider: provider,
          isDefault: true,
        });
        
        // If no default, get any matching provider
        if (!paymentMethodDoc) {
          paymentMethodDoc = await PaymentMethod.findOne({
            user: userAccount._id,
            type: 'mobile_money',
            provider: provider,
          });
        }
        
        if (paymentMethodDoc && paymentMethodDoc.mobileNumber) {
          finalPaymentDetails = {
            phone: paymentMethodDoc.mobileNumber,
            network: paymentMethodDoc.provider,
            accountName: paymentMethodDoc.name || currentSeller.name || currentSeller.shopName || '',
          };
        }
      }
      
      // Fallback to seller's saved mobile money details
      if (!finalPaymentDetails.phone && currentSeller.paymentMethods?.mobileMoney) {
        const mobileMoney = currentSeller.paymentMethods.mobileMoney;
        if (mobileMoney.phone && mobileMoney.network) {
          // Map saved network to payment method
          const networkToPaymentMethod = {
            'mtn': 'mtn_momo',
            'vodafone': 'vodafone_cash',
            'airteltigo': 'airtel_tigo_money',
          };
          
          const savedNetwork = mobileMoney.network.toLowerCase();
          const expectedPaymentMethod = networkToPaymentMethod[savedNetwork];
          
          if (expectedPaymentMethod === paymentMethod) {
            finalPaymentDetails = {
              phone: mobileMoney.phone,
              network: mobileMoney.network,
              accountName: mobileMoney.accountName || '',
            };
          }
        }
      }
      
      if (!finalPaymentDetails.phone) {
        return next(new AppError('Mobile money details not found. Please add mobile money details in your payment methods.', 400));
      }
    } else if (paymentMethod === 'cash') {
      // Cash pickup requires manual entry, cannot use saved methods
      if (!paymentDetails || !paymentDetails.pickupLocation || !paymentDetails.contactPerson || !paymentDetails.contactPhone) {
        return next(new AppError('Cash pickup requires pickup location, contact person, and contact phone. Please fill all cash pickup details.', 400));
      }
      finalPaymentDetails = paymentDetails;
    }
  } else {
    // Payment details provided - validate and use them
    if (paymentMethod === 'bank') {
      if (!paymentDetails.accountName || !paymentDetails.accountNumber || !paymentDetails.bankName) {
        return next(new AppError('Please provide all bank details: account name, account number, and bank name.', 400));
      }
      finalPaymentDetails = {
        accountName: paymentDetails.accountName,
        accountNumber: paymentDetails.accountNumber,
        bankName: paymentDetails.bankName,
        branch: paymentDetails.branch || '',
      };
    } else if (['mtn_momo', 'vodafone_cash', 'airtel_tigo_money'].includes(paymentMethod)) {
      if (!paymentDetails.phone || !paymentDetails.network) {
        return next(new AppError('Please provide phone number and network for mobile money.', 400));
      }
      finalPaymentDetails = {
        phone: paymentDetails.phone,
        network: paymentDetails.network,
        accountName: paymentDetails.accountName || '',
      };
    } else if (paymentMethod === 'cash') {
      if (!paymentDetails.pickupLocation || !paymentDetails.contactPerson || !paymentDetails.contactPhone) {
        return next(new AppError('Please provide all cash pickup details: pickup location, contact person, and contact phone.', 400));
      }
      finalPaymentDetails = paymentDetails;
    }
  }
  
  // Ensure paymentDetails is always populated before creating the request
  if (!finalPaymentDetails || Object.keys(finalPaymentDetails).length === 0) {
    return next(new AppError('Payment details are required. Please provide payment information.', 400));
  }

  // Calculate withholding tax based on seller's tax category (using dynamic rates)
  const taxService = require('../../services/tax/taxService');
  const taxCategory = currentSeller.taxCategory || 'individual';
  const withholdingResult = await taxService.calculateWithholdingTax(amount, taxCategory);
  const withholdingTax = withholdingResult.withholdingTax;
  const withholdingTaxRate = withholdingResult.withholdingTaxRate;
  const amountPaidToSeller = withholdingResult.amountPaidToSeller;

  // Create payment request with withholding tax information
  const paymentRequest = await PaymentRequest.create({
    seller: seller.id,
    amount,
    amountRequested: amount, // Store original requested amount
    currency: 'GHS',
    paymentMethod,
    paymentDetails: finalPaymentDetails,
    status: 'pending',
    withholdingTax,
    withholdingTaxRate,
    amountPaidToSeller,
    sellerBalanceBefore: currentSeller.balance || 0,
  });

  // Add amount to pendingBalance when withdrawal request is created
  // This tracks funds awaiting admin approval and OTP verification
  // IMPORTANT: Total Revenue (balance) should NOT be deducted here - only available balance decreases
  const oldBalance = currentSeller.balance || 0;
  const oldPendingBalance = currentSeller.pendingBalance || 0;
  const oldLockedBalance = currentSeller.lockedBalance || 0;
  const oldWithdrawableBalance = Math.max(0, oldBalance - oldLockedBalance - oldPendingBalance);
  
  // Add to pendingBalance (funds awaiting approval and OTP verification)
  // This reduces available balance but does NOT affect total revenue (balance)
  currentSeller.pendingBalance = oldPendingBalance + amount;
  
  // CRITICAL: Do NOT modify balance (total revenue) - it should remain unchanged
  // Only pendingBalance is increased, which reduces withdrawableBalance
  // Balance will only be deducted when withdrawal is actually paid (in processPaymentRequest)
  
  // Recalculate withdrawableBalance explicitly (balance - lockedBalance - pendingBalance)
  currentSeller.calculateWithdrawableBalance();
  const newWithdrawableBalance = Math.max(0, currentSeller.balance - currentSeller.lockedBalance - currentSeller.pendingBalance);
  currentSeller.withdrawableBalance = newWithdrawableBalance;
  
  // Verify balance was NOT modified
  if (currentSeller.balance !== oldBalance) {
    console.error(`[createPaymentRequest] ERROR: Balance was modified! Old: ${oldBalance}, New: ${currentSeller.balance}`);
    // Restore balance if it was accidentally modified
    currentSeller.balance = oldBalance;
  }
  
  console.log(`[createPaymentRequest] Pending balance update for seller ${seller.id}:`);
  console.log(`  Total Revenue (Balance): ${oldBalance} (UNCHANGED - not deducted)`);
  console.log(`  Pending Balance: ${oldPendingBalance} + ${amount} = ${currentSeller.pendingBalance}`);
  console.log(`  Locked Balance: ${oldLockedBalance} (unchanged)`);
  console.log(`  Available Balance: ${oldWithdrawableBalance} - ${amount} = ${newWithdrawableBalance} (decreased due to pending withdrawal)`);
  
  // Auto-update onboarding if bank details are being added
  if (!currentSeller.requiredSetup.hasAddedBankDetails) {
    currentSeller.requiredSetup.hasAddedBankDetails = true;
    
    // Check if all setup is complete (product not required for verification)
    const allSetupComplete =
      currentSeller.requiredSetup.hasAddedBusinessInfo &&
      currentSeller.requiredSetup.hasAddedBankDetails;

    if (allSetupComplete && currentSeller.onboardingStage === 'profile_incomplete') {
      currentSeller.onboardingStage = 'pending_verification';
    }
  }
  
  await currentSeller.save();
  
  // Verify the save worked and balance was NOT deducted
  const savedSeller = await Seller.findById(seller.id).select('balance lockedBalance pendingBalance withdrawableBalance');
  if (savedSeller) {
    // Verify balance (total revenue) was NOT modified
    if (Math.abs((savedSeller.balance || 0) - oldBalance) > 0.01) {
      console.error(`[createPaymentRequest] ❌ ERROR: Total Revenue (Balance) was modified! Expected: ${oldBalance}, Actual: ${savedSeller.balance}`);
    } else {
      console.log(`[createPaymentRequest] ✅ Verified save - Total Revenue (Balance): ${savedSeller.balance} (UNCHANGED)`);
    }
    console.log(`[createPaymentRequest] ✅ Verified save - LockedBalance: ${savedSeller.lockedBalance}, PendingBalance: ${savedSeller.pendingBalance}, WithdrawableBalance: ${savedSeller.withdrawableBalance}`);
  }
  // Send confirmation to seller
  await sendPaymentNotification(seller, 'request_created', paymentRequest);

  res.status(201).json({
    status: 'success',
    data: {
      paymentRequest,
    },
  });
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
    return next(new AppError('Payment request not found', 404));
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
    return next(new AppError('Payment request not found', 404));
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
      new AppError('Invalid status. Must be "paid" or "rejected"', 400),
    );
  }

  // Find payment request
  const paymentRequest = await PaymentRequest.findById(req.params.id).populate(
    'seller',
  );
  if (!paymentRequest) {
    return next(new AppError('Payment request not found', 404));
  }

  // Only pending requests can be processed
  if (paymentRequest.status !== 'pending') {
    return next(
      new AppError('This payment request has already been processed', 400),
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
    
    // Recalculate withdrawableBalance
    seller.calculateWithdrawableBalance();
    const newWithdrawableBalance = Math.max(0, seller.balance - seller.lockedBalance);
    seller.withdrawableBalance = newWithdrawableBalance;
    
    console.log(`[processPaymentRequest] Withdrawal approved for seller ${seller._id}:`);
    console.log(`  Total Balance: ${oldBalance} - ${paymentRequest.amount} = ${seller.balance}`);
    console.log(`  Locked Balance: ${oldLockedBalance} - ${paymentRequest.amount} = ${seller.lockedBalance}`);
    console.log(`  Available Balance: ${newWithdrawableBalance}`);
    
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
  } else if (status === 'rejected') {
    // When withdrawal is rejected, only unlock funds (do NOT add to balance)
    // Balance was never deducted when creating the request, so we don't add it back
    const oldLockedBalance = seller.lockedBalance || 0;
    seller.lockedBalance = Math.max(0, oldLockedBalance - paymentRequest.amount);
    
    // Recalculate withdrawableBalance
    seller.calculateWithdrawableBalance();
    const newWithdrawableBalance = Math.max(0, seller.balance - seller.lockedBalance);
    seller.withdrawableBalance = newWithdrawableBalance;
    
    console.log(`[processPaymentRequest] Withdrawal rejected for seller ${seller._id}:`);
    console.log(`  Total Balance: ${seller.balance} (unchanged)`);
    console.log(`  Locked Balance: ${oldLockedBalance} - ${paymentRequest.amount} = ${seller.lockedBalance}`);
    console.log(`  Available Balance: ${newWithdrawableBalance}`);
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
      return next(new AppError('Payment request not found', 404));
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
    
    console.log(`[deletePaymentRequest] Pending balance deduction for seller ${sellerId}:`);
    console.log(`  Total Balance: ${seller.balance} (unchanged)`);
    console.log(`  Pending Balance: ${oldPendingBalance} - ${amount} = ${seller.pendingBalance}`);
    console.log(`  Locked Balance: ${seller.lockedBalance} (unchanged)`);
    console.log(`  Available Balance: ${newWithdrawableBalance}`);
    
    await seller.save({ session });
    
    // Verify the save worked
    const savedSeller = await Seller.findById(sellerId).session(session).select('balance lockedBalance pendingBalance withdrawableBalance');
    if (savedSeller) {
      console.log(`[deletePaymentRequest] ✅ Verified save - Balance: ${savedSeller.balance}, LockedBalance: ${savedSeller.lockedBalance}, PendingBalance: ${savedSeller.pendingBalance}, WithdrawableBalance: ${savedSeller.withdrawableBalance}`);
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
    console.error('[deletePaymentRequest] Error:', error);
    
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
  console.log(`Processing cash payment of GHS ${amount.toFixed(2)}`);
  return { success: true };
}

async function simulateMobileMoneyPayment(phone, amount) {
  console.log(`Sending GHS ${amount.toFixed(2)} to ${phone} via mobile money`);
  // Actual integration would use something like:
  // const result = await momoProvider.sendPayment(phone, amount);
  return { success: true, transactionId: `MM_${Date.now()}` };
}

async function simulateBankTransfer(accountNumber, amount) {
  console.log(
    `Transferring GHS ${amount.toFixed(2)} to account ${accountNumber}`,
  );
  // Actual integration would use bank API
  return { success: true, transactionId: `BANK_${Date.now()}` };
}
