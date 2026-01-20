# Email Service Documentation

## Overview

The email service uses **Resend exclusively** for all email operations. Resend provides reliable, scalable email delivery with simple APIs and supports using your own verified domain.

## Resend Setup

### 1. Install Resend Package

```bash
npm install resend
```

### 2. Get Resend API Key

1. Sign up at [Resend](https://resend.com/)
2. Go to API Keys
3. Create a new API Key
4. Copy the API key

### 3. Configure Environment Variables

Add to your `.env` file:

```env
# SendGrid Configuration (REQUIRED)
SENDGRID_API_KEY=your_sendgrid_api_key_here
SENDGRID_FROM_EMAIL=noreply@yourdomain.com  # Optional: Override default sender
EMAIL_FROM_NAME=Saysay  # Optional: Sender name
EMAIL_FROM=noreply@yourdomain.com  # Default sender email
FRONTEND_URL=https://saiisai.com  # For email links
```

### 4. Verify Domain in Resend (Production)

For production, verify your sending domain in Resend:
1. Go to Domains in the Resend dashboard
2. Add and verify your domain
3. Add SPF, DKIM, and DMARC records to your DNS

## Usage

### Basic Email Sending

```javascript
const { sendEmail, sendWelcomeEmail } = require('./utils/email/emailService');

// Send custom email
await sendEmail({
  to: 'user@example.com',
  subject: 'Hello',
  text: 'Plain text message',
  html: '<h1>HTML message</h1>',
});

// Send welcome email
await sendWelcomeEmail('user@example.com', 'John Doe');
```

### Available Functions

- `sendEmail(data)` - Core email sending function
- `sendWelcomeEmail(email, name)` - Welcome email for new users
- `sendCustomEmail(data)` - Send custom email with full control
- `sendAccountDeletionConfirmation(email, name)` - Account deletion confirmation
- `sendDataReadyEmail(email, downloadUrl, expiresAt, name)` - Data export ready notification
- `sendPasswordResetEmail(email, resetToken, name)` - Password reset email
- `sendOrderConfirmationEmail(email, order, name)` - Order confirmation
- `sendLoginEmail(email, name, loginInfo)` - Login notification email
- `sendLoginOtpEmail(email, otp, name)` - Login OTP email

## Architecture

### Lazy Loading Pattern

The Resend client is created once and reused:
- Prevents unnecessary module loading at startup
- Uses a single Resend client instance across all operations

### File Structure

```
src/utils/email/
├── resendClient.js       # Lazy-loaded Resend client
├── resendService.js      # Resend email service functions (templates + helpers)
├── emailService.js       # Main email service (Resend only)
└── README.md             # This file
```

## Error Handling

The service includes proper error handling:
- Validates environment configuration on startup (via `config/env.js`)
- Throws clear error messages if Resend is not configured
- Logs detailed error information
- All email functions throw errors if the email provider is unavailable

## Requirements

- **RESEND_API_KEY** environment variable is **REQUIRED**
- **EMAIL_FROM** must be set and correspond to a verified sender/domain in Resend
- Resend account with verified domain (for production)

## Production Checklist

- [ ] Install `resend` package
- [ ] Set `RESEND_API_KEY` and `EMAIL_FROM` in environment variables
- [ ] Verify sending domain in Resend dashboard
- [ ] Add SPF, DKIM, and DMARC records to DNS
- [ ] Test email delivery in production environment
- [ ] Monitor Resend dashboard for delivery rates

## Troubleshooting

### Error: "RESEND_API_KEY is required" or Resend client not configured

**Solution:** Add `RESEND_API_KEY` (and `EMAIL_FROM`) to your `.env` file and restart the application.

### Emails not being delivered

**Solution:**
1. Check Resend dashboard for bounce/spam reports
2. Verify your sender domain is authenticated
3. Check Resend API key permissions
4. Review Resend activity logs
