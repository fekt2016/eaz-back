const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const ChatConversation = require('../models/chat/chatConversationModel');
const ChatMessage = require('../models/chat/chatMessageModel');
const Admin = require('../models/user/adminModel');
const logger = require('../utils/logger');
const {
  persistParticipantSnapshotIfNeeded,
  ensureConversationSellerIdentity,
} = require('../utils/chatParticipantEnrichment');

/** Set CHAT_TRACE=1 to log chat participant ids (compare with REST getOrCreateConversation). */
const chatTraceEnabled =
  process.env.NODE_ENV === 'development' || process.env.CHAT_TRACE === '1';
const {
  INITIAL_STEP_ID,
  applyBotOption,
} = require('../config/supportFaqBot');

/** Legacy rows without chatPhase stay in full human chat (pre–FAQ flow). */
const getEffectiveChatPhase = (conv) => {
  if (!conv || !conv.chatPhase) return 'active';
  return conv.chatPhase;
};

const ownsConversationSocket = (socket, conv) => {
  if (socket.isGuest) {
    return String(conv.guestToken || '') === String(socket.guestToken || '');
  }
  return conv.participantId && String(conv.participantId) === String(socket.userId);
};

const canAdminJoinConversationRoom = (socket, conv) => {
  if (!conv) return false;
  const phase = getEffectiveChatPhase(conv);
  if (phase === 'awaiting_admin') return false;
  if (!conv.assignedTo) return true;
  return String(conv.assignedTo) === String(socket.userId);
};

const canAdminSendMessage = (socket, conv) => {
  if (!conv) return false;
  const phase = getEffectiveChatPhase(conv);
  if (phase !== 'active') return false;
  if (!conv.assignedTo) return true;
  return String(conv.assignedTo) === String(socket.userId);
};

const CHAT_USER_INACTIVITY_MS = parseInt(
  process.env.CHAT_USER_INACTIVITY_MS || String(10 * 60 * 1000),
  10
);

/** convId string → Set(socket.id) for buyer/guest/seller tabs (admin excluded). */
const participantSocketIdsByConv = new Map();

function addParticipantSocket(io, convId, socketId) {
  if (!convId || !socketId) return;
  const id = String(convId);
  if (!participantSocketIdsByConv.has(id)) {
    participantSocketIdsByConv.set(id, new Set());
  }
  participantSocketIdsByConv.get(id).add(socketId);
  emitParticipantPresenceToAdmins(io, id);
}

function removeParticipantSocket(io, convId, socketId) {
  if (!convId || !socketId) return;
  const id = String(convId);
  const set = participantSocketIdsByConv.get(id);
  if (!set) return;
  set.delete(socketId);
  if (set.size === 0) participantSocketIdsByConv.delete(id);
  emitParticipantPresenceToAdmins(io, id);
}

function emitParticipantPresenceToAdmins(io, convId) {
  const id = String(convId);
  const set = participantSocketIdsByConv.get(id);
  const online = !!(set && set.size > 0);
  io.to('admin-room').emit('chat:participant_presence', {
    conversationId: id,
    online,
  });
}

function buildParticipantPresenceSnapshot() {
  const onlineByConversationId = {};
  for (const [cid, set] of participantSocketIdsByConv.entries()) {
    if (set && set.size > 0) onlineByConversationId[cid] = true;
  }
  return onlineByConversationId;
}

/** Matches admin list queue + legacy active + supportRequestedAt (unassigned). */
const queueWaitingForAdminFilter = () => ({
  $and: [
    { supportRequestedAt: { $ne: null } },
    {
      $or: [{ assignedTo: null }, { assignedTo: { $exists: false } }],
    },
    { chatPhase: { $in: ['awaiting_admin', 'active'] } },
  ],
});

async function countOpenAdminChatAttention() {
  const openOrLegacy = {
    $or: [{ status: 'open' }, { status: { $exists: false } }],
  };
  return ChatConversation.countDocuments({
    $and: [
      openOrLegacy,
      {
        $or: [
          { unreadByAdmin: { $gt: 0 } },
          queueWaitingForAdminFilter(),
        ],
      },
    ],
  });
}

const conversationJoinPayload = (conversation) => ({
  conversationId: conversation._id != null ? String(conversation._id) : conversation._id,
  status: conversation.status,
  chatPhase: getEffectiveChatPhase(conversation),
  faqBotStepId: conversation.faqBotStepId || null,
  lastParticipantMessageAt: conversation.lastParticipantMessageAt || null,
  supportRequestedAt: conversation.supportRequestedAt || null,
  supportRequestNote: conversation.supportRequestNote || '',
  assignedTo: conversation.assignedTo || null,
  supportAcceptedAt: conversation.supportAcceptedAt || null,
});

/** Join payload + assigned admin display name when an agent is already assigned. */
async function conversationJoinPayloadForParticipant(conversation) {
  const base = conversationJoinPayload(conversation);
  if (!conversation.assignedTo) {
    return { ...base, assignedAdminName: '' };
  }
  try {
    const adminDoc = await Admin.findById(conversation.assignedTo)
      .select('name email')
      .lean();
    const assignedAdminName = cleanStr(
      adminDoc?.name || adminDoc?.email || '',
      100
    );
    return { ...base, assignedAdminName };
  } catch {
    return { ...base, assignedAdminName: '' };
  }
}

