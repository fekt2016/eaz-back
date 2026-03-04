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
  logoUrl: process.env.BRAND_LOGO_URL || null,
  primaryColor: process.env.BRAND_PRIMARY_COLOR || '#4361ee',
  successColor: '#22C55E',
  warningColor: '#F59E0B',
});

/**
 * Returns the logo HTML block for email headers.
 * Falls back to styled text if no logo URL is configured.
 */
const getLogoHtml = (brandConfig) => {
  if (brandConfig.logoUrl) {
    return `<img src="${brandConfig.logoUrl}" alt="${brandConfig.name}" height="44" style="display:block;margin:0 auto;">`;
  }
  return `<span style="color:#fff;font-size:26px;font-weight:900;letter-spacing:2px;">${brandConfig.name}</span>`;
};

/**
 * Shared email wrapper — consistent header (logo) + footer across all emails.
 */
const getEmailWrapper = (brandConfig, headerBg, content, previewText = '') => `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${brandConfig.name}</title>
  </head>
  <body style="margin:0;padding:0;background:#F5F5F5;font-family:Arial,Helvetica,sans-serif;">
    ${previewText ? `<div style="display:none;max-height:0;overflow:hidden;color:transparent;">${previewText}&zwnj;&nbsp;</div>` : ''}
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F5F5;padding:32px 16px;">
      <tr><td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
          <!-- HEADER -->
          <tr>
            <td align="center" style="background:${headerBg};padding:24px 32px;border-radius:8px 8px 0 0;">
              ${getLogoHtml(brandConfig)}
            </td>
          </tr>
          <!-- BODY -->
          <tr>
            <td style="background:#ffffff;padding:32px;border-radius:0 0 8px 8px;">
              ${content}
            </td>
          </tr>
          <!-- FOOTER -->
          <tr>
            <td align="center" style="padding:24px 0;color:#888;font-size:12px;">
              <p style="margin:0 0 6px;">© ${new Date().getFullYear()} ${brandConfig.name}. All rights reserved.</p>
              <p style="margin:0 0 4px;">Questions? <a href="mailto:${brandConfig.supportEmail}" style="color:${brandConfig.primaryColor};">${brandConfig.supportEmail}</a></p>
              <p style="margin:0;"><a href="${brandConfig.url}" style="color:${brandConfig.primaryColor};">${brandConfig.url}</a></p>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
  </html>
`;

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
  const htmlContent = getEmailWrapper(
    brandConfig,
    `linear-gradient(135deg, ${brandConfig.primaryColor} 0%, #3a0ca3 100%)`,
    `<h2 style="margin:0 0 6px;font-size:22px;color:#333;">Welcome to ${brandConfig.name}! 🎉</h2>
     <p style="margin:0 0 20px;font-size:15px;color:#555;">Hello ${name},</p>
     <p style="margin:0 0 16px;font-size:14px;color:#555;">Thank you for joining ${brandConfig.name}! We're excited to have you on board.</p>
     <p style="margin:0 0 24px;font-size:14px;color:#555;">Start exploring our amazing products and enjoy a seamless shopping experience.</p>
     <div style="text-align:center;margin:24px 0;">
       <a href="${brandConfig.url}" style="display:inline-block;background:${brandConfig.primaryColor};color:#fff;text-decoration:none;padding:14px 32px;border-radius:6px;font-size:15px;font-weight:bold;">Start Shopping</a>
     </div>
     <p style="font-size:13px;color:#888;">If you have any questions, feel free to reach out to our support team at <a href="mailto:${brandConfig.supportEmail}" style="color:${brandConfig.primaryColor};">${brandConfig.supportEmail}</a>.</p>`,
    `Welcome to ${brandConfig.name}! We're glad to have you.`
  );

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
  const { generatePasswordResetUrl } = require('../mobileDeepLink');
  const resetUrl = generatePasswordResetUrl(resetToken, brandConfig.url);

  const htmlContent = getEmailWrapper(
    brandConfig,
    `linear-gradient(135deg, ${brandConfig.primaryColor} 0%, #3a0ca3 100%)`,
    `<h2 style="margin:0 0 16px;font-size:22px;color:#333;">Password Reset Request 🔑</h2>
     <p style="margin:0 0 12px;font-size:14px;color:#555;">Hello ${name},</p>
     <p style="margin:0 0 20px;font-size:14px;color:#555;">We received a request to reset your password. Click the button below to create a new password:</p>
     <div style="text-align:center;margin:24px 0;">
       <a href="${resetUrl}" style="display:inline-block;background:${brandConfig.primaryColor};color:#fff;text-decoration:none;padding:14px 32px;border-radius:6px;font-size:15px;font-weight:bold;">Reset Password</a>
     </div>
     <div style="background:#FFF8E7;border-left:4px solid #F59E0B;padding:12px 16px;border-radius:0 6px 6px 0;margin:16px 0;">
       <p style="margin:0;font-size:13px;color:#333;"><strong>Security Notice:</strong> This link will expire in 10 minutes. If you didn't request this, please ignore this email or contact support.</p>
     </div>`,
    `Reset your ${brandConfig.name} password — link expires in 10 minutes.`
  );

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
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  });

  const htmlContent = getEmailWrapper(
    brandConfig,
    `linear-gradient(135deg, ${brandConfig.primaryColor} 0%, #3a0ca3 100%)`,
    `<h2 style="margin:0 0 16px;font-size:22px;color:#333;">Login Notification 🔐</h2>
     <p style="margin:0 0 12px;font-size:14px;color:#555;">Hello ${name},</p>
     <p style="margin:0 0 16px;font-size:14px;color:#555;">We noticed a recent login to your ${brandConfig.name} account.</p>
     <div style="background:#F8F9FA;border-left:4px solid ${brandConfig.primaryColor};padding:16px;border-radius:0 6px 6px 0;margin:16px 0;">
       <p style="margin:0 0 6px;font-size:14px;color:#333;"><strong>Login Time:</strong> ${loginTime}</p>
       ${loginInfo.ip ? `<p style="margin:0 0 6px;font-size:14px;color:#333;"><strong>IP Address:</strong> ${loginInfo.ip}</p>` : ''}
       ${loginInfo.device ? `<p style="margin:0 0 6px;font-size:14px;color:#333;"><strong>Device:</strong> ${loginInfo.device}</p>` : ''}
       ${loginInfo.location ? `<p style="margin:0;font-size:14px;color:#333;"><strong>Location:</strong> ${loginInfo.location}</p>` : ''}
     </div>
     <div style="background:#FFF8E7;border-left:4px solid #F59E0B;padding:12px 16px;border-radius:0 6px 6px 0;margin:16px 0;">
       <p style="margin:0;font-size:13px;color:#333;"><strong>Security Notice:</strong> If this wasn't you, please secure your account immediately by changing your password.</p>
     </div>
     <div style="text-align:center;margin:24px 0;">
       <a href="${brandConfig.url}/account/security" style="display:inline-block;background:${brandConfig.primaryColor};color:#fff;text-decoration:none;padding:14px 32px;border-radius:6px;font-size:15px;font-weight:bold;">Manage Account Security</a>
     </div>`,
    `New login to your ${brandConfig.name} account detected.`
  );

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

  const htmlContent = getEmailWrapper(
    brandConfig,
    `linear-gradient(135deg, ${brandConfig.primaryColor} 0%, #3a0ca3 100%)`,
    `<p style="margin:0 0 12px;font-size:14px;color:#555;">Hello ${name},</p>
     <p style="margin:0 0 20px;font-size:14px;color:#555;">You requested a login code for your ${brandConfig.name} account. Use the code below to complete your login:</p>
     <div style="background:linear-gradient(135deg,${brandConfig.primaryColor} 0%,#3a0ca3 100%);padding:32px;text-align:center;border-radius:8px;margin:20px 0;">
       <p style="margin:0 0 8px;font-size:14px;color:rgba(255,255,255,0.85);">Your Login Code</p>
       <div style="font-size:42px;font-weight:900;letter-spacing:10px;color:#fff;margin:12px 0;">${otp}</div>
       <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.8);">Valid for 10 minutes</p>
     </div>
     <div style="background:#FFF8E7;border-left:4px solid #F59E0B;padding:12px 16px;border-radius:0 6px 6px 0;margin:16px 0;">
       <p style="margin:0;font-size:13px;color:#333;"><strong>Security Notice:</strong> Never share this code with anyone. ${brandConfig.name} staff will never ask for your login code.</p>
     </div>
     <p style="font-size:13px;color:#888;">If you didn't request this code, please ignore this email or contact our support team if you're concerned.</p>`,
    `Your ${brandConfig.name} login code: ${otp} — valid for 10 minutes.`
  );

  return sendEmail({
    to: toEmail,
    subject: `Your Login Code - ${brandConfig.name}`,
    text: `Hello ${name}, your login code is: ${otp}. This code is valid for 10 minutes. If you didn't request this, please ignore this email.`,
    html: htmlContent,
  });
};

