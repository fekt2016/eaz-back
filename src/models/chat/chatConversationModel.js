const mongoose = require('mongoose');

const chatConversationSchema = new mongoose.Schema(
  {
    // For authenticated users (buyer / seller) — ObjectId ref. Omit for guests (do not store null;
    // unique sparse index on participantId would otherwise allow only one null).
    participantId: {
      type: mongoose.Schema.Types.ObjectId,
      required: false,
    },
    participantModel: {
      type: String,
      required: true,
      enum: ['User', 'Seller', 'Guest'],
    },
    participantRole: {
      type: String,
      required: true,
      enum: ['buyer', 'seller', 'guest'],
    },
    participantName: { type: String, required: true },
    participantEmail: { type: String, default: '' },
    /** Denormalized for admin live chat (buyer/seller); filled from User/Seller on connect or via API enrich. */
    participantPhone: { type: String, default: '' },

    // Stable token for guest sessions only (UUID). Do not default to null — explicit null
    // breaks MongoDB unique { guestToken: 1 }: multiple nulls → E11000 duplicate key.
    guestToken: { type: String, required: false },

    status: {
      type: String,
      enum: ['open', 'closed'],
      default: 'open',
    },
    /**
     * Support flow: FAQ bot → optional human offer → queue → human chat.
     * Omitted on old rows = treat as active (legacy).
     */
    chatPhase: {
      type: String,
      enum: ['faq_bot', 'await_human_choice', 'awaiting_admin', 'active'],
      default: 'faq_bot',
    },
    /** Current FAQ step id (supportFaqBot); null means INITIAL_STEP. */
    faqBotStepId: { type: String, default: null },
    /** Last time the buyer/seller/guest sent a message or used the FAQ (for admin inactivity close). */
    lastParticipantMessageAt: { type: Date, default: Date.now },
    /** Optional note from buyer/guest when submitting a support request (one-time). */
    supportRequestNote: { type: String, maxlength: 500, default: '' },
    supportRequestedAt: { type: Date, default: null },
    supportAcceptedAt: { type: Date, default: null },
    lastMessage: { type: String, default: '' },
    lastMessageAt: { type: Date, default: Date.now },
    unreadByAdmin: { type: Number, default: 0 },
    unreadByUser: { type: Number, default: 0 },
    /** Admin who accepted this buyer/guest chat (single handler). */
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
    },
  },
  { timestamps: true }
);

// Unique per authenticated user (sparse: omit field for guests; do not store participantId: null).
chatConversationSchema.index({ participantId: 1 }, { unique: true, sparse: true });
// Unique per guest token only — partial index so buyer/seller rows without guestToken are not indexed.
chatConversationSchema.index(
  { guestToken: 1 },
  {
    unique: true,
    partialFilterExpression: {
      guestToken: { $exists: true, $type: 'string', $gt: '' },
    },
  }
);
chatConversationSchema.index({ status: 1, lastMessageAt: -1 });
chatConversationSchema.index({ unreadByAdmin: 1 });
chatConversationSchema.index({ chatPhase: 1, supportRequestedAt: -1 });
chatConversationSchema.index({ assignedTo: 1, status: 1 });

module.exports = mongoose.model('ChatConversation', chatConversationSchema);
