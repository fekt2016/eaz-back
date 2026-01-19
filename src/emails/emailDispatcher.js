const {
  sendEmail,
  sendCustomEmail,
  sendPasswordResetEmail,
  sendOrderConfirmationEmail,
  sendLoginEmail,
  sendLoginOtpEmail,
} = require('../utils/email/emailService');


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


const sendOrderConfirmation = async (order, user) => {
  return await sendOrderConfirmationEmail(
    user.email,
    order,
    user.name || 'Customer'
  );
};

const sendOrderShipped = async (order, user) => {
  const brandConfig = {
    name: process.env.APP_NAME || process.env.BRAND_NAME || 'EazShop',
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
    name: process.env.APP_NAME || process.env.BRAND_NAME || 'EazShop',
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
    name: process.env.APP_NAME || process.env.BRAND_NAME || 'EazShop',
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
 * Send withdrawal request confirmation email to seller
 * @param {Object} seller - Seller object with email and name
 * @param {Object} withdrawal - Withdrawal request object
 */
const sendWithdrawalRequest = async (seller, withdrawal) => {
  const brandConfig = {
    name: process.env.APP_NAME || process.env.BRAND_NAME || 'EazShop',
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
    name: process.env.APP_NAME || process.env.BRAND_NAME || 'EazShop',
    url: process.env.FRONTEND_URL || 'https://saiisai.com',
  };

  const amount = withdrawal.amount || 0;
  const requestId = withdrawal._id || withdrawal.id;
  const transactionId = withdrawal.transactionId || withdrawal.paystackReference || 'N/A';

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
    name: process.env.APP_NAME || process.env.BRAND_NAME || 'EazShop',
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
 * Send refund processed email to buyer
 * @param {Object} user - User object with email and name
 * @param {Object} refund - Refund request object
 * @param {Object} order - Order object
 */
const sendRefundProcessed = async (user, refund, order) => {
  const brandConfig = {
    name: process.env.APP_NAME || process.env.BRAND_NAME || 'EazShop',
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
    name: process.env.APP_NAME || process.env.BRAND_NAME || 'EazShop',
    url: process.env.FRONTEND_URL || 'https://saiisai.com',
  };

  const couponCode = coupon.code || 'N/A';
  const discountValue = batch.discountValue || 0;
  const discountType = batch.discountType || 'fixed';
  const discountText = discountType === 'percentage' 
    ? `${discountValue}% off` 
    : `GH₵${discountValue} off`;
  const validUntil = batch.expiresAt ? new Date(batch.expiresAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'N/A';
  const sellerName = seller ? (seller.name || seller.shopName || 'A seller') : 'EazShop';

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
    name: process.env.APP_NAME || process.env.BRAND_NAME || 'EazShop',
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
    name: process.env.APP_NAME || process.env.BRAND_NAME || 'EazShop',
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
    name: process.env.APP_NAME || process.env.BRAND_NAME || 'EazShop',
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

module.exports = {
  sendSignupEmail,
  sendLoginDeviceAlert,
  sendPasswordReset,
  sendOrderConfirmation,
  sendOrderShipped,
  sendOrderDelivered,
  sendSellerNewOrder,
  sendWithdrawalRequest,
  sendWithdrawalApproved,
  sendWithdrawalRejected,
  sendRefundProcessed,
  sendCouponToBuyer,
  sendWalletCredit,
  sendWalletDebit,
  sendPaymentSuccess,
};

