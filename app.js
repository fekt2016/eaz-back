const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const hpp = require('hpp');
const cloudinary = require('cloudinary').v2;
const { createBullBoard } = require('@bull-board/api');
const { BullAdapter } = require('@bull-board/api/bullAdapter');
const { ExpressAdapter } = require('@bull-board/express');

// Utils and config
const AppError = require('./utils/appError');
const globalErrorHandler = require('./Controllers/errorController');

// Routers
const routerConfig = [
  { path: '/admin', router: require('./routes/adminRoutes') },
  { path: '/users', router: require('./routes/userRoutes') },
  { path: '/order', router: require('./routes/orderRoutes') },
  { path: '/review', router: require('./routes/reviewRoutes') },
  { path: '/paymentmethod', router: require('./routes/paymentMethodRoutes') },
  { path: '/payment', router: require('./routes/paymentRoutes') },
  { path: '/seller', router: require('./routes/sellerRoutes') },
  { path: '/product', router: require('./routes/productRoutes') },
  { path: '/categories', router: require('./routes/categoryRoutes') },
  { path: '/orderItem', router: require('./routes/orderItemRoute') },
  { path: '/cart', router: require('./routes/cartRoutes') },
  { path: '/analytics', router: require('./routes/analyticsRoutes') },
  { path: '/wishlist', router: require('./routes/wishlistRoute') },
  { path: '/address', router: require('./routes/addressRoutes') },
  { path: '/follow', router: require('./routes/followRoutes') },
  { path: '/discount', router: require('./routes/discountRoute') },
  { path: '/coupon', router: require('./routes/couponRoutes') },
  { path: '/paymentrequest', router: require('./routes/paymentRequestRoutes') },
  { path: '/creditbalance', router: require('./routes/creditbalanceRoutes') },
  { path: '/history', router: require('./routes/browserHistoryRoutes') },
  {
    path: '/notification-settings',
    router: require('./routes/notificationRoutes'),
  },
  { path: '/search', router: require('./routes/searchRoutes') },
];
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

// 2. Setup Bull Board
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: queues.map((queue) => new BullAdapter(queue)),
  serverAdapter,
});

// 3. Global Middleware Stack
app.use(helmet());

// Determine environment
const isDevelopment = process.env.NODE_ENV === 'development';

// Development CORS settings (more permissive)
const devCorsOptions = {
  origin: true, // Allow all origins in development
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

// Production CORS settings (more restrictive)
const prodCorsOptions = {
  origin: [
    'https://eazworld.com',
    'https://www.eazworld.com',
    'https://api.eazworld.com', // Add your API subdomain if using one
    process.env.FRONTEND_URL,
  ],
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

// Use appropriate CORS configuration based on environment
app.use(cors(isDevelopment ? devCorsOptions : prodCorsOptions));
app.options('*', cors(isDevelopment ? devCorsOptions : prodCorsOptions));

// Development logging
if (isDevelopment) {
  app.use(morgan('dev'));
}

// Rate limiting - only enable in production
if (!isDevelopment) {
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 500, // limit each IP to 500 requests per window
    message: 'Too many requests from this IP, please try again later',
  });
  app.use('/api', limiter);
}

// Body parsers
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());

// Security middleware
app.use(mongoSanitize());
app.use(xss());
app.use(
  hpp({
    whitelist: ['price', 'ratingsAverage', 'ratingsQuantity', 'category'],
  }),
);

// Request timing and security headers
app.use((req, res, next) => {
  req.requestTime = new Date().toISOString();
  next();
});

app.use((req, res, next) => {
  res.setHeader(
    'Strict-Transport-Security',
    'max-age=31536000; includeSubDomains',
  );
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.removeHeader('X-Powered-By');
  next();
});

// 4. Routes
// Bull Board admin route
app.use(
  '/admin/queues',
  (req, res, next) => {
    // Add your authentication middleware here
    // Example: if (!req.user || !req.user.isAdmin) return res.status(403).end();
    next();
  },
  serverAdapter.getRouter(),
);

// API routes
routerConfig.forEach(({ path, router }) => {
  app.use(`/api/v1${path}`, router);
});

// 5. Error handling
app.all('*', (req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server`, 404));
});

app.use(globalErrorHandler);

module.exports = app;
