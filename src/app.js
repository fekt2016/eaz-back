// Load environment variables FIRST - before any other imports
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

// Load .env file from backend directory
// __dirname is backend/src, so go up one level to backend/
const envPath = path.join(__dirname, '../.env');
const configEnvPath = path.join(__dirname, '../config.env');

// Note: Logger not available yet during env loading, use console for initial setup
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
  // Will be replaced with logger after it's initialized
} else if (fs.existsSync(configEnvPath)) {
  dotenv.config({ path: configEnvPath });
  // Will be replaced with logger after it's initialized
} else {
  // Try default .env location
  dotenv.config({ path: envPath });
  // Will be replaced with logger after it's initialized
}

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const hpp = require('hpp');
const compression = require('compression');
// CSRF protection is now handled by custom middleware in ./middleware/csrf/csrfProtection.js
// const csurf = require('csurf');

// Config
const configureCloudinary = require('./config/cloudinary');

// Utils and error handling
const AppError = require('./utils/errors/appError');
const globalErrorHandler = require('./controllers/shared/errorController');
const logger = require('./utils/logger');

// Import routers by role
const userRoutes = require('./routes/buyer/userRoutes');
const cartRoutes = require('./routes/buyer/cartRoutes');
const wishlistRoutes = require('./routes/buyer/wishlistRoute');
const addressRoutes = require('./routes/buyer/addressRoutes');
const browserHistoryRoutes = require('./routes/buyer/browserHistoryRoutes');
const creditbalanceRoutes = require('./routes/buyer/creditbalanceRoutes');
const walletRoutes = require('./routes/buyer/walletRoutes');
const followRoutes = require('./routes/buyer/followRoutes');
const permissionRoutes = require('./routes/buyer/permissionRoutes');
const newsletterRoutes = require('./routes/buyer/newsletterRoutes');

const sellerRoutes = require('./routes/seller/sellerRoutes');
const sellerReviewRoutes = require('./routes/seller/reviewRoutes');
const paymentRequestRoutes = require('./routes/seller/paymentRequestRoutes');
const sellerPayoutRoutes = require('./routes/seller/payoutRoutes');
const discountRoutes = require('./routes/seller/discountRoute');
const buyerCouponRoutes = require('./routes/buyer/couponRoutes');
const sellerCouponRoutes = require('./routes/seller/couponRoutes');
const shippingSettingsRoutes = require('./routes/seller/shippingSettingsRoutes');

const adminRoutes = require('./routes/admin/adminRoutes');
const adminCouponRoutes = require('./routes/admin/couponRoutes');
const analyticsRoutes = require('./routes/admin/analyticsRoutes');
const pickupCenterRoutes = require('./routes/admin/pickupCenterRoutes');
const dispatchFeesRoutes = require('./routes/admin/dispatchFeesRoutes');
const eazshopStoreRoutes = require('./routes/admin/eazshopStoreRoutes');
const shippingRateRoutes = require('./routes/admin/shippingRateRoutes');
const shippingZoneRoutes = require('./routes/admin/shippingZoneRoutes');
const distanceAnalyzerRoutes = require('./routes/admin/distanceAnalyzerRoutes');
const adminNeighborhoodRoutes = require('./routes/admin/neighborhoodRoutes');
const adminReviewRoutes = require('./routes/admin/reviewRoutes');
const adminPayoutRoutes = require('./routes/admin/payoutRoutes');
const adminRefundRoutes = require('./routes/admin/refundRoutes');

const productRoutes = require('./routes/shared/productRoutes');
const categoryRoutes = require('./routes/shared/categoryRoutes');
const orderRoutes = require('./routes/shared/orderRoutes');
const orderItemRoutes = require('./routes/shared/orderItemRoute');
const reviewRoutes = require('./routes/shared/reviewRoutes');
const paymentMethodRoutes = require('./routes/shared/paymentMethodRoutes');
const paymentRoutes = require('./routes/shared/paymentRoutes');
const searchRoutes = require('./routes/shared/searchRoutes');
const notificationRoutes = require('./routes/shared/notificationRoutes');
const notificationsApiRoutes = require('./routes/notification/notificationRoutes');
const shippingRoutes = require('./routes/shared/shippingRoutes');
const locationRoutes = require('./routes/shared/locationRoutes');
const neighborhoodRoutes = require('./routes/shared/neighborhoodRoutes');
const deviceSessionRoutes = require('./routes/shared/deviceSessionRoutes');
const recommendationRoutes = require('./routes/shared/recommendationRoutes');
const supportRoutes = require('./routes/shared/supportRoutes');

