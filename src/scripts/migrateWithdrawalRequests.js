/**
 * Migration Script: Merge WithdrawalRequest → PaymentRequest
 *
 * Copies all WithdrawalRequest documents into the PaymentRequest collection,
 * preserving the original _id so that existing Transaction.payoutRequest
 * references remain valid with no updates needed.
 *
 * Safe to run multiple times — skips documents that already exist in PaymentRequest.
 *
 * Run with:
 *   node backend/src/scripts/migrateWithdrawalRequests.js
 *
 * After running:
 *   1. Verify the output counts match
 *   2. Deploy the updated code (WithdrawalRequest fallbacks removed)
 *   3. The WithdrawalRequest collection can be archived/dropped later
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');

const run = async () => {
  const DB = (process.env.MONGO_URL || process.env.DATABASE).replace('<PASSWORD>', process.env.DATABASE_PASSWORD);
  await mongoose.connect(DB);
  console.log('✅ Connected to MongoDB');

  const WithdrawalRequest = require('../models/payout/withdrawalRequestModel');
  const PaymentRequest = require('../models/payment/paymentRequestModel');

  const withdrawalRequests = await WithdrawalRequest.find({}).lean();
  console.log(`📦 Found ${withdrawalRequests.length} WithdrawalRequest documents`);

  let skipped = 0;
  let migrated = 0;
  let failed = 0;

  for (const wr of withdrawalRequests) {
    // Check if already migrated (same _id exists in PaymentRequest)
    const exists = await PaymentRequest.findById(wr._id).lean();
    if (exists) {
      skipped++;
      continue;
    }

    try {
      await PaymentRequest.create({
        _id: wr._id, // Preserve _id so Transaction.payoutRequest refs stay valid

        seller: wr.seller,
        amount: wr.amount,
        amountRequested: wr.amount, // WithdrawalRequest has no separate amountRequested
        amountPaidToSeller: wr.amount, // Best approximation — no withholding data stored
        currency: 'GHS',

        // paymentMethod is canonical; WithdrawalRequest uses payoutMethod
        paymentMethod: wr.payoutMethod,
        paymentDetails: wr.paymentDetails || {},

        status: wr.status,
        processedBy: wr.processedBy || null,
        processedAt: wr.processedAt || null,
        rejectionReason: wr.rejectionReason || null,

        // Paystack fields
        paystackRecipientCode: wr.paystackRecipientCode || null,
        paystackTransferId: wr.paystackTransferId || null,
        paystackTransferCode: wr.paystackTransferCode || null,
        paystackReference: wr.paystackReference || null,

        // OTP / PIN
        otpSessionStatus: wr.otpSessionStatus || null,
        requiresPin: wr.requiresPin || false,
        pinSubmitted: wr.pinSubmitted || false,

        // Reversal fields
        reversed: wr.reversed || false,
        reversedAt: wr.reversedAt || null,
        reversedBy: wr.reversedBy || null,
        reverseReason: wr.reverseReason || null,

        // Linked transaction
        transaction: wr.transaction || null,

        // Tax — WithdrawalRequest didn't track these
        withholdingTax: 0,
        withholdingTaxRate: 0,

        // Balance snapshots — not available in WithdrawalRequest
        sellerBalanceBefore: 0,
        sellerBalanceAfter: 0,

        // Audit
        approvedByAdmin: wr.approvedByAdmin || {},
        rejectedByAdmin: wr.rejectedByAdmin || {},
        auditHistory: wr.auditHistory || [],

        isActive: !wr.reversed, // Mark as inactive if reversed
        metadata: wr.metadata || {},

        createdAt: wr.createdAt,
        updatedAt: wr.updatedAt,
      });

      migrated++;
    } catch (err) {
      console.error(`❌ Failed to migrate WithdrawalRequest ${wr._id}:`, err.message);
      failed++;
    }
  }

  console.log('\n📊 Migration Summary:');
  console.log(`   ✅ Migrated : ${migrated}`);
  console.log(`   ⏭️  Skipped  : ${skipped} (already in PaymentRequest)`);
  console.log(`   ❌ Failed   : ${failed}`);

  if (failed === 0) {
    console.log('\n✅ Migration complete. You can now deploy the updated code.');
    console.log('   The WithdrawalRequest collection can be archived/dropped after verifying the app.');
  } else {
    console.log('\n⚠️  Some documents failed. Review errors above before deploying.');
  }

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
