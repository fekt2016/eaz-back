const mongoose = require('mongoose');
const User = require('../models/user/userModel');
const Seller = require('../models/user/sellerModel');
const ChatConversation = require('../models/chat/chatConversationModel');

const WEAK_NAME_RE =
  /^(buyer|seller|user|admin|support_agent|superadmin|guest)$/i;

const isWeakParticipantName = (name) => {
  const n = String(name || '').trim();
  if (!n) return true;
  return WEAK_NAME_RE.test(n);
};

/**
 * Load display fields for a chat participant (buyer User or Seller). Admin-only use.
 */
const fetchParticipantProfile = async (participantId, participantModel, participantRole) => {
  if (!participantId || !mongoose.Types.ObjectId.isValid(String(participantId))) return null;
  const id = String(participantId);
  try {
    if (participantModel === 'Seller' || participantRole === 'seller') {
      const s = await Seller.findById(id).select('name shopName email phone').lean();
      if (!s) return null;
      return {
        participantName: (s.shopName || s.name || '').trim() || null,
        participantEmail: (s.email || '').trim(),
        participantPhone: s.phone != null ? String(s.phone).trim() : '',
      };
    }
    const u = await User.findById(id).select('name email phone').lean();
    if (u) {
      return {
        participantName: (u.name || '').trim() || null,
        participantEmail: (u.email || '').trim(),
        participantPhone: u.phone != null ? String(u.phone).trim() : '',
      };
    }
    const sFallback = await Seller.findById(id).select('name shopName email phone').lean();
    if (!sFallback) return null;
    return {
      participantName: (sFallback.shopName || sFallback.name || '').trim() || null,
      participantEmail: (sFallback.email || '').trim(),
      participantPhone: sFallback.phone != null ? String(sFallback.phone).trim() : '',
    };
  } catch {
    return null;
  }
};

const mergeConversationWithProfile = (convPlain, profile) => {
  if (!profile) return convPlain;
  return {
    ...convPlain,
    participantName: !isWeakParticipantName(convPlain.participantName)
      ? convPlain.participantName
      : profile.participantName || convPlain.participantName,
    participantEmail:
      (convPlain.participantEmail && String(convPlain.participantEmail).trim()) ||
      profile.participantEmail ||
      '',
    participantPhone:
      (convPlain.participantPhone && String(convPlain.participantPhone).trim()) ||
      profile.participantPhone ||
      '',
  };
};

/**
 * If participantId is a Seller document but the row still says buyer/User, fix in DB.
 * Used on socket connect and support-request so admin payloads and filters stay correct.
 */
const ensureConversationSellerIdentity = async (conversationDoc) => {
  if (!conversationDoc || !conversationDoc.participantId) return conversationDoc;
  if (String(conversationDoc.participantRole) === 'guest') return conversationDoc;
  const pid = String(conversationDoc.participantId);
  if (!mongoose.Types.ObjectId.isValid(pid)) return conversationDoc;
  const exists = await Seller.exists({ _id: pid });
  if (!exists) return conversationDoc;
  if (
    conversationDoc.participantRole === 'seller' &&
    conversationDoc.participantModel === 'Seller'
  ) {
    return conversationDoc;
  }
  const fixed = await ChatConversation.findByIdAndUpdate(
    conversationDoc._id,
    { $set: { participantRole: 'seller', participantModel: 'Seller' } },
    { new: true }
  );
  return fixed || conversationDoc;
};

/**
 * Batch-enrich conversations for admin list (avoids N+1 when possible).
 * Loads both User and Seller for every participantId so mis-tagged seller rows still resolve.
 */