const app = express();

// 1. Configure Cloudinary
const cloudinary = configureCloudinary();
app.set('cloudinary', cloudinary);

// 2. Global Middleware Stack
// SECURITY FIX #8 (Phase 3 Enhancement): CSP with nonce support
const { attachNonce, getNonceDirective } = require('./middleware/security/cspNonce');

// Attach nonce to all requests (for CSP)
app.use(attachNonce);

// SECURITY FIX #34: Enhanced Helmet security headers with nonce-based CSP
app.use((req, res, next) => {
  const nonce = req.cspNonce || res.locals.cspNonce || '';
  const nonceDirective = nonce ? getNonceDirective(nonce) : '';
  
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          nonceDirective, // SECURITY FIX #8: Use nonce instead of unsafe-inline where possible
          // Note: Paystack checkout requires unsafe-inline for their embedded scripts
          // This is acceptable as Paystack is a trusted payment provider
          "'unsafe-inline'", // Required for Paystack checkout compatibility
          'https://cdnjs.cloudflare.com',
          'https://checkout.paystack.com',
        ],
        styleSrc: [
          "'self'",
          nonceDirective, // SECURITY FIX #8: Use nonce for inline styles
          "'unsafe-inline'", // Still needed for some third-party styles
          'https://fonts.googleapis.com',
          'https://cdnjs.cloudflare.com',
        ],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'https://res.cloudinary.com'],
        connectSrc: [
          "'self'",
          'https://api.cloudinary.com',
          'https://api.paystack.co',
          'https://*.paystack.com', // Allow all Paystack subdomains
          'https://checkout.paystack.com',
          'https://nominatim.openstreetmap.org', // OpenStreetMap Nominatim API for reverse geocoding
          // Development origins - specific ports
          ...(process.env.NODE_ENV === 'development' 
            ? [
                'http://localhost:5173', // eazmain
                'http://localhost:5174', // eazadmin
                'http://localhost:5175', // eazseller
                'http://localhost:3000',
                'http://localhost:3001',
                'http://127.0.0.1:5173',
                'http://127.0.0.1:5174',
                'http://127.0.0.1:5175',
              ]
            : []
          ),
          // Production origins
          ...(process.env.NODE_ENV === 'production'
            ? [
                'https://api.saiisai.com',
                'https://saiisai.com',
                'https://www.saiisai.com',
              ]
            : []
          ),
        ],
        frameSrc: [
          "'self'",
          'https://checkout.paystack.com',
        ],
        // SECURITY FIX #8: Additional CSP directives
        baseUri: ["'self'"],
        formAction: ["'self'", 'https://checkout.paystack.com'],
        upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null, // Upgrade HTTP to HTTPS
      },
    },
    // SECURITY: Additional Helmet protections
    hsts: {
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
      preload: true,
    },
    frameguard: { action: 'deny' }, // Prevent clickjacking
    noSniff: true, // Prevent MIME sniffing
    xssFilter: true, // XSS protection
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  })(req, res, next);
});

// Determine environment
const isDevelopment = process.env.NODE_ENV === 'development';
const isProduction = process.env.NODE_ENV === 'production';

const allowedOrigins = [
  // Main customer site
  'https://saiisai.com',
  'https://www.saiisai.com',
  // API domain
  'https://api.saiisai.com',
  // Seller & admin dashboards
  'https://seller.saiisai.com',
  'https://admin.saiisai.com',
  // Paystack checkout domain
  'https://checkout.paystack.com',
  // Fallback / additional frontend URL from env
  process.env.FRONTEND_URL,
].filter(Boolean);

