/**
 * Custom Application Error Class
 * Extends Error with statusCode for HTTP error handling
 */
class AppError extends Error {
  constructor(message, statusCode, fieldErrors = null) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;
    this.fieldErrors = fieldErrors || null;

    Error.captureStackTrace(this, this.constructor);
  }
}
<<<<<<< HEAD

=======
>>>>>>> 6d2bc77 (first ci/cd push)
module.exports = AppError;
