// In paymentUtils.js
const axios = require('axios');

async function processMTNMobileMoney(phone, amount) {
  const payload = {
    amount: amount * 100, // Convert to pesewas
    currency: 'GHS',
    externalId: `PAY_${Date.now()}`,
    payer: {
      partyIdType: 'MSISDN',
      partyId: phone,
    },
    payerMessage: 'Seller payment',
    payeeNote: 'Payment from marketplace',
  };

  try {
    const response = await axios.post(
      'https://sandbox.momodeveloper.mtn.com/collection/v1_0/requesttopay',
      payload,
      {
        headers: {
          'X-Reference-Id': uuidv4(),
          'Ocp-Apim-Subscription-Key': process.env.MTN_API_KEY,
          Authorization: `Bearer ${await getMTNAccessToken()}`,
        },
      },
    );

    return {
      success: true,
      transactionId: response.data.transactionId,
    };
  } catch (error) {
    return {
      success: false,
      error: error.response.data,
    };
  }
}

async function getMTNAccessToken() {
  // Implementation to get OAuth token
}
