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
const cloudinary = require('cloudinary').v2;
const { createBullBoard } = require('@bull-board/api');
const { BullAdapter } = require('@bull-board/api/bullAdapter');
const { ExpressAdapter } = require('@bull-board/express');

// Utils and config
const AppError = require('./utils/appError');
const globalErrorHandler = require('./Controllers/errorController');

// Import all routers
const routers = {
  admin: require('./routes/adminRoutes'),
  users: require('./routes/userRoutes'),
  order: require('./routes/orderRoutes'),
  review: require('./routes/reviewRoutes'),
  paymentmethod: require('./routes/paymentMethodRoutes'),
  payment: require('./routes/paymentRoutes'),
  seller: require('./routes/sellerRoutes'),
  product: require('./routes/productRoutes'),
  categories: require('./routes/categoryRoutes'),
  orderItem: require('./routes/orderItemRoute'),
  cart: require('./routes/cartRoutes'),
  analytics: require('./routes/analyticsRoutes'),
  wishlist: require('./routes/wishlistRoute'),
  address: require('./routes/addressRoutes'),
  follow: require('./routes/followRoutes'),
  discount: require('./routes/discountRoute'),
  coupon: require('./routes/couponRoutes'),
  paymentrequest: require('./routes/paymentRequestRoutes'),
  creditbalance: require('./routes/creditbalanceRoutes'),
  history: require('./routes/browserHistoryRoutes'),
  notificationSettings: require('./routes/notificationRoutes'),
  search: require('./routes/searchRoutes'),
  newsletter: require('./routes/newsletterRoutes'),
};

// Import queues
const dataExportQueue = require('./jobs/dataExportQueue');
const queues = [dataExportQueue]; // Add other queues here if needed

const app = express();

// 1. Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
  timeout: 120000,
});
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
      // Add authentication middleware for admin routes
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

// CORS configuration
const corsOptions = {
  origin: isProduction
    ? [
        'https://eazworld.com',
        'https://www.eazworld.com',
        'https://api.eazworld.com',
        process.env.FRONTEND_URL,
      ].filter(Boolean) // Remove any falsy values
    : true, // Allow all in development
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
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
  // Use more detailed logging in production
  app.use(
    morgan('combined', {
      skip: (req, res) => res.statusCode < 400, // Only log errors in production
      stream: process.stderr,
    }),
  );
  app.use(
    morgan('combined', {
      skip: (req, res) => res.statusCode >= 400, // Log successful requests to stdout
      stream: process.stdout,
    }),
  );
}

// Rate limiting - different for production
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isProduction ? 1000 : 5000, // More lenient in development
  message: {
    error: 'Too many requests from this IP, please try again later',
    retryAfter: 15 * 60, // 15 minutes in seconds
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api', limiter);

// More aggressive rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Only 5 attempts
  message: {
    error: 'Too many login attempts, please try again later',
    retryAfter: 15 * 60,
  },
  skipSuccessfulRequests: true, // Only count failed attempts
});

app.use('/api/v1/users/login', authLimiter);
app.use('/api/v1/users/signup', authLimiter);

// Body parsers with stricter limits in production
app.use(
  express.json({
    limit: isProduction ? '10mb' : '50mb',
    verify: (req, res, buf) => {
      // You can add request verification logic here
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
    parameterLimit: isProduction ? 100 : 1000, // Stricter in production
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
      level: 6, // Compression level (0-9)
      threshold: 1000, // Minimum response size to compress
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

  // Security headers
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

// 4. Routes
// API routes with versioning
app.use('/api/v1/admin', routers.admin);
app.use('/api/v1/users', routers.users);
app.use('/api/v1/order', routers.order);
app.use('/api/v1/review', routers.review);
app.use('/api/v1/paymentmethod', routers.paymentmethod);
app.use('/api/v1/payment', routers.payment);
app.use('/api/v1/seller', routers.seller);
app.use('/api/v1/product', routers.product);
app.use('/api/v1/categories', routers.categories);
app.use('/api/v1/orderItem', routers.orderItem);
app.use('/api/v1/cart', routers.cart);
app.use('/api/v1/analytics', routers.analytics);
app.use('/api/v1/wishlist', routers.wishlist);
app.use('/api/v1/address', routers.address);
app.use('/api/v1/follow', routers.follow);
app.use('/api/v1/discount', routers.discount);
app.use('/api/v1/coupon', routers.coupon);
app.use('/api/v1/paymentrequest', routers.paymentrequest);
app.use('/api/v1/creditbalance', routers.creditbalance);
app.use('/api/v1/history', routers.history);
app.use('/api/v1/notification-settings', routers.notificationSettings);
app.use('/api/v1/search', routers.search);
app.use('/api/v1/newsletter', routers.newsletter);

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
app.use((req, res, next) => {
  console.log('Incoming request:', req.method, req.url);
  next();
});

// 5. Error handling
app.all('*', (req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server`, 404));
});

app.use(globalErrorHandler);

module.exports = app;
