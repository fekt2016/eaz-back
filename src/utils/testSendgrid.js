/**
 * SendGrid Test Utility
 * 
 * This utility tests SendGrid configuration and sends a test email.
 * 
 * Usage:
 *   node src/utils/testSendgrid.js
 * 
 * Environment Variables Required:
 *   - SENDGRID_API_KEY
 *   - EMAIL_FROM (or SENDGRID_FROM_EMAIL)
 *   - TEST_EMAIL (optional, defaults to EMAIL_FROM)
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { sendEmail } = require('./email/emailService');

async function testSendGrid() {
  console.log('🧪 SendGrid Test Utility\n');
  console.log('='.repeat(50));
  
  // Check environment variables
  console.log('\n📋 Environment Check:');
  console.log(`  SENDGRID_API_KEY: ${process.env.SENDGRID_API_KEY ? '✅ Set' : '❌ Missing'}`);
  console.log(`  EMAIL_FROM: ${process.env.EMAIL_FROM || 'Not set'}`);
  console.log(`  SENDGRID_FROM_EMAIL: ${process.env.SENDGRID_FROM_EMAIL || 'Not set'}`);
  console.log(`  FRONTEND_URL: ${process.env.FRONTEND_URL || 'Not set'}`);
  
  if (!process.env.SENDGRID_API_KEY) {
    console.error('\n❌ ERROR: SENDGRID_API_KEY is not set in environment variables!');
    console.error('   Please add SENDGRID_API_KEY to your .env file.');
    process.exit(1);
  }
  
  const fromEmail = process.env.SENDGRID_FROM_EMAIL || process.env.EMAIL_FROM;
  if (!fromEmail) {
    console.error('\n❌ ERROR: Sender email is not configured!');
    console.error('   Please set EMAIL_FROM or SENDGRID_FROM_EMAIL in your .env file.');
    process.exit(1);
  }
  
  // Get test email from environment or use fromEmail
  const testEmail = process.env.TEST_EMAIL || fromEmail;
  
  console.log('\n📧 Test Email Configuration:');
  console.log(`  From: ${fromEmail}`);
  console.log(`  To: ${testEmail}`);
  
  // Send test email
  console.log('\n🚀 Sending test email...');
  
  try {
    const result = await sendEmail({
      to: testEmail,
      subject: 'SendGrid Test Email - EazShop',
      text: 'This is a test email from EazShop SendGrid service. If you receive this, SendGrid is configured correctly!',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #ffffff; padding: 30px; border-radius: 0 0 10px 10px; }
            .success { background: #d4edda; border: 1px solid #c3e6cb; color: #155724; padding: 15px; border-radius: 5px; margin: 20px 0; }
            .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eaeaea; color: #6c757d; font-size: 0.9em; text-align: center; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>✅ SendGrid Test Email</h1>
            </div>
            <div class="content">
              <p>Hello!</p>
              <div class="success">
                <strong>Success!</strong> This is a test email from the EazShop SendGrid service.
              </div>
              <p>If you're reading this, it means:</p>
              <ul>
                <li>✅ SendGrid API key is configured correctly</li>
                <li>✅ Sender email is verified</li>
                <li>✅ Email service is working properly</li>
              </ul>
              <p>You can now use the email service in your application!</p>
            </div>
            <div class="footer">
              <p>This is an automated test email from EazShop</p>
              <p>Generated at: ${new Date().toLocaleString()}</p>
            </div>
          </div>
        </body>
        </html>
      `,
    });
    
    console.log('\n✅ SUCCESS! Test email sent successfully!');
    console.log('\n📊 Response:');
    console.log(`  Status Code: ${result[0]?.statusCode || 'N/A'}`);
    console.log(`  Headers: ${JSON.stringify(result[0]?.headers || {}, null, 2)}`);
    console.log(`\n📬 Check your inbox at: ${testEmail}`);
    console.log('   (Also check spam folder if not received)');
    
  } catch (error) {
    console.error('\n❌ ERROR: Failed to send test email');
    console.error(`\nError Message: ${error.message}`);
    
    if (error.response) {
      console.error('\n📋 SendGrid Error Details:');
      console.error(JSON.stringify(error.response.body, null, 2));
      
      // Check for common errors
      if (error.response.body?.errors) {
        const errors = error.response.body.errors;
        errors.forEach((err, index) => {
          console.error(`\n  Error ${index + 1}:`);
          console.error(`    Field: ${err.field || 'N/A'}`);
          console.error(`    Message: ${err.message || 'N/A'}`);
          console.error(`    Help: ${err.help || 'N/A'}`);
        });
      }
      
      // Sender verification error
      if (error.response.body?.errors?.some(err => 
        err.message?.includes('verified Sender Identity')
      )) {
        console.error('\n🔴 SENDER IDENTITY NOT VERIFIED');
        console.error('\n📋 To fix this:');
        console.error('   1. Go to SendGrid Dashboard: https://app.sendgrid.com/');
        console.error('   2. Navigate to: Settings > Sender Authentication');
        console.error('   3. Verify your sender email or domain');
        console.error('   4. For single sender: Use "Single Sender Verification"');
        console.error('   5. For domain: Use "Domain Authentication" (recommended)');
        console.error(`\n   Current from address: ${fromEmail}`);
      }
    }
    
    process.exit(1);
  }
  
  console.log('\n' + '='.repeat(50));
  console.log('✅ Test completed successfully!');
}

// Run the test
testSendGrid().catch((error) => {
  console.error('\n❌ Unexpected error:', error);
  process.exit(1);
});

