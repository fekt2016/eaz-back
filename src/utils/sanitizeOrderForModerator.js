/**
 * Removes refund workflow fields and normalizes refund-related statuses
 * so support agents (orders read-only) never receive refund identifiers or labels.
 *
 * Mutates the plain order object in place.
 * @param {Record<string, unknown>|null|undefined} order
 * @returns {Record<string, unknown>|null|undefined}
 */
const ORDER_REFUND_ROOT_KEYS = [
  'refundRequested',
  'refundRequestDate',
  'refundReason',
  'refundReasonText',
  'refundAmount',
  'refundStatus',
  'refundRejectionReason',
  'refundProcessedAt',
  'refundProcessedBy',
  'refundProcessedByModel',
  'latestRefundRequestId',
];

const ORDER_ITEM_REFUND_KEYS = [
  'refundStatus',
  'refundRequestedQty',
  'refundApprovedQty',
  'refundReason',
  'refundReasonText',
  'refundImages',
  'refundAmount',
  'refundSellerNote',
  'refundAdminNote',
  'refundRequestedAt',
  'refundApprovedAt',
  'refundProcessedBy',
  'refundProcessedByModel',
];

function redactItemRefundFields(item) {
  if (!item || typeof item !== 'object') return;
  for (let i = 0; i < ORDER_ITEM_REFUND_KEYS.length; i += 1) {
    delete item[ORDER_ITEM_REFUND_KEYS[i]];
  }
}

function sanitizeOrderForModerator(order) {
  if (!order || typeof order !== 'object') return order;

  for (let i = 0; i < ORDER_REFUND_ROOT_KEYS.length; i += 1) {
    delete order[ORDER_REFUND_ROOT_KEYS[i]];
  }

  if (order.currentStatus === 'refunded') {
    order.currentStatus = 'cancelled';
  }
  if (order.orderStatus === 'refunded') {
    order.orderStatus = 'cancelled';
  }
  if (order.status === 'refunded') {
    order.status = 'cancelled';
  }

  const ps = String(order.paymentStatus || '').toLowerCase();
  if (ps === 'refunded' || ps === 'partial_refund') {
    order.paymentStatus = 'completed';
  }

  if (Array.isArray(order.trackingHistory)) {
    order.trackingHistory = order.trackingHistory.map((entry) => {
      if (!entry || typeof entry !== 'object') return entry;
      if (entry.status === 'refunded') {
        return {
          ...entry,
          status: 'cancelled',
          message: 'Order closed.',
        };
      }
      return entry;
    });
  }

  if (Array.isArray(order.orderItems)) {
    order.orderItems.forEach(redactItemRefundFields);
  }

  return order;
}

module.exports = sanitizeOrderForModerator;
