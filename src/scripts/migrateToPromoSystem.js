const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config({ path: './.env' });

const DB = process.env.DATABASE?.replace(
  '<PASSWORD>',
  process.env.DATABASE_PASSWORD,
);

const ARCHIVE_MAP = {
  advertisements: 'advertisements_archive_2026_04',
  discounts: 'discounts_archive_2026_04',
  flashdealproducts: 'flashdealproducts_archive_2026_04',
};

const SELLER_COUPON_ARCHIVE = 'seller_coupons_archive_2026_04';

const logStep = (label, payload = {}) => {
  console.log(`[migrateToPromoSystem] ${label}`, payload);
};

const collectionExists = async (db, name) => {
  const rows = await db.listCollections({ name }).toArray();
  return rows.length > 0;
};

const copyCollection = async ({
  db,
  sourceName,
  targetName,
  match = null,
}) => {
  const sourceExists = await collectionExists(db, sourceName);
  if (!sourceExists) {
    logStep(`skip ${sourceName} -> ${targetName} (source missing)`);
    return { copied: 0, skipped: true };
  }

  const targetExists = await collectionExists(db, targetName);
  if (targetExists) {
    const archivedCount = await db.collection(targetName).countDocuments({});
    logStep(`skip ${sourceName} -> ${targetName} (archive exists)`, {
      archivedCount,
    });
    return { copied: archivedCount, skipped: true };
  }

  const sourceCollection = db.collection(sourceName);
  const sourceCount = await sourceCollection.countDocuments(match || {});

  const pipeline = [];
  if (match) pipeline.push({ $match: match });
  pipeline.push({ $out: targetName });

  await sourceCollection.aggregate(pipeline, { allowDiskUse: true }).toArray();
  const copiedCount = await db.collection(targetName).countDocuments({});

  logStep(`archived ${sourceName} -> ${targetName}`, {
    sourceCount,
    copiedCount,
  });
  return { copied: copiedCount, skipped: false };
};

const archiveSellerCoupons = async (db) => {
  const couponsExists = await collectionExists(db, 'coupons');
  const couponBatchesExists = await collectionExists(db, 'couponbatches');

  const sourceName = couponsExists
    ? 'coupons'
    : couponBatchesExists
      ? 'couponbatches'
      : null;

  if (!sourceName) {
    logStep('skip seller coupons archive (no coupons/couponbatches source)');
    return { copied: 0, skipped: true };
  }

  const sellerScopedMatch = {
    $or: [
      { seller: { $exists: true, $ne: null } },
      { createdByModel: 'Seller' },
      { createdByRole: 'seller' },
      { createdByType: 'seller' },
    ],
  };

  return copyCollection({
    db,
    sourceName,
    targetName: SELLER_COUPON_ARCHIVE,
    match: sellerScopedMatch,
  });
};

async function run() {
  if (!DB) {
    throw new Error(
      'DATABASE env variable is missing; cannot run migrateToPromoSystem.',
    );
  }

  await mongoose.connect(DB);
  const db = mongoose.connection.db;
  logStep('connected', { dbName: db.databaseName });

  for (const [sourceName, targetName] of Object.entries(ARCHIVE_MAP)) {
    await copyCollection({ db, sourceName, targetName });
  }

  await archiveSellerCoupons(db);

  const productCollection = db.collection('products');
  const discountedPriceReset = await productCollection.updateMany(
    {},
    { $set: { discountedPrice: null } },
  );
  logStep('reset product.discountedPrice = null', {
    matchedCount: discountedPriceReset.matchedCount || 0,
    modifiedCount: discountedPriceReset.modifiedCount || 0,
  });

  const dealsExists = await collectionExists(db, 'deals');
  if (dealsExists) {
    await db.collection('deals').drop();
    logStep('dropped deals collection');
  } else {
    logStep('skip dropping deals (not present)');
  }

  await mongoose.connection.close();
  logStep('completed successfully');
  process.exit(0);
}

run().catch(async (error) => {
  logStep('failed', { message: error.message });
  try {
    await mongoose.connection.close();
  } catch {
    // noop
  }
  process.exit(1);
});
