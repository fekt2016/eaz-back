const { promisify } = require('util');
const User = require('../Models/userModel');
const Admin = require('../Models/adminModel');
const Seller = require('../Models/sellerModel');
const catchasync = require('../utils/catchAsync');
const jwt = require('jsonwebtoken');
const AppError = require('../utils/appError');
const sendEmail = require('../utils/email');
const crypto = require('crypto');
const { createSendToken } = require('../utils/createSendToken');
// const TokenBlacklist = require('../Models/tokenBlacklistSchema');
const TokenBlacklist = require('../Models/tokenBlackListModal');
const { Router } = require('express');
// Public GET routes (no authentication required)
const API_BASE_PATH = process.env.API_BASE_PATH;

const publicRoutes = [
  '/api/v1/product',
  '/api/v1/product/*',
  // Add other public GET routes here
  'api/v1/product/category-counts',
];
const FULLY_PROTECTED_ROUTES = [
  // Order-related
  '/order/seller-order',
  '/order',
  '/orderItem',
  '/address',

  // Admin
  '/admin',
  '/cart/item/',
  '/cart/item/*',
  '/cart',

  // Analytics
  '/analytics',
  '/analytics/sellers', // Covers all seller analytics routes
  '/analytics/sellers/*', // Wildcard for any seller analytics sub-routes
  '/analytics/views',

  // User management
  '/users',
  '/account',

  // Content
  '/review',
  '/product/seller',
  '/product',
  '/categories',

  // Transactions
  '/paymentmethod',
  '/payment',

  // Authentication
  '/auth/me',
  '/auth/verify',

  // Seller
  '/seller',
  '/wishlist',
  // Shopping

  // Special patterns
  '/sellers/*/views', // Matches /sellers/:sellerId/views
];

exports.signup = catchasync(async (req, res, next) => {
  const newUser = await User.create({
    name: req.body.name,
    email: req.body.email,
    password: req.body.password,
    passwordConfirm: req.body.passwordConfirm,
    passwordChangedAt: req.body.passwordChangedAt,
  });

  createSendToken(newUser, 201, res);
});

exports.login = catchasync(async (req, res, next) => {
  const { email, password } = req.body;

  // 1) Check if email and password exist
  if (!email || !password) {
    next(new Appp('Please provide email and password', 400));
  }

  //2) Check if user exist & password is correct
  const user = await User.findOne({ email }).select('+password');

  if (!user || !(await user.correctPassword(password, user.password))) {
    return next(new AppError('Incorrect email or password', 401));
  }
  //3) if everything ok, send token to client
  user.lastLogin = Date.now();

  createSendToken(user, 200, res);
});
exports.logout = catchasync(async (req, res, next) => {
  res.cookie('jwt', 'loggedout', {
    expires: new Date(Date.now() + 10 * 1000),
    httpOnly: true,
  });
  res.status(200).json({ status: 'success' });
});
exports.protect = catchasync(async (req, res, next) => {
  // 1. Declare token variable
  let token;

  // 2. Extract token from headers
  if (req.headers.authorization?.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  // 3. Use original URL for accurate path handling
  const API_BASE_PATH = '/api/v1';
  let fullPath = req.originalUrl.split('?')[0]; // Remove query parameters

  // 4. Remove base API path
  if (fullPath.startsWith(API_BASE_PATH)) {
    fullPath = fullPath.substring(API_BASE_PATH.length);
  }

  // 5. Normalize path (ensure leading slash, remove trailing slash)
  if (!fullPath.startsWith('/')) fullPath = '/' + fullPath;
  fullPath = fullPath.replace(/\/$/, '') || '/';

  // 8. Check for product detail routes
  let isPublicGet = false;

  // Handle product detail routes (/product/123)
  if (fullPath.startsWith('/product/')) {
    const pathSegments = fullPath.split('/');
    if (pathSegments.length === 3) {
      const productId = pathSegments[2];

      // Validate ID format
      const isValidId =
        /^[a-f\d]{24}$/i.test(productId) || // MongoDB ID
        /^\d+$/.test(productId) || // Numeric ID
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          productId,
        ); // UUID

      if (isValidId) {
        isPublicGet = true;
        console.log(`Valid product ID detected: ${productId}`);
      }
    }
  }

  // 9. Check exact matches for other public routes
  if (!isPublicGet) {
    isPublicGet = publicRoutes.includes(fullPath) && req.method === 'GET';
  }

  console.log(`Is Public GET Route: ${isPublicGet}`);

  // 10. Allow public GET access
  if (isPublicGet) {
    console.log(`Allowing public access to ${fullPath}`);
    return next();
  }

  // 11. Handle protected routes
  if (!token) {
    console.log('No token found for protected route');
    return next(
      new AppError('You are not logged in! Please log in to get access.', 401),
    );
  }

  console.log('Token found:', token.substring(0, 10) + '...');

  // 12. Check token blacklist
  const blacklisted = await TokenBlacklist.findOne({ token });
  if (blacklisted) {
    console.log('Token is blacklisted');
    return next(
      new AppError('Your session has expired. Please log in again.', 401),
    );
  }

  // 13. Verify token
  let decoded;
  try {
    decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);
    console.log('Token verified successfully');
  } catch (err) {
    if (
      err.name === 'TokenExpiredError' &&
      req.originalUrl.includes('/logout')
    ) {
      console.log('Using expired token for logout');
      decoded = jwt.decode(token);
    } else {
      console.error('Token verification failed:', err.message);
      return next(new AppError('Session expired', 401));
    }
  }

  // 14. Find user based on token role
  let currentUser;
  const userModel = {
    user: User,
    admin: Admin,
    seller: Seller,
  }[decoded.role];

  if (userModel) {
    currentUser = await userModel.findById(decoded.id);
  }

  if (!currentUser) {
    console.log('User not found for token');
    return next(
      new AppError('The user belonging to this token no longer exists', 401),
    );
  }

  // 15. Check if password changed after token was issued
  if (currentUser.changedPasswordAfter(decoded.iat)) {
    console.log('Password changed after token issued');
    return next(
      new AppError('User recently changed password! Please log in again', 401),
    );
  }

  // 16. Attach user to request
  req.user = currentUser;
  console.log(`Authenticated as ${currentUser.role}: ${currentUser.email}`);
  next();
});
// exports.protect = catchasync(async (req, res, next) => {
//   // 1. Declare token variable at the top
//   let token;

