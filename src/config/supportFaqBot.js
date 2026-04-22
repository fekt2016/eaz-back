/**
 * Scripted FAQ before live agent handoff. Server is source of truth for transitions.
 * Client fetches the same structure via GET /api/v1/chat/support-bot-script (public).
 */

const INITIAL_STEP_ID = 'topic';

const STEPS = {
  topic: {
    prompt: 'Hi! What do you need help with today?',
    options: [
      {
        id: 'orders',
        label: 'Order or delivery',
        reply:
          'You can track orders from your account under **My orders**. Delivery time depends on the seller and your location. If payment was successful, the seller will ship according to their stated timeline.',
        next: 'followup',
      },
      {
        id: 'payments',
        label: 'Payment or refund',
        reply:
          'Payments are processed securely through Paystack. For refunds or payment issues, open the relevant order or contact support below — an agent can review your case.',
        next: 'followup',
      },
      {
        id: 'account',
        label: 'Account or login',
        reply:
          'Use your registered email or phone to sign in. If you forgot your password, use **Forgot password** on the login page. Keep your phone number up to date for OTP delivery.',
        next: 'followup',
      },
      {
        id: 'seller_help',
        label: 'Selling on Saiisai',
        reply:
          'Sellers manage products, orders, and payouts from the seller dashboard. For dashboard or verification questions, a live agent can help after this chat.',
        next: 'followup',
      },
    ],
  },
  followup: {
    prompt: 'Does that answer your question?',
    options: [
      {
        id: 'helped',
        label: 'Yes, that helps',
        reply: 'Glad to help! You can still reach a live agent below if you need anything else.',
        next: 'human_offer',
      },
      {
        id: 'more_help',
        label: 'I still need help',
        reply: 'No problem — we can connect you with a real person from our team.',
        next: 'human_offer',
      },
    ],
  },
  human_offer: {
    prompt: 'Would you like to chat with a live support agent?',
    options: [
      {
        id: 'yes_agent',
        label: 'Yes, connect me to an agent',
        reply: 'We will add you to the queue for the next available agent.',
        next: '__REQUEST_HUMAN__',
      },
      {
        id: 'no_agent',
        label: 'No, I am all set',
        next: '__END_SELF__',
      },
    ],
  },
};

const getStep = (stepId) => STEPS[stepId] || null;

/**
 * @param {string|null|undefined} currentStepId
 * @param {string} optionId
 * @returns {{ error?: string, reply?: string, nextStepId?: string, requestHuman?: boolean, endSelf?: boolean }}
 */
const applyBotOption = (currentStepId, optionId) => {
  const sid = currentStepId && STEPS[currentStepId] ? currentStepId : INITIAL_STEP_ID;
  const step = STEPS[sid];
  if (!step) return { error: 'Invalid step' };
  const opt = step.options.find((o) => o.id === optionId);
  if (!opt) return { error: 'Invalid choice' };

  if (opt.next === '__REQUEST_HUMAN__') {
    return { reply: opt.reply || '', requestHuman: true };
  }
  if (opt.next === '__END_SELF__') {
    return { reply: opt.reply || '', endSelf: true };
  }
  return {
    reply: opt.reply || '',
    nextStepId: opt.next,
  };
};

/** Public script for UIs (buyer web, seller web) — no server-only logic. */
const getSupportBotScriptForClient = () => ({
  initialStepId: INITIAL_STEP_ID,
  steps: STEPS,
});

module.exports = {
  INITIAL_STEP_ID,
  STEPS,
  getStep,
  applyBotOption,
  getSupportBotScriptForClient,
};
