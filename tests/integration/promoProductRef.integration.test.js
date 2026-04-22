/**
 * Integration: promo line traceability (PromoProduct _id on OrderItems).
 * Requires a reachable MongoDB URI (e.g. from backend/.env).
 *
 * Run: cd backend && node --test tests/integration/promoProductRef.integration.test.js
 */

'use strict';

const path = require('path');
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert');

require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const mongoUri =
  process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL;

const runIntegration = Boolean(mongoUri);

if (!runIntegration) {
  test('promoProductRef integration (skipped — set MONGODB_URI / MONGO_URI)', () => {
    assert.ok(true);
  });
} else {
  describe('promoProductRef traceability', () => {
    let mongoose;
    const suffix = `ppt-${Date.now()}`;
    const pwd = 'TestPassw0rd!';

    /** @type {Record<string, import('mongoose').Types.ObjectId | null>} */
    const ids = {
      adminId: null,
      sellerId: null,
      parentCatId: null,
      subCatId: null,
      promoId: null,
      productPromoId: null,
      productPlainId: null,
      submissionId: null,
      orderItemPromoId: null,
      orderItemPlainId: null,
    };

    let taxService;
    let platformSettings;
    let resolveOrderItemPromoDiscount;
    let OrderItems;

    before(async () => {
      mongoose = require('mongoose');
      await mongoose.connect(mongoUri);

      const Admin = require('../../src/models/user/adminModel');
      const Seller = require('../../src/models/user/sellerModel');
      const Category = require('../../src/models/category/categoryModel');
      const Product = require('../../src/models/product/productModel');
      const Promo = require('../../src/models/promo/promoModel');
      const PromoProduct = require('../../src/models/promo/promoProductModel');
      OrderItems = require('../../src/models/order/OrderItemModel');
      taxService = require('../../src/services/tax/taxService');
      platformSettings = require('../../src/models/platform/platformSettingsModel');
      ({ resolveOrderItemPromoDiscount } = require('../../src/services/promo/promoService'));

      const admin = await Admin.create({
        name: `PromoRef Admin ${suffix}`,
        email: `admin-promoref-${suffix}@test.local`,
        password: pwd,
        passwordConfirm: pwd,
        role: 'superadmin',
      });
      ids.adminId = admin._id;

      const seller = await Seller.create({
        name: `PromoRef Seller ${suffix}`,
        shopName: `Shop ${suffix}`,
        email: `seller-promoref-${suffix}@test.local`,
        password: pwd,
        passwordConfirm: pwd,
        verificationStatus: 'verified',
      });
      ids.sellerId = seller._id;

      const parentCat = await Category.create({
        name: `Parent ${suffix}`,
        slug: `parent-${suffix}`,
      });
      ids.parentCatId = parentCat._id;

      const subCat = await Category.create({
        name: `Sub ${suffix}`,
        slug: `sub-${suffix}`,
        parentCategory: parentCat._id,
      });
      ids.subCatId = subCat._id;

      const skuPromo = `PROMO-SKU-${suffix}`;
      const skuPlain = `PLAIN-SKU-${suffix}`;

      const productPromo = await Product.create({
        seller: seller._id,
        name: `Promo line product ${suffix}`,
        description: 'integration test product',
        imageCover: 'https://example.com/cover.jpg',
        parentCategory: parentCat._id,
        subCategory: subCat._id,
        moderationStatus: 'approved',
        isVisible: true,
        variants: [
          {
            name: 'Default',
            price: 100,
            stock: 50,
            sku: skuPromo,
            attributes: [{ key: 'Size', value: 'M' }],
          },
        ],
      });
      ids.productPromoId = productPromo._id;

      const productPlain = await Product.create({
        seller: seller._id,
        name: `Plain product ${suffix}`,
        description: 'integration test product',
        imageCover: 'https://example.com/cover2.jpg',
        parentCategory: parentCat._id,
        subCategory: subCat._id,
        moderationStatus: 'approved',
        isVisible: true,
        variants: [
          {
            name: 'Default',
            price: 100,
            stock: 50,
            sku: skuPlain,
            attributes: [{ key: 'Size', value: 'L' }],
          },
        ],
      });
      ids.productPlainId = productPlain._id;

      const promo = await Promo.create({
        name: `Integration promo ${suffix}`,
        slug: `int-promo-${suffix}`,
        description: 'test',
        startDate: new Date(Date.now() - 3 * 86400000),
        endDate: new Date(Date.now() + 3 * 86400000),
        status: 'active',
        createdBy: admin._id,
        minDiscountPercent: 5,
      });
      ids.promoId = promo._id;

      const submission = await PromoProduct.create({
        promo: promo._id,
        seller: seller._id,
        product: productPromo._id,
        discountType: 'percentage',
        discountValue: 25,
        regularPrice: 100,
        status: 'approved',
        approvedAt: new Date(),
        approvedBy: admin._id,
      });
      ids.submissionId = submission._id;

      const reloadedPromoProduct = await Product.findById(productPromo._id);
      const variantPromo = reloadedPromoProduct.variants.find(
        (v) => v.sku && v.sku.toUpperCase() === skuPromo.toUpperCase(),
      );
      const reloadedPlainProduct = await Product.findById(productPlain._id);
      const variantPlain = reloadedPlainProduct.variants.find(
        (v) => v.sku && v.sku.toUpperCase() === skuPlain.toUpperCase(),
      );

      const [linePromo, linePlain] = await OrderItems.insertMany(
        [
          {
            product: productPromo._id,
            variant: variantPromo._id,
            quantity: 1,
            sku: skuPromo,
            price: 99,
            promoProductRef: submission._id,
            sellerId: seller._id,
            vatCollectedBy: 'platform',
          },
          {
            product: productPlain._id,
            variant: variantPlain._id,
            quantity: 1,
            sku: skuPlain,
            price: 100,
            promoProductRef: null,
            sellerId: seller._id,
            vatCollectedBy: 'platform',
          },
        ],
        { ordered: true },
      );
      ids.orderItemPromoId = linePromo._id;
      ids.orderItemPlainId = linePlain._id;
    });

    test('resolveOrderItemPromoDiscount returns promoProductId for approved active submission', async () => {
      const settings = await platformSettings.getSettings();
      const basePrice = 100;
      const vatComputed = await taxService.addVatToBase(basePrice, settings);

      const resolvedPromo = await resolveOrderItemPromoDiscount({
        productId: ids.productPromoId,
        sellerId: ids.sellerId,
        basePriceInclVat: vatComputed.priceInclVat,
        taxService,
        platformSettings: settings,
      });

      assert.ok(resolvedPromo.promoProductId);
      assert.strictEqual(
        String(resolvedPromo.promoProductId),
        String(ids.submissionId),
      );
      assert.strictEqual(
        resolvedPromo.promoSubmission &&
          String(resolvedPromo.promoSubmission._id),
        String(ids.submissionId),
      );
    });

    test('resolveOrderItemPromoDiscount returns null promoProductId when no submission', async () => {
      const settings = await platformSettings.getSettings();
      const basePrice = 100;
      const vatComputed = await taxService.addVatToBase(basePrice, settings);

      const resolvedPlain = await resolveOrderItemPromoDiscount({
        productId: ids.productPlainId,
        sellerId: ids.sellerId,
        basePriceInclVat: vatComputed.priceInclVat,
        taxService,
        platformSettings: settings,
      });
      assert.strictEqual(resolvedPlain.promoProductId, null);
      assert.strictEqual(resolvedPlain.promoSubmission, null);
    });

    test('OrderItems persist promoProductRef vs null', async () => {
      const checkPromo = await OrderItems.findById(ids.orderItemPromoId).lean();
      const checkPlain = await OrderItems.findById(ids.orderItemPlainId).lean();
      assert.strictEqual(String(checkPromo.promoProductRef), String(ids.submissionId));
      assert.strictEqual(checkPlain.promoProductRef, null);
    });

    after(async () => {
      if (!mongoose) return;
      const Product = require('../../src/models/product/productModel');
      const PromoProduct = require('../../src/models/promo/promoProductModel');
      const Promo = require('../../src/models/promo/promoModel');
      const Category = require('../../src/models/category/categoryModel');
      const Seller = require('../../src/models/user/sellerModel');
      const Admin = require('../../src/models/user/adminModel');

      try {
        if (ids.orderItemPromoId) {
          await OrderItems.deleteOne({ _id: ids.orderItemPromoId });
        }
        if (ids.orderItemPlainId) {
          await OrderItems.deleteOne({ _id: ids.orderItemPlainId });
        }
        if (ids.submissionId) {
          await PromoProduct.deleteOne({ _id: ids.submissionId });
        }
        if (ids.productPromoId) {
          await Product.deleteOne({ _id: ids.productPromoId });
        }
        if (ids.productPlainId) {
          await Product.deleteOne({ _id: ids.productPlainId });
        }
        if (ids.promoId) {
          await Promo.deleteOne({ _id: ids.promoId });
        }
        if (ids.subCatId) {
          await Category.deleteOne({ _id: ids.subCatId });
        }
        if (ids.parentCatId) {
          await Category.deleteOne({ _id: ids.parentCatId });
        }
        if (ids.sellerId) {
          await Seller.deleteOne({ _id: ids.sellerId });
        }
        if (ids.adminId) {
          await Admin.deleteOne({ _id: ids.adminId });
        }
      } finally {
        await mongoose.disconnect();
      }
    });
  });
}
