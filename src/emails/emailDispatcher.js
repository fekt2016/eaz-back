const {
  sendEmail,
  sendCustomEmail,
  sendPasswordResetEmail,
  sendOrderConfirmationEmail,
  sendLoginEmail,
  sendLoginOtpEmail,
} = require('../utils/email/emailService');

// Buyer-facing marketing emails (e.g. sendCouponToBuyer) must be gated by the caller
// using canSendUserEmail(userId, EMAIL_CATEGORY.PROMOTION) from utils/helpers/emailPermission.
// Order/payment/refund/wallet/auth emails are transactional or security – always send.

const sendSignupEmail = async (user, otp) => {
  return await sendLoginOtpEmail(user.email, otp, user.name || 'User');
};


const sendLoginDeviceAlert = async (user, loginInfo) => {
  return await sendLoginEmail(user.email, user.name || 'User', loginInfo);
};

/**
 * Send password reset email
 * @param {Object} user - User object with email and name
 * @param {string} resetToken - Password reset token
 */
const sendPasswordReset = async (user, resetToken) => {
  return await sendPasswordResetEmail(user.email, resetToken, user.name || 'User');
};


const sendOrderConfirmation = async (order, user, paymentMethod = null) => {
  // Resolve payment method: explicit arg > order field
  const method = paymentMethod || order.paymentMethod || null;
  return await sendOrderConfirmationEmail(
    user.email,
    order,
    user.name || 'Customer',
    method
  );
};