/**
 * Send order confirmation email — payment-method-aware.
 * @param {string} toEmail
 * @param {Object} order - full order document
 * @param {string} name - customer name
 * @param {string} paymentMethod - 'paystack'|'mobile_money'|'credit_balance'|'payment_on_delivery'
 */
const sendOrderConfirmationEmail = async (toEmail, order, name = 'Customer', paymentMethod = null) => {
  const brandConfig = getBrandConfig();
  const orderUrl = `${brandConfig.url}/orders/${order._id || order.id}`;
  const orderNumber = order.orderNumber || order._id || 'N/A';
  const orderTotal = Number(order.totalAmount || order.totalPrice || order.total || 0);
  const method = paymentMethod || order.paymentMethod || '';

  // ── Payment badge: method-specific ──────────────────────────────
  let paymentBadgeHtml = '';
  let statusTitle = 'Order Confirmed! 🎉';
  let statusMessage = 'Thank you for your order. It is now being processed.';
  let previewText = `Order #${orderNumber} confirmed — GH₵${orderTotal.toFixed(2)}`;

  if (method === 'credit_balance' || method === 'wallet') {
    paymentBadgeHtml = `
      <div style="background:#F0FDF4;border-left:4px solid #22C55E;padding:14px 16px;border-radius:0 6px 6px 0;margin:20px 0;">
        <p style="margin:0;font-size:15px;font-weight:700;color:#166534;">✅ Payment via Saiisai Credit Wallet confirmed</p>
        <p style="margin:6px 0 0;font-size:13px;color:#333;">GH₵ ${orderTotal.toFixed(2)} has been successfully debited from your wallet.</p>
      </div>`;
    statusTitle = 'Order Placed Successfully! 🎉';
    statusMessage = 'Your payment was completed instantly using your Saiisai Credit Wallet. Your order is now being processed.';
    previewText = `Wallet payment confirmed. Order #${orderNumber} is on its way.`;
  } else if (method === 'payment_on_delivery' || method === 'cod' || method === 'cash_on_delivery') {
    paymentBadgeHtml = `
      <div style="background:#FFFBEB;border-left:4px solid #F59E0B;padding:14px 16px;border-radius:0 6px 6px 0;margin:20px 0;">
        <p style="margin:0;font-size:15px;font-weight:700;color:#92400E;">🚚 Cash on Delivery</p>
        <p style="margin:6px 0 0;font-size:13px;color:#333;">You will pay GH₵ ${orderTotal.toFixed(2)} when your order is delivered to your door.</p>
      </div>`;
    statusTitle = 'Order Received! 📦';
    statusMessage = "We've received your order. You'll pay when it arrives at your door.";
    previewText = `Order #${orderNumber} received — pay GH₵${orderTotal.toFixed(2)} on delivery.`;
  } else {
    // paystack / mobile_money / momo / card — payment confirmed
    paymentBadgeHtml = `
      <div style="background:#F0FDF4;border-left:4px solid #22C55E;padding:14px 16px;border-radius:0 6px 6px 0;margin:20px 0;">
        <p style="margin:0;font-size:15px;font-weight:700;color:#166534;">✅ Payment via Mobile Money / Card confirmed</p>
        ${order.paymentReference ? `<p style="margin:6px 0 0;font-size:13px;color:#333;">Reference: ${order.paymentReference}</p>` : ''}
      </div>`;
    previewText = `Payment confirmed. Order #${orderNumber} is being processed.`;
  }

  // ── Order items table ────────────────────────────────────────────
  const orderItems = order.orderItems || order.items || [];
  const itemsHtml = orderItems.length > 0
    ? `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:16px 0;">
        <tr style="background:#F9F9F9;">
          <th align="left" style="padding:10px 12px;font-size:12px;color:#888;font-weight:600;border-bottom:1px solid #EEE;">Item</th>
          <th align="center" style="padding:10px 12px;font-size:12px;color:#888;font-weight:600;border-bottom:1px solid #EEE;">Qty</th>
          <th align="right" style="padding:10px 12px;font-size:12px;color:#888;font-weight:600;border-bottom:1px solid #EEE;">Price</th>
        </tr>
        ${orderItems.map(item => {
      const product = item.product || {};
      const itemName = product.name || item.productName || item.name || 'Product';
      const qty = item.quantity || 1;
      const unitPrice = Number(item.unitPrice || item.priceAtPurchase || product.price || 0);
      return `<tr>
            <td style="padding:12px;font-size:14px;color:#333;border-bottom:1px solid #EEE;">${itemName}</td>
            <td align="center" style="padding:12px;font-size:14px;color:#333;border-bottom:1px solid #EEE;">${qty}</td>
            <td align="right" style="padding:12px;font-size:14px;color:#333;border-bottom:1px solid #EEE;">GH₵ ${unitPrice.toFixed(2)}</td>
          </tr>`;
    }).join('')}
        <tr>
          <td colspan="2" align="right" style="padding:12px;font-size:15px;font-weight:700;color:#333;border-top:2px solid #EEE;">Total:</td>
          <td align="right" style="padding:12px;font-size:15px;font-weight:700;color:${brandConfig.primaryColor};border-top:2px solid #EEE;">GH₵ ${orderTotal.toFixed(2)}</td>
        </tr>
      </table>`
    : `<p style="font-size:14px;color:#888;">Order total: <strong>GH₵ ${orderTotal.toFixed(2)}</strong></p>`;

  // ── Shipping address ─────────────────────────────────────────────
  const addr = order.shippingAddress || order.deliveryAddress || {};
  const addrStr = typeof addr === 'string' ? addr
    : [addr.streetAddress, addr.town, addr.city, addr.region, addr.country].filter(Boolean).join(', ');
  const addrHtml = addrStr
    ? `<p style="font-size:14px;color:#555;margin:16px 0 4px;">Shipping to:</p>
       <div style="background:#F9F9F9;padding:12px 16px;border-radius:6px;font-size:14px;color:#333;">${addrStr}</div>`
    : '';

  // ── COD next-steps block ─────────────────────────────────────────
  const codNextStepsHtml = (method === 'payment_on_delivery' || method === 'cod' || method === 'cash_on_delivery')
    ? `<div style="background:#FFF8E7;border-radius:6px;padding:16px;margin:20px 0;">
         <p style="margin:0 0 8px;font-size:14px;color:#333;font-weight:700;">📌 What happens next?</p>
         <ul style="margin:0;padding-left:20px;font-size:14px;color:#555;line-height:1.9;">
           <li>Your order is being prepared by the seller</li>
           <li>A delivery agent will contact you before arrival</li>
           <li>Pay GH₵ ${orderTotal.toFixed(2)} in cash when the order arrives</li>
           <li>Track your order anytime from your account</li>
         </ul>
       </div>`
    : '';

  const bodyContent = `
    <h2 style="margin:0 0 6px;font-size:22px;color:#333;">${statusTitle}</h2>
    <p style="margin:0 0 20px;font-size:14px;color:#555;">Hi ${name}, ${statusMessage}</p>
    ${paymentBadgeHtml}
    <p style="font-size:13px;color:#888;margin:0 0 4px;">Order #<strong>${orderNumber}</strong> &nbsp;·&nbsp; ${new Date(order.createdAt || Date.now()).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
    ${itemsHtml}
    ${addrHtml}
    ${codNextStepsHtml}
    <div style="text-align:center;margin:28px 0 8px;">
      <a href="${orderUrl}" style="display:inline-block;background:${brandConfig.primaryColor};color:#fff;text-decoration:none;padding:14px 32px;border-radius:6px;font-size:15px;font-weight:bold;">View Order Details</a>
    </div>
    <p style="font-size:13px;color:#888;text-align:center;">Thank you for shopping with ${brandConfig.name}! 🛍️</p>
  `;

  const htmlContent = getEmailWrapper(
    brandConfig,
    `linear-gradient(135deg, ${brandConfig.primaryColor} 0%, #3a0ca3 100%)`,
    bodyContent,
    previewText
  );

  const subjectMap = {
    credit_balance: `✅ Order Confirmed — #${orderNumber}`,
    wallet: `✅ Order Confirmed — #${orderNumber}`,
    payment_on_delivery: `📦 Order Received — #${orderNumber} (Pay on Delivery)`,
    cod: `📦 Order Received — #${orderNumber} (Pay on Delivery)`,
    cash_on_delivery: `📦 Order Received — #${orderNumber} (Pay on Delivery)`,
  };
  const subject = subjectMap[method] || `✅ Payment Confirmed — Order #${orderNumber}`;

  return sendEmail({
    to: toEmail,
    subject,
    text: `${statusTitle} - Order #${orderNumber}. Hi ${name}, ${statusMessage} Total: GH₵${orderTotal.toFixed(2)}. View your order: ${orderUrl}`,
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
              ${order.paymentStatus
      ? `
              <div class="info-row">
                <span class="info-label">Payment Status:</span>
                <span class="info-value">${order.paymentStatus === 'completed' ? 'Paid' : 'Pending'
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
              ${shippingFee > 0
      ? `
              <div class="info-row">
                <span class="info-label">Shipping Fee:</span>
                <span class="info-value">GH₵${shippingFee.toFixed(2)}</span>
              </div>
              `
      : ''
    }
              ${tax > 0
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
${order.paymentStatus
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
  getEmailWrapper,
  getLogoHtml,
};
