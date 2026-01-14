/**
 * Admin Seller Management Controller
 * Handles admin operations on sellers
 */

const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const Seller = require('../../models/user/sellerModel');
const { logSellerRevenue } = require('../../services/historyLogger');

/**
 * Reset seller balance
 * PATCH /api/v1/admin/seller/:id/reset-balance
 * Body: { balance: Number (optional, defaults to 0), reason: String (optional) }
 */
exports.resetSellerBalance = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { balance = 0, reason } = req.body;
  const adminId = req.user.id;

  // Validate balance
  if (balance < 0) {
    return next(new AppError('Balance cannot be negative', 400));
  }

  // Find seller
  const seller = await Seller.findById(id);
  if (!seller) {
    return next(new AppError('Seller not found', 404));
  }

  // Store old balance for logging
  const oldBalance = seller.balance;
  const oldLockedBalance = seller.lockedBalance;
  const oldPendingBalance = seller.pendingBalance;
  const oldWithdrawableBalance = seller.withdrawableBalance;

  // Reset all balance fields
  seller.balance = balance;
  seller.lockedBalance = 0;
  seller.pendingBalance = 0;
  seller.withdrawableBalance = balance; // Withdrawable balance equals balance when no locked/pending

  // Always track the admin who reset the balance
  seller.lastBalanceResetBy = adminId;
  seller.lastBalanceResetAt = new Date();

  // Always save reset information in metadata (even if no reason provided)
  if (!seller.metadata) {
    seller.metadata = {};
  }
  if (!seller.metadata.balanceResets) {
    seller.metadata.balanceResets = [];
  }
  seller.metadata.balanceResets.push({
    resetBy: adminId,
    resetAt: new Date(),
    oldBalance,
    oldLockedBalance,
    oldPendingBalance,
    oldWithdrawableBalance,
    newBalance: balance,
    reason: reason || null,
  });

  await seller.save();

  // Log revenue history with correct balance values
  const balanceChange = balance - oldBalance;
  if (balanceChange !== 0) {
    try {
      await logSellerRevenue({
        sellerId: seller._id,
        amount: balanceChange,
        type: 'ADMIN_ADJUST',
        description: `Admin balance reset: ${reason || 'Balance reset by admin'}`,
        reference: `ADMIN-RESET-${seller._id}-${Date.now()}`,
        adminId: adminId,
        balanceBefore: oldBalance,
        balanceAfter: balance,
        metadata: {
          reason: reason || 'Balance reset',
          oldBalance,
          newBalance: balance,
          oldLockedBalance,
          oldPendingBalance,
          oldWithdrawableBalance,
          newLockedBalance: 0,
          newPendingBalance: 0,
          newWithdrawableBalance: balance,
        },
      });
      console.log(`[Admin Seller] ✅ Revenue history logged for balance reset - seller ${seller._id}`);
    } catch (err) {
      console.error(`[Admin Seller] Failed to log revenue history (non-critical) for seller ${seller._id}:`, {
        error: err.message,
        stack: err.stack,
      });
    }
  }

  res.status(200).json({
    status: 'success',
    message: 'Seller balance reset successfully',
    data: {
      seller: {
        _id: seller._id,
        name: seller.name,
        shopName: seller.shopName,
        email: seller.email,
        balance: seller.balance,
        lockedBalance: seller.lockedBalance,
        pendingBalance: seller.pendingBalance,
        withdrawableBalance: seller.withdrawableBalance,
        previousBalance: oldBalance,
        previousLockedBalance: oldLockedBalance,
        previousPendingBalance: oldPendingBalance,
        previousWithdrawableBalance: oldWithdrawableBalance,
        lastBalanceResetBy: seller.lastBalanceResetBy,
        lastBalanceResetAt: seller.lastBalanceResetAt,
      },
    },
  });
});

/**
 * Reset seller locked balance
 * PATCH /api/v1/admin/seller/:id/reset-locked-balance
 * Body: { reason: String (optional) }
 */
