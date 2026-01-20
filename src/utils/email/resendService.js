const logger = require('../logger');
const { getResend } = require('./resendClient');

// Brand Configuration (same as emailService.js to avoid circular dependency)
// Priority: APP_NAME > BRAND_NAME > default 'Saiisai'
const getBrandConfig = () => ({
  name: process.env.APP_NAME || process.env.BRAND_NAME || 'Saiisai',
  tagline: process.env.BRAND_TAGLINE || 'Online Marketplace',
  url: process.env.FRONTEND_URL || 'https://saiisai.com',
  supportEmail: process.env.SUPPORT_EMAIL || process.env.EMAIL_FROM || 'support@saiisai.com',
  fromName: process.env.EMAIL_FROM_NAME || 'Saiisai',
});

/**
 * Core Email Service - Resend
 *
 * This service uses Resend for all email operations.
 */

const sendEmail = async (data) => {
  const resend = getResend();

  if (!resend) {
    throw new Error('Resend is not configured. Please set RESEND_API_KEY in environment variables.');
  }

  const fromEmail = data.from || process.env.EMAIL_FROM;

  if (!fromEmail) {
    throw new Error('Sender email not configured. Set EMAIL_FROM in environment variables.');
  }

  const brandConfig = getBrandConfig();

  const fromName = data.fromName || brandConfig.fromName;
  const from = fromName ? `${fromName} <${fromEmail}>` : fromEmail;

  const to = data.to || data.email;

  if (!to) {
    throw new Error('Recipient email is required (to/email field).');
  }

  const emailPayload = {
    // Use a friendly Reply-To for user responses
    reply_to: getBrandConfig().supportEmail,
    from,
    to,
    subject: data.subject || '',
    html: data.html,
    text: data.text || data.message || '',
  };

  if (data.cc) {
    emailPayload.cc = data.cc;
  }

  if (data.bcc) {
    emailPayload.bcc = data.bcc;
  }

  try {
    logger.info('[Resend] 📤 Attempting to send email', {
      to,
      from: fromEmail,
      subject: emailPayload.subject,
    });

    const { data: response, error } = await resend.emails.send(emailPayload);

    if (error) {
      logger.error('[Resend] ❌ Error sending email', {
        from: fromEmail,
        to,
        message: error.message,
        name: error.name,
      });
      throw error;
    }

    logger.info('[Resend] ✅ Email sent successfully', {
      to,
      from: fromEmail,
      id: response?.id,
    });

    return { data: response || {}, error: null };
  } catch (error) {
    const errorMessage = error.message || error.toString();
    logger.error('[Resend] ❌ Error sending email:', errorMessage);
    logger.error('[Resend] Error details', {
      name: error.name,
      message: error.message,
      stack: error.stack?.split('\n').slice(0, 5).join('\n'),
    });
    throw error;
  }
};

/**
 * Send welcome email to new user
 */
const sendWelcomeEmail = async (email, name = 'User') => {
  const brandConfig = getBrandConfig();
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Inter', sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #ffffff; padding: 30px; border-radius: 0 0 10px 10px; }
        .button { display: inline-block; padding: 12px 30px; background: #667eea; color: white !important; text-decoration: none; border-radius: 5px; margin: 20px 0; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eaeaea; color: #6c757d; font-size: 0.9em; text-align: center; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Welcome to ${brandConfig.name}! 🎉</h1>
        </div>
        <div class="content">
          <p>Hello ${name},</p>
          <p>Thank you for joining ${brandConfig.name}! We're excited to have you on board.</p>
          <p>Start exploring our amazing products and enjoy a seamless shopping experience.</p>
          <p style="text-align: center;">
            <a href="${brandConfig.url}" class="button">Start Shopping</a>
          </p>
          <p>If you have any questions, feel free to reach out to our support team.</p>
        </div>
        <div class="footer">
          <p>Best regards,<br>The ${brandConfig.name} Team</p>
          <p>© ${new Date().getFullYear()} ${brandConfig.name}. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: email,
    subject: `Welcome to ${brandConfig.name}!`,
    text: `Welcome to ${brandConfig.name}, ${name}! Thank you for joining us. Start shopping at ${brandConfig.url}`,
    html: htmlContent,
  });
};

/**
 * Send custom email
 */
const sendCustomEmail = async (data) => {
  return sendEmail({
    to: data.email || data.to,
    subject: data.subject,
    text: data.message || data.text,
    html: data.html,
    from: data.from,
    fromName: data.fromName,
    cc: data.cc,
    bcc: data.bcc,
  });
};

/**
 * Send account deletion confirmation email
 */
