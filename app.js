const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const userRouter = require('./routes/userRoutes');
const productRouter = require('./routes/productRoutes');
const reviewRouter = require('./routes/reviewRoutes');
const paymentRouter = require('./routes/paymentRoutes');
const sellerRouter = require('./routes/sellerRoutes');
const orderRouter = require('./routes/orderRoutes');
const categoryRouter = require('./routes/categoryRoutes');
const orderItemRouter = require('./routes/orderItemRoute');
const analyticsRouter = require('./routes/analyticsRoutes');
const paymentMethodRouter = require('./routes/paymentMethodRoutes');
const wishlistRouter = require('./routes/wishlistRoute');
const adminRouter = require('./routes/adminRoutes');
const cartRouter = require('./routes/cartRoutes');
const addressRouter = require('./routes/addressRoutes');
const AppError = require('./utils/appError');
const globalErrorHandler = require('./controllers/errorController');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const hpp = require('hpp');
const cloudinary = require('cloudinary').v2; // Add this
// const jwt = require('jsonwebtoken');

const app = express();
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
  timeout: 120000,
});
app.set('cloudinary', cloudinary);
// app.use(express.static(path.join(__dirname, 'public')));

// GLOBAL middleware
//set security http headers
app.use(
  cors({
    origin: [
      'http://127.0.0.1:4000',
      'http://localhost:4000',
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:5173',
      'http://seller.localhost:5173',
      'http://admin.localhost:5173',
      process.env.FRONTEND_URL, // Add your production frontend URL here
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-User-Role'],
    exposedHeaders: ['Content-Range', 'X-Total-Count'],
  }),
);
app.use(helmet());
//development logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}
// limit request from same api
const limiter = rateLimit({
  max: 900,
  windowMs: 60 * 60 * 1000,
  message: 'Too many request from this IP, please try again in an hour',
});
app.use('/api', limiter);

// //for using req.body
app.use(bodyParser.json());
app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());
app.use(
  express.urlencoded({
    extended: true,
    inflate: true,
    limit: '1mb',
    parameterLimit: 5000,
    type: 'application/x-www-form-urlencoded',
  }),
);
app.use(express.json({ limit: '50mb' }));

//data sanitization against NoSQL query injection
app.use(mongoSanitize());
//data sanitization against XSS
app.use(xss());

//prevent parameter pollution
app.use(
  hpp({
    whitelist: ['price', 'ratingsAverage', 'ratingsQuantity', 'category'],
  }),
);

app.use((req, res, next) => {
  req.requestTime = new Date().toISOString();
  // console.log(req.headers);
  // console.log('cook', req.headers.cookie);
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
// app.get('/api/v1/check-cookie', (req, res) => {
//   const token = jwt.sign(
//     { id: 343322, role: 'admin' },
//     process.env.JWT_SECRET,
//     {
//       expiresIn: '90d',
//     },
//   );

//   const cookieOptions = {
//     httpOnly: true,
//     secure: false, // Temporarily disable for testing
//     sameSite: 'lax',
//     expires: Date.now(new Date() + 90 * 24 * 60 * 60 * 1000), // 90 days
//   };

//   // res.cookie('jwt', token, cookieOptions);
//   res.json({
//     token: token,
//     cookieValue: req.cookies.test,
//     serverTime: new Date(),
//     serverTimeISO: new Date().toISOString(),
//     serverTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
//   });
// });

// //routes middlewares
app.use('/api/v1/admin', adminRouter);
app.use('/api/v1/users', userRouter);
app.use('/api/v1/order', orderRouter);
app.use('/api/v1/review', reviewRouter);
app.use('/api/v1/paymentmethod', paymentMethodRouter);
app.use('/api/v1/payment', paymentRouter);
app.use('/api/v1/seller', sellerRouter);
app.use('/api/v1/product', productRouter);
app.use('/api/v1/categories', categoryRouter);
app.use('/api/v1/orderItem', orderItemRouter);
app.use('/api/v1/cart', cartRouter);
app.use('/api/v1/analytics', analyticsRouter);
app.use('/api/v1/wishlist', wishlistRouter);
app.use('/api/v1/address', addressRouter);

// app.get('/api/debug/routes', (req, res) => {
//   const routes = app._router.stack
//     .filter((layer) => layer.route)
//     .map((layer) => ({
//       path: layer.route.path,
//       methods: Object.keys(layer.route.methods),
//     }));

//   res.json(routes);
// });

//catching all unwanted routes as error
app.all('*', (req, res, next) => {
  const err = new AppError(`Can't find ${req.originalUrl} on this server`, 404);
  next(err);
});

app.use(globalErrorHandler);
module.exports = app;
