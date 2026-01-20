/**
 * Standard API response helpers
 * NOTE: This is additive and backwards-compatible. Existing fields like `status`
 * and `data` remain unchanged in controllers that already use them.
 */

/**
 * Build a standard success response payload.
 * @param {Object} options
 * @param {string} options.message - Human-readable message for the client.
 * @param {Object} [options.data] - Main response data.
 * @param {Object} [options.meta] - Optional meta information (pagination, etc).
 * @param {string} [options.status] - Optional legacy status ("success" | "fail" | "error").
 */
function buildSuccessResponse({ message, data = {}, meta = null, status = 'success' }) {
  const payload = {
    success: true,
    message: message || 'Request successful',
    data: data,
  };

  // Keep legacy `status` field for backwards compatibility
  if (status) {
    payload.status = status;
  }

  if (meta) {
    payload.meta = meta;
  }

  return payload;
}

/**
 * Build a standard error response payload.
 * @param {Object} options
 * @param {string} options.message - User-friendly error message.
 * @param {number} [options.statusCode] - HTTP status code.
 * @param {string} [options.errorCode] - Optional internal error code.
 * @param {Object} [options.details] - Optional extra details (e.g. field errors).
 * @param {string} [options.status] - Optional legacy status ("fail" | "error").
 */
function buildErrorResponse({ message, statusCode, errorCode = null, details = null, status }) {
  const payload = {
    success: false,
    message: message || 'Unable to process request',
  };

  // Keep legacy `status` field for backwards compatibility
  if (status) {
    payload.status = status;
  }

  if (errorCode) {
    payload.errorCode = errorCode;
  }

  if (details && Object.keys(details).length > 0) {
    payload.details = details;
  }

  // Optionally include statusCode for debugging on client (no stack trace)
  if (process.env.NODE_ENV !== 'production' && statusCode) {
    payload.statusCode = statusCode;
  }

  return payload;
}

module.exports = {
  buildSuccessResponse,
  buildErrorResponse,
};