exports.resetLockedBalance = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { reason } = req.body;
  const adminId = req.user.id;

  // Find seller
  const seller = await Seller.findById(id);
  if (!seller) {
    return next(new AppError('Seller not found', 404));
  }

  // Store old values for logging
  const oldLockedBalance = seller.lockedBalance;
  const oldBalance = seller.balance;
  const oldWithdrawableBalance = seller.withdrawableBalance;

  // Return locked funds back to balance
  seller.balance = (seller.balance || 0) + (seller.lockedBalance || 0);
  seller.lockedBalance = 0;
  seller.calculateWithdrawableBalance();

  // Always track the admin who reset the locked balance
  // Note: We could add separate fields for locked balance reset, but for now we'll use the same fields
  // since resetting locked balance is also a balance operation
  seller.lastBalanceResetBy = adminId;
  seller.lastBalanceResetAt = new Date();

  // Always save reset information in metadata (even if no reason provided)
  if (!seller.metadata) {
    seller.metadata = {};
  }
  if (!seller.metadata.lockedBalanceResets) {
    seller.metadata.lockedBalanceResets = [];
  }
  seller.metadata.lockedBalanceResets.push({
    resetBy: adminId,
    resetAt: new Date(),
    oldLockedBalance,
    oldBalance,
    oldWithdrawableBalance,
    newBalance: seller.balance,
    newLockedBalance: 0,
    newWithdrawableBalance: seller.withdrawableBalance,
    reason: reason || null,
  });

  await seller.save();

  // Log revenue history with correct balance values - unlocking funds increases balance
  const balanceChange = oldLockedBalance; // Amount added back to balance
  if (balanceChange > 0) {
    try {
      await logSellerRevenue({
        sellerId: seller._id,
        amount: balanceChange,
        type: 'ADMIN_ADJUST',
        description: `Admin unlocked funds: ${reason || 'Locked balance reset by admin'}`,
        reference: `ADMIN-UNLOCK-${seller._id}-${Date.now()}`,
        adminId: adminId,
        balanceBefore: oldBalance,
        balanceAfter: seller.balance,
        metadata: {
          reason: reason || 'Locked balance reset',
          oldBalance,
          newBalance: seller.balance,
          oldLockedBalance,
          newLockedBalance: 0,
          oldWithdrawableBalance,
          newWithdrawableBalance: seller.withdrawableBalance,
          fundsReturned: oldLockedBalance,
        },
      });
      console.log(`[Admin Seller] ✅ Revenue history logged for unlock funds - seller ${seller._id}`);
    } catch (err) {
      console.error(`[Admin Seller] Failed to log revenue history (non-critical) for seller ${seller._id}:`, {
        error: err.message,
        stack: err.stack,
      });
    }
  }

  res.status(200).json({
    status: 'success',
    message: 'Seller locked balance reset successfully',
    data: {
      seller: {
        _id: seller._id,
        name: seller.name,
        shopName: seller.shopName,
        email: seller.email,
        balance: seller.balance,
        lockedBalance: seller.lockedBalance,
        pendingBalance: seller.pendingBalance,
        withdrawableBalance: seller.withdrawableBalance,
        previousLockedBalance: oldLockedBalance,
        previousBalance: oldBalance,
        previousWithdrawableBalance: oldWithdrawableBalance,
        fundsReturned: oldLockedBalance,
      },
    },
  });
});

/**
 * Get seller balance details
 * GET /api/v1/admin/seller/:id/balance
 */
