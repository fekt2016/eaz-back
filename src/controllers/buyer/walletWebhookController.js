const crypto = require('crypto');
const catchAsync = require('../../utils/helpers/catchAsync');
const walletService = require('../../services/walletService');

/**
 * POST /api/v1/wallet/webhook
 * Paystack webhook handler specifically for wallet top-ups
 * Validates signature and processes wallet credits
 */
exports.paystackWalletWebhook = catchAsync(async (req, res, next) => {
  const hash = req.headers['x-paystack-signature'];
  const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

  if (!PAYSTACK_SECRET_KEY) {
    console.error('[Wallet Webhook] Paystack secret key not configured');
    return res.status(500).json({ received: false, error: 'Paystack not configured' });
  }

  // Verify webhook signature
  const hashCheck = crypto
    .createHmac('sha512', PAYSTACK_SECRET_KEY)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (hash !== hashCheck) {
    console.error('[Wallet Webhook] Invalid signature');
    return res.status(401).json({ received: false, error: 'Invalid signature' });
  }

  // Parse webhook event
  const event = req.body;

  // Handle successful payment event for wallet top-ups
  if (event && event.event === 'charge.success') {
    const transaction = event.data;
    
    if (transaction && transaction.metadata?.type === 'wallet_topup' && transaction.status === 'success') {
      const reference = transaction.reference;
      console.log(`[Wallet Webhook] Processing wallet top-up: ${reference}`);
      
      try {
        const userId = transaction.metadata?.userId;
        const amount = transaction.amount / 100; // Convert from smallest currency unit

        if (!userId) {
          console.error('[Wallet Webhook] User ID not found in wallet top-up metadata');
          return res.status(200).json({ received: true });
        }

        // Credit wallet (idempotency check is inside creditWallet)
        const result = await walletService.creditWallet(
          userId,
          amount,
          'CREDIT_TOPUP',
          `Wallet top-up via Paystack - ${reference}`,
          reference,
          {
            paystackReference: reference,
            paystackTransactionId: transaction.id?.toString(),
            email: transaction.customer?.email,
            webhookEvent: 'charge.success',
          }
        );

        if (result.isDuplicate) {
          console.log(`[Wallet Webhook] Wallet top-up ${reference} already processed (idempotency check)`);
        } else {
          console.log(`[Wallet Webhook] Wallet top-up successful: GH₵${amount} credited to user ${userId}`);
        }

        return res.status(200).json({ received: true });
      } catch (error) {
        console.error('[Wallet Webhook] Error processing wallet top-up:', error);
        // Don't fail webhook, but log error
        return res.status(200).json({ received: true });
      }
    }
  }

  // If not a wallet top-up event, acknowledge but don't process
  return res.status(200).json({ received: true });
});

