const catchAsync = require('../../utils/helpers/catchAsync');
const Status = require('../../models/status/statusModel');
const StatusView = require('../../models/status/statusViewModel');
const Follow = require('../../models/user/followModel');
const { computeRankingScore, randomizeTenPercent, logServedVideos } = require('../../services/statusRankingService');
const Order = require('../../models/order/orderModel');
const SellerOrder = require('../../models/order/sellerOrderModel');
const BrowserHistory = require('../../models/user/browserHistoryModel');
const Product = require('../../models/product/productModel');
const Address = require('../../models/user/addressModel');
const Seller = require('../../models/user/sellerModel');

/** Normalize region for comparison (Address: lowercase, Seller: capitalized) */
const normalizeRegion = (r) => (r ? String(r).toLowerCase().trim() : '');

/**
 * Build Cloudinary thumbnail URL from a video URL (first frame as JPG).
 * @param {string} videoUrl - Cloudinary video secure_url
 * @returns {string} Thumbnail URL or empty string if not Cloudinary
 */
function getVideoThumbnailUrl(videoUrl) {
  if (!videoUrl || typeof videoUrl !== 'string') return '';
  if (!videoUrl.includes('res.cloudinary.com') || !videoUrl.includes('/video/upload/')) return '';
  const asJpg = videoUrl.split('?')[0].replace(/\.(mp4|webm|mov|avi)$/i, '.jpg');
  if (asJpg === videoUrl.split('?')[0]) return '';
  const uploadIdx = asJpg.indexOf('/upload/');
  if (uploadIdx === -1) return '';
  const afterUpload = uploadIdx + '/upload/'.length;
  const rest = asJpg.slice(afterUpload);
  if (rest.startsWith('so_')) return asJpg;
  return asJpg.slice(0, afterUpload) + 'so_0,f_jpg/' + rest;
}

/**
 * GET /api/v1/statuses
 * Get status feed for buyers (all status videos, grouped by seller).
 * No filters - returns all statuses. Public endpoint.
 * When authenticated: personalized sort, viewedByMe, hasUnseen, deprioritize all-viewed (Phase 1–6).
 */
