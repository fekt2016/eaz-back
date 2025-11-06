const fs = require('fs');
const path = require('path');

// Import path mappings
const importMappings = [
  // Models
  { from: /require\(['"]\.\.\/Models\/([^'"]+)['"]\)/g, to: (match, model) => {
    const modelMap = {
      'userModel': 'user/userModel',
      'adminModel': 'user/adminModel',
      'sellerModel': 'user/sellerModel',
      'userAddress': 'user/userAddress',
      'addressModel': 'user/addressModel',
      'browserHistoryModel': 'user/browserHistoryModel',
      'creditbalanceModel': 'user/creditbalanceModel',
      'followModel': 'user/followModel',
      'permissionModel': 'user/permissionModel',
      'newsletterModel': 'user/newsletterModel',
      'sessionModel': 'user/sessionModel',
      'tokenBlackListModal': 'user/tokenBlackListModal',
      'securityModal': 'user/securityModal',
      'productModel': 'product/productModel',
      'variantModel': 'product/variantModel',
      'productViewModel': 'product/productViewModel',
      'discountModel': 'product/discountModel',
      'dealsModel': 'product/dealsModel',
      'reviewModel': 'product/reviewModel',
      'sellerReview': 'product/sellerReview',
      'wishListModel': 'product/wishListModel',
      'cartModel': 'product/cartModel',
      'categoryModel': 'category/categoryModel',
      'sequenceModel': 'category/sequenceModel',
      'orderModel': 'order/orderModel',
      'OrderItemModel': 'order/OrderItemModel',
      'sellerOrderModel': 'order/sellerOrderModel',
      'refundModel': 'order/refundModel',
      'paymentModel': 'payment/paymentModel',
      'PaymentMethodModel': 'payment/PaymentMethodModel',
      'paymentRequestModel': 'payment/paymentRequestModel',
      'couponBatchModel': 'coupon/couponBatchModel',
      'couponUsageModel': 'coupon/couponUsageModel',
      'shippingModel': 'order/shippingModel',
      'ReportModel': 'analytics/ReportModel',
      'notificationModel': 'notification/notificationModel',
    };
    const newPath = modelMap[model] || model;
    return `require('../../models/${newPath}')`;
  }},
  // Utils
  { from: /require\(['"]\.\.\/utils\/([^'"]+)['"]\)/g, to: (match, util) => {
    const utilMap = {
      'catchAsync': 'helpers/catchAsync',
      'appError': 'errors/appError',
      'emailService': 'email/emailService',
      'createSendToken': 'helpers/createSendToken',
      'helper': 'helpers/helper',
      'routeUtils': 'helpers/routeUtils',
      'apiFeatures': 'helpers/apiFeatures',
      'cloudinary': 'storage/cloudinary',
      'cloudStorage': 'storage/cloudStorage',
    };
    const newPath = utilMap[util] || util;
    return `require('../../utils/${newPath}')`;
  }},
  // Controllers (from routes)
  { from: /require\(['"]\.\.\/Controllers\/([^'"]+)['"]\)/g, to: (match, controller) => {
    // Determine which role folder
    if (controller.includes('auth') && !controller.includes('Admin') && !controller.includes('Seller')) {
      return `require('../buyer/${controller}')`;
    } else if (controller.includes('authAdmin') || controller.includes('admin')) {
      return `require('../admin/${controller.replace('authAdmin', 'auth')}')`;
    } else if (controller.includes('authSeller') || controller.includes('seller')) {
      return `require('../seller/${controller.replace('authSeller', 'auth')}')`;
    } else {
      return `require('../shared/${controller}')`;
    }
  }},
];

function updateFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let changed = false;

  importMappings.forEach(({ from, to }) => {
    const newContent = content.replace(from, to);
    if (newContent !== content) {
      content = newContent;
      changed = true;
    }
  });

  if (changed) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Updated: ${filePath}`);
  }
}

function walkDir(dir) {
  const files = fs.readdirSync(dir);
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      walkDir(filePath);
    } else if (file.endsWith('.js') || file.endsWith('.cjs')) {
      updateFile(filePath);
    }
  });
}

// Update all files in src directory
walkDir(path.join(__dirname, 'src'));
console.log('Import updates complete!');