//   // 2. Extract token FIRST if it exists
//   if (
//     req.headers.authorization &&
//     req.headers.authorization.startsWith('Bearer')
//   ) {
//     token = req.headers.authorization.split(' ')[1];
//   }

//   // 3. Check if this is a public GET route
//   const isPublicGet = PUBLIC_GET_ROUTES.some((route) => {
//     const pattern = route.replace(/\*/g, '.*');
//     const regex = new RegExp(`^${pattern}$`);
//     console.log('reg', regex);

//     return regex.test(req.path) && req.method === 'GET';
//   });
//   console.log('public', isPublicGet);

//   // 4. Allow public GET access - no token needed
//   if (isPublicGet) {
//     return next();
//   }

//   // 5. Check if token exists for protected routes
//   if (!token) {
//     return next(
//       new AppError('You are not logged in! Please log in to get access.', 401),
//     );
//   }

//   console.log('sent token', token);

//   // 6. Check token blacklist
//   const blacklisted = await TokenBlacklist.findOne({ token });
//   if (blacklisted) {
//     return next(
//       new AppError('Your session has expired. Please log in again.', 401),
//     );
//   }

//   // 7. Verify token
//   let decoded;
//   try {
//     decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);
//   } catch (err) {
//     // Allow expired tokens ONLY for logout route
//     if (
//       err.name === 'TokenExpiredError' &&
//       req.originalUrl.includes('/logout')
//     ) {
//       decoded = jwt.decode(token); // Get payload without verification
//     } else {
//       return next(new AppError('Session expired', 401));
//     }
//   }

//   // 8. Check if user still exists
//   let currentUser;
//   if (decoded.role === 'user') {
//     currentUser = await User.findById(decoded.id);
//   } else if (decoded.role === 'admin') {
//     currentUser = await Admin.findById(decoded.id);
//   } else if (decoded.role === 'seller') {
//     currentUser = await Seller.findById(decoded.id);
//   }

//   if (!currentUser) {
//     return next(
//       new AppError(
//         'The user belonging to this token does no longer exist',
//         401,
//       ),
//     );
//   }

//   // 9. Check if user changed password after token was issued
//   if (currentUser.changedPasswordAfter(decoded.iat)) {
//     return next(
//       new AppError('User recently changed password! Please log in again', 401),
//     );
//   }

//   // 10. GRANT ACCESS TO PROTECTED ROUTE
//   req.user = currentUser;
//   next();
// });

// exports.protect = catchasync(async (req, res, next) => {
//   let token;
//   if (
//     req.headers.authorization &&
//     req.headers.authorization.startsWith('Bearer')
//   ) {
//     token = req.headers.authorization.split(' ')[1];
//   }
//   // Check if this is a public GET route
//   const isPublicGet = PUBLIC_GET_ROUTES.some((route) => {
//     const pattern = route.replace(/\*/g, '.*');
//     const regex = new RegExp(`^${pattern}$`);
//     return regex.test(req.path) && req.method === 'GET';
//   });