exports.getSellerBalance = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  const seller = await Seller.findById(id).select(
    'name shopName email balance lockedBalance pendingBalance lockedReason lockedBy lockedAt withdrawableBalance lastBalanceResetBy lastBalanceResetAt metadata.balanceResets metadata.lockedBalanceResets metadata.fundLocks metadata.fundUnlocks'
  ).populate('lastBalanceResetBy', 'name email');

  if (!seller) {
    return next(new AppError('Seller not found', 404));
  }

  seller.calculateWithdrawableBalance();

  res.status(200).json({
    status: 'success',
    data: {
      seller: {
        _id: seller._id,
        name: seller.name,
        shopName: seller.shopName,
        email: seller.email,
        balance: seller.balance, // Total balance
        lockedBalance: seller.lockedBalance || 0, // Funds locked by admin due to disputes/issues
        pendingBalance: seller.pendingBalance || 0, // Funds in withdrawal requests awaiting approval/OTP
        withdrawableBalance: seller.withdrawableBalance, // Available balance
        lockedReason: seller.lockedReason, // Reason for admin lock (dispute/issue)
        lockedBy: seller.lockedBy, // Admin who locked the funds
        lockedAt: seller.lockedAt, // When funds were locked
        lastBalanceResetBy: seller.lastBalanceResetBy, // Admin who last reset the balance
        lastBalanceResetAt: seller.lastBalanceResetAt, // When balance was last reset
        // Verification: lockedBalance + pendingBalance + withdrawableBalance = balance
        balanceBreakdown: {
          total: seller.balance,
          disputeLocked: seller.lockedBalance || 0, // Funds locked due to disputes/issues
          pendingWithdrawals: seller.pendingBalance || 0, // Withdrawal requests awaiting approval/OTP
          available: seller.withdrawableBalance,
          // Verification: lockedBalance + pendingBalance + withdrawableBalance = balance
          sum: (seller.lockedBalance || 0) + (seller.pendingBalance || 0) + (seller.withdrawableBalance || 0),
        },
        balanceResets: seller.metadata?.balanceResets || [],
        lockedBalanceResets: seller.metadata?.lockedBalanceResets || [],
        fundLocks: seller.metadata?.fundLocks || [],
        fundUnlocks: seller.metadata?.fundUnlocks || [],
      },
    },
  });
});

/**
 * Lock seller funds (admin action)
 * PATCH /api/v1/admin/seller/:id/lock-funds
 * Body: { amount: Number, reason: String (required) }
 */
exports.lockSellerFunds = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { amount, reason } = req.body;
  const adminId = req.user.id;

  // Validate input
  if (!amount || amount <= 0) {
    return next(new AppError('Amount must be greater than 0', 400));
  }

  if (!reason || reason.trim() === '') {
    return next(new AppError('Reason is required for locking funds', 400));
  }

  // Find seller
  const seller = await Seller.findById(id);
  if (!seller) {
    return next(new AppError('Seller not found', 404));
  }

  // Check if seller has sufficient available balance
  seller.calculateWithdrawableBalance();
  const availableBalance = seller.withdrawableBalance;
  
  if (amount > availableBalance) {
    return next(
      new AppError(
        `Insufficient available balance. Available: GH₵${availableBalance.toFixed(2)}, Requested: GH₵${amount.toFixed(2)}`,
        400
      )
    );
  }

  // Store old values
  const oldLockedBalance = seller.lockedBalance || 0;
  const oldWithdrawableBalance = seller.withdrawableBalance;

  // Lock funds due to dispute/issue (this reduces withdrawableBalance automatically via calculateWithdrawableBalance)
  seller.lockedBalance = (seller.lockedBalance || 0) + amount;
  seller.lockedReason = reason;
  seller.lockedBy = adminId;
  seller.lockedAt = new Date();
  seller.calculateWithdrawableBalance();

  // Save lock history in metadata
  if (!seller.metadata) {
    seller.metadata = {};
  }
  if (!seller.metadata.fundLocks) {
    seller.metadata.fundLocks = [];
  }
  seller.metadata.fundLocks.push({
    lockedBy: adminId,
    lockedAt: new Date(),
    amount,
    reason,
    oldLockedBalance,
    newLockedBalance: seller.lockedBalance,
    oldWithdrawableBalance,
    newWithdrawableBalance: seller.withdrawableBalance,
  });

  await seller.save();

  // Log activity
  const { logActivityAsync } = require('../../modules/activityLog/activityLog.service');
  logActivityAsync({
    userId: adminId,
    role: 'admin',
    action: 'LOCK_SELLER_FUNDS',
    description: `Admin locked GH₵${amount.toFixed(2)} from seller ${seller.shopName || seller.name}. Reason: ${reason}`,
    req,
    metadata: {
      sellerId: seller._id,
      sellerName: seller.shopName || seller.name,
      amount,
      reason,
    },
  });

  res.status(200).json({
    status: 'success',
    message: `Successfully locked GH₵${amount.toFixed(2)} from seller due to dispute/issue`,
    data: {
      seller: {
        _id: seller._id,
        name: seller.name,
        shopName: seller.shopName,
        email: seller.email,
        balance: seller.balance,
        lockedBalance: seller.lockedBalance,
        pendingBalance: seller.pendingBalance,
        withdrawableBalance: seller.withdrawableBalance,
        lockedReason: seller.lockedReason,
        lockedBy: seller.lockedBy,
        lockedAt: seller.lockedAt,
      },
    },
  });
});

