const { sendCustomEmail } = require('./emailService');

exports.sendPaymentNotification = async (user, action, paymentRequest) => {
  let subject, message;

  switch (action) {
    case 'request_created':
      subject = 'Payment Request Submitted';
      message = `Your payment request of GHS ${paymentRequest.amount.toFixed(2)} has been received and is being processed.`;
      break;

    case 'paid':
      subject = 'Payment Processed';
      message = `Your payment of GHS ${paymentRequest.amount.toFixed(2)} has been sent! Transaction ID: ${paymentRequest.transactionId}`;
      break;

    case 'rejected':
      subject = 'Payment Request Rejected';
      message = `Your payment request of GHS ${paymentRequest.amount.toFixed(2)} was rejected. Reason: ${paymentRequest.rejectionReason}`;
      break;

    default:
      return;
  }

  // Send via email
  if (user.email) {
    await sendCustomEmail({
      email: user.email,
      subject,
      message,
    });
  }

  // Send via SMS if phone exists (pseudo-code)
  if (user.phone) {
    console.log(`Sending SMS to ${user.phone}: ${message}`);
    // Actual SMS integration would go here
  }
};
