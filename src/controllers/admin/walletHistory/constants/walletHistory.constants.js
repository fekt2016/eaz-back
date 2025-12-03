/**
 * Wallet History Constants
 * All magic numbers, default values, and configuration constants
 * for wallet history operations
 */

/**
 * Pagination constants
 */
const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
  MIN_PAGE: 1,
  MIN_LIMIT: 1,
};

/**
 * Sorting constants
 */
const SORTING = {
  DEFAULT_SORT_BY: 'createdAt',
  DEFAULT_SORT_ORDER: 'desc',
  ALLOWED_SORT_FIELDS: ['createdAt', 'amount', 'type', 'updatedAt'],
  SORT_DIRECTIONS: {
    ASC: 'asc',
    DESC: 'desc',
  },
  SORT_VALUES: {
    ASC: 1,
    DESC: -1,
  },
};

/**
 * Transaction type constants
 * Must match the enum values in walletHistoryModel
 */
const TRANSACTION_TYPES = {
  TOPUP: 'TOPUP',
  PAYSTACK_TOPUP: 'PAYSTACK_TOPUP',
  ORDER_DEBIT: 'ORDER_DEBIT',
  REFUND_CREDIT: 'REFUND_CREDIT',
  ADMIN_ADJUST: 'ADMIN_ADJUST',
  TRANSFER: 'TRANSFER',
};

/**
 * All valid transaction types as an array
 */
const VALID_TRANSACTION_TYPES = Object.values(TRANSACTION_TYPES);

/**
 * ObjectId validation constants
 */
const OBJECT_ID = {
  REQUIRED_LENGTH: 24,
};

/**
 * Parameter normalization constants
 */
const NORMALIZATION = {
  NULL_VALUES: ['null', 'undefined', 'NaN', ''],
};

/**
 * Search constants
 */
const SEARCH = {
  USER_SEARCH_LIMIT: 100,
  REGEX_OPTIONS: 'i', // Case-insensitive
};

/**
 * Amount validation constants
 */
const AMOUNT = {
  MIN_VALUE: 0,
};

/**
 * Populate field selections for MongoDB queries
 */
const POPULATE_FIELDS = {
  USER: 'name email phone',
  ORDER: 'orderNumber totalPrice',
  REFUND: 'status totalRefundAmount',
  ADMIN: 'name email',
};

/**
 * MongoDB error types
 */
const MONGO_ERROR_TYPES = {
  CAST_ERROR: 'CastError',
  BSON_TYPE_ERROR: 'BSONTypeError',
};

/**
 * HTTP status codes
 */
const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
};

/**
 * Response status values
 */
const RESPONSE_STATUS = {
  SUCCESS: 'success',
  ERROR: 'error',
};

module.exports = {
  PAGINATION,
  SORTING,
  TRANSACTION_TYPES,
  VALID_TRANSACTION_TYPES,
  OBJECT_ID,
  NORMALIZATION,
  SEARCH,
  AMOUNT,
  POPULATE_FIELDS,
  MONGO_ERROR_TYPES,
  HTTP_STATUS,
  RESPONSE_STATUS,
};