/**
 * Unlock seller funds (admin action)
 * PATCH /api/v1/admin/seller/:id/unlock-funds
 * Body: { amount: Number (optional, unlocks all if not provided), reason: String (optional) }
 */
exports.unlockSellerFunds = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { amount, reason } = req.body;
  const adminId = req.user.id;

  // Find seller
  const seller = await Seller.findById(id);
  if (!seller) {
    return next(new AppError('Seller not found', 404));
  }

  const currentLocked = seller.lockedBalance || 0;

  if (currentLocked === 0) {
    return next(new AppError('No locked funds to unlock', 400));
  }

  // Determine unlock amount
  let unlockAmount = amount;
  if (!unlockAmount || unlockAmount <= 0) {
    // Unlock all if amount not provided
    unlockAmount = currentLocked;
  }

  if (unlockAmount > currentLocked) {
    return next(
      new AppError(
        `Cannot unlock more than locked amount. Locked: GH₵${currentLocked.toFixed(2)}, Requested: GH₵${unlockAmount.toFixed(2)}`,
        400
      )
    );
  }

  // Store old values
  const oldLockedBalance = seller.lockedBalance || 0;
  const oldWithdrawableBalance = seller.withdrawableBalance;

  // Unlock funds (this increases withdrawableBalance automatically via calculateWithdrawableBalance)
  seller.lockedBalance = Math.max(0, (seller.lockedBalance || 0) - unlockAmount);
  
  // Clear reason/date if all funds are unlocked
  if (seller.lockedBalance === 0) {
    seller.lockedReason = null;
    seller.lockedBy = null;
    seller.lockedAt = null;
  }
  
  seller.calculateWithdrawableBalance();

  // Save unlock history in metadata
  if (!seller.metadata) {
    seller.metadata = {};
  }
  if (!seller.metadata.fundUnlocks) {
    seller.metadata.fundUnlocks = [];
  }
  seller.metadata.fundUnlocks.push({
    unlockedBy: adminId,
    unlockedAt: new Date(),
    amount: unlockAmount,
    reason: reason || 'Admin unlock',
    oldLockedBalance,
    newLockedBalance: seller.lockedBalance,
    oldWithdrawableBalance,
    newWithdrawableBalance: seller.withdrawableBalance,
  });

  await seller.save();

  // Log activity
  const { logActivityAsync } = require('../../modules/activityLog/activityLog.service');
  logActivityAsync({
    userId: adminId,
    role: 'admin',
    action: 'UNLOCK_SELLER_FUNDS',
    description: `Admin unlocked GH₵${unlockAmount.toFixed(2)} for seller ${seller.shopName || seller.name}. ${reason ? `Reason: ${reason}` : ''}`,
    req,
    metadata: {
      sellerId: seller._id,
      sellerName: seller.shopName || seller.name,
      amount: unlockAmount,
      reason: reason || 'Admin unlock',
    },
  });

  res.status(200).json({
    status: 'success',
    message: `Successfully unlocked GH₵${unlockAmount.toFixed(2)} for seller`,
    data: {
      seller: {
        _id: seller._id,
        name: seller.name,
        shopName: seller.shopName,
        email: seller.email,
        balance: seller.balance,
        lockedBalance: seller.lockedBalance,
        pendingBalance: seller.pendingBalance,
        withdrawableBalance: seller.withdrawableBalance,
        lockedReason: seller.lockedReason,
        lockedBy: seller.lockedBy,
        lockedAt: seller.lockedAt,
        unlockedAmount: unlockAmount,
      },
    },
  });
});