const sendAccountDeletionConfirmation = async (toEmail, name = 'User') => {
  const brandConfig = getBrandConfig();
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Inter', sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #dc3545; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #ffffff; padding: 30px; border-radius: 0 0 10px 10px; }
        .warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eaeaea; color: #6c757d; font-size: 0.9em; text-align: center; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Account Deletion Completed</h1>
        </div>
        <div class="content">
          <p>Hello ${name},</p>
          <p>We've completed your account deletion request as scheduled.</p>
          <div class="warning">
            <p><strong>Important:</strong> All personal data has been permanently removed from our systems in accordance with our privacy policy.</p>
          </div>
          <p>If you didn't request this deletion, please contact our support team immediately.</p>
        </div>
        <div class="footer">
          <p>Best regards,<br>The ${brandConfig.name} Privacy Team</p>
          <p>© ${new Date().getFullYear()} ${brandConfig.name}. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: toEmail,
    subject: 'Account Deletion Completed',
    text: `Your account has been deleted. All personal data has been permanently removed. If you didn't request this, please contact support immediately.`,
    html: htmlContent,
  });
};

/**
 * Send data export ready email
 */
const sendDataReadyEmail = async (toEmail, downloadUrl, expiresAt, name = 'User') => {
  const brandConfig = getBrandConfig();
  const formattedExpires = new Date(expiresAt).toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Inter', sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #ffffff; padding: 30px; border-radius: 0 0 10px 10px; }
        .button { display: inline-block; padding: 12px 30px; background: #667eea; color: white !important; text-decoration: none; border-radius: 5px; margin: 20px 0; }
        .warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eaeaea; color: #6c757d; font-size: 0.9em; text-align: center; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Your Data Export is Ready</h1>
        </div>
        <div class="content">
          <p>Hello ${name},</p>
          <p>We've prepared your personal data export as requested.</p>
          <p style="text-align: center;">
            <a href="${downloadUrl}" class="button">Download Your Data</a>
          </p>
          <div class="warning">
            <p><strong>Important:</strong> This download link will expire on <strong>${formattedExpires}</strong>. Please download your data before this time.</p>
          </div>
          <p>If you didn't request this export, please contact our support team immediately.</p>
        </div>
        <div class="footer">
          <p>Best regards,<br>The ${brandConfig.name} Privacy Team</p>
          <p>© ${new Date().getFullYear()} ${brandConfig.name}. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: toEmail,
    subject: 'Your Data Export is Ready',
    text: `Your data export is ready for download: ${downloadUrl}\nThis link expires on ${formattedExpires}`,
    html: htmlContent,
  });
};

/**
 * Send password reset email
 */
const sendPasswordResetEmail = async (toEmail, resetToken, name = 'User') => {
  const brandConfig = getBrandConfig();
  // Use mobile-aware URL generator (supports universal links)
  const { generatePasswordResetUrl } = require('../mobileDeepLink');
  const resetUrl = generatePasswordResetUrl(resetToken, brandConfig.url);

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Inter', sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #ffffff; padding: 30px; border-radius: 0 0 10px 10px; }
        .button { display: inline-block; padding: 12px 30px; background: #667eea; color: white !important; text-decoration: none; border-radius: 5px; margin: 20px 0; }
        .warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eaeaea; color: #6c757d; font-size: 0.9em; text-align: center; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Password Reset Request</h1>
        </div>
        <div class="content">
          <p>Hello ${name},</p>
          <p>We received a request to reset your password. Click the button below to create a new password:</p>
          <p style="text-align: center;">
            <a href="${resetUrl}" class="button">Reset Password</a>
          </p>
          <div class="warning">
            <p><strong>Security Notice:</strong> This link will expire in 10 minutes. If you didn't request this, please ignore this email or contact support.</p>
          </div>
        </div>
        <div class="footer">
          <p>Best regards,<br>The ${brandConfig.name} Team</p>
          <p>© ${new Date().getFullYear()} ${brandConfig.name}. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: toEmail,
    subject: `Password Reset Request - ${brandConfig.name}`,
    text: `You requested a password reset. Click this link to reset your password: ${resetUrl}\nThis link expires in 10 minutes.`,
    html: htmlContent,
  });
};

/**
 * Send login notification email
 */