// CORS configuration with SECURITY FIX #17
const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) {
      if (isDevelopment) {
        logger.info('[CORS] Request with no origin, allowing');
      }
      return callback(null, true);
    }

    // Normalize origin (remove trailing slash, ensure lowercase for comparison)
    const normalizedOrigin = origin.toLowerCase().replace(/\/$/, '');

    // SECURITY FIX #17: Development - restrict to specific localhost ports (no wildcard)
    if (process.env.NODE_ENV === 'development') {
      const devOrigins = [
        'http://localhost:5173', // eazmain
        'http://localhost:5174', // eazadmin
        'http://localhost:5175', // eazseller
        'http://localhost:3000',
        'http://localhost:3001',
        'http://127.0.0.1:5173',
        'http://127.0.0.1:5174',
        'http://127.0.0.1:5175',
      ].map(o => o.toLowerCase());

      // Check if origin is in the allowed list (case-insensitive)
      if (devOrigins.includes(normalizedOrigin)) {
        if (isDevelopment) {
          logger.info(`[CORS] Development - allowing origin: ${origin}`);
        }
        return callback(null, true);
      }

      // Allow network IP ranges for mobile app connections (development only)
      if (origin) {
        if (
          origin.startsWith('http://10.194.166.') ||
          origin.startsWith('http://192.168.') ||
          origin.startsWith('http://172.') ||
          origin.startsWith('http://10.')
        ) {
          if (isDevelopment) {
            logger.info(`[CORS] Development - allowing network origin: ${origin}`);
          }
          return callback(null, true);
        }
      }

      if (isDevelopment) {
        logger.warn(`[CORS] Development - blocked unrecognized origin: ${origin}`);
      }
      return callback(new Error(`CORS not allowed for origin: ${origin}`), false);
    }

    // Production: Normalize allowed origins for comparison
    const normalizedAllowedOrigins = allowedOrigins.map(o => o.toLowerCase().replace(/\/$/, ''));

    // Check if origin is in allowed list (case-insensitive, trailing slash insensitive)
    if (normalizedAllowedOrigins.includes(normalizedOrigin)) {
      if (isDevelopment) {
        logger.info(`[CORS] Production - allowing origin: ${origin}`);
      }
      return callback(null, true);
    }

    // Allow AWS Amplify domains (*.amplifyapp.com)
    if (origin && origin.endsWith('.amplifyapp.com')) {
      if (isDevelopment) {
        logger.info(`[CORS] Production - allowing AWS Amplify origin: ${origin}`);
      }
      return callback(null, true);
    }

    // Log in production for debugging (without exposing sensitive info)
    if (isProduction) {
      logger.warn(`[CORS] Blocked origin: ${origin.substring(0, 50)}... (normalized: ${normalizedOrigin.substring(0, 50)})`);
    }
    callback(new Error(`CORS not allowed for origin: ${origin}`), false);
  },
  credentials: true, // REQUIRED for cookies
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    // CSRF protection header for frontend state-changing requests
    'X-CSRF-Token',
    'X-User-Role',
    'x-seller-subdomain',
    'x-admin-subdomain',
    'x-client-app',        // Mobile app identifier
    'x-client-screen',     // Screen tracking for debugging
    'x-client-screen-params', // Screen params for debugging
    'x-device-id',         // Device ID
    'x-platform',          // Platform identifier
    'x-mobile',            // Mobile app flag
  ],
  exposedHeaders: ['Content-Range', 'X-Total-Count'],
  optionsSuccessStatus: 200, // Some legacy browsers (IE11) choke on 204
  // Ensure CORS headers are always sent, even on errors
  preflightContinue: false,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// SECURITY FIX #9 (Phase 3 Enhancement): Enhanced HTTPS Enforcement
const { enforceHttps } = require('./middleware/security/httpsEnforcement');
app.use(enforceHttps); // Enforces HTTPS in production

// Logging - Use Winston logger for HTTP requests
if (isDevelopment) {
  app.use(morgan('dev', { stream: logger.stream }));
} else {
  // Production: Log all requests to Winston
  app.use(morgan('combined', { stream: logger.stream }));
}
app.set('trust proxy', 1);

// SECURITY FIX #35: Enhanced global rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isProduction ? 500 : 5000, // Stricter in production
  message: {
    error: 'Too many requests from this IP, please try again later',
    retryAfter: 15 * 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Skip rate limiting for whitelisted IPs (optional)
  skip: (req) => {
    // Skip localhost in development
    if (!isProduction && req.ip === '::1') return true;
    return false;
  },
});

app.use('/api', limiter);

// 🐢 Slow Down Repeated Requests (SECURITY)
const speedLimiter = slowDown({
  windowMs: 15 * 60 * 1000, // 15 minutes
  delayAfter: 100, // Allow 100 requests per window
  delayMs: (hits) => hits * 500, // Add 500ms delay per request after limit
  maxDelayMs: 20000, // Max 20s delay
});
app.use('/api', speedLimiter);

