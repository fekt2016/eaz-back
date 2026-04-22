const FlashDeal = require('../models/product/dealsModel');
const logger = require('./logger');

const TICK_MS = 60 * 1000;

async function tickFlashDealStatuses() {
  const now = new Date();
  try {
    const scheduledRes = await FlashDeal.updateMany(
      {
        status: 'scheduled',
        startTime: { $lte: now },
        endTime: { $gt: now },
      },
      { $set: { status: 'active' } },
    );

    const activeEndedRes = await FlashDeal.updateMany(
      {
        status: 'active',
        endTime: { $lte: now },
      },
      { $set: { status: 'ended' } },
    );

    await FlashDeal.updateMany(
      {
        status: 'scheduled',
        endTime: { $lte: now },
      },
      { $set: { status: 'ended' } },
    );

    if (
      (scheduledRes.modifiedCount || 0) > 0 ||
      (activeEndedRes.modifiedCount || 0) > 0
    ) {
      logger.info('[flashDealScheduler] Updated flash deal statuses', {
        scheduledToActive: scheduledRes.modifiedCount,
        activeToEnded: activeEndedRes.modifiedCount,
      });
    }
  } catch (err) {
    logger.error('[flashDealScheduler] Tick failed', {
      message: err.message,
    });
  }
}

function startFlashDealScheduler() {
  tickFlashDealStatuses();
  const id = setInterval(tickFlashDealStatuses, TICK_MS);
  return () => clearInterval(id);
}

module.exports = {
  startFlashDealScheduler,
  tickFlashDealStatuses,
};
