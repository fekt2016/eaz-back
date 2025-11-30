const { body } = require('express-validator');

const paymentValidator = [
  body('amount')
    .isFloat({ min: 10 })
    .withMessage('Minimum withdrawal amount is ₵10')
    .customSanitizer((value) => parseFloat(value).toFixed(2)),

  body('paymentMethod')
    .isIn(['bank', 'mtn_momo', 'vodafone_cash', 'airtel_tigo_money', 'cash'])
    .withMessage('Invalid payment method'),

  body('paymentDetails')
    .isObject()
    .withMessage('Payment details must be an object'),

  body('paymentDetails.mobileMoney.phone')
    .if(
      body('paymentMethod').isIn([
        'mtn_momo',
        'vodafone_cash',
        'airtel_tigo_money',
        'cash',
      ]),
    )
    .notEmpty()
    .withMessage('Mobile money phone number is required')
    .matches(/^0(?:23|24|54|55|59|20|50|27|57|26|56|28)[0-9]{7}$/)
    .withMessage('Invalid Ghanaian phone number'),

  body('paymentDetails.mobileMoney.network')
    .if(
      body('paymentMethod').isIn([
        'mtn_momo',
        'vodafone_cash',
        'airtel_tigo_money',
      ]),
    )
    .isIn(['MTN', 'Vodafone', 'AirtelTigo'])
    .withMessage('Invalid mobile network'),

  body('paymentDetails.bank.accountName')
    .if(body('paymentMethod').equals('bank'))
    .notEmpty()
    .withMessage('Account name is required'),

  body('paymentDetails.bank.accountNumber')
    .if(body('paymentMethod').equals('bank'))
    .notEmpty()
    .withMessage('Account number is required')
    .isLength({ min: 8, max: 15 })
    .withMessage('Account number must be 8-15 characters'),

  body('paymentDetails.bank.bankName')
    .if(body('paymentMethod').equals('bank'))
    .notEmpty()
    .withMessage('Bank name is required')
    .isIn([
      'GCB Bank',
      'Absa Ghana',
      'Stanbic Bank',
      'Ecobank Ghana',
      'Fidelity Bank',
      'CalBank',
      'Zenith Bank',
      'GT Bank',
      'Republic Bank',
      'Standard Chartered',
      'First National Bank',
    ])
    .withMessage('Invalid bank selected'),
];

module.exports = paymentValidator;;
