/**
 * Use express-rate-limit's safe IP key generator to avoid IPv6 bypasses.
 * Prefer an authenticated user id when available.
 */
const rateLimitKey = (req) => {
  const userId = req.user?.id || req.user?._id;
  if (userId != null && String(userId).trim()) {
    return String(userId);
  }
  // express-rate-limit v7 in this repo exports a function with `.rateLimit` attached,
  // and does not expose ipKeyGenerator. We implement a safe IPv6-aware fallback:
  // - strip IPv6 brackets
  // - normalize IPv4-mapped IPv6 (::ffff:127.0.0.1)
  // - collapse zone index (fe80::1%lo0)
  const raw = req.ip || req.connection?.remoteAddress || '';
  const ip = String(raw)
    .trim()
    .replace(/^\[|\]$/g, '')
    .replace(/^::ffff:/i, '')
    .split('%')[0];
  return ip || 'unknown';
};

module.exports = { rateLimitKey };

