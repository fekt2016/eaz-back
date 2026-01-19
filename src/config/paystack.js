/**
 * Paystack Configuration
 * Handles Paystack API configuration and base setup
 */

const axios = require('axios');
const logger = require('../utils/logger');

// Get Paystack secret key from environment
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || process.env.PAYSTACK_SECRET;

if (!PAYSTACK_SECRET_KEY) {
  logger.warn('[Paystack Config] PAYSTACK_SECRET_KEY not found in environment variables');
}

// Paystack API base URL
const PAYSTACK_BASE_URL = 'https://api.paystack.co';

/**
 * Create axios instance for Paystack API
 */
const paystackApi = axios.create({
  baseURL: PAYSTACK_BASE_URL,
  headers: {
    Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json',
  },
  timeout: 30000, // 30 seconds
});

/**
 * Paystack API endpoints
 */
const PAYSTACK_ENDPOINTS = {
  CREATE_RECIPIENT: '/transferrecipient',
  INITIATE_TRANSFER: '/transfer',
  GET_TRANSFER: '/transfer',
  VERIFY_TRANSFER: '/transfer/verify',
  FINALIZE_TRANSFER: '/transfer/finalize_transfer',
  LIST_TRANSFERS: '/transfer',
  LIST_BANKS: '/bank',
  RESOLVE_BANK: '/bank/resolve',
};

module.exports = {
  paystackApi,
  PAYSTACK_ENDPOINTS,
  PAYSTACK_SECRET_KEY,
  PAYSTACK_BASE_URL,
};