const sendLoginEmail = async (toEmail, name = 'User', loginInfo = {}) => {
  const brandConfig = getBrandConfig();
  const loginTime = new Date().toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Inter', sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #ffffff; padding: 30px; border-radius: 0 0 10px 10px; }
        .info-box { background: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #667eea; }
        .warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }
        .button { display: inline-block; padding: 12px 30px; background: #667eea; color: white !important; text-decoration: none; border-radius: 5px; margin: 20px 0; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eaeaea; color: #6c757d; font-size: 0.9em; text-align: center; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Login Notification 🔐</h1>
        </div>
        <div class="content">
          <p>Hello ${name},</p>
          <p>We noticed a recent login to your ${brandConfig.name} account.</p>
          <div class="info-box">
            <p><strong>Login Time:</strong> ${loginTime}</p>
            ${loginInfo.ip ? `<p><strong>IP Address:</strong> ${loginInfo.ip}</p>` : ''}
            ${loginInfo.device ? `<p><strong>Device:</strong> ${loginInfo.device}</p>` : ''}
            ${loginInfo.location ? `<p><strong>Location:</strong> ${loginInfo.location}</p>` : ''}
          </div>
          <div class="warning">
            <p><strong>Security Notice:</strong> If this wasn't you, please secure your account immediately by changing your password.</p>
          </div>
          <p style="text-align: center;">
            <a href="${brandConfig.url}/account/security" class="button">Manage Account Security</a>
          </p>
        </div>
        <div class="footer">
          <p>Best regards,<br>The ${brandConfig.name} Security Team</p>
          <p>© ${new Date().getFullYear()} ${brandConfig.name}. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: toEmail,
    subject: `Login Notification - ${brandConfig.name}`,
    text: `Hello ${name}, we noticed a recent login to your ${brandConfig.name} account at ${loginTime}. If this wasn't you, please secure your account immediately.`,
    html: htmlContent,
  });
};

/**
 * Send login OTP email
 */
const sendLoginOtpEmail = async (toEmail, otp, name = 'User') => {
  const brandConfig = getBrandConfig();
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Inter', sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #ffffff; padding: 30px; border-radius: 0 0 10px 10px; }
        .otp-box { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px; margin: 30px 0; }
        .otp-code { font-size: 3.6rem; font-weight: 800; letter-spacing: 10px; margin: 20px 0; }
        .warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eaeaea; color: #6c757d; font-size: 0.9em; text-align: center; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Your Login Code</h1>
        </div>
        <div class="content">
          <p>Hello ${name},</p>
          <p>You requested a login code for your ${brandConfig.name} account. Use the code below to complete your login:</p>
          <div class="otp-box">
            <p style="margin: 0; font-size: 1.4rem; opacity: 0.9;">Your Login Code</p>
            <div class="otp-code">${otp}</div>
            <p style="margin: 0; font-size: 1.2rem; opacity: 0.9;">Valid for 10 minutes</p>
          </div>
          <div class="warning">
            <p><strong>Security Notice:</strong> Never share this code with anyone. ${brandConfig.name} staff will never ask for your login code.</p>
          </div>
          <p>If you didn't request this code, please ignore this email or contact our support team if you're concerned about your account's security.</p>
        </div>
        <div class="footer">
          <p>Best regards,<br>The ${brandConfig.name} Team</p>
          <p>© ${new Date().getFullYear()} ${brandConfig.name}. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: toEmail,
    subject: `Your Login Code - ${brandConfig.name}`,
    text: `Hello ${name}, your login code is: ${otp}. This code is valid for 10 minutes. If you didn't request this, please ignore this email.`,
    html: htmlContent,
  });
};

/**
 * Send order confirmation email
 */
const sendOrderConfirmationEmail = async (toEmail, order, name = 'Customer') => {
  const brandConfig = getBrandConfig();
  const orderUrl = `${brandConfig.url}/orders/${order._id || order.id}`;

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Inter', sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #ffffff; padding: 30px; border-radius: 0 0 10px 10px; }
        .order-info { background: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0; }
        .button { display: inline-block; padding: 12px 30px; background: #667eea; color: white !important; text-decoration: none; border-radius: 5px; margin: 20px 0; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eaeaea; color: #6c757d; font-size: 0.9em; text-align: center; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Order Confirmation</h1>
        </div>
        <div class="content">
          <p>Hello ${name},</p>
          <p>Thank you for your order! We've received it and are processing it now.</p>
          <div class="order-info">
            <p><strong>Order Number:</strong> ${order.orderNumber || order._id || 'N/A'}</p>
            <p><strong>Total Amount:</strong> GH₵${(order.totalAmount || order.total || 0).toFixed(2)}</p>
            <p><strong>Order Date:</strong> ${new Date(order.createdAt || Date.now()).toLocaleDateString()}</p>
          </div>
          <p style="text-align: center;">
            <a href="${orderUrl}" class="button">View Order Details</a>
          </p>
          <p>You'll receive another email when your order ships.</p>
        </div>
        <div class="footer">
          <p>Best regards,<br>The ${brandConfig.name} Team</p>
          <p>© ${new Date().getFullYear()} ${brandConfig.name}. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: toEmail,
    subject: `Order Confirmation - Order #${order.orderNumber || order._id || 'N/A'}`,
    text: `Thank you for your order! Order Number: ${order.orderNumber || order._id || 'N/A'}, Total: GH₵${(order.totalAmount || order.total || 0).toFixed(2)}. View your order: ${orderUrl}`,
    html: htmlContent,
  });
};