exports.getStatusFeed = catchAsync(async (req, res) => {
  const rawStatuses = await Status.find({})
    .populate({
      path: 'seller',
      select: 'name shopName avatar isVerified',
    })
    .populate({
      path: 'product',
      select: 'name imageCover slug price parentCategory subCategory',
    })
    .lean();

  const validStatuses = rawStatuses.filter((s) => s.seller != null);

  const withScores = validStatuses.map((s) => ({
    ...s,
    _rankingScore: computeRankingScore(s),
  }));
  withScores.sort((a, b) => (b._rankingScore || 0) - (a._rankingScore || 0));
  const randomized = randomizeTenPercent(withScores);
  const statuses = randomized.slice(0, 200);

  // Group by seller; track product categories per seller for Phase 5 scoring
  const sellerCategoryIds = new Map();
  const groupMap = new Map();
  for (const s of validStatuses) {
    const sellerId = s.seller._id.toString();
    if (!groupMap.has(sellerId)) {
      groupMap.set(sellerId, {
        seller: {
          _id: s.seller._id,
          id: s.seller._id,
          name: s.seller.name || s.seller.shopName,
          shopName: s.seller.shopName || s.seller.name,
          avatar: s.seller.avatar || '',
          isVerified: Boolean(s.seller.isVerified),
        },
        statuses: [],
        hasUnseen: true,
      });
    }
    const group = groupMap.get(sellerId);
    if (s.product?.parentCategory || s.product?.subCategory) {
      const ids = sellerCategoryIds.get(sellerId) || new Set();
      if (s.product.parentCategory) ids.add(s.product.parentCategory.toString());
      if (s.product.subCategory) ids.add(s.product.subCategory.toString());
      sellerCategoryIds.set(sellerId, ids);
    }
    const views = Math.max(0, Number(s.views) || 0);
    const productImage =
      s.product?.imageCover ||
      (Array.isArray(s.product?.images) && s.product.images[0]) ||
      '';
    const thumbnailUrl =
      productImage || getVideoThumbnailUrl(s.video) || '';
    group.statuses.push({
      _id: s._id,
      seller: group.seller,
      videoUrl: s.video,
      thumbnailUrl,
      caption: s.caption || '',
      duration: 0,
      product: s.product
        ? {
            _id: s.product._id,
            name: s.product.name,
            price: s.product.price,
            images: s.product.imageCover ? [s.product.imageCover] : [],
            slug: s.product.slug,
          }
        : null,
      viewCount: views,
      views,
      viewedByMe: false,
      expiresAt: s.expiresAt,
      createdAt: s.createdAt,
    });
  }

  let feed = Array.from(groupMap.values());

  const nowBuyer = new Date();
  feed = feed
    .map((g) => ({
      ...g,
      statuses: (g.statuses || []).filter((st) => {
        const v = st.videoUrl;
        if (typeof v !== 'string' || !v.trim()) return false;
        if (st.expiresAt && new Date(st.expiresAt) <= nowBuyer) return false;
        return true;
      }),
    }))
    .filter((g) => (g.statuses || []).length > 0);

  const statusIdsInFeed = validStatuses.map((s) => s._id);

  // Phase 1–6: When authenticated, personalize and set viewedByMe
  if (req.user && req.user._id) {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const sellerIdsInFeed = feed.map((g) => g.seller._id);
    const [followedIds, purchasedIds, viewedIds, userRegion, sellerRegions, viewedCategoryIds, viewedStatusIds] =
      await Promise.all([
        Follow.find({ user: req.user._id }).distinct('seller'),
        (async () => {
          const orders = await Order.find({
            user: req.user._id,
            createdAt: { $gte: ninetyDaysAgo },
          })
            .select('sellerOrder')
            .limit(300)
            .lean();
          const soIds = orders.flatMap((o) => o.sellerOrder || []).filter(Boolean);
          if (soIds.length === 0) return [];
          const sos = await SellerOrder.find({ _id: { $in: soIds } })
            .select('seller')
            .lean();
          return [...new Set(sos.map((s) => s.seller?.toString()).filter(Boolean))];
        })(),
        (async () => {
          const history = await BrowserHistory.find({
            user: req.user._id,
            type: { $in: ['product', 'seller'] },
            viewedAt: { $gte: sevenDaysAgo },
          })
            .select('type itemId')
            .limit(500)
            .lean();
          const sellerIds = new Set();
          const productIds = [];
          for (const h of history) {
            if (h.type === 'seller' && h.itemId) {
              sellerIds.add(h.itemId.toString());
            } else if (h.type === 'product' && h.itemId) {
              productIds.push(h.itemId);
            }
          }
          if (productIds.length > 0) {
            const products = await Product.find({ _id: { $in: productIds } })
              .select('seller')
              .lean();
            products.forEach((p) => {
              if (p.seller) sellerIds.add(p.seller.toString());
            });
          }
          return [...sellerIds];
        })(),
        (async () => {
          const addr = await Address.findOne({ user: req.user._id })
            .sort({ isDefault: -1 })
            .select('region')
            .lean();
          return normalizeRegion(addr?.region);
        })(),
        (async () => {
          if (sellerIdsInFeed.length === 0) return new Map();
          const sellers = await Seller.find({ _id: { $in: sellerIdsInFeed } })
            .select('shopLocation pickupLocations')
            .lean();
          const map = new Map();
          for (const s of sellers) {
            const regions = new Set();
            if (s.shopLocation?.region) {
              regions.add(normalizeRegion(s.shopLocation.region));
            }
            (s.pickupLocations || []).forEach((pl) => {
              if (pl.region) regions.add(normalizeRegion(pl.region));
            });
            map.set(s._id.toString(), regions);
          }
          return map;
        })(),
        (async () => {
          const history = await BrowserHistory.find({
            user: req.user._id,
            type: 'product',
            viewedAt: { $gte: sevenDaysAgo },
          })
            .select('itemId')
            .limit(300)
            .lean();
          const productIds = history.map((h) => h.itemId).filter(Boolean);
          if (productIds.length === 0) return new Set();
          const products = await Product.find({ _id: { $in: productIds } })
            .select('parentCategory subCategory')
            .lean();
          const ids = new Set();
          products.forEach((p) => {
            if (p.parentCategory) ids.add(p.parentCategory.toString());
            if (p.subCategory) ids.add(p.subCategory.toString());
          });
          return ids;
        })(),
        (async () => {
          if (statusIdsInFeed.length === 0) return new Set();
          const views = await StatusView.find({
            user: req.user._id,
            status: { $in: statusIdsInFeed },
          })
            .select('status')
            .lean();
          return new Set(views.map((v) => v.status.toString()));
        })(),
      ]);
    const followedSet = new Set(followedIds.map((id) => id.toString()));
    const purchasedSet = new Set(purchasedIds);
    const viewedSet = new Set(viewedIds);
    for (const group of feed) {
      for (const st of group.statuses || []) {
        st.viewedByMe = viewedStatusIds.has(st._id.toString());
      }
      group.hasUnseen = (group.statuses || []).some((st) => !st.viewedByMe);
    }
    const hasCategoryMatch = (sellerId) => {
      const sellerCats = sellerCategoryIds.get(sellerId);
      if (!sellerCats || sellerCats.size === 0) return false;
      for (const cid of sellerCats) {
        if (viewedCategoryIds.has(cid)) return true;
      }
      return false;
    };
    feed.sort((a, b) => {
      const aId = a.seller._id.toString();
      const bId = b.seller._id.toString();
      const aInRegion =
        userRegion && sellerRegions.get(aId)?.has(userRegion);
      const bInRegion =
        userRegion && sellerRegions.get(bId)?.has(userRegion);
      const aCategory = hasCategoryMatch(aId);
      const bCategory = hasCategoryMatch(bId);
      const aScore =
        (followedSet.has(aId) ? 32 : 0) +
        (viewedSet.has(aId) ? 16 : 0) +
        (purchasedSet.has(aId) ? 8 : 0) +
        (aInRegion ? 4 : 0) +
        (aCategory ? 2 : 0);
      const bScore =
        (followedSet.has(bId) ? 32 : 0) +
        (viewedSet.has(bId) ? 16 : 0) +
        (purchasedSet.has(bId) ? 8 : 0) +
        (bInRegion ? 4 : 0) +
        (bCategory ? 2 : 0);
      if (aScore !== bScore) return bScore - aScore;
      return (b.hasUnseen ? 1 : 0) - (a.hasUnseen ? 1 : 0);
    });
  }

  logServedVideos(feed, req);

  res.status(200).json({
    status: 'success',
    data: feed,
  });
});

