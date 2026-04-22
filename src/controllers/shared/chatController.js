const mongoose = require('mongoose');
const ChatConversation = require('../../models/chat/chatConversationModel');
const ChatMessage = require('../../models/chat/chatMessageModel');
const Admin = require('../../models/user/adminModel');
const logger = require('../../utils/logger');
const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');

/** Set CHAT_TRACE=1 to log chat routing ids (no emails/phones). */
const chatTraceEnabled =
  process.env.NODE_ENV === 'development' || process.env.CHAT_TRACE === '1';
const {
  enrichManyConversationsForAdmin,
  enrichConversationForAdmin,
  ensureConversationSellerIdentity,
} = require('../../utils/chatParticipantEnrichment');

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Open convos waiting for an admin (includes legacy active + supportRequestedAt). */
const queueWaitingForAdminClause = {
  $and: [
    { supportRequestedAt: { $ne: null } },
    {
      $or: [{ assignedTo: null }, { assignedTo: { $exists: false } }],
    },
    { chatPhase: { $in: ['awaiting_admin', 'active'] } },
  ],
};

/** Seller dashboard users include official stores; they must map to Seller chat rows. */
const isSellerChatUser = (user) =>
  user?.role === 'seller' || user?.role === 'official_store';

/**
 * Fix conversations created before official_store was mapped to seller (wrong buyer/User row).
 */
const mendSellerConversationIdentity = async (conversation, user) => {
  if (!conversation || !isSellerChatUser(user)) return conversation;
  if (
    conversation.participantRole === 'seller' &&
    conversation.participantModel === 'Seller'
  ) {
    return conversation;
  }
  const displayName =
    user.shopName ||
    user.name ||
    user.fullName ||
    user.email ||
    conversation.participantName ||
    'Seller';
  const updated = await ChatConversation.findByIdAndUpdate(
    conversation._id,
    {
      $set: {
        participantRole: 'seller',
        participantModel: 'Seller',
        participantName: displayName,
      },
    },
    { new: true }
  );
  return updated || conversation;
};

/** Display name for assigned admin (buyer/seller/guest chat UI). */
const conversationClientMeta = async (conv) => {
  if (!conv) return null;
  const o = conv.toObject ? conv.toObject() : conv;
  let assignedAdminName = '';
  if (o.assignedTo) {
    try {
      const a = await Admin.findById(o.assignedTo).select('name email').lean();
      if (a) {
        assignedAdminName = String(a.name || a.email || '').trim().slice(0, 100);
      }
    } catch {
      assignedAdminName = '';
    }
  }
  return {
    chatPhase: o.chatPhase || 'active',
    faqBotStepId: o.faqBotStepId || null,
    lastParticipantMessageAt: o.lastParticipantMessageAt || null,
    supportRequestedAt: o.supportRequestedAt || null,
    supportRequestNote: o.supportRequestNote || '',
    assignedTo: o.assignedTo || null,
    supportAcceptedAt: o.supportAcceptedAt || null,
    assignedAdminName,
  };
};

// Basic UUID-v4 pattern check to avoid arbitrary DB queries
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ─── User / Seller routes ────────────────────────────────

/**
 * GET /api/v1/chat/conversation
 * Get or create the conversation for the authenticated user/seller.
 */
exports.getOrCreateConversation = catchAsync(async (req, res) => {
  const user = req.user;
  const asSeller = isSellerChatUser(user);
  const participantModel = asSeller ? 'Seller' : 'User';
  const participantRole = asSeller ? 'seller' : 'buyer';

  let conversation = await ChatConversation.findOne({ participantId: user._id });

  if (conversation) {
    conversation = await mendSellerConversationIdentity(conversation, user);
  }

  if (!conversation) {
    await ChatConversation.updateOne(
      { participantId: user._id },
      {
        $setOnInsert: {
          participantId: user._id,
          participantModel,
          participantRole,
          participantName: asSeller
            ? user.shopName || user.name || user.email || 'Seller'
            : user.fullName || user.name || user.email || 'User',
          participantEmail: user.email || '',
          participantPhone: user.phone != null ? String(user.phone) : '',
          status: 'open',
          chatPhase: 'faq_bot',
        },
      },
      { upsert: true }
    );
    conversation = await ChatConversation.findOne({ participantId: user._id });
  }

  /** Fix rows where participantId is a Seller doc but role/model still say buyer/User (REST/socket mismatch). */
  if (conversation) {
    conversation = await ensureConversationSellerIdentity(conversation);
  }

  if (chatTraceEnabled && conversation) {
    logger.info('[Chat][REST] getOrCreateConversation', {
      conversationId: String(conversation._id),
      participantId: String(conversation.participantId),
      participantRole: conversation.participantRole,
      participantModel: conversation.participantModel,
      userModelType: user.constructor?.modelName || 'unknown',
      asSeller,
      xPlatform: String(req.headers['x-platform'] || ''),
    });
  }

  res.status(200).json({ status: 'success', data: { conversation } });
});