//   // Allow public GET access
//   if (isPublicGet) {
//     return next();
//   }
//   if (!token) {
//     return next(
//       new AppError('You are not logged in! Please log in to get access.', 401),
//     );
//   }
//   console.log('sent token', token);
//   if (token) {
//     const blacklisted = await TokenBlacklist.findOne({ token });
//     if (blacklisted) {
//       return next(
//         new AppError('Your session has expired. Please log in again.', 401),
//       );
//     }
//   }
//   // Check if this is a protected route
//   const isProtected = FULLY_PROTECTED_ROUTES.some((route) => {
//     const pattern = route.replace(/\*/g, '.*');
//     const regex = new RegExp(`^${pattern}$`);
//     return regex.test(req.path);
//   });
//   if (isProtected && !req.user) {
//     return res.status(401).json({ message: 'Not authorized' });
//   }

//   let decoded;
//   try {
//     // Verify token
//     decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);
//   } catch (err) {
//     // Allow expired tokens ONLY for logout route
//     if (
//       err.name === 'TokenExpiredError' &&
//       req.originalUrl.includes('/logout')
//     ) {
//       decoded = jwt.decode(token); // Get payload without verification
//     } else {
//       return next(new AppError('Session expired', 401));
//     }
//   }

//   // 3) Check if user still exists
//   let currentUser;
//   if (decoded.role === 'user') {
//     currentUser = await User.findById(decoded.id);
//   } else if (decoded.role === 'admin') {
//     currentUser = await Admin.findById(decoded.id);
//   } else if (decoded.role === 'seller') {
//     currentUser = await Seller.findById(decoded.id);
//   }

//   if (!currentUser) {
//     return next(
//       new AppError(
//         'The user belonging to this token does no longer exist',
//         401,
//       ),
//     );
//   }

//   if (currentUser.changedPasswordAfter(decoded.iat)) {
//     return next(
//       new AppError('User recently changed password!, Please log in again', 401),
//     );
//   }

//   // GRANT ACCESS TO PROTECTED ROUTE
//   req.user = currentUser;
//   next();
// });
// exports.protect = catchasync(async (req, res, next) => {
//   // 1. Declare token variable
//   let token;
//   console.log('url', req.path);
//   // 2. Extract token from headers
//   if (req.headers.authorization?.startsWith('Bearer')) {
//     token = req.headers.authorization.split(' ')[1];
//   }

//   // 3. Normalize request path
//   let fullPath = req.originalUrl.split('?')[0]; // Remove query parameters

//   if (fullPath.startsWith(API_BASE_PATH)) {
//     fullPath = fullPath.substring(API_BASE_PATH.length);
//   }

//   // 5. Normalize path (ensure leading slash, remove trailing slash)
//   if (!fullPath.startsWith('/')) fullPath = '/' + fullPath;
//   fullPath = fullPath.replace(/\/$/, '') || '/';

//   // 6. Debug logging
//   console.log('\n--- REQUEST DETAILS ---');
//   console.log(`Method: ${req.method}`);
//   console.log(`Original URL: ${req.originalUrl}`);
//   console.log(`Base URL: ${req.baseUrl}`);
//   console.log(`Request Path: ${req.path}`);
//   console.log(`Full Path: ${fullPath}`);
//   console.log(`Token Present: ${!!token}`);
//   // Remove API base path
//   // if (API_BASE_PATH && requestPath.startsWith(API_BASE_PATH)) {
//   //   requestPath = requestPath.substring(API_BASE_PATH.length);
//   // }

//   // // Ensure consistent formatting
//   // requestPath = requestPath.replace(/\/$/, '') || '/'; // Remove trailing slashes
//   // if (!requestPath.startsWith('/')) requestPath = '/' + requestPath; // Add leading slash

//   // 4. Debug logging
//   // console.log('\n--- NEW REQUEST ---');
//   // console.log(`Method: ${req.method}`);
//   // console.log(`Original URL: ${req.originalUrl}`);
//   // console.log(`Path: ${req.path}`);
//   // console.log(`Normalized Path: ${requestPath}`);
//   // console.log(`Token Present: ${!!token}`);

//   // 5. Check if this is a public GET route
//   let isPublicGet = false;
//   console.log('Public GET ROUTES', PUBLIC_GET_ROUTES);
//   for (const route of PUBLIC_GET_ROUTES) {
//     try {
//       // Convert route pattern to regex
//       const pattern = route.startsWith('^')
//         ? route
//         : `^${route.replace(/\*/g, '[^\\/]+')}$`;
//       console.log('pattern', pattern);

//       const regex = new RegExp(pattern);
//       console.log('regex', regex);
//       const matches = regex.test(requestPath) && req.method === 'GET';
//       if (matches) console.log(`Matched public route: ${route}`);
//       return matches;
//     } catch (err) {
//       console.error(`Error in route pattern: ${route}`, err);
//     }
//   }

//   // Only allow GET requests for public routes
//   isPublicGet = isPublicGet && req.method === 'GET';