/**
 * GET /api/v1/statuses/seller/:sellerId
 * Get all status videos for one seller (for buyer viewing on seller profile).
 * Returns one group: { seller, statuses } in same shape as feed.
 */
exports.getStatusesBySeller = catchAsync(async (req, res) => {
  const { sellerId } = req.params;
  if (!sellerId) {
    return res.status(400).json({ status: 'fail', message: 'Seller ID required' });
  }
  const mongoose = require('mongoose');
  if (!mongoose.Types.ObjectId.isValid(sellerId)) {
    return res.status(400).json({ status: 'fail', message: 'Invalid seller ID' });
  }

  const now = new Date();
  const rawStatuses = await Status.find({
    seller: sellerId,
    expiresAt: { $gt: now },
  })
    .populate({
      path: 'seller',
      select: 'name shopName avatar isVerified',
    })
    .populate({
      path: 'product',
      select: 'name imageCover slug price parentCategory subCategory',
    })
    .sort({ createdAt: -1 })
    .lean();

  const validStatuses = rawStatuses.filter((s) => s.seller != null);
  if (validStatuses.length === 0) {
    return res.status(200).json({
      status: 'success',
      data: [{
        seller: {
          _id: sellerId,
          id: sellerId,
          name: '',
          shopName: '',
          avatar: '',
          isVerified: false,
        },
        statuses: [],
        hasUnseen: false,
      }],
    });
  }

  const seller = validStatuses[0].seller;
  const group = {
    seller: {
      _id: seller._id,
      id: seller._id,
      name: seller.name || seller.shopName,
      shopName: seller.shopName || seller.name,
      avatar: seller.avatar || '',
      isVerified: Boolean(seller.isVerified),
    },
    statuses: validStatuses.map((s) => {
      const views = Math.max(0, Number(s.views) || 0);
      const productImage =
        s.product?.imageCover ||
        (Array.isArray(s.product?.images) && s.product.images[0]) ||
        '';
      const thumbnailUrl =
        productImage || getVideoThumbnailUrl(s.video) || '';
      return {
        _id: s._id,
        seller: null,
        videoUrl: s.video,
        thumbnailUrl,
        caption: s.caption || '',
        duration: 0,
        product: s.product
          ? {
              _id: s.product._id,
              name: s.product.name,
              price: s.product.price,
              images: s.product.imageCover ? [s.product.imageCover] : [],
              slug: s.product.slug,
            }
          : null,
        viewCount: views,
        views,
        viewedByMe: false,
        expiresAt: s.expiresAt,
        createdAt: s.createdAt,
      };
    }),
    hasUnseen: true,
  };
  group.statuses.forEach((st) => { st.seller = group.seller; });

  group.statuses = group.statuses.filter(
    (st) => typeof st.videoUrl === 'string' && st.videoUrl.trim(),
  );

  if (group.statuses.length === 0) {
    return res.status(200).json({
      status: 'success',
      data: [{
        seller: {
          _id: sellerId,
          id: sellerId,
          name: '',
          shopName: '',
          avatar: '',
          isVerified: false,
        },
        statuses: [],
        hasUnseen: false,
      }],
    });
  }

  res.status(200).json({
    status: 'success',
    data: [group],
  });
});

