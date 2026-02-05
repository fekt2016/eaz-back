#!/usr/bin/env node
/**
 * Check payout verification status for all sellers.
 * Usage: node scripts/checkPayoutVerification.js
 * (Run from backend directory with .env loaded)
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');

const DB = process.env.MONGO_URL.replace('<PASSWORD>', process.env.DATABASE_PASSWORD);

async function main() {
  await mongoose.connect(DB);

  const Seller = mongoose.connection.collection('sellers');
  const User = mongoose.connection.collection('users');
  const PaymentMethod = mongoose.connection.collection('paymentmethods');

  const sellers = await Seller.find({}).project({
    _id: 1,
    name: 1,
    shopName: 1,
    email: 1,
    'paymentMethods.bankAccount': 1,
    'paymentMethods.mobileMoney': 1,
  }).toArray();

  console.log('\n=== PAYOUT VERIFICATION STATUS CHECK ===\n');
  console.log(`Total sellers: ${sellers.length}\n`);

  for (const s of sellers) {
    const bankStatus = s.paymentMethods?.bankAccount?.payoutStatus || 'pending';
    const mobileStatus = s.paymentMethods?.mobileMoney?.payoutStatus || 'pending';
    const hasVerifiedEmbedded = bankStatus === 'verified' || mobileStatus === 'verified';

    let hasVerifiedPaymentMethod = false;
    let userMatch = null;
    if (!hasVerifiedEmbedded && s.email) {
      // Exact match first, then case-insensitive (same as balance controller should use)
      userMatch = await User.findOne({ email: s.email }, { projection: { _id: 1, email: 1 } });
      if (!userMatch) {
        const escaped = s.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        userMatch = await User.findOne({ email: new RegExp(`^${escaped}$`, 'i') }, { projection: { _id: 1, email: 1 } });
      }
      if (userMatch) {
        const pm = await PaymentMethod.findOne({
          user: userMatch._id,
          $or: [{ verificationStatus: 'verified' }, { status: 'verified' }],
        });
        hasVerifiedPaymentMethod = !!pm;
      }
    }

    const effectiveStatus = hasVerifiedEmbedded || hasVerifiedPaymentMethod ? 'verified' : 'pending';

    console.log(`Seller: ${s.shopName || s.name || s._id}`);
    console.log(`  ID: ${s._id}`);
    console.log(`  Email: ${s.email || '(none)'}`);
    console.log(`  Embedded: bank=${bankStatus}, mobile=${mobileStatus}`);
    console.log(`  PaymentMethod fallback: ${hasVerifiedPaymentMethod ? 'verified' : 'none'}`);
    console.log(`  Effective (balance API would return): ${effectiveStatus}`);
    if (effectiveStatus === 'verified') {
      console.log(`  ✓ OK - Wallet should show verified`);
    } else {
      console.log(`  ✗ PENDING - Wallet shows "must verify"`);
    }
    console.log('');
  }

  await mongoose.connection.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