/**
 * Plain conversation for admin-room broadcasts: string ids so Socket.io/JSON clients
 * always resolve `conversationListId` (avoids ObjectId / EJSON edge cases on the admin UI).
 */
function conversationPayloadForAdminBroadcast(conversation) {
  if (!conversation) return conversation;
  const o =
    conversation && typeof conversation.toObject === 'function'
      ? conversation.toObject({ virtuals: false })
      : { ...conversation };
  if (o._id != null) o._id = String(o._id);
  if (o.participantId != null) o.participantId = String(o.participantId);
  if (o.assignedTo != null) o.assignedTo = String(o.assignedTo);
  return o;
}

// ─── Helpers ─────────────────────────────────────────────

const parseCookies = (cookieStr) => {
  const out = {};
  if (!cookieStr) return out;
  cookieStr.split(';').forEach((part) => {
    const eq = part.indexOf('=');
    if (eq < 0) return;
    const key = part.slice(0, eq).trim();
    const raw = part.slice(eq + 1).trim();
    try { out[key] = decodeURIComponent(raw); } catch { out[key] = raw; }
  });
  return out;
};

const decodeToken = (token) => {
  if (!token) return null;
  try { return jwt.verify(token, process.env.JWT_SECRET); }
  catch { return null; }
};

const sanitize = (str) =>
  String(str || '')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .trim();

/** Basic email format check */
const isValidEmail = (str) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str || '');

/** Trim and cap a name/email string */
const cleanStr = (s, max = 100) => String(s || '').trim().slice(0, max);

/**
 * Normalize conversation/user id from socket payloads (string, ObjectId, EJSON {$oid}, nested {_id}).
 * Avoids String(object) → "[object Object]" which breaks Mongoose casts.
 */
function normalizeSocketObjectId(raw) {
  if (raw == null || raw === '') return '';
  if (typeof raw === 'object') {
    if (raw.$oid != null) return String(raw.$oid);
    if (raw._id != null) return normalizeSocketObjectId(raw._id);
    if (raw.id != null) return normalizeSocketObjectId(raw.id);
    if (raw.conversationId != null) return normalizeSocketObjectId(raw.conversationId);
    if (typeof raw.toHexString === 'function') return raw.toHexString();
    if (typeof raw.toString === 'function') {
      const s = raw.toString();
      if (s && s !== '[object Object]') return s;
    }
    return '';
  }
  return String(raw);
}

/** Trim and extract a 24-char hex ObjectId string from noisy client payloads. */
function strictObjectIdHexFromPayload(raw) {
  const s = normalizeSocketObjectId(raw).trim();
  if (/^[a-fA-F0-9]{24}$/i.test(s)) return s.toLowerCase();
  const m = s.match(/[a-fA-F0-9]{24}/i);
  return m ? m[0].toLowerCase() : '';
}

/**
 * Resolve a Mongo ObjectId hex string from admin socket payloads.
 * strictObjectIdHexFromPayload alone misses valid ids when separators break the {24} run
 * or when the client sends a value mongoose can still parse.
 */
function parseConversationObjectIdFromPayload(raw) {
  if (raw == null || raw === '') return '';
  if (Buffer.isBuffer(raw)) {
    try {
      return new mongoose.Types.ObjectId(raw).toString();
    } catch {
      return '';
    }
  }

  const normalized = normalizeSocketObjectId(raw).trim();
  if (!normalized) return '';

  let hex = strictObjectIdHexFromPayload(raw);
  if (hex) return hex;

  try {
    return new mongoose.Types.ObjectId(normalized).toString();
  } catch {
    /* continue */
  }

  const compact = normalized.replace(/[^a-fA-F0-9]/g, '');
  if (compact.length === 24) {
    try {
      return new mongoose.Types.ObjectId(compact).toString();
    } catch {
      return '';
    }
  }
  if (compact.length > 24) {
    const tail = compact.slice(-24);
    try {
      return new mongoose.Types.ObjectId(tail).toString();
    } catch {
      return '';
    }
  }
  return '';
}

/** Admin dashboard JWT roles (Admin collection). */
function isAdminSocketRole(role) {
  return (
    role === 'admin' ||
    role === 'superadmin' ||
    role === 'support_agent'
  );
}

/** Buyer/seller/guest live support: all staffed admin roles. */
function isLiveSupportAgentRole(role) {
  return isAdminSocketRole(role);
}

// ─── Socket.io auth middleware ────────────────────────────