/**
 * POST /api/v1/statuses/:id/view
 * Mark a status as viewed. Body: { watchTimeSeconds?: number, completionRate?: number }.
 * When completionRate >= 30: increments Status.views (each video counts after 30% view).
 * When authenticated: persists to StatusView.
 */
exports.markStatusViewed = catchAsync(async (req, res) => {
  const statusId = req.params.id;
  const rawWatch = req.body?.watchTimeSeconds;
  const rawCompletion = req.body?.completionRate;
  const watchTimeSeconds = Math.max(0, Math.floor(Number(rawWatch)) || 0);
  const completionRate = Math.min(100, Math.max(0, Math.floor(Number(rawCompletion)) || 0));

  const status = await Status.findById(statusId);
  if (!status) {
    return res.status(404).json({
      status: 'fail',
      message: 'Status not found',
    });
  }

  if (completionRate >= 30) {
    await Status.findByIdAndUpdate(statusId, {
      $inc: {
        views: 1,
        watchTime: watchTimeSeconds,
        totalCompletionRate: completionRate,
      },
      $set: { lastViewedAt: new Date() },
    });
  }

  if (req.user && req.user._id) {
    await StatusView.findOneAndUpdate(
      { user: req.user._id, status: statusId },
      {
        viewedAt: new Date(),
        watchTimeSeconds,
        completionRate,
      },
      { upsert: true }
    );
  }

  res.status(200).json({
    status: 'success',
    message: 'Viewed',
  });
});