//   console.log(`Is Public GET Route: ${isPublicGet}`);

//   // 6. Allow public GET access
//   if (isPublicGet) return next();

//   // 7. Check if token exists for protected routes
//   // if (!token) {
//   //   console.log('No token found for protected route');
//   //   return next(
//   //     new AppError('You are not logged in! Please log in to get access.', 401),
//   //   );
//   // }

//   console.log('Token found:', token.substring(0, 10) + '...');

//   // 8. Check token blacklist
//   const blacklisted = await TokenBlacklist.findOne({ token });
//   if (blacklisted) {
//     console.log('Token is blacklisted');
//     return next(
//       new AppError('Your session has expired. Please log in again.', 401),
//     );
//   }

//   // 9. Verify token
//   let decoded;
//   try {
//     decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);
//     console.log('Token verified successfully');
//   } catch (err) {
//     // Handle token expiration specifically for logout route
//     if (
//       err.name === 'TokenExpiredError' &&
//       req.originalUrl.includes('/logout')
//     ) {
//       console.log('Using expired token for logout');
//       decoded = jwt.decode(token);
//     } else {
//       console.error('Token verification failed:', err.message);
//       return next(new AppError('Session expired', 401));
//     }
//   }

//   // 10. Check if user still exists
//   let currentUser;
//   if (decoded.role === 'user') {
//     currentUser = await User.findById(decoded.id);
//   } else if (decoded.role === 'admin') {
//     currentUser = await Admin.findById(decoded.id);
//   } else if (decoded.role === 'seller') {
//     currentUser = await Seller.findById(decoded.id);
//   }

//   if (!currentUser) {
//     console.log('User not found for token');
//     return next(
//       new AppError('The user belonging to this token no longer exists', 401),
//     );
//   }

//   // 11. Check password change timestamp
//   if (currentUser.changedPasswordAfter(decoded.iat)) {
//     console.log('Password changed after token issued');
//     return next(
//       new AppError('User recently changed password! Please log in again', 401),
//     );
//   }

//   // 12. Attach user to request
//   req.user = currentUser;
//   console.log(`Authenticated as ${currentUser.role}: ${currentUser.email}`);
//   next();
// });
exports.restrictTo = (...roles) => {
  return (req, res, next) => {
    // Check if user exists and has a role
    if (!req.user?.role) {
      return next(
        new AppError('User authentication failed. Please log in again.', 401),
      );
    }

    // Check role permissions
    // console.log('Checking roles:', roles);
    console.log(roles, 'includes', req.user.role);
    // console.log(roles.includes(req.user.role));
    if (!roles.includes(req.user.role)) {
      return next(
        new AppError('You do not have permission to perform this action', 403),
      );
    }

    next();
  };
};
exports.forgotPassword = async (req, res, next) => {
  //1)  Get user based on POSTed email
  const user = await User.findOne({ email: req.body.email });

  if (!user) {
    return next(new AppError('There is no user with email address', 404));
  }

  // 2) Generate the random reset token
  const resetToken = user.createPasswordResetToken();

  await user.save({ validateBeforeSave: false });

  //3) Sendit to user's email
  const resetURL = `${req.protocol}://${req.get('host')}/api/v1/users/resetPassword/${resetToken}`;

  const message = `Forget your password? Submit a PATCH  request with your new password  and passwordConfirm to: ${resetURL}.\nIf you didn't forget your password,please ignore this email!`;
  try {
    await sendEmail({
      email: user.email,
      subject: 'Your password reset token (valid for 10min)',
      message,
    });
    res.status(200).json({
      status: 'success',
      message: 'Token sent to mail',
    });
  } catch (err) {
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;

    await user.save({ validateBeforeSave: false });

    next(
      new AppError(
        'There was an error sending the email. Try again later',
        404,
      ),
    );
  }
};
exports.resetPassword = catchasync(async (req, res, next) => {
  // 1) Get user based on the token

  const hashedToken = crypto
    .createHash('sha256')
    .update(req.params.token)
    .digest('hex');
  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() },
  });

  // 2) If token has not expired, and there is user, set the new password

  user.password = req.body.password;
  user.passwordConfirm = req.body.passwordConfirm;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  await user.save();
  // 3) Update changedPasswordAt property for the user

  // 4) Log the user in, send JWT

  createSendToken(user, 200, res);
});

exports.updatePassword = catchasync(async (req, res, next) => {
  //Get user from collection
  const user = await User.findById(req.user.id).select('+password');

  //2) check if POSTed current password is correct
  if (!(awaituser, correctPassword(req.body.passwordCurrent, user.password))) {
    return next(new AppError('Your current password is wrong', 401));
  }
  //3) if so, update password
  user.password = req.body.password;
  user.passwordConfirm = req.body.passwordConfirm;

  //4) log user in send jwt

  createSendToken(user, 200, res);
});