const attachUserFromJwt = (socket, decoded, roleHint) => {
  socket.userId = decoded.id || decoded._id;
  const dr = decoded.role;

  let socketRole;
  if (roleHint === 'official_store') {
    socketRole = 'seller';
  } else if (roleHint === 'buyer') {
    socketRole = 'buyer';
  } else if (roleHint === 'admin') {
    const normalizedDr = dr === 'moderator' ? 'support_agent' : dr;
    socketRole = ['support_agent', 'admin', 'superadmin'].includes(normalizedDr)
      ? normalizedDr
      : 'admin';
  } else if (roleHint === 'seller') {
    socketRole = dr === 'official_store' ? 'seller' : dr || 'seller';
  } else {
    socketRole = roleHint === 'official_store' ? 'seller' : roleHint;
  }

  socket.userRole = socketRole;
  socket.userName = decoded.name || decoded.fullName || decoded.email || roleHint;
  socket.userModel = isAdminSocketRole(socketRole)
    ? 'Admin'
    : socketRole === 'seller' || dr === 'official_store'
      ? 'Seller'
      : 'User';
  socket.isGuest = false;
};

const tryJwtCookiePairs = (socket, cookies, pairs, explicitToken = null) => {
  for (const [cookieName, role] of pairs) {
    const token = cookies[cookieName] || explicitToken;
    if (!token) continue;
    const decoded = decodeToken(token);
    if (!decoded) continue;
    attachUserFromJwt(socket, decoded, role);
    return true;
  }
  return false;
};

/** Avoid duplicate-key races when two sockets create the same conversation. */
const findOrCreateConversation = async (findQuery, createPayload) => {
  let doc = await ChatConversation.findOne(findQuery);
  if (doc) return { doc, created: false };
  try {
    // Use upsert instead of create so Mongoose defaults do not force nullable
    // unique fields (e.g. guestToken=null) onto non-guest conversations.
    await ChatConversation.updateOne(
      findQuery,
      { $setOnInsert: createPayload },
      { upsert: true }
    );
    doc = await ChatConversation.findOne(findQuery);
    return { doc, created: true };
  } catch (err) {
    if (err && err.code === 11000) {
      doc = await ChatConversation.findOne(findQuery);
      if (doc) return { doc, created: false };
    }
    throw err;
  }
};

const socketAuth = (socket, next) => {
  try {
    const cookies = parseCookies(socket.handshake.headers.cookie);
    const rawAuth = socket.handshake.auth;
    const auth =
      rawAuth && typeof rawAuth === 'object' && !Array.isArray(rawAuth) ? rawAuth : {};
    const chatAsRaw = auth.chatAs;
    const chatAs =
      typeof chatAsRaw === 'string' ? chatAsRaw.trim().toLowerCase() : '';
    const { guestName, guestEmail, guestToken } = auth;

    // Clients must send chatAs so we do not pick seller_jwt/admin_jwt on the buyer site (common when
    // multiple dashboards share one browser). Legacy clients omit chatAs → old cookie order + guest.
    const legacyPairs = [
      ['admin_jwt', 'admin'],
      ['seller_jwt', 'seller'],
      ['user_jwt', 'buyer'],
      ['main_jwt', 'buyer'],
    ];

    if (chatAs === 'admin') {
      if (tryJwtCookiePairs(socket, cookies, [['admin_jwt', 'admin']])) {
        if (!isLiveSupportAgentRole(socket.userRole)) {
          logger.warn('[Chat] socket auth failed', { reason: 'admin_live_chat_forbidden' });
          return next(new Error('Live support chat is not available for your role.'));
        }
        return next();
      }
      logger.warn('[Chat] socket auth failed', { reason: 'admin_no_valid_cookie' });
      return next(new Error('Authentication required'));
    }

    if (chatAs === 'seller') {
      if (tryJwtCookiePairs(socket, cookies, [['seller_jwt', 'seller']], auth.token)) {
        return next();
      }
      logger.warn('[Chat] socket auth failed', { reason: 'seller_no_valid_cookie' });
      return next(new Error('Authentication required'));
    }

    if (chatAs === 'buyer') {
      if (
        tryJwtCookiePairs(socket, cookies, [
          ['user_jwt', 'buyer'],
          ['main_jwt', 'buyer'],
        ])
      ) {
        if (
          socket.userRole === 'buyer' &&
          !mongoose.Types.ObjectId.isValid(String(socket.userId))
        ) {
          logger.warn('[Chat] socket auth failed', { reason: 'buyer_jwt_invalid_subject' });
          return next(new Error('Authentication required'));
        }
        return next();
      }
      // Do not fall back to seller/admin cookies on the buyer app
    } else if (tryJwtCookiePairs(socket, cookies, legacyPairs)) {
      return next();
    }

    const name = cleanStr(guestName, 80);
    const email = cleanStr(guestEmail, 200);
    const token = cleanStr(guestToken, 128);
    const guestEmailTrimmed =
      typeof guestEmail === 'string' ? guestEmail.trim() : '';

    if (name && token) {
      if (guestEmailTrimmed && !isValidEmail(email)) {
        logger.warn('[Chat] socket auth failed', { reason: 'guest_invalid_email' });
        return next(new Error('Invalid guest email'));
      }

      socket.userId = null;
      socket.userRole = 'guest';
      socket.userName = name;
      socket.userModel = 'Guest';
      socket.guestToken = token;
      socket.guestEmail = email;
      socket.isGuest = true;
      return next();
    }

    logger.warn('[Chat] socket auth failed', {
      reason: chatAs === 'buyer' ? 'buyer_no_cookie_or_guest' : 'no_valid_session',
      chatAs: chatAs || 'legacy',
    });
    return next(new Error('Authentication required'));
  } catch (err) {
    logger.error('[Chat] socket auth exception', { message: err.message });
    return next(new Error('Authentication required'));
  }
};

