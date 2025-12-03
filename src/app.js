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
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const hpp = require('hpp');
const compression = require('compression');
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
const couponRoutes = require('./routes/seller/couponRoutes');
const shippingSettingsRoutes = require('./routes/seller/shippingSettingsRoutes');

const adminRoutes = require('./routes/admin/adminRoutes');
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
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          'https://cdnjs.cloudflare.com',
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

// CORS configuration
const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) {
      console.log('[CORS] Request with no origin, allowing');
      return callback(null, true);
    }

    // Development: Allow all origins (including localhost with any port)
    if (process.env.NODE_ENV === 'development') {
      console.log(`[CORS] Development mode - allowing origin: ${origin}`);
      return callback(null, true);
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

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProduction ? 1000 : 5000,
  message: {
    error: 'Too many requests from this IP, please try again later',
    retryAfter: 15 * 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api', limiter);

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

// Body parsers
app.use(
  express.json({
    limit: isProduction ? '10mb' : '50mb',
    verify: (req, res, buf) => {
      try {
        JSON.parse(buf);
      } catch (e) {
        throw new AppError('Invalid JSON payload', 400);
      }
    },
  }),
);

app.use(
  express.urlencoded({
    extended: true,
    limit: isProduction ? '10mb' : '50mb',
    parameterLimit: isProduction ? 100 : 1000,
  }),
);

app.use(cookieParser());

// Security middleware
app.use(mongoSanitize());
app.use(xss());
app.use(
  hpp({
    whitelist: ['price', 'ratingsAverage', 'ratingsQuantity', 'category'],
  }),
);

// Compression middleware for production
if (isProduction) {
  app.use(
    compression({
      level: 6,
      threshold: 1000,
      filter: (req, res) => {
        if (req.headers['x-no-compression']) {
          return false;
        }
        return compression.filter(req, res);
      },
    }),
  );
}

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
app.use('/api/v1/seller', sellerRoutes);
app.use('/api/v1/seller/reviews', sellerReviewRoutes);
app.use('/api/v1/seller/payout', sellerPayoutRoutes);
app.use('/api/v1/paymentrequest', paymentRequestRoutes);
app.use('/api/v1/discount', discountRoutes);
app.use('/api/v1/coupon', couponRoutes);
app.use('/api/v1/shipping/settings', shippingSettingsRoutes);

// Admin routes
// IMPORTANT: adminNeighborhoodRoutes must come BEFORE adminRoutes to avoid route conflicts
// adminRoutes has a catch-all /:id route that would match /neighborhoods
// Mount adminNeighborhoodRoutes at /api/v1/admin/neighborhoods
app.use('/api/v1/admin/neighborhoods', adminNeighborhoodRoutes);
app.use('/api/v1/admin/reviews', adminReviewRoutes);
app.use('/api/v1/admin/payout', adminPayoutRoutes);
app.use('/api/v1/admin/refunds', adminRefundRoutes);
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

app.use(globalErrorHandler);

module.exports = app;;

