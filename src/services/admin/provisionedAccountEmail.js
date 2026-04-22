const logger = require('../../utils/logger');
const { sendEmail } = require('../../utils/email/emailService');

const brand = process.env.APP_NAME || process.env.BRAND_NAME || 'Saiisai';

/**
 * @param {object} opts
 * @param {string} opts.to
 * @param {string} [opts.name]
 * @param {'buyer'|'seller'|'admin'} opts.accountType
 * @param {string} opts.tempPassword
 * @param {string} [opts.loginUrl]
 * @param {string} [opts.referredByLine]
 */
async function sendProvisionedAccountEmail(opts) {
  const {
    to,
    name,
    accountType,
    tempPassword,
    loginUrl = 'https://saiisai.com',
    referredByLine,
  } = opts;

  const greeting = name ? `Hi ${name},` : 'Hello,';

  const typeLabel =
    accountType === 'seller'
      ? 'seller'
      : accountType === 'admin'
        ? 'admin'
        : 'buyer';

  const html = `
  <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;line-height:1.5;color:#1e293b;">
    <h2 style="color:#0f172a;">Your ${brand} ${typeLabel} account</h2>
    <p>${greeting}</p>
    <p>An administrator created an account for you on <strong>${brand}</strong>.</p>
    <p><strong>Your sign-in email:</strong> ${to}</p>
    <p><strong>Temporary password:</strong></p>
    <p style="font-size:18px;font-weight:600;letter-spacing:0.04em;background:#f1f5f9;padding:12px 16px;border-radius:8px;">${tempPassword}</p>
    <p>For security, <strong>change this password</strong> after you first sign in.</p>
    <p><a href="${loginUrl}" style="display:inline-block;margin-top:8px;padding:10px 18px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;">Sign in</a></p>
    ${referredByLine ? `<p style="color:#64748b;font-size:14px;">${referredByLine}</p>` : ''}
    <p style="color:#64748b;font-size:13px;margin-top:24px;">If you did not expect this email, contact ${brand} support.</p>
  </div>`;

  try {
    await sendEmail({
      to,
      subject: `${brand} — your new ${typeLabel} account`,
      html,
      text: `${greeting} Your ${typeLabel} account was created. Email: ${to}. Temporary password: ${tempPassword}. Change it after first sign in. Sign in: ${loginUrl}`,
    });
  } catch (err) {
    logger.error('[provisionedAccountEmail] Failed to send:', err?.message || err);
    throw err;
  }
}

module.exports = { sendProvisionedAccountEmail };
