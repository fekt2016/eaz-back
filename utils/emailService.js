const nodemailer = require('nodemailer');

// Create reusable transporter
const createTransport = () => {
  return nodemailer.createTransport({
    host: MAILTRAP_HOST,
    port: process.env.MAILTRAP_PORT,
    auth: {
      user: process.env.MAILTRAP_USER,
      pass: process.env.MAILTRAP_PASSWORD,
    },
    authMethod: 'PLAIN',
  });
};

// Core email sending function
const sendEmail = async (data) => {
  console.log('data', data);
  const mailOptions = {
    from: `Yussif Faisal <${process.env.EMAIL_FROM}>`,
    to: data.email,
    subject: data.subject,
    text: data.message,
  };

  await createTransport().sendMail(mailOptions);
};

// Specific email functions
const sendWelcomeEmail = (email) => {
  return sendEmail(email, 'Welcome', 'Welcome to eaz-world shop');
};

const sendCustomEmail = (email, subject, message) => {
  return sendEmail(email, subject, message);
};

// ... existing email functions ...

// const sendDataReadyEmail = async (toEmail, downloadUrl, expiresAt) => {
//   const formattedDate = new Date(expiresAt).toLocaleString();

//   const mailOptions = {
//     from: `"Your App" <${process.env.EMAIL_FROM}>`,
//     to: toEmail,
//     subject: 'Your Data Export is Ready',
//     html: `
//       <h1>Your Data is Ready for Download</h1>
//       <p>We've prepared your personal data export as requested.</p>
//       <p><a href="${downloadUrl}">Download your data</a></p>
//       <p><strong>Important:</strong> This link will expire on ${formattedDate}</p>
//       <p>If you didn't request this, please contact our support team.</p>
//     `,
//   };

//   await transporter.sendMail(mailOptions);
// };

const sendAccountDeletionConfirmation = async (toEmail) => {
  const mailOptions = {
    from: `"Your App" <${process.env.EMAIL_FROM}>`,
    to: toEmail,
    subject: 'Account Deletion Completed',
    html: `
      <h1>Your Account Has Been Deleted</h1>
      <p>We've completed your account deletion request as scheduled.</p>
      <p>All personal data has been permanently removed from our systems in accordance with our privacy policy.</p>
      <p>If you didn't request this, please contact our support team immediately.</p>
    `,
  };

  await transporter.sendMail(mailOptions);
};

const sendDataReadyEmail = async (toEmail, downloadUrl, expiresAt) => {
  try {
    // Format expiration date
    const formattedExpires = new Date(expiresAt).toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    });

    // Create email content
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #f8f9fa; padding: 20px; text-align: center; }
          .content { padding: 30px; background-color: #ffffff; }
          .button { 
            display: inline-block; 
            padding: 12px 24px; 
            background-color: #007bff; 
            color: white !important; 
            text-decoration: none; 
            border-radius: 4px; 
            margin: 20px 0;
          }
          .footer { 
            margin-top: 30px; 
            padding-top: 20px; 
            border-top: 1px solid #eaeaea; 
            color: #6c757d; 
            font-size: 0.9em;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>Your Data Export is Ready</h2>
          </div>
          
          <div class="content">
            <p>Hello,</p>
            <p>We've prepared your personal data export as requested.</p>
            
            <p>
              <a href="${downloadUrl}" class="button">Download Your Data</a>
            </p>
            
            <p><strong>Important:</strong> 
              This download link will expire on <strong>${formattedExpires}</strong>. 
              Please download your data before this time.
            </p>
            
            <p>If you didn't request this export, please contact our support team immediately.</p>
          </div>
          
          <div class="footer">
            <p>Best regards,<br>The Privacy Team</p>
            <p>© ${new Date().getFullYear()} ${process.env.APP_NAME}. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const mailOptions = {
      from: `"Privacy Team" <${process.env.EMAIL_FROM}>`,
      to: toEmail,
      subject: 'Your Data Export is Ready',
      html: htmlContent,
      text: `Your data export is ready for download: ${downloadUrl}\nThis link expires on ${formattedExpires}`,
    };

    await transporter.sendMail(mailOptions);
    console.log(`Data ready email sent to ${toEmail}`);
    return true;
  } catch (error) {
    console.error('Email send error:', error);
    throw new Error('Failed to send data ready email');
  }
};

module.exports = {
  sendWelcomeEmail,
  sendCustomEmail,
  sendAccountDeletionConfirmation,
  sendDataReadyEmail,
  sendDataReadyEmail,
};
