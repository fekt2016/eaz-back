/**
 * Unified Promo migration (idempotent).
 *
 * What it does:
 * - Backfills Promo documents from legacy Advertisement + FlashDeal records.
 * - Optionally creates pending PromoProduct submissions from legacy Discount rows.
 * - Safe to re-run (upsert + duplicate checks).
 */

const dotenv = require('dotenv');
const mongoose = require('mongoose');
const slugify = require('slugify');

const Promo = require('../src/models/promo/promoModel');
const PromoProduct = require('../src/models/promo/promoProductModel');
const Advertisement = require('../src/models/advertisementModel');
const FlashDeal = require('../src/models/product/dealsModel');
const Discount = require('../src/models/product/discountModel');
const Product = require('../src/models/product/productModel');

dotenv.config({ path: './.env' });

const DB = process.env.DATABASE?.replace(
  '<PASSWORD>',
  process.env.DATABASE_PASSWORD,
);

const now = () => new Date();

const mapPromoStatus = ({ startDate, endDate, enabled = true, sourceStatus }) => {
  if (!enabled) return 'cancelled';
  if (sourceStatus === 'cancelled') return 'cancelled';
  if (sourceStatus === 'draft') return 'draft';
  if (sourceStatus === 'ended') return 'ended';

  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  const current = Date.now();

  if (Number.isNaN(start) || Number.isNaN(end)) return 'draft';
  if (current < start) return 'scheduled';
  if (current > end) return 'ended';
  return 'active';
};

const normalizeSlug = (value) =>
  slugify(String(value || ''), { lower: true, strict: true, trim: true });

async function migrateAdvertisements() {
  const ads = await Advertisement.find({}).lean();
  let created = 0;
  let updated = 0;

  for (const ad of ads) {
    const slug =
      normalizeSlug(ad.title) ||
      `ad-${String(ad._id).slice(-8)}`;
    const status = mapPromoStatus({
      startDate: ad.startDate,
      endDate: ad.endDate || ad.startDate,
      enabled: ad.active !== false,
    });

    const payload = {
      name: ad.title || 'Advertisement Promo',
      slug,
      description: `Migrated from Advertisement ${ad._id}`,
      type: 'campaign',
      banner: {
        url: ad.imageUrl || '',
        public_id: '',
      },
      startDate: ad.startDate || now(),
      endDate: ad.endDate || ad.startDate || now(),
      minDiscountPercent: 10,
      maxProductsPerSeller: 5,
      status,
      showCountdown: false,
      showOnHomepage: true,
      createdBy: ad.createdBy || '000000000000000000000000',
    };

    const existing = await Promo.findOne({ slug });
    if (!existing) {
      await Promo.create(payload);
      created += 1;
    } else {
      await Promo.updateOne({ _id: existing._id }, { $set: payload });
      updated += 1;
    }
  }

  return { created, updated, total: ads.length };
}

async function migrateFlashDeals() {
  const flashDeals = await FlashDeal.find({}).lean();
  let created = 0;
  let updated = 0;

  for (const deal of flashDeals) {
    const slug =
      normalizeSlug(deal.slug || deal.title) ||
      `flash-${String(deal._id).slice(-8)}`;
    const status = mapPromoStatus({
      startDate: deal.startTime,
      endDate: deal.endTime,
      enabled: deal.isActive !== false,
      sourceStatus: deal.status,
    });

    const payload = {
      name: deal.title || 'Flash Deal',
      slug,
      description: deal.description || `Migrated from FlashDeal ${deal._id}`,
      type: 'flash',
      banner: {
        url: deal.bannerImage || '',
        public_id: '',
      },
      startDate: deal.startTime || now(),
      endDate: deal.endTime || deal.startTime || now(),
      minDiscountPercent: Number(deal?.discountRules?.minDiscountPercent || 10),
      maxProductsPerSeller: Number(deal.maxProducts || 5),
      status,
      showCountdown: true,
      showOnHomepage: true,
      createdBy: deal.createdBy || '000000000000000000000000',
    };

    const existing = await Promo.findOne({ slug });
    if (!existing) {
      await Promo.create(payload);
      created += 1;
    } else {
      await Promo.updateOne({ _id: existing._id }, { $set: payload });
      updated += 1;
    }
  }

  return { created, updated, total: flashDeals.length };
}

async function migrateDiscountSubmissions() {
  const discounts = await Discount.find({
    active: true,
    products: { $exists: true, $ne: [] },
  })
    .select('name promotionKey seller products type value startDate endDate')
    .lean();

  let promosCreated = 0;
  let submissionsCreated = 0;
  let submissionsSkipped = 0;

  for (const discount of discounts) {
    const slug = normalizeSlug(discount.promotionKey || discount.name);
    if (!slug) continue;

    let promo = await Promo.findOne({ slug });
    if (!promo) {
      promo = await Promo.create({
        name: discount.name || `Migrated Discount ${String(discount._id).slice(-6)}`,
        slug,
        description: `Migrated from Discount ${discount._id}`,
        type: 'campaign',
        startDate: discount.startDate || now(),
        endDate: discount.endDate || discount.startDate || now(),
        minDiscountPercent: 10,
        maxProductsPerSeller: 5,
        status: mapPromoStatus({
          startDate: discount.startDate,
          endDate: discount.endDate || discount.startDate,
          enabled: true,
        }),
        showCountdown: false,
        showOnHomepage: false,
        createdBy: '000000000000000000000000',
      });
      promosCreated += 1;
    }

    for (const productId of discount.products || []) {
      const product = await Product.findById(productId).select('price');
      if (!product || !(Number(product.price) > 0)) {
        submissionsSkipped += 1;
        continue;
      }

      const existing = await PromoProduct.findOne({
        promo: promo._id,
        product: productId,
      });
      if (existing) {
        submissionsSkipped += 1;
        continue;
      }

      await PromoProduct.create({
        promo: promo._id,
        seller: discount.seller,
        product: productId,
        discountType: discount.type === 'fixed' ? 'fixed' : 'percentage',
        discountValue: Number(discount.value || 0),
        regularPrice: Number(product.price || 0),
        status: 'pending',
      });
      submissionsCreated += 1;
    }
  }

  return {
    promosCreated,
    submissionsCreated,
    submissionsSkipped,
    total: discounts.length,
  };
}

async function runMigration() {
  if (!DB) {
    throw new Error('DATABASE env variable is required');
  }

  console.log('Connecting to database...');
  await mongoose.connect(DB);
  console.log('Database connected');

  const adSummary = await migrateAdvertisements();
  const flashSummary = await migrateFlashDeals();
  const discountSummary = await migrateDiscountSubmissions();

  console.log('\nUnified promo migration summary:');
  console.log('Advertisements:', adSummary);
  console.log('Flash deals:', flashSummary);
  console.log('Discount submissions:', discountSummary);
}

runMigration()
  .then(async () => {
    await mongoose.connection.close();
    console.log('Migration completed successfully');
    process.exit(0);
  })
  .catch(async (error) => {
    console.error('Migration failed:', error.message);
    await mongoose.connection.close();
    process.exit(1);
  });