const enrichManyConversationsForAdmin = async (conversations) => {
  if (!conversations || conversations.length === 0) return [];

  const idStrings = [];
  for (const c of conversations) {
    const o = c.toObject ? c.toObject() : { ...c };
    if (!o.participantId || o.participantRole === 'guest') continue;
    const pid = String(o.participantId);
    if (mongoose.Types.ObjectId.isValid(pid)) idStrings.push(pid);
  }
  const uniqueIds = [...new Set(idStrings)].map((s) => new mongoose.Types.ObjectId(s));

  const [users, sellers] = await Promise.all([
    uniqueIds.length
      ? User.find({ _id: { $in: uniqueIds } }).select('name email phone').lean()
      : [],
    uniqueIds.length
      ? Seller.find({ _id: { $in: uniqueIds } })
          .select('name shopName email phone')
          .lean()
      : [],
  ]);

  const userMap = Object.fromEntries(users.map((u) => [String(u._id), u]));
  const sellerMap = Object.fromEntries(sellers.map((s) => [String(s._id), s]));

  const fixIds = [];

  const mapped = conversations.map((c) => {
    const o = c.toObject ? c.toObject() : { ...c };
    // Ensure _id is a string (especially if it came from Mongo aggregate POJO)
    if (o._id && typeof o._id === 'object') {
      o._id = String(o._id);
    }
    if (!o.participantId || o.participantRole === 'guest') return o;

    const pid = String(o.participantId);
    const s = sellerMap[pid];
    const u = userMap[pid];

    let out = { ...o };
    let profile = null;

    if (s) {
      if (o.participantRole !== 'seller' || o.participantModel !== 'Seller') {
        fixIds.push(o._id);
        out = {
          ...out,
          participantRole: 'seller',
          participantModel: 'Seller',
        };
      }
      profile = {
        participantName: (s.shopName || s.name || '').trim() || null,
        participantEmail: (s.email || '').trim(),
        participantPhone: s.phone != null ? String(s.phone).trim() : '',
      };
    } else if (u) {
      profile = {
        participantName: (u.name || '').trim() || null,
        participantEmail: (u.email || '').trim(),
        participantPhone: u.phone != null ? String(u.phone).trim() : '',
      };
    }

    return mergeConversationWithProfile(out, profile);
  });

  if (fixIds.length) {
    await ChatConversation.updateMany(
      { _id: { $in: fixIds } },
      { $set: { participantRole: 'seller', participantModel: 'Seller' } }
    );
  }

  return mapped;
};

/**
 * Single conversation enrichment (admin message view).
 */
const enrichConversationForAdmin = async (conversation) => {
  if (!conversation) return null;
  const o = conversation.toObject ? conversation.toObject() : { ...conversation };
  if (o._id && typeof o._id === 'object') {
    o._id = String(o._id);
  }
  if (!o.participantId || o.participantRole === 'guest') return o;
  const profile = await fetchParticipantProfile(
    o.participantId,
    o.participantModel,
    o.participantRole
  );
  return mergeConversationWithProfile(o, profile);
};

/**
 * Persist email / phone / display name on the conversation when missing (socket connect).
 */
const persistParticipantSnapshotIfNeeded = async (conversationDoc) => {
  if (
    !conversationDoc ||
    !conversationDoc.participantId ||
    conversationDoc.participantRole === 'guest'
  ) {
    return;
  }
  const profile = await fetchParticipantProfile(
    conversationDoc.participantId,
    conversationDoc.participantModel,
    conversationDoc.participantRole
  );
  if (!profile) return;

  const patch = {};
  const emailEmpty = !(conversationDoc.participantEmail && String(conversationDoc.participantEmail).trim());
  if (emailEmpty && profile.participantEmail) patch.participantEmail = profile.participantEmail;

  const phoneEmpty = !(
    conversationDoc.participantPhone != null &&
    String(conversationDoc.participantPhone).trim()
  );
  if (phoneEmpty && profile.participantPhone) patch.participantPhone = profile.participantPhone;

  if (isWeakParticipantName(conversationDoc.participantName) && profile.participantName) {
    patch.participantName = profile.participantName;
  }

  if (Object.keys(patch).length === 0) return;

  await ChatConversation.updateOne({ _id: conversationDoc._id }, { $set: patch });
  Object.assign(conversationDoc, patch);
};

module.exports = {
  fetchParticipantProfile,
  enrichManyConversationsForAdmin,
  enrichConversationForAdmin,
  persistParticipantSnapshotIfNeeded,
  ensureConversationSellerIdentity,
  isWeakParticipantName,
};