// More aggressive rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: {
    error: 'Too many login attempts, please try again later',
    retryAfter: 15 * 60,
  },
  skipSuccessfulRequests: true,
});

app.use('/api/v1/users/login', authLimiter);
app.use('/api/v1/users/signup', authLimiter);

// 📦 Body parsing with strict size limits (SECURITY)
app.use(express.json({ 
  limit: '20kb',
  // Custom error handler for malformed JSON
  verify: (req, res, buf, encoding) => {
    // Check if body is a string (malformed JSON)
    if (buf && buf.length > 0) {
      try {
        const bodyString = buf.toString(encoding || 'utf8');
        // If it's just a quoted string (like "email"), it's malformed
        if (bodyString.trim().startsWith('"') && bodyString.trim().endsWith('"') && !bodyString.includes('{')) {
          console.error('[Body Parser] Malformed JSON detected - received string instead of object:', bodyString.substring(0, 100));
          throw new Error('Invalid request format. Expected JSON object, received string.');
        }
      } catch (e) {
        // Let express.json handle the error
      }
    }
  }
}));
app.use(express.urlencoded({ extended: true, limit: '20kb' }));
app.use(cookieParser());

// SECURITY FIX #7: CSRF Protection for authenticated routes
// Apply CSRF protection after cookie parser but before routes
const { csrfProtection, getCsrfToken, generateCSRFToken } = require('./middleware/csrf/csrfProtection');

// CSRF token endpoint - returns the token from cookie (token is generated on login/signup)
app.get('/api/v1/csrf-token', getCsrfToken);

// Apply CSRF protection to all other routes
app.use('/api/v1', csrfProtection);

// Custom error handler for JSON parsing errors
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    console.error('[Body Parser] JSON parsing error:', {
      message: err.message,
      url: req.originalUrl,
      method: req.method,
      contentType: req.headers['content-type'],
      bodyPreview: req.body ? JSON.stringify(req.body).substring(0, 100) : 'empty',
    });
    return res.status(400).json({
      status: 'error',
      message: 'Invalid JSON format. Please ensure your request body is a valid JSON object (e.g., {"email":"...","password":"..."})',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
  next(err);
});

// 🧼 Data Sanitization (SECURITY)
app.use(mongoSanitize());
app.use(xss());

// 🚫 HTTP Parameter Pollution Protection (SECURITY)
app.use(hpp({
  whitelist: ['price', 'rating', 'category', 'limit', 'page', 'sort'],
}));

// 🧱 Compression (Performance Optimization)
app.use(
  compression({
    level: 6, // Compression level (0-9)
    threshold: 1024, // Only compress responses > 1KB
    filter: (req, res) => {
      // Don't compress if client doesn't support it
      if (req.headers['x-no-compression']) {
        return false;
      }
      return compression.filter(req, res);
    },
  })
);

// Request timing and security headers
app.use((req, res, next) => {
  req.requestTime = new Date().toISOString();

  // Note: HSTS is already set by Helmet (line 165-169), so we don't set it again here
  // Additional security headers (Helmet also sets these, but keeping for explicit control)
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.removeHeader('X-Powered-By');

  next();
});

// Serve static files from public directory (for user avatars, product images, etc.)
app.use(express.static(path.join(__dirname, '../../public')));

// 4. Routes - Organized by role
// Buyer routes
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/cart', cartRoutes);
app.use('/api/v1/wishlist', wishlistRoutes);
app.use('/api/v1/address', addressRoutes);
app.use('/api/v1/history', browserHistoryRoutes);
app.use('/api/v1/creditbalance', creditbalanceRoutes);
app.use('/api/v1/wallet', walletRoutes);
app.use('/api/v1/follow', followRoutes);
app.use('/api/v1/permission', permissionRoutes);
app.use('/api/v1/newsletter', newsletterRoutes);

// Seller routes
// IMPORTANT: More specific routes must come BEFORE general routes to avoid route conflicts
// The sellerRoutes has a catch-all /:id route that would match /coupon if mounted first
app.use('/api/v1/seller/coupon', sellerCouponRoutes); // Seller routes (manage coupons) - MUST come before sellerRoutes
app.use('/api/v1/seller/discount', discountRoutes); // Seller routes (manage discounts) - MUST come before sellerRoutes
app.use('/api/v1/seller/reviews', sellerReviewRoutes);
app.use('/api/v1/seller/payout', sellerPayoutRoutes);
app.use('/api/v1/seller', sellerRoutes);
app.use('/api/v1/paymentrequest', paymentRequestRoutes);
app.use('/api/v1/coupon', buyerCouponRoutes); // Buyer routes (apply coupons)
app.use('/api/v1/shipping/settings', shippingSettingsRoutes);