// ─── Main handler ─────────────────────────────────────────

module.exports = (io) => {
  io.use(socketAuth);

  io.on('connection', async (socket) => {
    const { userId, userRole, userName, userModel, isGuest } = socket;
    logger.info(`[Chat] Connected: ${userRole} ${isGuest ? `(guest:${socket.guestToken})` : userId} (${userName})`);

    // Register before async findOrCreate: client `connect` fires immediately; early
    // `chat:submit_support_request` emits were dropped (no listener yet) → “nothing happened”.
    if (!isAdminSocketRole(userRole)) {
      socket.on('chat:submit_support_request', async (data) => {
        const note = String(data?.note || '')
          .replace(/[<>]/g, '')
          .trim()
          .slice(0, 500);
        try {
          if (!socket.conversationId) {
            socket.emit('chat:error', {
              message: 'Chat is still starting. Wait a second and try again.',
            });
            return;
          }
          const conv = await ChatConversation.findById(socket.conversationId);
          if (!conv) {
            socket.emit('chat:error', { message: 'Conversation not found. Refresh and try again.' });
            return;
          }
          if (!ownsConversationSocket(socket, conv)) {
            socket.emit('chat:error', { message: 'You cannot update this conversation.' });
            return;
          }
          const rawPhase = conv.chatPhase || 'active';
          if (conv.supportRequestedAt) {
            socket.emit('chat:error', { message: 'You already have a pending request.' });
            return;
          }
          const notePreview = note.trim().slice(0, 72);
          const lastMessageForQueue = notePreview
            ? `Support request: ${notePreview}`
            : 'Requested live support';
          const queueActivityAt = new Date();
          /** Legacy rows may omit `status`; `{ status: 'open' }` alone does not match. */
          const convStatusOpen =
            !conv.status || conv.status === 'open' || String(conv.status) === '';
          const legacyActiveUnassigned =
            rawPhase === 'active' && !conv.assignedTo;
          const legacyActiveStaleAssignee =
            rawPhase === 'active' &&
            conv.assignedTo &&
            !conv.supportRequestedAt &&
            convStatusOpen;
          const wasClosed = conv.status === 'closed';

          if (
            rawPhase === 'faq_bot' ||
            rawPhase === 'await_human_choice' ||
            legacyActiveUnassigned ||
            legacyActiveStaleAssignee ||
            wasClosed
          ) {
            await ChatConversation.findByIdAndUpdate(conv._id, {
              $set: {
                chatPhase: 'awaiting_admin',
                faqBotStepId: null,
                supportRequestNote: note,
                supportRequestedAt: queueActivityAt,
                lastParticipantMessageAt: queueActivityAt,
                lastMessage: lastMessageForQueue,
                lastMessageAt: queueActivityAt,
                status: 'open',
              },
              $unset: { assignedTo: 1, supportAcceptedAt: 1 },
              $inc: { unreadByAdmin: 1 },
            });
          } else if (rawPhase === 'awaiting_admin') {
            await ChatConversation.findByIdAndUpdate(conv._id, {
              $set: {
                supportRequestNote: note,
                supportRequestedAt: queueActivityAt,
                lastParticipantMessageAt: queueActivityAt,
                lastMessage: lastMessageForQueue,
                lastMessageAt: queueActivityAt,
              },
              $unset: { assignedTo: 1, supportAcceptedAt: 1 },
              $inc: { unreadByAdmin: 1 },
            });
          } else {
            socket.emit('chat:error', { message: 'A support request is not available right now.' });
            return;
          }
          let updated = await ChatConversation.findById(conv._id);
          if (updated) {
            updated = await ensureConversationSellerIdentity(updated);
          }
          const plain = conversationPayloadForAdminBroadcast(updated);
          io.to('admin-room').emit('chat:new_support_request', { conversation: plain });
          const cnt = await countOpenAdminChatAttention();
          io.to('admin-room').emit('chat:admin_unread_count', { count: cnt });
          io.to('admin-room').emit('chat:conversation_updated', { conversation: plain });
          logger.info('[Chat] new_support_request notified admin-room', {
            conversationId: String(updated._id),
            participantRole: plain.participantRole,
            ...(chatTraceEnabled && {
              participantId: plain.participantId != null ? String(plain.participantId) : '',
              socketUserId: String(socket.userId),
              idsMatch: String(conv.participantId) === String(socket.userId),
            }),
          });
          socket.emit('chat:support_request_ack', conversationJoinPayload(updated));
        } catch (e) {
          logger.error('[Chat] submit_support_request:', e.message);
          socket.emit('chat:error', { message: 'Could not send request.' });
        }
      });
    }

    try {
      if (isLiveSupportAgentRole(userRole)) {
        // ── Admin / superadmin live support ───────────────
        socket.join('admin-room');

        const unreadCount = await countOpenAdminChatAttention();
        socket.emit('chat:admin_unread_count', { count: unreadCount });
        socket.emit('chat:participant_presence_snapshot', {
          onlineByConversationId: buildParticipantPresenceSnapshot(),
        });

        socket.on('chat:join_conversation', async (payload = {}) => {
          const rawConv =
            typeof payload === 'string'
              ? payload
              : payload?.conversationId ?? payload?.conversation_id ?? payload?.id;
          const conversationId = parseConversationObjectIdFromPayload(rawConv);
          if (!conversationId) return;
          if (!mongoose.Types.ObjectId.isValid(conversationId)) {
            return;
          }

          const conv = await ChatConversation.findById(conversationId);
          if (!conv) return;
          if (!canAdminJoinConversationRoom(socket, conv)) {
            socket.emit('chat:error', {
              message: 'Accept this support request first to open the chat.',
            });
            return;
          }
          socket.join(`conv-${conversationId}`);
          socket.currentConvId = conversationId;

          await ChatMessage.updateMany(
            { conversationId, senderRole: { $ne: 'admin' }, readAt: null },
            { readAt: new Date() }
          );
          await ChatConversation.findByIdAndUpdate(conversationId, { unreadByAdmin: 0 });
          socket.emit('chat:messages_read', { conversationId });
        });

        socket.on('chat:accept_support_request', async (payload = {}) => {
          const rawConv =
            typeof payload === 'string'
              ? payload
              : payload?.conversationId ?? payload?.conversation_id ?? payload?.id;
          const conversationId = parseConversationObjectIdFromPayload(rawConv);
          if (!conversationId) {
            if (process.env.NODE_ENV === 'development') {
              logger.warn('[Chat] accept_support_request: invalid id (parse empty)', {
                rawType: typeof rawConv,
                payloadKeys:
                  payload && typeof payload === 'object' && !Array.isArray(payload)
                    ? Object.keys(payload)
                    : [],
              });
            }
            socket.emit('chat:error', {
              code: 'ACCEPT_FAILED',
              message: 'Invalid conversation id.',
            });
            return;
          }
          if (!mongoose.Types.ObjectId.isValid(conversationId)) {
            if (process.env.NODE_ENV === 'development') {
              logger.warn('[Chat] accept_support_request: invalid id (ObjectId.isValid false)', {
                idLength: String(conversationId).length,
                idPrefix: String(conversationId).slice(0, 4),
              });
            }
            socket.emit('chat:error', {
              code: 'ACCEPT_FAILED',
              message: 'Invalid conversation id.',
            });
            return;
          }

          const adminIdStr = userId != null ? String(userId) : '';
          if (!mongoose.Types.ObjectId.isValid(adminIdStr)) {
            logger.error('[Chat] accept_support_request: invalid admin session id');
            socket.emit('chat:error', {
              code: 'ACCEPT_FAILED',
              message: 'Session invalid. Please sign in again.',
            });
            return;
          }

          try {
            // const debugDoc = await ChatConversation.findById(conversationId).lean();
            // logger.info('[Chat] accept_request debug', {
            //   conversationId,
         

            const updated = await ChatConversation.findOneAndUpdate(
              {
                _id: conversationId,
                chatPhase: 'awaiting_admin',
                supportRequestedAt: { $ne: null },
                assignedTo: null,
                participantRole: { $in: ['buyer', 'guest', 'seller'] },
                status: 'open',
              },
              {
                $set: {
                  chatPhase: 'active',
                  assignedTo: adminIdStr,
                  supportAcceptedAt: new Date(),
                },
              },
              { new: true }
            );
            if (!updated) {
              socket.emit('chat:error', {
                code: 'ACCEPT_FAILED',
                message: 'This request was already taken or is no longer available.',
              });
              return;
            }
            socket.join(`conv-${conversationId}`);
            const plain = conversationPayloadForAdminBroadcast(updated);
            let assignedAdminName = '';
            try {
              const adminDoc = await Admin.findById(adminIdStr).select('name email').lean();
              assignedAdminName = cleanStr(
                adminDoc?.name || adminDoc?.email || socket.userName || '',
                100
              );
            } catch {
              assignedAdminName = cleanStr(socket.userName || '', 100);
            }
            const participantSupportPayload = {
              ...conversationJoinPayload(updated),
              assignedAdminName,
            };
            io.to(`conv-${conversationId}`).emit('chat:support_accepted', {
              conversationId: String(conversationId),
              conversation: participantSupportPayload,
            });
            io.to('admin-room').emit('chat:support_request_claimed', {
              conversationId: String(conversationId),
              assignedTo: adminIdStr,
            });
            const cnt = await countOpenAdminChatAttention();
            io.to('admin-room').emit('chat:admin_unread_count', { count: cnt });
            io.to('admin-room').emit('chat:conversation_updated', {
              conversation: plain,
            });
          } catch (err) {
            logger.error('[Chat] accept_support_request:', err.message);
            if (process.env.NODE_ENV === 'development') {
              logger.error('[Chat] accept_support_request stack:', err.stack);
            }
            socket.emit('chat:error', {
              code: 'ACCEPT_FAILED',
              message: 'Could not accept request.',
            });
          }
        });

        socket.on('chat:leave_conversation', ({ conversationId } = {}) => {
          if (conversationId) socket.leave(`conv-${conversationId}`);
        });

        socket.on('chat:close_conversation', async ({ conversationId } = {}) => {
          if (!conversationId) return;
          try {
            await ChatConversation.findByIdAndUpdate(conversationId, { status: 'closed' });
            io.to(`conv-${conversationId}`).emit('chat:conversation_closed', { conversationId });
            io.to('admin-room').emit('chat:conversation_updated', {
              conversation: { _id: String(conversationId), status: 'closed' },
            });
          } catch (err) {
            logger.error('[Chat] close_conversation error:', err.message);
          }
        });

        socket.on('chat:reopen_conversation', async ({ conversationId } = {}) => {
          if (!conversationId) return;
          try {
            await ChatConversation.findByIdAndUpdate(conversationId, { status: 'open' });
            io.to(`conv-${conversationId}`).emit('chat:conversation_reopened', { conversationId });
            io.to('admin-room').emit('chat:conversation_updated', {
              conversation: { _id: String(conversationId), status: 'open' },
            });
          } catch (err) {
            logger.error('[Chat] reopen_conversation error:', err.message);
          }
        });

        socket.on('chat:admin_end_inactive', async ({ conversationId } = {}) => {
          if (!conversationId) return;
          try {
            const conv = await ChatConversation.findById(conversationId);
            if (!conv || conv.status === 'closed') return;
            if (!canAdminSendMessage(socket, conv)) {
              socket.emit('chat:error', { message: 'You cannot end this chat.' });
              return;
            }
            let lastMs = conv.lastParticipantMessageAt
              ? new Date(conv.lastParticipantMessageAt).getTime()
              : 0;
            if (!lastMs && conv.supportAcceptedAt) {
              lastMs = new Date(conv.supportAcceptedAt).getTime();
            }
            if (!lastMs && conv.lastMessageAt) {
              lastMs = new Date(conv.lastMessageAt).getTime();
            }
            if (!lastMs || Date.now() - lastMs < CHAT_USER_INACTIVITY_MS) {
              socket.emit('chat:error', {
                code: 'INACTIVITY_TOO_SOON',
                message: 'The visitor was active recently. You can close the chat normally if needed.',
              });
              return;
            }
            await ChatConversation.findByIdAndUpdate(conversationId, { status: 'closed' });
            io.to(`conv-${conversationId}`).emit('chat:conversation_closed', {
              conversationId: String(conversationId),
              reason: 'inactivity',
            });
            io.to('admin-room').emit('chat:conversation_updated', {
              conversation: { _id: String(conversationId), status: 'closed' },
            });
          } catch (err) {
            logger.error('[Chat] admin_end_inactive:', err.message);
            socket.emit('chat:error', { message: 'Could not end chat.' });
          }
        });

      } else if (isAdminSocketRole(userRole)) {
        // Moderator (or future read-only admin): no buyer/seller chat agent access
        socket.emit('chat:error', {
          code: 'LIVE_CHAT_FORBIDDEN',
          message: 'Live support chat is not available for your role.',
        });
        return;
      } else if (isGuest) {
        // ── Guest ─────────────────────────────────────────
        const { doc: conversation, created } = await findOrCreateConversation(
          { guestToken: socket.guestToken },
          {
            participantModel: 'Guest',
            participantRole: 'guest',
            participantName: socket.userName,
            participantEmail: socket.guestEmail || '',
            guestToken: socket.guestToken,
            status: 'open',
          }
        );

        socket.conversationId = conversation._id.toString();
        socket.join(`conv-${conversation._id}`);

        socket.emit(
          'chat:conversation_joined',
          await conversationJoinPayloadForParticipant(conversation)
        );
        addParticipantSocket(io, socket.conversationId, socket.id);

        // Notify admin-room about this guest so they appear in the list immediately.
        const convPlain = conversationPayloadForAdminBroadcast(conversation);
        if (created) {
          io.to('admin-room').emit('chat:new_conversation', { conversation: convPlain });
        } else {
          io.to('admin-room').emit('chat:conversation_updated', { conversation: convPlain });
        }
      } else {
        // ── Authenticated Buyer / Seller (same FAQ → queue → human flow as guests) ──
        let { doc: conversation, created } = await findOrCreateConversation(
          { participantId: userId },
          {
            participantId: userId,
            participantModel: userModel,
            participantRole: userRole,
            participantName: userName,
            participantEmail: '',
            participantPhone: '',
            status: 'open',
            chatPhase: 'faq_bot',
          }
        );
        // participantId may reference a Seller doc while role/model still say buyer/User (legacy / bugs).
        if (conversation) {
          const fixed = await ensureConversationSellerIdentity(conversation);
          if (fixed) conversation = fixed;
        }
        try {
          await persistParticipantSnapshotIfNeeded(conversation);
        } catch (persistErr) {
          logger.warn('[Chat] persistParticipantSnapshotIfNeeded failed', {
            message: persistErr.message,
          });
        }

        socket.conversationId = conversation._id.toString();
        socket.join(`conv-${conversation._id}`);

        socket.emit(
          'chat:conversation_joined',
          await conversationJoinPayloadForParticipant(conversation)
        );
        addParticipantSocket(io, socket.conversationId, socket.id);

        if (chatTraceEnabled && conversation) {
          logger.info('[Chat][socket] participant_conversation_ready', {
            socketUserId: String(userId),
            userRole,
            userModel,
            conversationId: String(conversation._id),
            participantId: String(conversation.participantId),
            participantRole: conversation.participantRole,
            participantModel: conversation.participantModel,
            idsMatch: String(conversation.participantId) === String(userId),
          });
        }

        // Notify admin-room about this participant so the admin sees them immediately.
        // For brand-new conversations emit chat:new_conversation; for reconnects just
        // emit chat:conversation_updated so the admin's unread / phase counts stay fresh.
        const convPlain = conversationPayloadForAdminBroadcast(conversation);
        if (created) {
          io.to('admin-room').emit('chat:new_conversation', { conversation: convPlain });
        } else {
          io.to('admin-room').emit('chat:conversation_updated', { conversation: convPlain });
        }
      }
    } catch (err) {
      logger.error('[Chat] Connection setup error:', err.message);
      socket.emit('chat:error', { message: 'Connection error, please refresh.' });
      return;
    }

    // ── Buyer / guest / seller: FAQ + session actions (submit_support_request registered above) ──
    if (!isAdminSocketRole(userRole)) {
      socket.on('chat:faq_bot_action', async (data) => {
        const optionId = String(data?.optionId || '').trim();
        if (!optionId) return;
        try {
          const conv = await ChatConversation.findById(socket.conversationId);
          if (!conv || !ownsConversationSocket(socket, conv)) return;
          if (conv.status === 'closed') return;
          if ((conv.chatPhase || '') !== 'faq_bot') {
            socket.emit('chat:error', { message: 'The guided help flow is not active.' });
            return;
          }
          const current = conv.faqBotStepId || INITIAL_STEP_ID;
          const result = applyBotOption(current, optionId);
          if (result.error) {
            socket.emit('chat:error', { message: result.error });
            return;
          }
          if (result.endSelf) {
            await ChatConversation.findByIdAndUpdate(conv._id, {
              status: 'closed',
              faqBotStepId: null,
              lastParticipantMessageAt: new Date(),
            });
            const upd = await ChatConversation.findById(conv._id);
            io.to(`conv-${conv._id}`).emit('chat:conversation_closed', {
              conversationId: String(conv._id),
            });
            io.to('admin-room').emit('chat:conversation_updated', {
              conversation: conversationPayloadForAdminBroadcast(upd),
            });
            socket.emit('chat:faq_bot_progress', {
              reply: result.reply,
              ended: true,
              closed: true,
              conversation: conversationJoinPayload(upd),
            });
            return;
          }
          if (result.requestHuman) {
            await ChatConversation.findByIdAndUpdate(conv._id, {
              chatPhase: 'await_human_choice',
              faqBotStepId: null,
              lastParticipantMessageAt: new Date(),
            });
            const upd = await ChatConversation.findById(conv._id);
            socket.emit('chat:faq_bot_progress', {
              reply: result.reply,
              ended: true,
              phase: 'await_human_choice',
              conversation: conversationJoinPayload(upd),
            });
            socket.emit('chat:conversation_joined', conversationJoinPayload(upd));
            return;
          }
          await ChatConversation.findByIdAndUpdate(conv._id, {
            faqBotStepId: result.nextStepId,
            lastParticipantMessageAt: new Date(),
          });
          const upd = await ChatConversation.findById(conv._id);
          socket.emit('chat:faq_bot_progress', {
            reply: result.reply,
            stepId: result.nextStepId,
            ended: false,
            conversation: conversationJoinPayload(upd),
          });
        } catch (e) {
          logger.error('[Chat] faq_bot_action:', e.message);
          socket.emit('chat:error', { message: 'Could not continue help flow.' });
        }
      });

      socket.on('chat:participant_end_conversation', async () => {
        try {
          const conv = await ChatConversation.findById(socket.conversationId);
          if (!conv || !ownsConversationSocket(socket, conv) || conv.status === 'closed') return;
          await ChatConversation.findByIdAndUpdate(conv._id, { status: 'closed' });
          io.to(`conv-${conv._id}`).emit('chat:conversation_closed', {
            conversationId: String(conv._id),
            reason: 'participant',
          });
          io.to('admin-room').emit('chat:conversation_updated', {
            conversation: { _id: String(conv._id), status: 'closed' },
          });
        } catch (e) {
          logger.error('[Chat] participant_end_conversation:', e.message);
        }
      });

      /**
       * Buyer/guest/seller: clear thread and support state for a fresh session.
       * Uses chatPhase `faq_bot` so web clients return to request-support (same as new conv default).
       */
      socket.on('chat:participant_reset_conversation', async () => {
        try {
          const conv = await ChatConversation.findById(socket.conversationId);
          if (!conv || !ownsConversationSocket(socket, conv)) return;
          const conversationId = conv._id;
          await ChatMessage.deleteMany({ conversationId });
          const updated = await ChatConversation.findByIdAndUpdate(
            conversationId,
            {
              status: 'open',
              chatPhase: 'faq_bot',
              faqBotStepId: null,
              supportRequestNote: '',
              supportRequestedAt: null,
              supportAcceptedAt: null,
              assignedTo: null,
              lastParticipantMessageAt: new Date(),
              lastMessage: '',
              lastMessageAt: new Date(),
              unreadByAdmin: 0,
              unreadByUser: 0,
            },
            { new: true }
          );
          if (!updated) return;
          const joinPayload = conversationJoinPayload(updated);
          const plain = conversationPayloadForAdminBroadcast(updated);
          // Always deliver to the initiator; `socket.to(room)` reaches admins/other tabs without duplicating to sender.
          socket.emit('chat:conversation_reset', { conversation: joinPayload });
          socket.to(`conv-${conversationId}`).emit('chat:conversation_reset', {
            conversation: joinPayload,
          });
          io.to('admin-room').emit('chat:conversation_updated', { conversation: plain });
          const cnt = await countOpenAdminChatAttention();
          io.to('admin-room').emit('chat:admin_unread_count', { count: cnt });
        } catch (e) {
          logger.error('[Chat] participant_reset_conversation:', e.message);
          socket.emit('chat:error', { message: 'Could not reset chat.' });
        }
      });
    }

    // ── Shared: send a message ────────────────────────────
    socket.on('chat:send', async (data) => {
      const content = sanitize(data?.content);
      if (!content || content.length > 2000) return;

      const rawConvId =
        isLiveSupportAgentRole(userRole) ? data?.conversationId : socket.conversationId;
      if (rawConvId == null || rawConvId === '') return;

      const conversationId = String(rawConvId).trim();
      if (!mongoose.Types.ObjectId.isValid(conversationId)) return;

      try {
        const conversation = await ChatConversation.findById(conversationId);
        if (!conversation || conversation.status === 'closed') {
          socket.emit('chat:error', { message: 'This conversation is closed.' });
          return;
        }

        if (isLiveSupportAgentRole(userRole)) {
          if (!canAdminSendMessage(socket, conversation)) {
            socket.emit('chat:error', {
              message: 'Only the assigned admin can reply in this chat.',
            });
            return;
          }
          socket.join(`conv-${conversationId}`);
        } else if (getEffectiveChatPhase(conversation) !== 'active') {
          socket.emit('chat:error', {
            code: 'PHASE_BLOCK',
            message:
              'Live messaging starts after an agent accepts your request. Use the guided help above until then.',
          });
          return;
        }

        // For guests, senderId is the conversation _id (no user record exists)
        const senderId = isGuest ? conversation._id : userId;
        const senderModel = isGuest ? 'Guest' : userModel;

        const message = await ChatMessage.create({
          conversationId,
          senderId,
          senderModel,
          senderRole: isLiveSupportAgentRole(userRole) ? 'admin' : userRole,
          senderName: userName,
          content,
        });

        const inc = isLiveSupportAgentRole(userRole) ? { unreadByUser: 1 } : { unreadByAdmin: 1 };
        const updatePayload = {
          lastMessage: content.substring(0, 100),
          lastMessageAt: new Date(),
          $inc: inc,
        };
        if (!isLiveSupportAgentRole(userRole)) {
          updatePayload.lastParticipantMessageAt = new Date();
        }
        let updatedConv = await ChatConversation.findByIdAndUpdate(
          conversationId,
          updatePayload,
          { new: true }
        );

        if (!isLiveSupportAgentRole(userRole) && updatedConv) {
          updatedConv = await ensureConversationSellerIdentity(updatedConv);
        }

        io.to(`conv-${conversationId}`).emit('chat:message', { message });
        // Admins may miss conv-room delivery if join raced or failed; admin-room + client filter fixes seller/buyer/guest delivery.
        io.to('admin-room').emit('chat:message', { message });

        if (!isLiveSupportAgentRole(userRole)) {
          io.to('admin-room').emit('chat:conversation_updated', {
            conversation: conversationPayloadForAdminBroadcast(updatedConv),
          });

          const totalUnread = await countOpenAdminChatAttention();
          io.to('admin-room').emit('chat:admin_unread_count', { count: totalUnread });
        }
      } catch (err) {
        logger.error('[Chat] send error:', err.message);
        socket.emit('chat:error', { message: 'Failed to send message.' });
      }
    });

    // ── Shared: typing indicator ──────────────────────────
    socket.on('chat:typing', (data) => {
      const typing = Boolean(data?.typing);
      if (isLiveSupportAgentRole(userRole)) {
        const convId = data?.conversationId;
        if (convId) {
          socket.to(`conv-${convId}`).emit('chat:typing', { role: 'admin', typing });
        }
      } else {
        const convId = socket.conversationId;
        if (convId) {
          socket.to(`conv-${convId}`).emit('chat:typing', { role: userRole, typing });
        }
      }
    });

    socket.on('disconnect', (reason) => {
      if (!isAdminSocketRole(userRole) && socket.conversationId) {
        removeParticipantSocket(io, socket.conversationId, socket.id);
      }
      logger.info(`[Chat] Disconnected: ${userRole} ${isGuest ? socket.guestToken : userId} — ${reason}`);
    });
  });
};