const sendOrderShipped = async (order, user) => {
  const brandConfig = {
    name: process.env.APP_NAME || process.env.BRAND_NAME || 'Saiisai',
    url: process.env.FRONTEND_URL || 'https://saiisai.com',
  };

  const trackingNumber = order.trackingNumber || 'N/A';
  const orderUrl = `${brandConfig.url}/orders/${order._id || order.id}`;

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Inter', sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #4361ee 0%, #3a0ca3 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #ffffff; padding: 30px; border-radius: 0 0 10px 10px; }
        .info-box { background: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #4361ee; }
        .button { display: inline-block; padding: 12px 30px; background: #4361ee; color: white !important; text-decoration: none; border-radius: 5px; margin: 20px 0; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eaeaea; color: #6c757d; font-size: 0.9em; text-align: center; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🚚 Your Order Has Shipped!</h1>
        </div>
        <div class="content">
          <p>Hello ${user.name || 'Customer'},</p>
          <p>Great news! Your order has been shipped and is on its way to you.</p>
          <div class="info-box">
            <p><strong>Order Number:</strong> ${order.orderNumber || order._id || 'N/A'}</p>
            <p><strong>Tracking Number:</strong> ${trackingNumber}</p>
            <p><strong>Shipped Date:</strong> ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
          </div>
          <p>You can track your order using the tracking number above or by clicking the button below.</p>
          <p style="text-align: center;">
            <a href="${orderUrl}" class="button">Track Your Order</a>
          </p>
          <p>We'll notify you once your order has been delivered.</p>
        </div>
        <div class="footer">
          <p>Best regards,<br>The ${brandConfig.name} Team</p>
          <p>© ${new Date().getFullYear()} ${brandConfig.name}. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return await sendEmail({
    to: user.email,
    subject: `Your Order #${order.orderNumber || order._id || 'N/A'} Has Shipped - ${brandConfig.name}`,
    text: `Hello ${user.name || 'Customer'}, your order #${order.orderNumber || order._id || 'N/A'} has been shipped. Tracking Number: ${trackingNumber}. Track your order: ${orderUrl}`,
    html: htmlContent,
  });
};

/**
 * Send order delivered email to buyer
 * @param {Object} order - Order object
 * @param {Object} user - User object with email and name
 */
const sendOrderDelivered = async (order, user) => {
  const brandConfig = {
    name: process.env.APP_NAME || process.env.BRAND_NAME || 'Saiisai',
    url: process.env.FRONTEND_URL || 'https://saiisai.com',
  };

  const orderUrl = `${brandConfig.url}/orders/${order._id || order.id}`;

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Inter', sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #28a745 0%, #20c997 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #ffffff; padding: 30px; border-radius: 0 0 10px 10px; }
        .success-box { background: #d4edda; border-left: 4px solid #28a745; padding: 20px; border-radius: 5px; margin: 20px 0; }
        .button { display: inline-block; padding: 12px 30px; background: #28a745; color: white !important; text-decoration: none; border-radius: 5px; margin: 20px 0; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eaeaea; color: #6c757d; font-size: 0.9em; text-align: center; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>✅ Your Order Has Been Delivered!</h1>
        </div>
        <div class="content">
          <p>Hello ${user.name || 'Customer'},</p>
          <p>We're excited to let you know that your order has been successfully delivered!</p>
          <div class="success-box">
            <p><strong>Order Number:</strong> ${order.orderNumber || order._id || 'N/A'}</p>
            <p><strong>Delivered Date:</strong> ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
          </div>
          <p>We hope you're happy with your purchase. If you have any questions or concerns, please don't hesitate to contact our support team.</p>
          <p style="text-align: center;">
            <a href="${orderUrl}" class="button">View Order Details</a>
          </p>
          <p>Thank you for shopping with ${brandConfig.name}!</p>
        </div>
        <div class="footer">
          <p>Best regards,<br>The ${brandConfig.name} Team</p>
          <p>© ${new Date().getFullYear()} ${brandConfig.name}. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return await sendEmail({
    to: user.email,
    subject: `Your Order #${order.orderNumber || order._id || 'N/A'} Has Been Delivered - ${brandConfig.name}`,
    text: `Hello ${user.name || 'Customer'}, your order #${order.orderNumber || order._id || 'N/A'} has been delivered. View your order: ${orderUrl}`,
    html: htmlContent,
  });
};

/**
 * Send new order alert email to seller
 * @param {Object} seller - Seller object with email and name/shopName
 * @param {Object} order - Order object
 */
const sendSellerNewOrder = async (seller, order) => {
  const brandConfig = {
    name: process.env.APP_NAME || process.env.BRAND_NAME || 'Saiisai',
    url: process.env.FRONTEND_URL || 'https://saiisai.com',
  };

  const sellerDashboardUrl = `${brandConfig.url}/dashboard/orders/${order._id || order.id}`;
  const orderTotal = order.totalPrice || order.total || 0;
  const itemCount = order.orderItems?.length || 0;

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Inter', sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #ff6b6b 0%, #ee5a6f 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #ffffff; padding: 30px; border-radius: 0 0 10px 10px; }
        .alert-box { background: #fff3cd; border-left: 4px solid #ffc107; padding: 20px; border-radius: 5px; margin: 20px 0; }
        .info-box { background: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0; }
        .button { display: inline-block; padding: 12px 30px; background: #ff6b6b; color: white !important; text-decoration: none; border-radius: 5px; margin: 20px 0; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eaeaea; color: #6c757d; font-size: 0.9em; text-align: center; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🛍️ New Order Received!</h1>
        </div>
        <div class="content">
          <p>Hello ${seller.name || seller.shopName || 'Seller'},</p>
          <div class="alert-box">
            <p><strong>You have received a new order!</strong></p>
          </div>
          <div class="info-box">
            <p><strong>Order Number:</strong> ${order.orderNumber || order._id || 'N/A'}</p>
            <p><strong>Order Total:</strong> GH₵${orderTotal.toFixed(2)}</p>
            <p><strong>Items:</strong> ${itemCount} item(s)</p>
            <p><strong>Order Date:</strong> ${new Date(order.createdAt || Date.now()).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
          </div>
          <p>Please review and process this order as soon as possible.</p>
          <p style="text-align: center;">
            <a href="${sellerDashboardUrl}" class="button">View Order Details</a>
          </p>
        </div>
        <div class="footer">
          <p>Best regards,<br>The ${brandConfig.name} Team</p>
          <p>© ${new Date().getFullYear()} ${brandConfig.name}. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return await sendEmail({
    to: seller.email,
    subject: `New Order #${order.orderNumber || order._id || 'N/A'} - ${brandConfig.name}`,
    text: `Hello ${seller.name || seller.shopName || 'Seller'}, you have received a new order #${order.orderNumber || order._id || 'N/A'} for GH₵${orderTotal.toFixed(2)}. View order: ${sellerDashboardUrl}`,
    html: htmlContent,
  });
};

/**
 * Send order status update email to seller
 * @param {Object} seller - Seller object with email and name/shopName
 * @param {Object} order - Order object
 * @param {string} status - New order status (e.g. 'delivered', 'out_for_delivery')
 */
const sendSellerOrderStatusUpdate = async (seller, order, status) => {
  const brandConfig = {
    name: process.env.APP_NAME || process.env.BRAND_NAME || 'Saiisai',
    url: process.env.SELLER_DASHBOARD_URL || process.env.FRONTEND_URL || 'https://saiisai.com',
  };

  const orderId = order._id || order.id;
  const orderNumber = order.orderNumber || orderId || 'N/A';
  const sellerDashboardUrl = `${brandConfig.url}/dashboard/orders/${orderId}`;

  const statusLabelMap = {
    confirmed: 'Confirmed',
    processing: 'Processing',
    preparing: 'Preparing',
    ready_for_dispatch: 'Ready for Dispatch',
    out_for_delivery: 'Out for Delivery',
    delivery_attempted: 'Delivery Attempted',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
    refunded: 'Refunded',
  };

  const statusLabel = statusLabelMap[status] || status;

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Inter', sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #ffffff; padding: 30px; border-radius: 0 0 10px 10px; }
        .info-box { background: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #2563eb; }
        .button { display: inline-block; padding: 12px 30px; background: #2563eb; color: white !important; text-decoration: none; border-radius: 5px; margin: 20px 0; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eaeaea; color: #6c757d; font-size: 0.9em; text-align: center; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>📦 Order Status Updated</h1>
        </div>
        <div class="content">
          <p>Hello ${seller.name || seller.shopName || 'Seller'},</p>
          <p>The status of one of your orders has been updated.</p>
          <div class="info-box">
            <p><strong>Order Number:</strong> ${orderNumber}</p>
            <p><strong>New Status:</strong> ${statusLabel}</p>
            <p><strong>Updated On:</strong> ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
          </div>
          <p>Please review the order details and take any necessary action from your seller dashboard.</p>
          <p style="text-align: center;">
            <a href="${sellerDashboardUrl}" class="button">View Order in Dashboard</a>
          </p>
        </div>
        <div class="footer">
          <p>Best regards,<br>The ${brandConfig.name} Team</p>
          <p>© ${new Date().getFullYear()} ${brandConfig.name}. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return await sendEmail({
    to: seller.email,
    subject: `Order #${orderNumber} Status Updated to ${statusLabel} - ${brandConfig.name}`,
    text: `Hello ${seller.name || seller.shopName || 'Seller'}, the status of order #${orderNumber} has been updated to "${statusLabel}". View order: ${sellerDashboardUrl}`,
    html: htmlContent,
  });
};

/**
 * Send seller credit alert email after order delivery payout.
 * @param {Object} seller - Seller object with email and name/shopName
 * @param {Object} order - Order object
 * @param {number} amount - Credited amount
 */
const sendSellerCreditAlert = async (seller, order, amount) => {
  const brandConfig = {
    name: process.env.APP_NAME || process.env.BRAND_NAME || 'Saiisai',
    url: process.env.SELLER_DASHBOARD_URL || process.env.FRONTEND_URL || 'https://saiisai.com',
  };

  const orderId = order._id || order.id;
  const orderNumber = order.orderNumber || orderId || 'N/A';
  const sellerDashboardUrl = `${brandConfig.url}/dashboard/orders/${orderId}`;
  const creditAmount = Number(amount || 0).toFixed(2);

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Inter', sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #16a34a 0%, #15803d 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #ffffff; padding: 30px; border-radius: 0 0 10px 10px; }
        .info-box { background: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #16a34a; }
        .button { display: inline-block; padding: 12px 30px; background: #16a34a; color: white !important; text-decoration: none; border-radius: 5px; margin: 20px 0; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eaeaea; color: #6c757d; font-size: 0.9em; text-align: center; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>💰 Seller Credit Received</h1>
        </div>
        <div class="content">
          <p>Hello ${seller.name || seller.shopName || 'Seller'},</p>
          <p>You have received a payout credit for a delivered order.</p>
          <div class="info-box">
            <p><strong>Order Number:</strong> ${orderNumber}</p>
            <p><strong>Credited Amount:</strong> GH₵${creditAmount}</p>
            <p><strong>Date:</strong> ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
          </div>
          <p style="text-align: center;">
            <a href="${sellerDashboardUrl}" class="button">View Order</a>
          </p>
        </div>
        <div class="footer">
          <p>Best regards,<br>The ${brandConfig.name} Team</p>
          <p>© ${new Date().getFullYear()} ${brandConfig.name}. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return await sendEmail({
    to: seller.email,
    subject: `Seller Credit: GH₵${creditAmount} for Order #${orderNumber} - ${brandConfig.name}`,
    text: `Hello ${seller.name || seller.shopName || 'Seller'}, you have been credited GH₵${creditAmount} for delivered order #${orderNumber}. View order: ${sellerDashboardUrl}`,
    html: htmlContent,
  });
};

/**
 * Send withdrawal request confirmation email to seller
 * @param {Object} seller - Seller object with email and name
 * @param {Object} withdrawal - Withdrawal request object
 */
const sendWithdrawalRequest = async (seller, withdrawal) => {
  const brandConfig = {
    name: process.env.APP_NAME || process.env.BRAND_NAME || 'Saiisai',
    url: process.env.FRONTEND_URL || 'https://saiisai.com',
  };

  const amount = withdrawal.amount || 0;
  const requestId = withdrawal._id || withdrawal.id;

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Inter', sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #ffffff; padding: 30px; border-radius: 0 0 10px 10px; }
        .info-box { background: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eaeaea; color: #6c757d; font-size: 0.9em; text-align: center; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>💰 Withdrawal Request Received</h1>
        </div>
        <div class="content">
          <p>Hello ${seller.name || seller.shopName || 'Seller'},</p>
          <p>We've received your withdrawal request and it's currently under review.</p>
          <div class="info-box">
            <p><strong>Request ID:</strong> #${requestId}</p>
            <p><strong>Amount:</strong> GH₵${amount.toFixed(2)}</p>
            <p><strong>Request Date:</strong> ${new Date(withdrawal.createdAt || Date.now()).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
            <p><strong>Status:</strong> Pending Review</p>
          </div>
          <p>Our team will review your request and process it within 1-3 business days. You'll receive another email once your withdrawal has been approved and processed.</p>
        </div>
        <div class="footer">
          <p>Best regards,<br>The ${brandConfig.name} Finance Team</p>
          <p>© ${new Date().getFullYear()} ${brandConfig.name}. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return await sendEmail({
    to: seller.email,
    subject: `Withdrawal Request Received - GH₵${amount.toFixed(2)} - ${brandConfig.name}`,
    text: `Hello ${seller.name || seller.shopName || 'Seller'}, your withdrawal request for GH₵${amount.toFixed(2)} has been received and is pending review.`,
    html: htmlContent,
  });
};

/**
 * Send withdrawal approved email to seller
 * @param {Object} seller - Seller object with email and name
 * @param {Object} withdrawal - Withdrawal request object
 */
const sendWithdrawalApproved = async (seller, withdrawal) => {
  const brandConfig = {
    name: process.env.APP_NAME || process.env.BRAND_NAME || 'Saiisai',
    url: process.env.FRONTEND_URL || 'https://saiisai.com',
  };

  const amount = withdrawal.amount ?? withdrawal.amountRequested ?? 0;
  const requestId = withdrawal._id || withdrawal.id;
  const transactionId = withdrawal.transactionId || withdrawal.paystackReference || withdrawal.paystackTransferCode || 'N/A';

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Inter', sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #28a745 0%, #20c997 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #ffffff; padding: 30px; border-radius: 0 0 10px 10px; }
        .success-box { background: #d4edda; border-left: 4px solid #28a745; padding: 20px; border-radius: 5px; margin: 20px 0; }
        .info-box { background: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eaeaea; color: #6c757d; font-size: 0.9em; text-align: center; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>✅ Withdrawal Approved!</h1>
        </div>
        <div class="content">
          <p>Hello ${seller.name || seller.shopName || 'Seller'},</p>
          <div class="success-box">
            <p><strong>Your withdrawal request has been approved and processed!</strong></p>
          </div>
          <div class="info-box">
            <p><strong>Request ID:</strong> #${requestId}</p>
            <p><strong>Amount:</strong> GH₵${amount.toFixed(2)}</p>
            <p><strong>Transaction ID:</strong> ${transactionId}</p>
            <p><strong>Processed Date:</strong> ${new Date(withdrawal.processedAt || Date.now()).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
          </div>
          <p>The funds have been transferred to your account. Please allow 1-3 business days for the funds to reflect in your account.</p>
        </div>
        <div class="footer">
          <p>Best regards,<br>The ${brandConfig.name} Finance Team</p>
          <p>© ${new Date().getFullYear()} ${brandConfig.name}. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return await sendEmail({
    to: seller.email,
    subject: `Withdrawal Approved - GH₵${amount.toFixed(2)} - ${brandConfig.name}`,
    text: `Hello ${seller.name || seller.shopName || 'Seller'}, your withdrawal request for GH₵${amount.toFixed(2)} has been approved and processed. Transaction ID: ${transactionId}`,
    html: htmlContent,
  });
};

/**
 * Send withdrawal rejected email to seller
 * @param {Object} seller - Seller object with email and name
 * @param {Object} withdrawal - Withdrawal request object
 * @param {string} reason - Rejection reason
 */
const sendWithdrawalRejected = async (seller, withdrawal, reason) => {
  const brandConfig = {
    name: process.env.APP_NAME || process.env.BRAND_NAME || 'Saiisai',
    url: process.env.FRONTEND_URL || 'https://saiisai.com',
  };

  const amount = withdrawal.amount || 0;
  const requestId = withdrawal._id || withdrawal.id;

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Inter', sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #dc3545 0%, #c82333 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #ffffff; padding: 30px; border-radius: 0 0 10px 10px; }
        .warning-box { background: #f8d7da; border-left: 4px solid #dc3545; padding: 20px; border-radius: 5px; margin: 20px 0; }
        .info-box { background: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eaeaea; color: #6c757d; font-size: 0.9em; text-align: center; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>⚠️ Withdrawal Request Rejected</h1>
        </div>
        <div class="content">
          <p>Hello ${seller.name || seller.shopName || 'Seller'},</p>
          <div class="warning-box">
            <p><strong>Your withdrawal request has been rejected.</strong></p>
          </div>
          <div class="info-box">
            <p><strong>Request ID:</strong> #${requestId}</p>
            <p><strong>Amount:</strong> GH₵${amount.toFixed(2)}</p>
            <p><strong>Rejection Reason:</strong> ${reason || 'No reason provided'}</p>
          </div>
          <p>The requested amount has been refunded to your available balance. If you have any questions about this rejection, please contact our support team.</p>
        </div>
        <div class="footer">
          <p>Best regards,<br>The ${brandConfig.name} Finance Team</p>
          <p>© ${new Date().getFullYear()} ${brandConfig.name}. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return await sendEmail({
    to: seller.email,
    subject: `Withdrawal Request Rejected - GH₵${amount.toFixed(2)} - ${brandConfig.name}`,
    text: `Hello ${seller.name || seller.shopName || 'Seller'}, your withdrawal request for GH₵${amount.toFixed(2)} has been rejected. Reason: ${reason || 'No reason provided'}. The amount has been refunded to your balance.`,
    html: htmlContent,
  });
};

/**
 * Send product approved email to seller
 * @param {Object} seller - Seller object with email, name, shopName
 * @param {Object} product - Product object with name, _id
 */
const sendProductApprovedEmail = async (seller, product) => {
  const brandConfig = {
    name: process.env.APP_NAME || process.env.BRAND_NAME || 'Saiisai',
    url: process.env.FRONTEND_URL || 'https://saiisai.com',
  };

  const productName = product.name || 'Your product';
  const productId = product._id || product.id;
  const sellerProductsUrl = `${brandConfig.url}/seller/products`;

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Inter', sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #28a745 0%, #20c997 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #ffffff; padding: 30px; border-radius: 0 0 10px 10px; }
        .success-box { background: #d4edda; border-left: 4px solid #28a745; padding: 20px; border-radius: 5px; margin: 20px 0; }
        .info-box { background: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0; }
        .button { display: inline-block; padding: 12px 30px; background: #28a745; color: white !important; text-decoration: none; border-radius: 5px; margin: 20px 0; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eaeaea; color: #6c757d; font-size: 0.9em; text-align: center; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>✅ Product Approved!</h1>
        </div>
        <div class="content">
          <p>Hello ${seller.name || seller.shopName || 'Seller'},</p>
          <p>Great news! Your product has been approved and is now live on the marketplace.</p>
          <div class="success-box">
            <p><strong>Your product has been approved.</strong></p>
          </div>
          <div class="info-box">
            <p><strong>Product:</strong> ${productName}</p>
            <p><strong>Approved on:</strong> ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
          </div>
          <p>Buyers can now see and purchase this product. You can manage it from your seller dashboard.</p>
          <p style="text-align: center;">
            <a href="${sellerProductsUrl}" class="button">View My Products</a>
          </p>
        </div>
        <div class="footer">
          <p>Best regards,<br>The ${brandConfig.name} Team</p>
          <p>© ${new Date().getFullYear()} ${brandConfig.name}. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return await sendEmail({
    to: seller.email,
    subject: `Product Approved: ${productName} - ${brandConfig.name}`,
    text: `Hello ${seller.name || seller.shopName || 'Seller'}, your product "${productName}" has been approved and is now live on ${brandConfig.name}. View your products: ${sellerProductsUrl}`,
    html: htmlContent,
  });
};

/**
 * Send refund processed email to buyer
 * @param {Object} user - User object with email and name
 * @param {Object} refund - Refund request object
 * @param {Object} order - Order object
 */
const sendRefundProcessed = async (user, refund, order) => {
  const brandConfig = {
    name: process.env.APP_NAME || process.env.BRAND_NAME || 'Saiisai',
    url: process.env.FRONTEND_URL || 'https://saiisai.com',
  };

  const refundAmount = refund.finalRefundAmount || refund.totalRefundAmount || 0;
  const orderUrl = `${brandConfig.url}/orders/${order._id || order.id}`;

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Inter', sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #28a745 0%, #20c997 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #ffffff; padding: 30px; border-radius: 0 0 10px 10px; }
        .success-box { background: #d4edda; border-left: 4px solid #28a745; padding: 20px; border-radius: 5px; margin: 20px 0; }
        .info-box { background: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0; }
        .button { display: inline-block; padding: 12px 30px; background: #28a745; color: white !important; text-decoration: none; border-radius: 5px; margin: 20px 0; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eaeaea; color: #6c757d; font-size: 0.9em; text-align: center; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>✅ Refund Processed</h1>
        </div>
        <div class="content">
          <p>Hello ${user.name || 'Customer'},</p>
          <div class="success-box">
            <p><strong>Your refund has been processed successfully!</strong></p>
          </div>
          <div class="info-box">
            <p><strong>Order Number:</strong> ${order.orderNumber || order._id || 'N/A'}</p>
            <p><strong>Refund Amount:</strong> GH₵${refundAmount.toFixed(2)}</p>
            <p><strong>Processed Date:</strong> ${new Date(refund.processedAt || Date.now()).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
          </div>
          <p>The refund amount has been processed and will be credited to your original payment method within 5-10 business days.</p>
          <p style="text-align: center;">
            <a href="${orderUrl}" class="button">View Order Details</a>
          </p>
        </div>
        <div class="footer">
          <p>Best regards,<br>The ${brandConfig.name} Team</p>
          <p>© ${new Date().getFullYear()} ${brandConfig.name}. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return await sendEmail({
    to: user.email,
    subject: `Refund Processed - GH₵${refundAmount.toFixed(2)} - ${brandConfig.name}`,
    text: `Hello ${user.name || 'Customer'}, your refund of GH₵${refundAmount.toFixed(2)} for order #${order.orderNumber || order._id || 'N/A'} has been processed.`,
    html: htmlContent,
  });
};

/**
 * Send coupon received email to buyer
 * @param {Object} user - User object with email and name
 * @param {Object} coupon - Coupon object
 * @param {Object} batch - Coupon batch object
 * @param {Object} seller - Seller object (optional)
 * @param {string} personalMessage - Optional personal message from seller
 */
const sendCouponToBuyer = async (user, coupon, batch, seller = null, personalMessage = null) => {
  const brandConfig = {
    name: process.env.APP_NAME || process.env.BRAND_NAME || 'Saiisai',
    url: process.env.FRONTEND_URL || 'https://saiisai.com',
  };

  const couponCode = coupon.code || 'N/A';
  const discountValue = batch.discountValue || 0;
  const discountType = batch.discountType || 'fixed';
  const discountText = discountType === 'percentage'
    ? `${discountValue}% off`
    : `GH₵${discountValue} off`;
  const validUntil = batch.expiresAt ? new Date(batch.expiresAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'N/A';
  const sellerName = seller ? (seller.name || seller.shopName || 'A seller') : 'Saiisai';

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Inter', sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #ff6b6b 0%, #ee5a6f 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #ffffff; padding: 30px; border-radius: 0 0 10px 10px; }
        .coupon-box { background: linear-gradient(135deg, #ff6b6b 0%, #ee5a6f 100%); color: white; padding: 30px; text-align: center; border-radius: 10px; margin: 30px 0; }
        .coupon-code { font-size: 2.5rem; font-weight: 800; letter-spacing: 5px; margin: 20px 0; }
        .info-box { background: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0; }
        .button { display: inline-block; padding: 12px 30px; background: #ff6b6b; color: white !important; text-decoration: none; border-radius: 5px; margin: 20px 0; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eaeaea; color: #6c757d; font-size: 0.9em; text-align: center; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🎁 You've Received a Coupon!</h1>
        </div>
        <div class="content">
          <p>Hello ${user.name || 'Customer'},</p>
          <p>Great news! ${sellerName} has sent you a special coupon.</p>
          <div class="coupon-box">
            <p style="margin: 0; font-size: 1.4rem; opacity: 0.9;">Your Coupon Code</p>
            <div class="coupon-code">${couponCode}</div>
            <p style="margin: 0; font-size: 1.2rem; opacity: 0.9;">${discountText}</p>
          </div>
          <div class="info-box">
            <p><strong>Discount:</strong> ${discountText}</p>
            <p><strong>Valid Until:</strong> ${validUntil}</p>
            ${batch.minOrderAmount ? `<p><strong>Minimum Order:</strong> GH₵${batch.minOrderAmount.toFixed(2)}</p>` : ''}
          </div>
          ${personalMessage ? `<div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px; border-radius: 5px; margin: 20px 0;"><p style="margin: 0; font-style: italic; color: #92400e;">"${personalMessage}"</p><p style="margin: 8px 0 0 0; font-size: 0.9rem; color: #78350f;">- ${sellerName}</p></div>` : ''}
          <p>Use this coupon code at checkout to enjoy your discount!</p>
          <p style="text-align: center;">
            <a href="${brandConfig.url}/checkout?coupon=${couponCode}" class="button">Start Shopping</a>
          </p>
        </div>
        <div class="footer">
          <p>Best regards,<br>The ${brandConfig.name} Team</p>
          <p>© ${new Date().getFullYear()} ${brandConfig.name}. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return await sendEmail({
    to: user.email,
    subject: `🎁 Special Coupon for You - ${discountText} - ${brandConfig.name}`,
    text: `Hello ${user.name || 'Customer'}, you've received a coupon from ${sellerName}! Code: ${couponCode}, Discount: ${discountText}, Valid until: ${validUntil}`,
    html: htmlContent,
  });
};

/**
 * Send wallet credit notification email
 * @param {Object} user - User object with email and name
 * @param {number} amount - Credit amount
 * @param {string} description - Transaction description
 */
const sendWalletCredit = async (user, amount, description) => {
  const brandConfig = {
    name: process.env.APP_NAME || process.env.BRAND_NAME || 'Saiisai',
    url: process.env.FRONTEND_URL || 'https://saiisai.com',
  };

  const walletUrl = `${brandConfig.url}/wallet`;

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Inter', sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #28a745 0%, #20c997 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #ffffff; padding: 30px; border-radius: 0 0 10px 10px; }
        .success-box { background: #d4edda; border-left: 4px solid #28a745; padding: 20px; border-radius: 5px; margin: 20px 0; }
        .info-box { background: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0; }
        .button { display: inline-block; padding: 12px 30px; background: #28a745; color: white !important; text-decoration: none; border-radius: 5px; margin: 20px 0; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eaeaea; color: #6c757d; font-size: 0.9em; text-align: center; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>💰 Wallet Credit</h1>
        </div>
        <div class="content">
          <p>Hello ${user.name || 'Customer'},</p>
          <div class="success-box">
            <p><strong>Your wallet has been credited!</strong></p>
          </div>
          <div class="info-box">
            <p><strong>Amount:</strong> GH₵${amount.toFixed(2)}</p>
            <p><strong>Description:</strong> ${description || 'Wallet credit'}</p>
            <p><strong>Date:</strong> ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
          </div>
          <p style="text-align: center;">
            <a href="${walletUrl}" class="button">View Wallet</a>
          </p>
        </div>
        <div class="footer">
          <p>Best regards,<br>The ${brandConfig.name} Team</p>
          <p>© ${new Date().getFullYear()} ${brandConfig.name}. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return await sendEmail({
    to: user.email,
    subject: `Wallet Credit - GH₵${amount.toFixed(2)} - ${brandConfig.name}`,
    text: `Hello ${user.name || 'Customer'}, your wallet has been credited with GH₵${amount.toFixed(2)}. ${description || 'Wallet credit'}`,
    html: htmlContent,
  });
};

/**
 * Send wallet debit notification email
 * @param {Object} user - User object with email and name
 * @param {number} amount - Debit amount
 * @param {string} description - Transaction description
 */
const sendWalletDebit = async (user, amount, description) => {
  const brandConfig = {
    name: process.env.APP_NAME || process.env.BRAND_NAME || 'Saiisai',
    url: process.env.FRONTEND_URL || 'https://saiisai.com',
  };

  const walletUrl = `${brandConfig.url}/wallet`;

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Inter', sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #dc3545 0%, #c82333 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #ffffff; padding: 30px; border-radius: 0 0 10px 10px; }
        .info-box { background: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0; }
        .button { display: inline-block; padding: 12px 30px; background: #dc3545; color: white !important; text-decoration: none; border-radius: 5px; margin: 20px 0; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eaeaea; color: #6c757d; font-size: 0.9em; text-align: center; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>💳 Wallet Debit</h1>
        </div>
        <div class="content">
          <p>Hello ${user.name || 'Customer'},</p>
          <p>Your wallet has been debited for the following transaction:</p>
          <div class="info-box">
            <p><strong>Amount:</strong> GH₵${amount.toFixed(2)}</p>
            <p><strong>Description:</strong> ${description || 'Wallet debit'}</p>
            <p><strong>Date:</strong> ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
          </div>
          <p style="text-align: center;">
            <a href="${walletUrl}" class="button">View Wallet</a>
          </p>
        </div>
        <div class="footer">
          <p>Best regards,<br>The ${brandConfig.name} Team</p>
          <p>© ${new Date().getFullYear()} ${brandConfig.name}. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return await sendEmail({
    to: user.email,
    subject: `Wallet Debit - GH₵${amount.toFixed(2)} - ${brandConfig.name}`,
    text: `Hello ${user.name || 'Customer'}, your wallet has been debited GH₵${amount.toFixed(2)}. ${description || 'Wallet debit'}`,
    html: htmlContent,
  });
};

/**
 * Send payment success email to buyer
 * @param {Object} user - User object with email and name
 * @param {Object} order - Order object
 */
const sendPaymentSuccess = async (user, order) => {
  const brandConfig = {
    name: process.env.APP_NAME || process.env.BRAND_NAME || 'Saiisai',
    url: process.env.FRONTEND_URL || 'https://saiisai.com',
  };

  const orderUrl = `${brandConfig.url}/orders/${order._id || order.id}`;
  const orderTotal = order.totalPrice || order.total || 0;

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Inter', sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #28a745 0%, #20c997 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #ffffff; padding: 30px; border-radius: 0 0 10px 10px; }
        .success-box { background: #d4edda; border-left: 4px solid #28a745; padding: 20px; border-radius: 5px; margin: 20px 0; }
        .info-box { background: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0; }
        .button { display: inline-block; padding: 12px 30px; background: #28a745; color: white !important; text-decoration: none; border-radius: 5px; margin: 20px 0; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eaeaea; color: #6c757d; font-size: 0.9em; text-align: center; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>✅ Payment Successful!</h1>
        </div>
        <div class="content">
          <p>Hello ${user.name || 'Customer'},</p>
          <div class="success-box">
            <p><strong>Your payment has been processed successfully!</strong></p>
          </div>
          <div class="info-box">
            <p><strong>Order Number:</strong> ${order.orderNumber || order._id || 'N/A'}</p>
            <p><strong>Amount Paid:</strong> GH₵${orderTotal.toFixed(2)}</p>
            <p><strong>Payment Date:</strong> ${new Date(order.paidAt || Date.now()).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
          </div>
          <p>Your order is now being processed. You'll receive another email once your order ships.</p>
          <p style="text-align: center;">
            <a href="${orderUrl}" class="button">View Order Details</a>
          </p>
        </div>
        <div class="footer">
          <p>Best regards,<br>The ${brandConfig.name} Team</p>
          <p>© ${new Date().getFullYear()} ${brandConfig.name}. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return await sendEmail({
    to: user.email,
    subject: `Payment Successful - Order #${order.orderNumber || order._id || 'N/A'} - ${brandConfig.name}`,
    text: `Hello ${user.name || 'Customer'}, your payment of GH₵${orderTotal.toFixed(2)} for order #${order.orderNumber || order._id || 'N/A'} has been processed successfully.`,
    html: htmlContent,
  });
};

/**
 * Send payment failed email to buyer
 * @param {Object} user - User object with email and name
 * @param {Object} order - Order object
 * @param {string} reason - Failure reason
 */
const sendPaymentFailed = async (user, order, reason = null) => {
  const brandConfig = {
    name: process.env.APP_NAME || process.env.BRAND_NAME || 'Saiisai',
    url: process.env.FRONTEND_URL || 'https://saiisai.com',
  };

  const orderUrl = `${brandConfig.url}/orders/${order._id || order.id}`;
  const orderTotal = order.totalPrice || order.total || 0;

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Inter', sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #dc3545 0%, #b91c1c 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #ffffff; padding: 30px; border-radius: 0 0 10px 10px; }
        .warning-box { background: #f8d7da; border-left: 4px solid #dc3545; padding: 20px; border-radius: 5px; margin: 20px 0; }
        .info-box { background: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0; }
        .button { display: inline-block; padding: 12px 30px; background: #4361ee; color: white !important; text-decoration: none; border-radius: 5px; margin: 20px 0; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eaeaea; color: #6c757d; font-size: 0.9em; text-align: center; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Payment Failed</h1>
        </div>
        <div class="content">
          <p>Hello ${user.name || 'Customer'},</p>
          <div class="warning-box">
            <p><strong>We could not complete your payment.</strong></p>
          </div>
          <div class="info-box">
            <p><strong>Order Number:</strong> ${order.orderNumber || order._id || 'N/A'}</p>
            <p><strong>Amount:</strong> GH₵${orderTotal.toFixed(2)}</p>
            <p><strong>Reason:</strong> ${reason || 'The payment was not successful. Please try again.'}</p>
          </div>
          <p>You can retry payment from your order details page.</p>
          <p style="text-align: center;">
            <a href="${orderUrl}" class="button">Retry Payment</a>
          </p>
        </div>
        <div class="footer">
          <p>Best regards,<br>The ${brandConfig.name} Team</p>
          <p>© ${new Date().getFullYear()} ${brandConfig.name}. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return await sendEmail({
    to: user.email,
    subject: `Payment Failed - Order #${order.orderNumber || order._id || 'N/A'} - ${brandConfig.name}`,
    text: `Hello ${user.name || 'Customer'}, payment for order #${order.orderNumber || order._id || 'N/A'} could not be completed. ${reason || 'Please retry payment from your order details.'}`,
    html: htmlContent,
  });
};


// ============================================================================
// BUYER — ORDER CANCELLED
// ============================================================================
const sendOrderCancelledBuyer = async (order, user, cancelledBy = 'system', reason = null) => {
  const BRAND_NAME = process.env.APP_NAME || process.env.BRAND_NAME || 'Saiisai';
  const FRONTEND_URL = process.env.FRONTEND_URL || 'https://saiisai.com';
  const supportUrl = `${FRONTEND_URL}/support`;
  const isPaid = order.paymentStatus === 'paid' || order.paymentStatus === 'completed';
  const total = Number(order.totalPrice || order.total || 0).toFixed(2);

  const html = `<!DOCTYPE html><html><head><style>
    body{font-family:'Inter',sans-serif;line-height:1.6;color:#333;margin:0;padding:0;}
    .wrap{max-width:600px;margin:0 auto;padding:24px;}
    .hd{background:linear-gradient(135deg,#EF4444,#B91C1C);color:#fff;padding:28px;text-align:center;border-radius:10px 10px 0 0;}
    .bd{background:#fff;padding:28px;border-radius:0 0 10px 10px;}
    .badge{background:#FEF2F2;border-left:4px solid #EF4444;padding:14px 18px;border-radius:6px;margin:18px 0;}
    .info{background:#F9F9F9;border-radius:6px;padding:18px;margin:18px 0;}
    .info p{margin:4px 0;font-size:14px;}
    .refund-box{background:#F0FDF4;border-left:4px solid #22C55E;padding:14px 18px;border-radius:6px;margin:18px 0;}
    .btn{display:inline-block;padding:12px 28px;background:#4361EE;color:#fff!important;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;}
    .ft{margin-top:24px;padding-top:16px;border-top:1px solid #EEE;font-size:12px;color:#888;text-align:center;}
  </style></head><body><div class="wrap">
    <div class="hd"><h1 style="margin:0;font-size:22px;">❌ Order Cancelled</h1></div>
    <div class="bd">
      <p>Hi ${user.name || 'Customer'},</p>
      <p>Your order has been cancelled${cancelledBy !== 'system' ? ` by ${cancelledBy}` : ''}.</p>
      <div class="badge">
        <strong>Reason:</strong> ${reason || 'Not specified'}
      </div>
      <div class="info">
        <p><strong>Order #:</strong> ${order.orderNumber || order._id}</p>
        <p><strong>Cancelled on:</strong> ${new Date().toDateString()}</p>
        <p><strong>Original Total:</strong> GH₵${total}</p>
      </div>
      ${isPaid ? `<div class="refund-box">
        <p style="margin:0;font-weight:600;color:#166534;">💰 Refund Information</p>
        <p style="margin:6px 0 0;">A refund of GH₵${total} will be processed within 3–5 business days to your original payment method.</p>
      </div>` : ''}
      <p style="text-align:center;"><a href="${supportUrl}" class="btn">Contact Support</a></p>
    </div>
    <div class="ft">© ${new Date().getFullYear()} ${BRAND_NAME} · Need help? <a href="mailto:${process.env.SUPPORT_EMAIL || 'support@saiisai.com'}">${process.env.SUPPORT_EMAIL || 'support@saiisai.com'}</a></div>
  </div></body></html>`;

  return await sendEmail({
    to: user.email,
    subject: `Order #${order.orderNumber || order._id} Cancelled — ${BRAND_NAME}`,
    text: `Hi ${user.name || 'Customer'}, your order #${order.orderNumber || order._id} has been cancelled. ${reason ? 'Reason: ' + reason : ''}`,
    html,
  });
};

// ============================================================================
// SELLER — ORDER CANCELLED
// ============================================================================
const sendOrderCancelledSeller = async (order, seller, reason = null) => {
  const BRAND_NAME = process.env.APP_NAME || process.env.BRAND_NAME || 'Saiisai';
  const SELLER_URL = process.env.SELLER_DASHBOARD_URL || process.env.FRONTEND_URL || 'https://saiisai.com';
  const ordersUrl = `${SELLER_URL}/dashboard/orders`;

  const html = `<!DOCTYPE html><html><head><style>
    body{font-family:'Inter',sans-serif;line-height:1.6;color:#333;margin:0;}
    .wrap{max-width:600px;margin:0 auto;padding:24px;}
    .hd{background:linear-gradient(135deg,#F59E0B,#D97706);color:#fff;padding:28px;text-align:center;border-radius:10px 10px 0 0;}
    .bd{background:#fff;padding:28px;border-radius:0 0 10px 10px;}
    .badge{background:#FFFBEB;border-left:4px solid #F59E0B;padding:14px 18px;border-radius:6px;margin:18px 0;}
    .info{background:#F9F9F9;border-radius:6px;padding:18px;margin:18px 0;}
    .info p{margin:4px 0;font-size:14px;}
    .btn{display:inline-block;padding:12px 28px;background:#4361EE;color:#fff!important;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;}
    .ft{margin-top:24px;padding-top:16px;border-top:1px solid #EEE;font-size:12px;color:#888;text-align:center;}
  </style></head><body><div class="wrap">
    <div class="hd"><h1 style="margin:0;font-size:22px;">📋 Order Cancelled</h1></div>
    <div class="bd">
      <p>Hi ${seller.name || seller.shopName || 'Seller'},</p>
      <p>An order from your store has been cancelled. Stock has been automatically restored.</p>
      <div class="badge">
        <strong>Reason:</strong> ${reason || 'Not specified'}
      </div>
      <div class="info">
        <p><strong>Order #:</strong> ${order.orderNumber || order._id}</p>
        <p><strong>Cancelled on:</strong> ${new Date().toDateString()}</p>
        <p><strong>Order Total:</strong> GH₵${Number(order.totalPrice || 0).toFixed(2)}</p>
      </div>
      <p style="text-align:center;"><a href="${ordersUrl}" class="btn">View My Orders</a></p>
    </div>
    <div class="ft">© ${new Date().getFullYear()} ${BRAND_NAME}</div>
  </div></body></html>`;

  return await sendEmail({
    to: seller.email,
    subject: `Order #${order.orderNumber || order._id} Cancelled — ${BRAND_NAME}`,
    text: `Hi ${seller.name || seller.shopName || 'Seller'}, order #${order.orderNumber || order._id} has been cancelled. ${reason ? 'Reason: ' + reason : ''} Stock has been restored.`,
    html,
  });
};

// ============================================================================
// SELLER — PRODUCT REJECTED
// ============================================================================
const sendProductRejectedEmail = async (seller, product, reason = null) => {
  const BRAND_NAME = process.env.APP_NAME || process.env.BRAND_NAME || 'Saiisai';
  const SELLER_URL = process.env.SELLER_DASHBOARD_URL || process.env.FRONTEND_URL || 'https://saiisai.com';
  const editUrl = `${SELLER_URL}/dashboard/products/${product._id || product.id}/edit`;

  const html = `<!DOCTYPE html><html><head><style>
    body{font-family:'Inter',sans-serif;line-height:1.6;color:#333;margin:0;}
    .wrap{max-width:600px;margin:0 auto;padding:24px;}
    .hd{background:linear-gradient(135deg,#EF4444,#B91C1C);color:#fff;padding:28px;text-align:center;border-radius:10px 10px 0 0;}
    .bd{background:#fff;padding:28px;border-radius:0 0 10px 10px;}
    .badge{background:#FEF2F2;border-left:4px solid #EF4444;padding:14px 18px;border-radius:6px;margin:18px 0;}
    .product-box{background:#F9F9F9;border-radius:6px;padding:18px;margin:18px 0;}
    .btn{display:inline-block;padding:12px 28px;background:#4361EE;color:#fff!important;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;}
    .ft{margin-top:24px;padding-top:16px;border-top:1px solid #EEE;font-size:12px;color:#888;text-align:center;}
  </style></head><body><div class="wrap">
    <div class="hd"><h1 style="margin:0;font-size:22px;">📝 Product Needs Changes</h1></div>
    <div class="bd">
      <p>Hi ${seller.name || seller.shopName || 'Seller'},</p>
      <p>Your product submission needs changes before it can go live on ${BRAND_NAME}.</p>
      <div class="badge">
        <strong>Reason:</strong> ${reason || 'Please review the product and resubmit.'}
      </div>
      <div class="product-box">
        <p style="margin:0;font-size:15px;font-weight:600;">${product.name || 'Product'}</p>
        <p style="margin:6px 0 0;font-size:13px;color:#888;">Submitted for review on ${new Date(product.createdAt || Date.now()).toDateString()}</p>
      </div>
      <p>Please review the feedback above, make the necessary changes to your product, and resubmit for approval.</p>
      <p style="text-align:center;"><a href="${editUrl}" class="btn">Edit &amp; Resubmit</a></p>
    </div>
    <div class="ft">© ${new Date().getFullYear()} ${BRAND_NAME}</div>
  </div></body></html>`;

  return await sendEmail({
    to: seller.email,
    subject: `Changes Required — "${product.name || 'Your product'}" — ${BRAND_NAME}`,
    text: `Hi ${seller.name || seller.shopName || 'Seller'}, your product "${product.name}" needs changes. Reason: ${reason || 'Please review and resubmit.'}`,
    html,
  });
};

// ============================================================================
// SELLER — ACCOUNT VERIFIED
// ============================================================================
const sendSellerVerifiedEmail = async (seller) => {
  const BRAND_NAME = process.env.APP_NAME || process.env.BRAND_NAME || 'Saiisai';
  const SELLER_URL = process.env.SELLER_DASHBOARD_URL || process.env.FRONTEND_URL || 'https://saiisai.com';
  const dashUrl = `${SELLER_URL}/dashboard`;

  const html = `<!DOCTYPE html><html><head><style>
    body{font-family:'Inter',sans-serif;line-height:1.6;color:#333;margin:0;}
    .wrap{max-width:600px;margin:0 auto;padding:24px;}
    .hd{background:linear-gradient(135deg,#22C55E,#15803D);color:#fff;padding:28px;text-align:center;border-radius:10px 10px 0 0;}
    .bd{background:#fff;padding:28px;border-radius:0 0 10px 10px;}
    .badge{background:#F0FDF4;border-left:4px solid #22C55E;padding:14px 18px;border-radius:6px;margin:18px 0;}
    .steps{background:#F9F9F9;border-radius:6px;padding:18px;margin:18px 0;}
    .steps li{font-size:14px;margin-bottom:8px;}
    .btn{display:inline-block;padding:12px 28px;background:#4361EE;color:#fff!important;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;}
    .ft{margin-top:24px;padding-top:16px;border-top:1px solid #EEE;font-size:12px;color:#888;text-align:center;}
  </style></head><body><div class="wrap">
    <div class="hd"><h1 style="margin:0;font-size:22px;">🎉 Seller Account Verified!</h1></div>
    <div class="bd">
      <p>Hi ${seller.name || seller.shopName || 'Seller'},</p>
      <p>Congratulations! Your seller account on ${BRAND_NAME} has been verified. You can now list products and start selling.</p>
      <div class="badge">
        <strong>✅ You are now a verified ${BRAND_NAME} seller</strong>
      </div>
      <div class="steps">
        <p style="margin:0 0 8px;font-weight:600;">🚀 What you can do now:</p>
        <ul style="margin:0;padding-left:20px;">
          <li>List your products for sale</li>
          <li>Set up your store profile &amp; logo</li>
          <li>Manage orders and inventory</li>
          <li>Track sales and request payouts</li>
        </ul>
      </div>
      <p style="text-align:center;"><a href="${dashUrl}" class="btn">Go to Seller Dashboard</a></p>
    </div>
    <div class="ft">© ${new Date().getFullYear()} ${BRAND_NAME}</div>
  </div></body></html>`;

  return await sendEmail({
    to: seller.email,
    subject: `🎉 Your ${BRAND_NAME} Seller Account is Verified!`,
    text: `Hi ${seller.name || seller.shopName || 'Seller'}, congratulations! Your seller account on ${BRAND_NAME} has been verified. Log in to your dashboard to start selling.`,
    html,
  });
};

// ============================================================================
// SELLER — ACCOUNT SUSPENDED
// ============================================================================
const sendSellerSuspendedEmail = async (seller, reason = null) => {
  const BRAND_NAME = process.env.APP_NAME || process.env.BRAND_NAME || 'Saiisai';
  const supportEmail = process.env.SUPPORT_EMAIL || 'support@saiisai.com';

  const html = `<!DOCTYPE html><html><head><style>
    body{font-family:'Inter',sans-serif;line-height:1.6;color:#333;margin:0;}
    .wrap{max-width:600px;margin:0 auto;padding:24px;}
    .hd{background:linear-gradient(135deg,#6B7280,#374151);color:#fff;padding:28px;text-align:center;border-radius:10px 10px 0 0;}
    .bd{background:#fff;padding:28px;border-radius:0 0 10px 10px;}
    .badge{background:#FEF2F2;border-left:4px solid #EF4444;padding:14px 18px;border-radius:6px;margin:18px 0;}
    .ft{margin-top:24px;padding-top:16px;border-top:1px solid #EEE;font-size:12px;color:#888;text-align:center;}
  </style></head><body><div class="wrap">
    <div class="hd"><h1 style="margin:0;font-size:22px;">⚠️ Account Suspended</h1></div>
    <div class="bd">
      <p>Hi ${seller.name || seller.shopName || 'Seller'},</p>
      <p>Your ${BRAND_NAME} seller account has been suspended.</p>
      <div class="badge">
        <strong>Reason:</strong> ${reason || 'Policy violation. Please contact support.'}
      </div>
      <p>During suspension, your listings are not visible to buyers and you cannot process new orders.</p>
      <p>If you believe this is an error or would like to appeal, please contact our support team at <a href="mailto:${supportEmail}">${supportEmail}</a>.</p>
    </div>
    <div class="ft">© ${new Date().getFullYear()} ${BRAND_NAME}</div>
  </div></body></html>`;

  return await sendEmail({
    to: seller.email,
    subject: `⚠️ Your ${BRAND_NAME} Seller Account Has Been Suspended`,
    text: `Hi ${seller.name || seller.shopName || 'Seller'}, your seller account on ${BRAND_NAME} has been suspended. Reason: ${reason || 'Policy violation.'}. Contact ${supportEmail} to appeal.`,
    html,
  });
};

// ============================================================================
// SELLER — LOW / OUT OF STOCK ALERT
// ============================================================================
/**
 * @param {Object} seller - { email, name, shopName }
 * @param {Array}  alerts - [{ productName, variantName, sku, stock }]
 */
const sendLowStockAlert = async (seller, alerts = []) => {
  const BRAND_NAME = process.env.APP_NAME || process.env.BRAND_NAME || 'Saiisai';
  const SELLER_URL = process.env.SELLER_DASHBOARD_URL || process.env.FRONTEND_URL || 'https://saiisai.com';
  const inventoryUrl = `${SELLER_URL}/dashboard/inventory`;

  const rows = alerts.map(a => `
    <tr>
      <td style="padding:10px 12px;font-size:13px;border-bottom:1px solid #EEE;">
        ${a.productName || 'Product'}
        ${a.variantName ? `<br><span style="font-size:11px;color:#888;">${a.variantName}</span>` : ''}
      </td>
      <td style="padding:10px 12px;font-size:13px;font-weight:700;border-bottom:1px solid #EEE;color:${a.stock === 0 ? '#DC2626' : '#D97706'};text-align:center;">
        ${a.stock === 0 ? '⛔ OUT OF STOCK' : `${a.stock} left`}
      </td>
    </tr>`).join('');

  const html = `<!DOCTYPE html><html><head><style>
    body{font-family:'Inter',sans-serif;line-height:1.6;color:#333;margin:0;}
    .wrap{max-width:600px;margin:0 auto;padding:24px;}
    .hd{background:linear-gradient(135deg,#F59E0B,#D97706);color:#fff;padding:28px;text-align:center;border-radius:10px 10px 0 0;}
    .bd{background:#fff;padding:28px;border-radius:0 0 10px 10px;}
    table{width:100%;border-collapse:collapse;margin:16px 0;}
    th{background:#F3F4F6;text-align:left;padding:10px 12px;font-size:13px;}
    .btn{display:inline-block;padding:12px 28px;background:#4361EE;color:#fff!important;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;}
    .ft{margin-top:24px;padding-top:16px;border-top:1px solid #EEE;font-size:12px;color:#888;text-align:center;}
  </style></head><body><div class="wrap">
    <div class="hd"><h1 style="margin:0;font-size:22px;">⚠️ Low Stock Alert</h1></div>
    <div class="bd">
      <p>Hi ${seller.name || seller.shopName || 'Seller'},</p>
      <p>${alerts.length} product variant(s) in your store are running low or out of stock.</p>
      <table>
        <thead><tr><th>Product / Variant</th><th style="text-align:center;">Stock</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p>Restock soon to avoid losing sales.</p>
      <p style="text-align:center;"><a href="${inventoryUrl}" class="btn">Update Inventory</a></p>
    </div>
    <div class="ft">© ${new Date().getFullYear()} ${BRAND_NAME}</div>
  </div></body></html>`;

  return await sendEmail({
    to: seller.email,
    subject: `⚠️ Low Stock Alert — ${alerts.length} variant(s) need attention — ${BRAND_NAME}`,
    text: `Hi ${seller.name || seller.shopName || 'Seller'}, ${alerts.length} of your product variants are low or out of stock. Log in to update your inventory: ${inventoryUrl}`,
    html,
  });
};

// ============================================================================
// BUYER — WALLET TOPPED UP
// ============================================================================
const sendWalletTopup = async (user, amount, newBalance) => {
  const BRAND_NAME = process.env.APP_NAME || process.env.BRAND_NAME || 'Saiisai';
  const FRONTEND_URL = process.env.FRONTEND_URL || 'https://saiisai.com';
  const walletUrl = `${FRONTEND_URL}/wallet`;
  const amt = Number(amount || 0).toFixed(2);
  const bal = Number(newBalance || 0).toFixed(2);

  const html = `<!DOCTYPE html><html><head><style>
    body{font-family:'Inter',sans-serif;line-height:1.6;color:#333;margin:0;}
    .wrap{max-width:600px;margin:0 auto;padding:24px;}
    .hd{background:linear-gradient(135deg,#22C55E,#15803D);color:#fff;padding:28px;text-align:center;border-radius:10px 10px 0 0;}
    .bd{background:#fff;padding:28px;border-radius:0 0 10px 10px;}
    .balance-box{background:#F0FDF4;border-radius:8px;padding:24px;margin:18px 0;text-align:center;}
    .btn{display:inline-block;padding:12px 28px;background:#4361EE;color:#fff!important;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;}
    .ft{margin-top:24px;padding-top:16px;border-top:1px solid #EEE;font-size:12px;color:#888;text-align:center;}
  </style></head><body><div class="wrap">
    <div class="hd"><h1 style="margin:0;font-size:22px;">💳 Wallet Topped Up!</h1></div>
    <div class="bd">
      <p>Hi ${user.name || 'Customer'},</p>
      <p>Your ${BRAND_NAME} wallet has been credited with <strong>GH₵${amt}</strong>.</p>
      <div class="balance-box">
        <p style="margin:0;font-size:13px;color:#555;">New Wallet Balance</p>
        <p style="margin:8px 0 0;font-size:36px;font-weight:800;color:#16A34A;">GH₵${bal}</p>
      </div>
      <p style="text-align:center;"><a href="${walletUrl}" class="btn">View Wallet</a></p>
    </div>
    <div class="ft">© ${new Date().getFullYear()} ${BRAND_NAME}</div>
  </div></body></html>`;

  return await sendEmail({
    to: user.email,
    subject: `💳 GH₵${amt} Added to Your Wallet — ${BRAND_NAME}`,
    text: `Hi ${user.name || 'Customer'}, GH₵${amt} has been added to your ${BRAND_NAME} wallet. New balance: GH₵${bal}. View your wallet: ${walletUrl}`,
    html,
  });
};

// ============================================================================
// ADMIN — REFUND REQUESTED ALERT
// ============================================================================
const sendAdminRefundAlert = async (order, user, refundAmount, reason = null) => {
  const BRAND_NAME = process.env.APP_NAME || process.env.BRAND_NAME || 'Saiisai';
  const adminEmail = process.env.ADMIN_EMAIL || process.env.SUPPORT_EMAIL || 'admin@saiisai.com';
  const ADMIN_URL = process.env.ADMIN_DASHBOARD_URL || process.env.FRONTEND_URL || 'https://saiisai.com';
  const refundUrl = `${ADMIN_URL}/admin/refunds`;

  const html = `<!DOCTYPE html><html><head><style>
    body{font-family:'Inter',sans-serif;line-height:1.6;color:#333;margin:0;}
    .wrap{max-width:600px;margin:0 auto;padding:24px;}
    .hd{background:linear-gradient(135deg,#F97316,#EA580C);color:#fff;padding:28px;text-align:center;border-radius:10px 10px 0 0;}
    .bd{background:#fff;padding:28px;border-radius:0 0 10px 10px;}
    .info{background:#FFF7ED;border-left:4px solid #F97316;padding:14px 18px;border-radius:6px;margin:18px 0;}
    .info p{margin:4px 0;font-size:14px;}
    .btn{display:inline-block;padding:12px 28px;background:#4361EE;color:#fff!important;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;}
    .ft{margin-top:24px;padding-top:16px;border-top:1px solid #EEE;font-size:12px;color:#888;text-align:center;}
  </style></head><body><div class="wrap">
    <div class="hd"><h1 style="margin:0;font-size:22px;">⚠️ Refund Request Needs Review</h1></div>
    <div class="bd">
      <p>A buyer has submitted a refund request that requires admin review.</p>
      <div class="info">
        <p><strong>Order #:</strong> ${order.orderNumber || order._id}</p>
        <p><strong>Buyer:</strong> ${user.name || user.email || 'Unknown'}</p>
        <p><strong>Buyer Email:</strong> ${user.email || 'N/A'}</p>
        <p><strong>Refund Amount:</strong> GH₵${Number(refundAmount || 0).toFixed(2)}</p>
        <p><strong>Reason:</strong> ${reason || 'Not specified'}</p>
        <p><strong>Submitted:</strong> ${new Date().toDateString()}</p>
      </div>
      <p style="text-align:center;"><a href="${refundUrl}" class="btn">Review Refund</a></p>
    </div>
    <div class="ft">© ${new Date().getFullYear()} ${BRAND_NAME}</div>
  </div></body></html>`;

  return await sendEmail({
    to: adminEmail,
    subject: `⚠️ Refund Request — Order #${order.orderNumber || order._id} — GH₵${Number(refundAmount || 0).toFixed(2)}`,
    text: `Refund request for order #${order.orderNumber || order._id} by ${user.email}. Amount: GH₵${Number(refundAmount || 0).toFixed(2)}. Reason: ${reason || 'Not provided'}. Review: ${refundUrl}`,
    html,
  });
};

// ============================================================================
// ADMIN — NEW SELLER REGISTERED
// ============================================================================
const sendAdminNewSellerAlert = async (seller) => {
  const BRAND_NAME = process.env.APP_NAME || process.env.BRAND_NAME || 'Saiisai';
  const adminEmail = process.env.ADMIN_EMAIL || process.env.SUPPORT_EMAIL || 'admin@saiisai.com';
  const ADMIN_URL = process.env.ADMIN_DASHBOARD_URL || process.env.FRONTEND_URL || 'https://saiisai.com';
  const reviewUrl = `${ADMIN_URL}/admin/sellers`;

  const html = `<!DOCTYPE html><html><head><style>
    body{font-family:'Inter',sans-serif;line-height:1.6;color:#333;margin:0;}
    .wrap{max-width:600px;margin:0 auto;padding:24px;}
    .hd{background:linear-gradient(135deg,#4361EE,#3A0CA3);color:#fff;padding:28px;text-align:center;border-radius:10px 10px 0 0;}
    .bd{background:#fff;padding:28px;border-radius:0 0 10px 10px;}
    .info{background:#EFF6FF;border-left:4px solid #3B82F6;padding:14px 18px;border-radius:6px;margin:18px 0;}
    .info p{margin:4px 0;font-size:14px;}
    .btn{display:inline-block;padding:12px 28px;background:#4361EE;color:#fff!important;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;}
    .ft{margin-top:24px;padding-top:16px;border-top:1px solid #EEE;font-size:12px;color:#888;text-align:center;}
  </style></head><body><div class="wrap">
    <div class="hd"><h1 style="margin:0;font-size:22px;">🛍️ New Seller Registered</h1></div>
    <div class="bd">
      <p>A new seller has registered on ${BRAND_NAME} and is awaiting verification.</p>
      <div class="info">
        <p><strong>Shop Name:</strong> ${seller.shopName || 'N/A'}</p>
        <p><strong>Seller Name:</strong> ${seller.name || 'N/A'}</p>
        <p><strong>Email:</strong> ${seller.email || 'N/A'}</p>
        <p><strong>Phone:</strong> ${seller.phone || 'N/A'}</p>
        <p><strong>Registered:</strong> ${new Date().toDateString()}</p>
      </div>
      <p style="text-align:center;"><a href="${reviewUrl}" class="btn">Review Seller Application</a></p>
    </div>
    <div class="ft">© ${new Date().getFullYear()} ${BRAND_NAME}</div>
  </div></body></html>`;

  return await sendEmail({
    to: adminEmail,
    subject: `🛍️ New Seller Registration — ${seller.shopName || seller.name || seller.email} — ${BRAND_NAME}`,
    text: `New seller registered: ${seller.shopName || seller.name} (${seller.email}). Review their application: ${reviewUrl}`,
    html,
  });
};

// ============================================================================
// ADMIN — NEW PRODUCT PENDING REVIEW
// ============================================================================
const sendAdminNewProductAlert = async (product, seller) => {
  const BRAND_NAME = process.env.APP_NAME || process.env.BRAND_NAME || 'Saiisai';
  const adminEmail = process.env.ADMIN_EMAIL || process.env.SUPPORT_EMAIL || 'admin@saiisai.com';
  const ADMIN_URL = process.env.ADMIN_DASHBOARD_URL || process.env.FRONTEND_URL || 'https://saiisai.com';
  const reviewUrl = `${ADMIN_URL}/admin/products`;

  const html = `<!DOCTYPE html><html><head><style>
    body{font-family:'Inter',sans-serif;line-height:1.6;color:#333;margin:0;}
    .wrap{max-width:600px;margin:0 auto;padding:24px;}
    .hd{background:linear-gradient(135deg,#8B5CF6,#6D28D9);color:#fff;padding:28px;text-align:center;border-radius:10px 10px 0 0;}
    .bd{background:#fff;padding:28px;border-radius:0 0 10px 10px;}
    .info{background:#F5F3FF;border-left:4px solid #8B5CF6;padding:14px 18px;border-radius:6px;margin:18px 0;}
    .info p{margin:4px 0;font-size:14px;}
    .btn{display:inline-block;padding:12px 28px;background:#4361EE;color:#fff!important;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;}
    .ft{margin-top:24px;padding-top:16px;border-top:1px solid #EEE;font-size:12px;color:#888;text-align:center;}
  </style></head><body><div class="wrap">
    <div class="hd"><h1 style="margin:0;font-size:22px;">📦 New Product Pending Review</h1></div>
    <div class="bd">
      <p>A seller has submitted a new product for review on ${BRAND_NAME}.</p>
      <div class="info">
        <p><strong>Product:</strong> ${product.name || 'N/A'}</p>
        <p><strong>Seller:</strong> ${seller?.shopName || seller?.name || 'N/A'}</p>
        <p><strong>Seller Email:</strong> ${seller?.email || 'N/A'}</p>
        <p><strong>Category:</strong> ${product.category || 'N/A'}</p>
        <p><strong>Submitted:</strong> ${new Date().toDateString()}</p>
      </div>
      <p style="text-align:center;"><a href="${reviewUrl}" class="btn">Review Products</a></p>
    </div>
    <div class="ft">© ${new Date().getFullYear()} ${BRAND_NAME}</div>
  </div></body></html>`;

  return await sendEmail({
    to: adminEmail,
    subject: `📦 New Product Pending — "${product.name}" by ${seller?.shopName || seller?.name || 'Seller'} — ${BRAND_NAME}`,
    text: `New product pending review: "${product.name}" submitted by ${seller?.shopName || seller?.email}. Review: ${reviewUrl}`,
    html,
  });
};

// ============================================================================
// ADMIN — ORDER PAID ALERT
// ============================================================================
const sendAdminOrderPaidAlert = async (order) => {
  const BRAND_NAME = process.env.APP_NAME || process.env.BRAND_NAME || 'Saiisai';
  const adminEmail = process.env.ADMIN_EMAIL || process.env.SUPPORT_EMAIL || 'admin@saiisai.com';
  const ADMIN_URL = process.env.ADMIN_DASHBOARD_URL || process.env.FRONTEND_URL || 'https://saiisai.com';
  const orderUrl = `${ADMIN_URL}/admin/orders`;
  const amount = Number(order?.totalPrice || order?.totalAmount || 0);

  const html = `<!DOCTYPE html><html><head><style>
    body{font-family:'Inter',sans-serif;line-height:1.6;color:#333;margin:0;}
    .wrap{max-width:600px;margin:0 auto;padding:24px;}
    .hd{background:linear-gradient(135deg,#16A34A,#15803D);color:#fff;padding:28px;text-align:center;border-radius:10px 10px 0 0;}
    .bd{background:#fff;padding:28px;border-radius:0 0 10px 10px;}
    .info{background:#ECFDF3;border-left:4px solid #16A34A;padding:14px 18px;border-radius:6px;margin:18px 0;}
    .info p{margin:4px 0;font-size:14px;}
    .btn{display:inline-block;padding:12px 28px;background:#4361EE;color:#fff!important;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;}
    .ft{margin-top:24px;padding-top:16px;border-top:1px solid #EEE;font-size:12px;color:#888;text-align:center;}
  </style></head><body><div class="wrap">
    <div class="hd"><h1 style="margin:0;font-size:22px;">✅ Order Paid — Action Required</h1></div>
    <div class="bd">
      <p>A Paystack payment has been confirmed. Sellers can now prepare shipment.</p>
      <div class="info">
        <p><strong>Order #:</strong> ${order?.orderNumber || order?._id || 'N/A'}</p>
        <p><strong>Amount:</strong> GH₵${amount.toFixed(2)}</p>
        <p><strong>Payment Method:</strong> ${order?.paymentMethod || 'paystack'}</p>
        <p><strong>Paid At:</strong> ${order?.paidAt ? new Date(order.paidAt).toDateString() : new Date().toDateString()}</p>
      </div>
      <p style="text-align:center;"><a href="${orderUrl}" class="btn">Open Admin Orders</a></p>
    </div>
    <div class="ft">© ${new Date().getFullYear()} ${BRAND_NAME}</div>
  </div></body></html>`;

  return await sendEmail({
    to: adminEmail,
    subject: `✅ Paid Order Alert — #${order?.orderNumber || order?._id || 'N/A'} — GH₵${amount.toFixed(2)}`,
    text: `Paid order confirmed: #${order?.orderNumber || order?._id || 'N/A'} (${order?.paymentMethod || 'paystack'}) for GH₵${amount.toFixed(2)}. Review: ${orderUrl}`,
    html,
  });
};

// ============================================================================
// BUYER — PASSWORD CHANGED CONFIRMATION
// ============================================================================
const sendPasswordChangedEmail = async (user) => {
  const BRAND_NAME = process.env.APP_NAME || process.env.BRAND_NAME || 'Saiisai';
  const supportEmail = process.env.SUPPORT_EMAIL || 'support@saiisai.com';

  const html = `<!DOCTYPE html><html><head><style>
    body{font-family:'Inter',sans-serif;line-height:1.6;color:#333;margin:0;}
    .wrap{max-width:600px;margin:0 auto;padding:24px;}
    .hd{background:linear-gradient(135deg,#4361EE,#3A0CA3);color:#fff;padding:28px;text-align:center;border-radius:10px 10px 0 0;}
    .bd{background:#fff;padding:28px;border-radius:0 0 10px 10px;}
    .info{background:#EFF6FF;border-left:4px solid #3B82F6;padding:14px 18px;border-radius:6px;margin:18px 0;}
    .ft{margin-top:24px;padding-top:16px;border-top:1px solid #EEE;font-size:12px;color:#888;text-align:center;}
  </style></head><body><div class="wrap">
    <div class="hd"><h1 style="margin:0;font-size:22px;">🔒 Password Changed</h1></div>
    <div class="bd">
      <p>Hi ${user.name || 'Customer'},</p>
      <p>Your ${BRAND_NAME} password was successfully changed on <strong>${new Date().toDateString()}</strong>.</p>
      <div class="info">
        <p style="margin:0;">If you made this change, no further action is needed.</p>
        <p style="margin:8px 0 0;">If you did <strong>not</strong> make this change, please contact us immediately at <a href="mailto:${supportEmail}">${supportEmail}</a>.</p>
      </div>
    </div>
    <div class="ft">© ${new Date().getFullYear()} ${BRAND_NAME}</div>
  </div></body></html>`;

  return await sendEmail({
    to: user.email,
    subject: `🔒 Your ${BRAND_NAME} Password Was Changed`,
    text: `Hi ${user.name || 'Customer'}, your ${BRAND_NAME} password was successfully changed on ${new Date().toDateString()}. If you did not make this change, contact ${supportEmail} immediately.`,
    html,
  });
};

module.exports = {
  // Auth
  sendSignupEmail,
  sendLoginDeviceAlert,
  sendPasswordReset,
  sendPasswordChangedEmail,
  // Orders — buyer
  sendOrderConfirmation,
  sendOrderShipped,
  sendOrderDelivered,
  sendOrderCancelledBuyer,
  // Orders — seller
  sendSellerNewOrder,
  sendSellerOrderStatusUpdate,
  sendSellerCreditAlert,
  sendOrderCancelledSeller,
  // Payments
  sendPaymentSuccess,
  sendPaymentFailed,
  // Wallet
  sendWalletCredit,
  sendWalletDebit,
  sendWalletTopup,
  // Refunds
  sendRefundProcessed,
  // Coupons
  sendCouponToBuyer,
  // Withdrawals (seller payouts)
  sendWithdrawalRequest,
  sendWithdrawalApproved,
  sendWithdrawalRejected,
  // Products
  sendProductApprovedEmail,
  sendProductRejectedEmail,
  // Seller account
  sendSellerVerifiedEmail,
  sendSellerSuspendedEmail,
  sendLowStockAlert,
  // Admin alerts
  sendAdminRefundAlert,
  sendAdminNewSellerAlert,
  sendAdminNewProductAlert,
  sendAdminOrderPaidAlert,
};