/**
 * Send detailed order information email
 */
const sendOrderDetailEmail = async (toEmail, order, name = 'Customer') => {
  const brandConfig = getBrandConfig();
  const orderUrl = `${brandConfig.url}/orders/${order._id || order.id}`;
  const orderItems = order.orderItems || [];

  const itemsHtml = orderItems
    .map((item) => {
      const product = item.product || {};
      const quantity = item.quantity || 1;
      const price = product.price || 0;
      const total = price * quantity;
      return `
      <tr>
        <td style="padding: 10px; border-bottom: 1px solid #eaeaea;">${product.name || 'N/A'}</td>
        <td style="padding: 10px; border-bottom: 1px solid #eaeaea; text-align: center;">${quantity}</td>
        <td style="padding: 10px; border-bottom: 1px solid #eaeaea; text-align: right;">GH₵${price.toFixed(2)}</td>
        <td style="padding: 10px; border-bottom: 1px solid #eaeaea; text-align: right;">GH₵${total.toFixed(2)}</td>
      </tr>
    `;
    })
    .join('');

  const subtotal = order.subtotal || order.totalPrice || 0;
  const shippingFee = order.shippingFee || order.shippingCost || 0;
  const tax = order.tax || 0;
  const total = order.totalPrice || order.total || subtotal + shippingFee;

  const shippingAddress = order.shippingAddress || {};
  const addressHtml = shippingAddress.streetAddress
    ? `
      <p><strong>Street:</strong> ${shippingAddress.streetAddress}</p>
      ${shippingAddress.town ? `<p><strong>Town:</strong> ${shippingAddress.town}</p>` : ''}
      ${shippingAddress.city ? `<p><strong>City:</strong> ${shippingAddress.city}</p>` : ''}
      ${shippingAddress.region ? `<p><strong>Region:</strong> ${shippingAddress.region}</p>` : ''}
      ${shippingAddress.digitalAddress ? `<p><strong>Digital Address:</strong> ${shippingAddress.digitalAddress}</p>` : ''}
      ${shippingAddress.landmark ? `<p><strong>Landmark:</strong> ${shippingAddress.landmark}</p>` : ''}
    `
    : '<p>No shipping address provided</p>';

  const paymentMethodMap = {
    mobile_money: 'Mobile Money',
    credit_card: 'Credit Card',
    paypal: 'PayPal',
    cash_on_delivery: 'Cash on Delivery',
  };
  const paymentMethod = paymentMethodMap[order.paymentMethod] || order.paymentMethod || 'N/A';

  const statusMap = {
    pending: 'Pending',
    paid: 'Paid',
    processing: 'Processing',
    shipped: 'Shipped',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
  };
  const orderStatus =
    statusMap[order.status] || statusMap[order.orderStatus] || order.status || 'Pending';

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Inter', sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #4361ee 0%, #3a0ca3 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #ffffff; padding: 30px; border-radius: 0 0 10px 10px; }
        .section { margin: 20px 0; }
        .section-title { font-size: 18px; font-weight: bold; color: #333; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 2px solid #4361ee; }
        .order-info { background: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0; }
        .info-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eaeaea; }
        .info-row:last-child { border-bottom: none; }
        .info-label { font-weight: 600; color: #666; }
        .info-value { color: #333; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th { background: #f8f9fa; padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #4361ee; }
        td { padding: 10px; border-bottom: 1px solid #eaeaea; }
        .total-row { font-weight: bold; font-size: 16px; background: #f8f9fa; }
        .button { display: inline-block; padding: 12px 30px; background: #4361ee; color: white !important; text-decoration: none; border-radius: 5px; margin: 20px 0; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eaeaea; color: #6c757d; font-size: 0.9em; text-align: center; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Order Details</h1>
        </div>
        <div class="content">
          <p>Hello ${name},</p>
          <p>Here are the details of your order:</p>
          <div class="section">
            <div class="section-title">Order Information</div>
            <div class="order-info">
              <div class="info-row">
                <span class="info-label">Order Number:</span>
                <span class="info-value">${order.orderNumber || order._id || 'N/A'}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Order Date:</span>
                <span class="info-value">${new Date(
                  order.createdAt || Date.now(),
                ).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Order Status:</span>
                <span class="info-value">${orderStatus}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Payment Method:</span>
                <span class="info-value">${paymentMethod}</span>
              </div>
              ${
                order.paymentStatus
                  ? `
              <div class="info-row">
                <span class="info-label">Payment Status:</span>
                <span class="info-value">${
                  order.paymentStatus === 'completed' ? 'Paid' : 'Pending'
                }</span>
              </div>
              `
                  : ''
              }
            </div>
          </div>
          <div class="section">
            <div class="section-title">Order Items</div>
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th style="text-align: center;">Quantity</th>
                  <th style="text-align: right;">Price</th>
                  <th style="text-align: right;">Total</th>
                </tr>
              </thead>
              <tbody>
                ${itemsHtml}
              </tbody>
            </table>
          </div>
          <div class="section">
            <div class="section-title">Order Summary</div>
            <div class="order-info">
              <div class="info-row">
                <span class="info-label">Subtotal:</span>
                <span class="info-value">GH₵${subtotal.toFixed(2)}</span>
              </div>
              ${
                shippingFee > 0
                  ? `
              <div class="info-row">
                <span class="info-label">Shipping Fee:</span>
                <span class="info-value">GH₵${shippingFee.toFixed(2)}</span>
              </div>
              `
                  : ''
              }
              ${
                tax > 0
                  ? `
              <div class="info-row">
                <span class="info-label">Tax:</span>
                <span class="info-value">GH₵${tax.toFixed(2)}</span>
              </div>
              `
                  : ''
              }
              <div class="info-row total-row">
                <span class="info-label">Total:</span>
                <span class="info-value">GH₵${total.toFixed(2)}</span>
              </div>
            </div>
          </div>
          <div class="section">
            <div class="section-title">Shipping Address</div>
            <div class="order-info">
              ${addressHtml}
            </div>
          </div>
          <p style="text-align: center;">
            <a href="${orderUrl}" class="button">View Order Online</a>
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

  const textContent = `
Order Details - ${order.orderNumber || order._id || 'N/A'}

Hello ${name},

Here are the details of your order:

Order Information:
- Order Number: ${order.orderNumber || order._id || 'N/A'}
- Order Date: ${new Date(order.createdAt || Date.now()).toLocaleDateString()}
- Order Status: ${orderStatus}
- Payment Method: ${paymentMethod}
${
  order.paymentStatus
    ? `- Payment Status: ${order.paymentStatus === 'completed' ? 'Paid' : 'Pending'}`
    : ''
}

Order Items:
${orderItems
  .map((item) => {
    const product = item.product || {};
    const quantity = item.quantity || 1;
    const price = product.price || 0;
    return `- ${product.name || 'N/A'} x${quantity} @ GH₵${price.toFixed(2)} = GH₵${(
      price * quantity
    ).toFixed(2)}`;
  })
  .join('\n')}

Order Summary:
- Subtotal: GH₵${subtotal.toFixed(2)}
${shippingFee > 0 ? `- Shipping Fee: GH₵${shippingFee.toFixed(2)}` : ''}
${tax > 0 ? `- Tax: GH₵${tax.toFixed(2)}` : ''}
- Total: GH₵${total.toFixed(2)}

Shipping Address:
${shippingAddress.streetAddress ? `Street: ${shippingAddress.streetAddress}` : ''}
${shippingAddress.town ? `Town: ${shippingAddress.town}` : ''}
${shippingAddress.city ? `City: ${shippingAddress.city}` : ''}
${shippingAddress.region ? `Region: ${shippingAddress.region}` : ''}
${shippingAddress.digitalAddress ? `Digital Address: ${shippingAddress.digitalAddress}` : ''}
${shippingAddress.landmark ? `Landmark: ${shippingAddress.landmark}` : ''}

View your order online: ${orderUrl}

Best regards,
The ${brandConfig.name} Team
  `;

  return sendEmail({
    to: toEmail,
    subject: `Order Details - Order #${order.orderNumber || order._id || 'N/A'}`,
    text: textContent,
    html: htmlContent,
  });
};

module.exports = {
  sendEmail,
  sendWelcomeEmail,
  sendCustomEmail,
  sendAccountDeletionConfirmation,
  sendDataReadyEmail,
  sendPasswordResetEmail,
  sendOrderConfirmationEmail,
  sendOrderDetailEmail,
  sendLoginEmail,
  sendLoginOtpEmail,
  getBrandConfig,
};