// Admin routes
// IMPORTANT: adminNeighborhoodRoutes must come BEFORE adminRoutes to avoid route conflicts
// adminRoutes has a catch-all /:id route that would match /neighborhoods
// Mount adminNeighborhoodRoutes at /api/v1/admin/neighborhoods
app.use('/api/v1/admin/neighborhoods', adminNeighborhoodRoutes);
app.use('/api/v1/admin/reviews', adminReviewRoutes);
app.use('/api/v1/admin/payout', adminPayoutRoutes);
app.use('/api/v1/admin/refunds', adminRefundRoutes);
app.use('/api/v1/admin/coupons', adminCouponRoutes);
app.use('/api/v1/logs', require('./modules/activityLog/activityLog.routes'));
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/analytics', analyticsRoutes);
app.use('/api/v1/pickup-centers', pickupCenterRoutes);
app.use('/api/v1/dispatch-fees', dispatchFeesRoutes);
app.use('/api/v1/eazshop', eazshopStoreRoutes);
app.use('/api/v1/shipping-rates', shippingRateRoutes);
app.use('/api/v1/shipping-zones', shippingZoneRoutes);
app.use('/api/v1/shipping-analysis', distanceAnalyzerRoutes);

// Shared routes
app.use('/api/v1/product', productRoutes);
app.use('/api/v1/categories', categoryRoutes);
app.use('/api/v1/order', orderRoutes);
app.use('/api/v1/orderItem', orderItemRoutes);
app.use('/api/v1/review', reviewRoutes);
app.use('/api/v1/paymentmethod', paymentMethodRoutes);
app.use('/api/v1/payment', paymentRoutes);
app.use('/api/v1/search', searchRoutes);
app.use('/api/v1/notification-settings', notificationRoutes);
app.use('/api/v1/notifications', notificationsApiRoutes);
app.use('/api/v1/shipping', shippingRoutes);
app.use('/api/v1/location', locationRoutes);
app.use('/api/v1/neighborhoods', neighborhoodRoutes);
app.use('/api/v1/sessions', deviceSessionRoutes);
app.use('/api/v1/recommendations', recommendationRoutes);
app.use('/api/v1/support', supportRoutes);

// Health check endpoint (improved for Docker/K8s)
app.get('/health', (req, res) => {
  const mongoose = require('mongoose');
  const dbStatus = mongoose.connection.readyState;
  const dbStates = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  };

  const health = {
    status: dbStatus === 1 ? 'healthy' : 'degraded',
    message: dbStatus === 1 ? 'Server is running' : 'Server is running but database is disconnected',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    database: {
      status: dbStates[dbStatus] || 'unknown',
      readyState: dbStatus,
    },
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + ' MB',
    },
    environment: process.env.NODE_ENV || 'development',
    version: process.env.npm_package_version || '1.0.0',
  };

  // Return 503 if database is not connected, 200 otherwise
  const statusCode = dbStatus === 1 ? 200 : 503;
  res.status(statusCode).json(health);
});

// Readiness probe (check database connection)
app.get('/health/ready', async (req, res) => {
  try {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 1) {
      res.status(200).json({
        status: 'ready',
        database: 'connected',
        timestamp: new Date().toISOString(),
      });
    } else {
      res.status(503).json({
        status: 'not ready',
        database: 'disconnected',
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    res.status(503).json({
      status: 'error',
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Liveness probe (basic server check)
app.get('/health/live', (req, res) => {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
  });
});

// 5. Error handling
app.all('*', (req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server`, 404));
});

// 🛡️ CSRF Error Handler (SECURITY)
app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    logger.warn('Invalid CSRF token detected', {
      ip: req.ip,
      path: req.path,
      method: req.method,
    });
    return res.status(403).json({
      status: 'fail',
      message: 'Invalid CSRF token. Please refresh and try again.',
    });
  }
  next(err);
});

app.use(globalErrorHandler);

module.exports = app;
