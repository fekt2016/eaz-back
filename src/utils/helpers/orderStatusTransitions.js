// Canonical international pre-order flow, mapped to existing tracking statuses
// NOTE: We intentionally reuse 'pending_payment' and 'payment_completed'
// for the initial payment steps to stay compatible with the current system.
const INTERNATIONAL_PREORDER_FLOW = [
  'pending_payment',        // Order placed / awaiting payment
  'payment_completed',      // Payment confirmed
  'supplier_confirmed',     // Supplier has confirmed the order
  'awaiting_dispatch',      // Waiting for supplier to dispatch
  'international_shipped',  // Left supplier country
  'customs_clearance',      // In customs at destination
  'arrived_destination',    // Arrived in destination country/warehouse
  'local_dispatch',         // Handed to local courier
  'out_for_delivery',       // Rider is out for delivery
  'delivered',              // Completed
];

// Statuses that are only valid for international pre-orders
const INTERNATIONAL_ONLY_STATUSES = new Set([
  'supplier_confirmed',
  'awaiting_dispatch',
  'international_shipped',
  'customs_clearance',
  'arrived_destination',
  'local_dispatch',
]);

// Terminal statuses that can be reached from any non-terminal state
const TERMINAL_STATUSES = new Set(['cancelled', 'refunded']);

/**
 * Validate a status transition for an order.
 *
 * For normal + local pre-orders:
 *   - we only prevent use of international-only statuses.
 *
 * For international pre-orders:
 *   - enforce strict, non-skipping forward transitions defined in INTERNATIONAL_PREORDER_FLOW
 *   - allow terminal statuses (cancelled/refunded) from any non-terminal state
 *
 * @param {import('../../models/order/orderModel')} order - Mongoose Order document
 * @param {string} nextStatus - requested new tracking status
 * @param {string} actorRole - req.user.role ('admin' | 'seller' | 'user')
 * @returns {{ allowed: boolean, reason?: string }}
 */
function validateStatusTransition(order, nextStatus, actorRole) {
  const orderType = order.orderType || 'normal';
  const currentStatus = order.currentStatus || 'pending_payment';

  // Never allow international-only statuses on normal or local pre-orders
  if ((orderType === 'normal' || orderType === 'preorder_local') && INTERNATIONAL_ONLY_STATUSES.has(nextStatus)) {
    return {
      allowed: false,
      reason: 'International pre-order statuses are not allowed for this order type.',
    };
  }

  // Short‑circuit: allow staying on same status (idempotent calls)
  if (nextStatus === currentStatus) {
    return { allowed: true };
  }

  // International pre-order strict flow
  if (orderType === 'preorder_international') {
    // Terminal statuses are always allowed (cancellation / refund)
    if (TERMINAL_STATUSES.has(nextStatus)) {
      return { allowed: true };
    }

    const currentIndex = INTERNATIONAL_PREORDER_FLOW.indexOf(currentStatus);
    const nextIndex = INTERNATIONAL_PREORDER_FLOW.indexOf(nextStatus);

    // If either status isn't part of the flow, reject
    if (nextIndex === -1) {
      return {
        allowed: false,
        reason: `Status "${nextStatus}" is not valid for international pre-orders.`,
      };
    }

    // When creating/upgrading legacy orders, allow starting the chain at the first step
    if (currentIndex === -1) {
      const isFirstStep = nextStatus === INTERNATIONAL_PREORDER_FLOW[0];
      return isFirstStep
        ? { allowed: true }
        : {
            allowed: false,
            reason: `International pre-orders must start at "${INTERNATIONAL_PREORDER_FLOW[0]}".`,
          };
    }

    // Enforce "no skipping" – must move to immediate next step only
    if (nextIndex === currentIndex + 1) {
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: `Invalid status transition for international pre-order: "${currentStatus}" → "${nextStatus}" is not allowed.`,
    };
  }

  // For all other order types, we do not enforce a strict flow here.
  // Existing business logic remains unchanged, aside from blocking
  // international-only statuses above.
  return { allowed: true };
}

/**
 * Map a request.user.role to the trackingHistory.updatedByRole value.
 */
function mapRoleToUpdatedByRole(role) {
  if (role === 'seller') return 'seller';
  if (role === 'admin' || role === 'superadmin' || role === 'moderator') return 'admin';
  return 'system';
}

module.exports = {
  INTERNATIONAL_PREORDER_FLOW,
  INTERNATIONAL_ONLY_STATUSES,
  TERMINAL_STATUSES,
  validateStatusTransition,
  mapRoleToUpdatedByRole,
};

