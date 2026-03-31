const logger = require('../utils/logger');

/**
 * Compute algorithmic ranking score for a status.
 * score = (views*0.4) + (likes*0.3) + (commentsCount*0.2) + (shares*0.1)
 * + freshness: (1 / hours_since_upload) * 10
 */
function computeRankingScore(status) {
  const views = Number(status.views) || 0;
  const likes = Number(status.likes) || 0;
  const commentsCount = Number(status.commentsCount) || 0;
  const shares = Number(status.shares) || 0;

  let score =
    views * 0.4 +
    likes * 0.3 +
    commentsCount * 0.2 +
    shares * 0.1;

  const createdAt = status.createdAt ? new Date(status.createdAt) : new Date();
  const hoursSinceUpload = Math.max(0.1, (Date.now() - createdAt.getTime()) / (1000 * 60 * 60));
  score += (1 / hoursSinceUpload) * 10;

  return score;
}

/**
 * Randomize 10% of items by swapping with random positions.
 */
function randomizeTenPercent(items) {
  if (!items || items.length < 2) return items;
  const result = [...items];
  const swapCount = Math.max(1, Math.floor(result.length * 0.1));
  for (let i = 0; i < swapCount; i++) {
    const a = Math.floor(Math.random() * result.length);
    let b = Math.floor(Math.random() * result.length);
    while (b === a) b = Math.floor(Math.random() * result.length);
    [result[a], result[b]] = [result[b], result[a]];
  }
  return result;
}

/**
 * Log served videos for algorithm audit.
 */
function logServedVideos(feed, req) {
  try {
    const statusIds = [];
    for (const group of feed || []) {
      for (const st of group.statuses || []) {
        if (st._id) statusIds.push(st._id.toString());
      }
    }
    if (statusIds.length > 0) {
      logger.info('[StatusFeed] Served videos', {
        count: statusIds.length,
        statusIds: statusIds.slice(0, 20),
        userId: req.user?._id?.toString() || 'anonymous',
      });
    }
  } catch (err) {
    logger.warn('[StatusFeed] Failed to log served videos', err.message);
  }
}

module.exports = {
  computeRankingScore,
  randomizeTenPercent,
  logServedVideos,
};
