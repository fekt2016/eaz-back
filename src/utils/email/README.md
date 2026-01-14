# Email Service Documentation

## Overview

The email service uses **SendGrid exclusively** for all email operations. SendGrid provides reliable, scalable email delivery with professional templates and analytics.

## SendGrid Setup

### 1. Install SendGrid Package

```bash
npm install @sendgrid/mail
```

### 2. Get SendGrid API Key

1. Sign up at [SendGrid](https://sendgrid.com/)
2. Go to Settings > API Keys
3. Create a new API Key with "Full Access" or "Mail Send" permissions
4. Copy the API key

### 3. Configure Environment Variables

Add to your `.env` file:

```env
# SendGrid Configuration (REQUIRED)
SENDGRID_API_KEY=your_sendgrid_api_key_here
SENDGRID_FROM_EMAIL=noreply@yourdomain.com  # Optional: Override default sender
EMAIL_FROM_NAME=Saysay  # Optional: Sender name
EMAIL_FROM=noreply@yourdomain.com  # Default sender email
FRONTEND_URL=https://eazworld.com  # For email links
```

### 4. Verify Domain in SendGrid (Production)

For production, verify your sending domain in SendGrid:
1. Go to Settings > Sender Authentication
2. Authenticate your domain
3. Add SPF and DKIM records to your DNS

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

### Access SendGrid Service Directly

```javascript
const { sendGridService } = require('./utils/email/emailService');

// Use SendGrid-specific functions
await sendGridService.sendPasswordResetEmail(email, token);
```

## Architecture

### Lazy Loading Pattern

The SendGrid client uses lazy loading to:
- Prevent WebAssembly memory allocation at startup
- Only load SendGrid when first needed
- Reuse the same client instance across all operations

### File Structure

```
src/utils/email/
├── sendGridClient.js      # Lazy-loaded SendGrid singleton
├── sendGridService.js     # SendGrid email service functions
├── emailService.js        # Main email service (SendGrid only)
└── README.md             # This file
```

## Error Handling

The service includes proper error handling:
- Validates SendGrid configuration on startup
- Throws clear error messages if SendGrid is not configured
- Logs detailed error information including response body
- All email functions throw errors if SendGrid is unavailable

## Requirements

- **SENDGRID_API_KEY** environment variable is **REQUIRED**
- **@sendgrid/mail** package must be installed
- SendGrid account with verified sender (for production)

## Production Checklist

- [ ] Install `@sendgrid/mail` package
- [ ] Set `SENDGRID_API_KEY` in environment variables
- [ ] Verify sending domain in SendGrid dashboard
- [ ] Add SPF and DKIM records to DNS
- [ ] Test email delivery in production environment
- [ ] Monitor SendGrid dashboard for delivery rates

## Troubleshooting

### Error: "SENDGRID_API_KEY is required"

**Solution:** Add `SENDGRID_API_KEY` to your `.env` file and restart the application.

### Error: "SendGrid service is not available"

**Solution:** 
1. Ensure `@sendgrid/mail` is installed: `npm install @sendgrid/mail`
2. Check that `sendGridService.js` exists and is valid
3. Restart the application

### Emails not being delivered

**Solution:**
1. Check SendGrid dashboard for bounce/spam reports
2. Verify your sender domain is authenticated
3. Check SendGrid API key permissions
4. Review SendGrid activity logs
