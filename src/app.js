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
const { createBullBoard } = require('@bull-board/api');
const { BullAdapter } = require('@bull-board/api/bullAdapter');
const { ExpressAdapter } = require('@bull-board/express');

// Config
const configureCloudinary = require('./config/cloudinary');

// Utils and error handling
const AppError = require('./utils/errors/appError');
const globalErrorHandler = require('./controllers/shared/errorController');

// Import routers by role
const buyerRoutes = {
  users: require('./routes/buyer/userRoutes'),
  cart: require('./routes/buyer/cartRoutes'),
  wishlist: require('./routes/buyer/wishlistRoute'),
  address: require('./routes/buyer/addressRoutes'),
  history: require('./routes/buyer/browserHistoryRoutes'),
  creditbalance: require('./routes/buyer/creditbalanceRoutes'),
  follow: require('./routes/buyer/followRoutes'),
  permission: require('./routes/buyer/permissionRoutes'),
  newsletter: require('./routes/buyer/newsletterRoutes'),
};

const sellerRoutes = {
  seller: require('./routes/seller/sellerRoutes'),
  paymentrequest: require('./routes/seller/paymentRequestRoutes'),
  discount: require('./routes/seller/discountRoute'),
  coupon: require('./routes/seller/couponRoutes'),
};

const adminRoutes = {
  admin: require('./routes/admin/adminRoutes'),
  analytics: require('./routes/admin/analyticsRoutes'),
};

const sharedRoutes = {
  product: require('./routes/shared/productRoutes'),
  categories: require('./routes/shared/categoryRoutes'),
  order: require('./routes/shared/orderRoutes'),
  orderItem: require('./routes/shared/orderItemRoute'),
  review: require('./routes/shared/reviewRoutes'),
  paymentmethod: require('./routes/shared/paymentMethodRoutes'),
  payment: require('./routes/shared/paymentRoutes'),
  search: require('./routes/shared/searchRoutes'),
  notificationSettings: require('./routes/shared/notificationRoutes'),
};

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
        connectSrc: ["'self'", 'https://api.cloudinary.com'],
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
  process.env.FRONTEND_URL,
].filter(Boolean);

// CORS configuration
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);

    if (process.env.NODE_ENV === 'development') {
      callback(null, true);
    } else if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS not allowed for origin: ${origin}`), false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-User-Role',
    'x-seller-subdomain',
    'x-admin-subdomain',
  ],
  exposedHeaders: ['Content-Range', 'X-Total-Count'],
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

// 4. Routes - Organized by role
// Buyer routes
app.use('/api/v1/users', buyerRoutes.users);
app.use('/api/v1/cart', buyerRoutes.cart);
app.use('/api/v1/wishlist', buyerRoutes.wishlist);
app.use('/api/v1/address', buyerRoutes.address);
app.use('/api/v1/history', buyerRoutes.history);
app.use('/api/v1/creditbalance', buyerRoutes.creditbalance);
app.use('/api/v1/follow', buyerRoutes.follow);
app.use('/api/v1/permission', buyerRoutes.permission);
app.use('/api/v1/newsletter', buyerRoutes.newsletter);

// Seller routes
app.use('/api/v1/seller', sellerRoutes.seller);
app.use('/api/v1/paymentrequest', sellerRoutes.paymentrequest);
app.use('/api/v1/discount', sellerRoutes.discount);
app.use('/api/v1/coupon', sellerRoutes.coupon);

// Admin routes
app.use('/api/v1/admin', adminRoutes.admin);
app.use('/api/v1/analytics', adminRoutes.analytics);

// Shared routes
app.use('/api/v1/product', sharedRoutes.product);
app.use('/api/v1/categories', sharedRoutes.categories);
app.use('/api/v1/order', sharedRoutes.order);
app.use('/api/v1/orderItem', sharedRoutes.orderItem);
app.use('/api/v1/review', sharedRoutes.review);
app.use('/api/v1/paymentmethod', sharedRoutes.paymentmethod);
app.use('/api/v1/payment', sharedRoutes.payment);
app.use('/api/v1/search', sharedRoutes.search);
app.use('/api/v1/notification-settings', sharedRoutes.notificationSettings);

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

module.exports = app;

