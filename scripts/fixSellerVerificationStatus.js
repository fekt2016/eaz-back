#!/usr/bin/env node
/**
 * Fix sellers whose documents are all verified but verificationStatus is stuck at pending.
 * This can happen when documents were verified before payout was verified - the pre-save
 * hook requires BOTH, so it never set verificationStatus. Now that payout is also verified,
 * we can safely set verificationStatus to 'verified' for these sellers.
 *
 * Usage: node scripts/fixSellerVerificationStatus.js [sellerEmail]
 * If sellerEmail is omitted, fixes all sellers matching the criteria.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Seller = require('../src/models/user/sellerModel');
const User = require('../src/models/user/userModel');
const PaymentMethod = require('../src/models/payment/PaymentMethodModel');
const { hasVerifiedPayoutMethod } = require('../src/utils/helpers/paymentMethodHelpers');

const DB = process.env.MONGO_URL.replace('<PASSWORD>', process.env.DATABASE_PASSWORD);

function getDocStatus(doc) {
  if (!doc) return null;
  if (typeof doc === 'string') return null;
  return doc.status || null;
}

async function hasPayoutVerified(seller) {
  const embedded = hasVerifiedPayoutMethod(seller);
  if (embedded.hasVerified) return true;
  if (!seller.email) return false;
  const user = await User.findOne({ email: seller.email }).select('_id').lean();
  if (!user) {
    const escaped = String(seller.email).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const userCi = await User.findOne({ email: new RegExp(`^${escaped}$`, 'i') }).select('_id').lean();
    if (!userCi) return false;
    const pm = await PaymentMethod.findOne({
      user: userCi._id,
      $or: [{ verificationStatus: 'verified' }, { status: 'verified' }],
    }).lean();
    return !!pm;
  }
  const pm = await PaymentMethod.findOne({
    user: user._id,
    $or: [{ verificationStatus: 'verified' }, { status: 'verified' }],
  }).lean();
  return !!pm;
}

async function main() {
  const targetEmail = process.argv[2]; // e.g. benzflex00@gmail.com

  await mongoose.connect(DB);

  const query = targetEmail ? { email: targetEmail } : {};
  const sellers = await Seller.find(query)
    .select('name shopName email verificationDocuments verification verificationStatus onboardingStage paymentMethods phone')
    .lean();

  let fixed = 0;
  for (const s of sellers) {
    const businessCert = getDocStatus(s.verificationDocuments?.businessCert);
    const idProof = getDocStatus(s.verificationDocuments?.idProof);
    const addresProof = getDocStatus(s.verificationDocuments?.addresProof);

    const allDocsVerified =
      businessCert === 'verified' && idProof === 'verified' && addresProof === 'verified';

    const hasPayout = await hasPayoutVerified(s);

    if (
      allDocsVerified &&
      hasPayout &&
      s.verificationStatus !== 'verified'
    ) {
      await mongoose.connection.collection('sellers').updateOne(
        { _id: s._id },
        {
          $set: {
            verificationStatus: 'verified',
            onboardingStage: 'verified',
            'verification.businessVerified': true,
          },
        }
      );
      console.log(`Fixed: ${s.shopName || s.name} (${s.email})`);
      fixed++;
    } else if (targetEmail && s.email === targetEmail) {
      console.log(`No fix needed or criteria not met for ${s.email}:`);
      console.log('  allDocsVerified:', allDocsVerified);
      console.log('  hasPayout:', hasPayout);
      console.log('  verificationStatus:', s.verificationStatus);
    }
  }

  console.log(`\nDone. Fixed ${fixed} seller(s).`);
  await mongoose.connection.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
