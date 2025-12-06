// Load environment variables FIRST - before any other imports
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

// Load .env file from backend directory
// __dirname is backend/src, so go up one level to backend/
const envPath = path.join(__dirname, '../.env');
const configEnvPath = path.join(__dirname, '../config.env');

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
  console.log(`✅ [app.js] Loaded environment from: ${envPath}`);
} else if (fs.existsSync(configEnvPath)) {
  dotenv.config({ path: configEnvPath });
  console.log(`✅ [app.js] Loaded environment from: ${configEnvPath}`);
} else {
  // Try default .env location
  dotenv.config({ path: envPath });
  console.log(`⚠️  [app.js] Attempting to load from: ${envPath} (file may not exist)`);
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
const csurf = require('csurf');
// Bull Board (CommonJS compatible)
const { createBullBoard } = require('@bull-board/api');
const { BullAdapter } = require('@bull-board/api/bullAdapter');
const { ExpressAdapter } = require('@bull-board/express');

// Config
const configureCloudinary = require('./config/cloudinary');

// Utils and error handling
const AppError = require('./utils/errors/appError');
const globalErrorHandler = require('./controllers/shared/errorController');

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

// Import queues
const dataExportQueue = require('./jobs/queues/dataExportQueue');
const queues = [dataExportQueue];

const app = express();

// 1. Configure Cloudinary
const cloudinary = configureCloudinary();
app.set('cloudinary', cloudinary);

// 2. Setup Bull Board (only in development/staging)
if (process.env.NODE_ENV !== 'production') {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/admin/queues');

  createBullBoard({
    queues: queues.map((queue) => new BullAdapter(queue)),
    serverAdapter,
  });

  app.use(
    '/admin/queues',
    (req, res, next) => {
      if (!req.user || !req.user.isAdmin) {
        return res.status(403).json({ message: 'Access denied' });
      }
      next();
    },
    serverAdapter.getRouter(),
  );
}

// 3. Global Middleware Stack
// SECURITY FIX #34: Enhanced Helmet security headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          'https://cdnjs.cloudflare.com',
          'https://checkout.paystack.com',
        ],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          'https://fonts.googleapis.com',
          'https://cdnjs.cloudflare.com',
        ],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'https://res.cloudinary.com'],
        connectSrc: [
          "'self'",
          'https://api.cloudinary.com',
          'https://api.paystack.co',
          'https://checkout.paystack.com',
        ],
        frameSrc: [
          "'self'",
          'https://checkout.paystack.com',
        ],
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
  }),
);

// Determine environment
const isDevelopment = process.env.NODE_ENV === 'development';
const isProduction = process.env.NODE_ENV === 'production';

const allowedOrigins = [
  'https://eazworld.com',
  'https://www.eazworld.com',
  'https://api.eazworld.com',
  'https://checkout.paystack.com', // Allow Paystack checkout domain
  process.env.FRONTEND_URL,
].filter(Boolean);

// CORS configuration with SECURITY FIX #17
const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) {
      console.log('[CORS] Request with no origin, allowing');
      return callback(null, true);
    }

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
      ];

      if (devOrigins.includes(origin)) {
        console.log(`[CORS] Development - allowing origin: ${origin}`);
        return callback(null, true);
      }

      console.warn(`[CORS] Development - blocked unrecognized origin: ${origin}`);
      return callback(new Error(`CORS not allowed for origin: ${origin}`), false);
    }

    // Production: Only allow specific origins
    if (allowedOrigins.includes(origin)) {
      console.log(`[CORS] Production - allowing origin: ${origin}`);
      return callback(null, true);
    }

    console.warn(`[CORS] Blocked origin: ${origin}`);
    callback(new Error(`CORS not allowed for origin: ${origin}`), false);
  },
  credentials: true, // REQUIRED for cookies
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-User-Role',
    'x-seller-subdomain',
    'x-admin-subdomain',
  ],
  exposedHeaders: ['Content-Range', 'X-Total-Count'],
  optionsSuccessStatus: 200, // Some legacy browsers (IE11) choke on 204
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Logging
if (isDevelopment) {
  app.use(morgan('dev'));
} else {
  app.use(
    morgan('combined', {
      skip: (req, res) => res.statusCode < 400,
      stream: process.stderr,
    }),
  );
  app.use(
    morgan('combined', {
      skip: (req, res) => res.statusCode >= 400,
      stream: process.stdout,
    }),
  );
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
app.use(express.json({ limit: '20kb' }));
app.use(express.urlencoded({ extended: true, limit: '20kb' }));
app.use(cookieParser());

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

  res.setHeader(
    'Strict-Transport-Security',
    'max-age=31536000; includeSubDomains; preload',
  );
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

// Health check endpoint
app.get('/health', (req, res) => {
  console.log('Server is running');
  res.status(200).json({
    status: 'success',
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// 5. Error handling
app.all('*', (req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server`, 404));
});

// 🛡️ CSRF Error Handler (SECURITY)
app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    console.error('[CSRF] Invalid CSRF token detected:', {
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

module.exports = app;;
