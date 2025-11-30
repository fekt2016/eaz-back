const jwt = require('jsonwebtoken');

const signToken = (id, role) => {
  // Default to 90 days if JWT_EXPIRES_IN is not set
  const expiresIn = process.env.JWT_EXPIRES_IN || '90d';
  return jwt.sign({ id: id, role: role }, process.env.JWT_SECRET, {
    expiresIn: expiresIn,
  });
};

exports.createSendToken = (user, statusCode, res, redirectTo = null, cookieName = 'jwt') => {
  const token = signToken(user._id, user.role);
  const isProduction = process.env.NODE_ENV === 'production';
  
  const cookieOptions = {
    httpOnly: true,
    secure: isProduction, // true in production, false in development
    sameSite: isProduction ? 'none' : 'lax', // 'none' for cross-site in production, 'lax' for same-site in dev
    path: '/', // Available on all paths
      expires: new Date(
        Date.now() +
          (process.env.JWT_COOKIE_EXPIRES_IN || 90) * 24 * 60 * 60 * 1000, // 90 days default
      ),
    // Set domain for production to allow cookie sharing across subdomains
    // Only set in production, leave undefined in development (localhost)
    ...(isProduction && process.env.COOKIE_DOMAIN && { domain: process.env.COOKIE_DOMAIN }),
  };

  res.cookie(cookieName, token, cookieOptions);

  user.password = undefined;

  const response = {
    status: 'success',
    token,
    data: {
      user,
    },
  };

  // Add redirectTo if provided
  if (redirectTo) {
    response.redirectTo = redirectTo;
  }

  res.status(statusCode).json(response);
};