/**
 * GET /api/v1/chat/messages
 * Get paginated messages for the authenticated user's conversation.
 */
exports.getMyMessages = catchAsync(async (req, res) => {
  const user = req.user;

  let conversation = await ChatConversation.findOne({ participantId: user._id });
  if (!conversation) {
    return res.status(200).json({
      status: 'success',
      data: {
        messages: [],
        conversationId: null,
        status: 'open',
        conversation: null,
      },
    });
  }

  conversation = await mendSellerConversationIdentity(conversation, user);
  conversation = await ensureConversationSellerIdentity(conversation);

  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 50;
  const skip = (page - 1) * limit;

  const messages = await ChatMessage.find({ conversationId: conversation._id })
    .sort({ createdAt: 1 })
    .skip(skip)
    .limit(limit);

  await ChatMessage.updateMany(
    { conversationId: conversation._id, senderRole: 'admin', readAt: null },
    { readAt: new Date() }
  );
  await ChatConversation.findByIdAndUpdate(conversation._id, { unreadByUser: 0 });

  res.status(200).json({
    status: 'success',
    data: {
      messages,
      conversationId: conversation._id,
      status: conversation.status,
      conversation: await conversationClientMeta(conversation),
    },
  });
});

/**
 * GET /api/v1/chat/guest/messages?token=<guestToken>
 * Public endpoint — returns message history for a guest session.
 * Requires the guestToken UUID; no authentication cookie needed.
 */
exports.getGuestMessages = catchAsync(async (req, res, next) => {
  const token = String(req.query.token || '').trim();

  // Validate UUID format to prevent arbitrary lookups
  if (!UUID_RE.test(token)) {
    return next(new AppError('Invalid guest token', 400));
  }

  const conversation = await ChatConversation.findOne({ guestToken: token });
  if (!conversation) {
    return res.status(200).json({
      status: 'success',
      data: {
        messages: [],
        conversationId: null,
        status: 'open',
        conversation: null,
      },
    });
  }

  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 50;
  const skip = (page - 1) * limit;

  const messages = await ChatMessage.find({ conversationId: conversation._id })
    .sort({ createdAt: 1 })
    .skip(skip)
    .limit(limit);

  await ChatMessage.updateMany(
    { conversationId: conversation._id, senderRole: 'admin', readAt: null },
    { readAt: new Date() }
  );
  await ChatConversation.findByIdAndUpdate(conversation._id, { unreadByUser: 0 });

  res.status(200).json({
    status: 'success',
    data: {
      messages,
      conversationId: conversation._id,
      status: conversation.status,
      conversation: await conversationClientMeta(conversation),
    },
  });
});

// ─── Admin routes ────────────────────────────────────────

/**
 * GET /api/v1/admin/chat/conversations
 * Admin: list all conversations, optionally filtered by status.
 */
