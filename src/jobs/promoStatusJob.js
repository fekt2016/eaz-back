const logger = require('../utils/logger');
const { syncPromoStatuses } = require('../services/promo/promoService');

const TICK_MS = 60 * 1000;

async function tickPromoStatuses() {
  try {
    const result = await syncPromoStatuses();
    const changed =
      (result.scheduledToActive || 0) +
      (result.activeToEnded || 0) +
      (result.staleScheduledToEnded || 0);

    if (changed > 0) {
      logger.info('[promoStatusJob] Promo statuses updated', result);
    }
  } catch (error) {
    logger.error('[promoStatusJob] Failed to sync promo statuses', {
      message: error.message,
    });
  }
}

function startPromoStatusJob() {
  tickPromoStatuses();
  const timer = setInterval(tickPromoStatuses, TICK_MS);
  return () => clearInterval(timer);
}

module.exports = {
  tickPromoStatuses,
  startPromoStatusJob,
};
