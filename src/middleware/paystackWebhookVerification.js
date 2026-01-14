/**
 * Paystack Webhook Signature Verification Middleware
 * 
 * SECURITY FIX #8: Verifies Paystack webhook signatures to ensure requests
 * are authentic and haven't been tampered with.
 * 
 * Paystack sends webhook requests with an X-Paystack-Signature header containing
 * an HMAC SHA512 hash of the raw request body. This middleware verifies that hash.
 */

const crypto = require('crypto');
const AppError = require('../utils/errors/appError');

/**
 * Verify Paystack webhook signature
 * 
 * This middleware MUST be used with express.raw() middleware to get the raw body.
 * The signature is computed over the raw JSON string (as bytes), not the parsed object.
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const verifyPaystackWebhook = (req, res, next) => {
  const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

  if (!PAYSTACK_SECRET_KEY) {
    console.error('[Paystack Webhook] Secret key not configured');
    return next(new AppError('Paystack webhook verification failed', 500));
  }

  // Get signature from header
  const signature = req.headers['x-paystack-signature'];

  if (!signature) {
    console.error('[Paystack Webhook] Missing signature header');
    return next(new AppError('Invalid webhook signature', 403));
  }

  // Get raw body
  // If express.raw() middleware is used, req.body will be a Buffer
  // If express.json() middleware is used, req.body will be a parsed object
  let rawBody;
  
  if (Buffer.isBuffer(req.body)) {
    // Raw body from express.raw() - use directly
    rawBody = req.body;
  } else if (typeof req.body === 'string') {
    // Already a string - use as is
    rawBody = req.body;
  } else if (typeof req.body === 'object') {
    // Parsed JSON object - stringify it (this should match Paystack's format)
    // Note: Paystack sends JSON, so we stringify without spaces to match their format
    rawBody = JSON.stringify(req.body);
  } else {
    console.error('[Paystack Webhook] Unexpected body type:', typeof req.body);
    return next(new AppError('Invalid webhook payload', 400));
  }

  // Compute HMAC SHA512 hash
  const hash = crypto
    .createHmac('sha512', PAYSTACK_SECRET_KEY)
    .update(rawBody)
    .digest('hex');

  // Compare signatures using constant-time comparison (prevents timing attacks)
  // Both hash and signature are hex strings (128 chars for SHA512)
  const hashBuffer = Buffer.from(hash, 'hex');
  const signatureBuffer = Buffer.from(signature, 'hex');
  
  // Length check - if different lengths, definitely invalid
  if (hashBuffer.length !== signatureBuffer.length) {
    console.error('[Paystack Webhook] Invalid signature detected (length mismatch):', {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      hashLength: hashBuffer.length,
      signatureLength: signatureBuffer.length,
    });
    return next(new AppError('Invalid webhook signature', 403));
  }
  
  // Constant-time comparison
  if (!crypto.timingSafeEqual(hashBuffer, signatureBuffer)) {
    console.error('[Paystack Webhook] Invalid signature detected:', {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      hasBody: !!req.body,
      bodyType: typeof req.body,
      bodyLength: Buffer.isBuffer(req.body) ? req.body.length : 
                   typeof req.body === 'string' ? req.body.length : 
                   'N/A',
    });
    return next(new AppError('Invalid webhook signature', 403));
  }

  // Signature is valid - parse JSON if needed and continue
  if (Buffer.isBuffer(req.body) || typeof req.body === 'string') {
    try {
      req.body = JSON.parse(rawBody.toString());
    } catch (parseError) {
      console.error('[Paystack Webhook] Failed to parse JSON:', parseError);
      return next(new AppError('Invalid webhook payload', 400));
    }
  }

  next();
};

module.exports = {
  verifyPaystackWebhook,
};