exports.getAllConversations = catchAsync(async (req, res) => {
  const { status = 'open', page = 1, search = '', assignment = 'all' } = req.query;
  const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 100), 500);
  const skip = (Math.max(1, parseInt(page, 10)) - 1) * limit;

  const conditions = [];

  // Legacy rows may omit `status`; `{ status: 'open' }` alone does NOT match missing `status`.
  if (status !== 'all') {
    if (status === 'open') {
      conditions.push({
        $or: [{ status: 'open' }, { status: { $exists: false } }],
      });
    } else {
      conditions.push({ status });
    }
  }

  const q = String(search || '').trim();
  if (q) {
    const esc = escapeRegex(q);
    const searchOr = [
      { participantName: { $regex: esc, $options: 'i' } },
      { participantEmail: { $regex: esc, $options: 'i' } },
      { participantPhone: { $regex: esc, $options: 'i' } },
      { lastMessage: { $regex: esc, $options: 'i' } },
      { supportRequestNote: { $regex: esc, $options: 'i' } },
    ];
    if (mongoose.Types.ObjectId.isValid(q) && q.length === 24) {
      try {
        searchOr.push({ _id: new mongoose.Types.ObjectId(q) });
      } catch {
        /* ignore invalid cast */
      }
    }
    conditions.push({ $or: searchOr });
  }

  if (assignment === 'pending') {
    conditions.push(queueWaitingForAdminClause);
  } else if (assignment === 'mine') {
    conditions.push({ assignedTo: req.user._id });
  }

  const filter = conditions.length === 0 ? {} : { $and: conditions };

  const [conversationsRaw, total] = await Promise.all([
    // Pending human-support first (numeric sort key — reliable across Mongo versions), then recency.
    ChatConversation.aggregate([
      { $match: filter },
      {
        $addFields: {
          _pendingSort: {
            $cond: [
              {
                $and: [
                  { $ne: ['$supportRequestedAt', null] },
                  { $eq: [{ $ifNull: ['$assignedTo', null] }, null] },
                  {
                    $or: [
                      { $eq: ['$chatPhase', 'awaiting_admin'] },
                      { $eq: ['$chatPhase', 'active'] },
                    ],
                  },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
      { $sort: { _pendingSort: -1, lastMessageAt: -1 } },
      { $project: { _pendingSort: 0 } },
      { $skip: skip },
      { $limit: limit },
    ]),
    ChatConversation.countDocuments(filter),
  ]);

  const conversationsEnriched = await enrichManyConversationsForAdmin(conversationsRaw);

  const totalUnread = await ChatConversation.countDocuments({
    $and: [
      {
        $or: [{ status: 'open' }, { status: { $exists: false } }],
      },
      {
        $or: [{ unreadByAdmin: { $gt: 0 } }, queueWaitingForAdminClause],
      },
    ],
  });

  res.status(200).json({
    status: 'success',
    data: {
      conversations: conversationsEnriched,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      totalUnread,
    },
  });
});

/**
 * GET /api/v1/admin/chat/conversations/:id/messages
 * Admin: get messages for a specific conversation.
 */
exports.getConversationMessages = catchAsync(async (req, res, next) => {
  let conversation = await ChatConversation.findById(req.params.id);
  if (!conversation) return next(new AppError('Conversation not found', 404));
  conversation = await ensureConversationSellerIdentity(conversation);

  const phase = conversation.chatPhase || 'active';
  if (
    ['buyer', 'guest', 'seller'].includes(conversation.participantRole) &&
    phase === 'active' &&
    conversation.assignedTo &&
    String(conversation.assignedTo) !== String(req.user._id)
  ) {
    return next(new AppError('Only the assigned admin can open this chat.', 403));
  }

  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 50;
  const skip = (page - 1) * limit;

  const messages = await ChatMessage.find({ conversationId: req.params.id })
    .sort({ createdAt: 1 })
    .skip(skip)
    .limit(limit);

  // Mark user messages as read
  await ChatMessage.updateMany(
    { conversationId: req.params.id, senderRole: { $ne: 'admin' }, readAt: null },
    { readAt: new Date() }
  );
  await ChatConversation.findByIdAndUpdate(req.params.id, { unreadByAdmin: 0 });

  const conversationEnriched = await enrichConversationForAdmin(conversation);

  res.status(200).json({
    status: 'success',
    data: { messages, conversation: conversationEnriched },
  });
});

/**
 * PATCH /api/v1/admin/chat/conversations/:id/close
 */
exports.closeConversation = catchAsync(async (req, res, next) => {
  const conversation = await ChatConversation.findByIdAndUpdate(
    req.params.id,
    { status: 'closed' },
    { new: true }
  );
  if (!conversation) return next(new AppError('Conversation not found', 404));
  res.status(200).json({ status: 'success', data: { conversation } });
});

/**
 * PATCH /api/v1/admin/chat/conversations/:id/reopen
 */
exports.reopenConversation = catchAsync(async (req, res, next) => {
  const conversation = await ChatConversation.findByIdAndUpdate(
    req.params.id,
    { status: 'open' },
    { new: true }
  );
  if (!conversation) return next(new AppError('Conversation not found', 404));
  res.status(200).json({ status: 'success', data: { conversation } });
});

/**
 * GET /api/v1/admin/chat/stats
 */
exports.getChatStats = catchAsync(async (req, res) => {
  const openOrLegacy = {
    $or: [{ status: 'open' }, { status: { $exists: false } }],
  };
  const [open, closed, totalUnread, pendingSupportRequests] = await Promise.all([
    ChatConversation.countDocuments(openOrLegacy),
    ChatConversation.countDocuments({ status: 'closed' }),
    ChatConversation.countDocuments({
      $and: [
        openOrLegacy,
        {
          $or: [{ unreadByAdmin: { $gt: 0 } }, queueWaitingForAdminClause],
        },
      ],
    }),
    ChatConversation.countDocuments({
      $and: [openOrLegacy, queueWaitingForAdminClause],
    }),
  ]);
  res.status(200).json({
    status: 'success',
    data: { open, closed, totalUnread, pendingSupportRequests },
  });
});
