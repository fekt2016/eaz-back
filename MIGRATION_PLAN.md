# EazBackend Migration Plan
**Based on: BACKEND_ARCHITECTURE_AUDIT.md**

## 📊 Current State Analysis

### File Statistics
- **Total Files:** 120 (118 .js + 2 .cjs)
- **Controllers:** 32 files
- **Routes:** 24 files
- **Models:** 30+ files (well-organized, keep as-is)
- **Services:** 1 file (shippingService.js)
- **Large Controllers:**
  - `orderController.js`: ~531 lines (business logic)
  - `authController.js`: ~607 lines (unified needed)

### Critical Issues Identified
1. **2 .cjs files** need conversion to .js
2. **Business logic in controllers** (orderController, authController, etc.)
3. **No feature-based structure** (role-based instead)
4. **config.env** with exposed secrets
5. **All CommonJS** (require/module.exports)

---

## 🎯 Migration Phases

### **Phase 1: Security & Configuration** (Priority: CRITICAL)

#### Files to Create:
- ✅ `.env` (from config.env, gitignored)
- ✅ `.env.example` (template)
- ✅ Update `.gitignore`

#### Files to Delete:
- ❌ `config.env` (after migration)

#### Files to Update:
- `src/config/env.js` - Update to load from `.env` instead of `config.env`

#### Import Changes:
- `src/config/env.js`: Change path from `../../config.env` to `../../.env`

---

### **Phase 2: Convert .cjs to .js** (Priority: HIGH)

#### Files to Convert:
1. `src/controllers/buyer/cartController.cjs` → `src/controllers/buyer/cartController.js`
2. `src/controllers/seller/ProductController.cjs` → `src/controllers/seller/productController.js` (also rename)

#### Import Changes Required:
**Files importing cartController.cjs:**
- `src/routes/buyer/cartRoutes.js`: `require('./controllers/buyer/cartController.cjs')` → `require('./controllers/buyer/cartController')`

**Files importing ProductController.cjs:**
- `src/routes/shared/productRoutes.js`: `require('../../controllers/seller/ProductController.cjs')` → `require('../../controllers/seller/productController')`

#### Code Changes:
- Convert `require()` → `import` (will be done in Phase 3)
- Convert `module.exports` → `export` (will be done in Phase 3)

---

### **Phase 3: ES Modules Conversion** (Priority: HIGH)

#### Files to Convert (All 120 files):
All files using CommonJS need conversion:
- `require()` → `import`
- `module.exports` → `export default` or `export const`
- `exports.name` → `export const name`

#### Key Files:
- `src/app.js`
- `src/server.js`
- All controllers (32 files)
- All routes (24 files)
- All models (30+ files)
- All utils (15+ files)
- All config files (3 files)
- All middleware (5+ files)
- All jobs (2 files)

#### Package.json Update:
```json
{
  "type": "module"  // Add this
}
```

---

### **Phase 4: Extract Business Logic to Services** (Priority: HIGH)

#### Controllers Needing Service Extraction:

##### 1. **Order Controller** → Order Service
**File:** `src/controllers/shared/orderController.js` (531 lines)

**Business Logic to Extract:**
- Order creation (200+ lines)
- Order number generation
- Product-seller mapping
- Seller grouping
- Subtotal calculation
- Coupon application
- Stock management
- Transaction handling

**New Service:** `src/features/orders/services/orderService.js`

**Functions to Create:**
- `createOrder(orderData, userId)`
- `getOrderById(orderId, user)`
- `updateOrderStatus(orderId, status)`
- `calculateOrderTotals(items, couponCode)`
- `groupItemsBySeller(orderItems)`
- `updateProductStock(orderItems)`

##### 2. **Auth Controllers** → Unified Auth Service
**Files:**
- `src/controllers/buyer/authController.js` (607 lines)
- `src/controllers/admin/authAdminController.js`
- `src/controllers/seller/authSellerController.js`

**Business Logic to Extract:**
- Login (unified for all roles)
- Signup/Registration
- OTP generation/verification
- Password reset
- Token generation/validation
- Email verification

**New Service:** `src/features/auth/services/authService.js`

**Functions to Create:**
- `login(loginId, password, role)`
- `signup(userData, role)`
- `sendOtp(loginId, role)`
- `verifyOtp(loginId, otp, role)`
- `resetPassword(token, password)`
- `changePassword(userId, currentPassword, newPassword)`

##### 3. **Cart Controller** → Cart Service
**File:** `src/controllers/buyer/cartController.cjs` (210 lines)

**Business Logic to Extract:**
- Cart creation/update
- Item addition/removal
- Quantity updates
- Cart calculation
- Variant handling

**New Service:** `src/features/cart/services/cartService.js`

##### 4. **Product Controller** → Product Service
**File:** `src/controllers/seller/ProductController.cjs` (338 lines)

**Business Logic to Extract:**
- Product creation
- Image upload/processing
- Variant management
- Product updates
- Stock management

**New Service:** `src/features/products/services/productService.js`

##### 5. **Payment Controller** → Payment Service
**File:** `src/controllers/shared/paymentController.js`

**Business Logic to Extract:**
- Payment processing
- Payment method management
- Payment validation

**New Service:** `src/features/payments/services/paymentService.js`

##### 6. **Category Controller** → Category Service
**File:** `src/controllers/shared/categoryController.js`

**New Service:** `src/features/categories/services/categoryService.js`

##### 7. **Review Controller** → Review Service
**File:** `src/controllers/shared/reviewController.js`

**New Service:** `src/features/reviews/services/reviewService.js`

##### 8. **Coupon Controller** → Coupon Service
**File:** `src/controllers/seller/couponController.js`

**New Service:** `src/features/coupons/services/couponService.js`

##### 9. **Discount Controller** → Discount Service
**File:** `src/controllers/seller/discountController.js`

**New Service:** `src/features/discounts/services/discountService.js`

##### 10. **Payment Request Controller** → Payment Request Service
**File:** `src/controllers/seller/paymentRequestController.js`

**New Service:** `src/features/payments/services/paymentRequestService.js`

##### 11. **Shipping Controller** → Shipping Service (Already exists)
**File:** `src/controllers/shared/shippingController.js`
**Service:** `src/services/order/shippingService.js` (move to features)

---

### **Phase 5: Feature-Based Reorganization** (Priority: HIGH)

#### Feature Modules to Create:

##### 1. **Auth Feature** (`src/features/auth/`)
**Structure:**
```
features/auth/
├── controllers/
│   ├── authController.js (unified, thin)
│   └── passwordController.js
├── services/
│   ├── authService.js
│   ├── tokenService.js
│   └── passwordService.js
├── routes/
│   ├── authRoutes.js
│   └── passwordRoutes.js
├── validators/
│   ├── authValidator.js
│   └── passwordValidator.js
├── middleware/
│   ├── protect.js (from controllers/buyer/authController.js)
│   ├── restrictTo.js (from controllers/buyer/authController.js)
│   └── tokenBlacklist.js
└── index.js
```

**Files to Move:**
- `src/controllers/buyer/authController.js` → Extract business logic, keep thin controller
- `src/controllers/admin/authAdminController.js` → Merge into authService
- `src/controllers/seller/authSellerController.js` → Merge into authService

**Routes to Move:**
- Auth routes from `src/routes/buyer/userRoutes.js`
- `src/routes/admin/adminRoutes.js` (auth parts)
- `src/routes/seller/sellerRoutes.js` (auth parts)

##### 2. **Products Feature** (`src/features/products/`)
**Structure:**
```
features/products/
├── controllers/
│   ├── productController.js
│   ├── variantController.js
│   └── dealsController.js
├── services/
│   ├── productService.js
│   ├── variantService.js
│   ├── imageService.js
│   └── searchService.js
├── routes/
│   └── productRoutes.js
├── validators/
│   └── productValidator.js
└── index.js
```

**Files to Move:**
- `src/controllers/seller/ProductController.cjs` → `features/products/controllers/productController.js`
- `src/controllers/shared/searchController.js` → `features/products/services/searchService.js`
- `src/routes/shared/productRoutes.js` → `features/products/routes/productRoutes.js`

##### 3. **Orders Feature** (`src/features/orders/`)
**Structure:**
```
features/orders/
├── controllers/
│   ├── orderController.js (thin)
│   └── orderItemController.js
├── services/
│   ├── orderService.js
│   ├── orderItemService.js
│   ├── orderNumberService.js
│   └── orderStatusService.js
├── routes/
│   └── orderRoutes.js
├── validators/
│   └── orderValidator.js
└── index.js
```

**Files to Move:**
- `src/controllers/shared/orderController.js` → Extract to service, keep thin controller
- `src/controllers/shared/orderItemController.js` → Move
- `src/routes/shared/orderRoutes.js` → Move
- `src/routes/shared/orderItemRoute.js` → Move
- `src/services/order/shippingService.js` → Move here

##### 4. **Payments Feature** (`src/features/payments/`)
**Structure:**
```
features/payments/
├── controllers/
│   ├── paymentController.js
│   ├── paymentMethodController.js
│   └── paymentRequestController.js
├── services/
│   ├── paymentService.js
│   ├── paymentMethodService.js
│   ├── paymentRequestService.js
│   └── stripeService.js
├── routes/
│   ├── paymentRoutes.js
│   ├── paymentMethodRoutes.js
│   └── paymentRequestRoutes.js
├── validators/
│   └── paymentValidator.js
└── index.js
```

**Files to Move:**
- `src/controllers/shared/paymentController.js`
- `src/controllers/shared/paymentMethodController.js`
- `src/controllers/seller/paymentRequestController.js`
- `src/routes/shared/paymentRoutes.js`
- `src/routes/shared/paymentMethodRoutes.js`
- `src/routes/seller/paymentRequestRoutes.js`
- `src/middleware/validation/paymentValidator.js`

##### 5. **Cart Feature** (`src/features/cart/`)
**Structure:**
```
features/cart/
├── controllers/
│   └── cartController.js
├── services/
│   └── cartService.js
├── routes/
│   └── cartRoutes.js
└── index.js
```

**Files to Move:**
- `src/controllers/buyer/cartController.cjs` → Convert and move
- `src/routes/buyer/cartRoutes.js` → Move

##### 6. **Categories Feature** (`src/features/categories/`)
**Structure:**
```
features/categories/
├── controllers/
│   └── categoryController.js
├── services/
│   └── categoryService.js
├── routes/
│   └── categoryRoutes.js
└── index.js
```

**Files to Move:**
- `src/controllers/shared/categoryController.js`
- `src/routes/shared/categoryRoutes.js`

##### 7. **Reviews Feature** (`src/features/reviews/`)
**Structure:**
```
features/reviews/
├── controllers/
│   └── reviewController.js
├── services/
│   └── reviewService.js
├── routes/
│   └── reviewRoutes.js
└── index.js
```

**Files to Move:**
- `src/controllers/shared/reviewController.js`
- `src/routes/shared/reviewRoutes.js`

##### 8. **Coupons Feature** (`src/features/coupons/`)
**Structure:**
```
features/coupons/
├── controllers/
│   └── couponController.js
├── services/
│   └── couponService.js
├── routes/
│   └── couponRoutes.js
└── index.js
```

**Files to Move:**
- `src/controllers/seller/couponController.js`
- `src/routes/seller/couponRoutes.js`

##### 9. **Discounts Feature** (`src/features/discounts/`)
**Structure:**
```
features/discounts/
├── controllers/
│   └── discountController.js
├── services/
│   └── discountService.js
├── routes/
│   └── discountRoutes.js
└── index.js
```

**Files to Move:**
- `src/controllers/seller/discountController.js`
- `src/routes/seller/discountRoute.js`

##### 10. **Shipping Feature** (`src/features/shipping/`)
**Structure:**
```
features/shipping/
├── controllers/
│   └── shippingController.js
├── services/
│   ├── shippingService.js (existing)
│   └── trackingService.js
├── routes/
│   └── shippingRoutes.js
└── index.js
```

**Files to Move:**
- `src/controllers/shared/shippingController.js`
- `src/services/order/shippingService.js` → Move here

##### 11. **Users Feature** (`src/features/users/`)
**Structure:**
```
features/users/
├── controllers/
│   ├── userController.js
│   ├── addressController.js
│   ├── wishlistController.js
│   ├── profileController.js
│   └── newsletterController.js
├── services/
│   ├── userService.js
│   ├── addressService.js
│   ├── wishlistService.js
│   └── newsletterService.js
├── routes/
│   ├── userRoutes.js
│   ├── addressRoutes.js
│   ├── wishlistRoutes.js
│   └── newsletterRoutes.js
└── index.js
```

**Files to Move:**
- `src/controllers/buyer/userController.js`
- `src/controllers/buyer/addressController.js`
- `src/controllers/buyer/wishlistController.js`
- `src/controllers/buyer/newsletterController.js`
- `src/routes/buyer/userRoutes.js`
- `src/routes/buyer/addressRoutes.js`
- `src/routes/buyer/wishlistRoute.js`
- `src/routes/buyer/newsletterRoutes.js`

##### 12. **Analytics Feature** (`src/features/analytics/`)
**Structure:**
```
features/analytics/
├── controllers/
│   └── analyticsController.js
├── services/
│   └── analyticsService.js
├── routes/
│   └── analyticsRoutes.js
└── index.js
```

**Files to Move:**
- `src/controllers/admin/analyticsController.js`
- `src/routes/admin/analyticsRoutes.js`

##### 13. **Admin Feature** (`src/features/admin/`)
**Structure:**
```
features/admin/
├── controllers/
│   └── adminController.js
├── services/
│   └── adminService.js
├── routes/
│   └── adminRoutes.js
└── index.js
```

**Files to Move:**
- `src/controllers/admin/adminController.js`
- `src/routes/admin/adminRoutes.js`

##### 14. **Seller Feature** (`src/features/sellers/`)
**Structure:**
```
features/sellers/
├── controllers/
│   ├── sellerController.js
│   └── sellerCustomerController.js
├── services/
│   ├── sellerService.js
│   └── sellerCustomerService.js
├── routes/
│   └── sellerRoutes.js
└── index.js
```

**Files to Move:**
- `src/controllers/seller/sellerController.js`
- `src/controllers/seller/SellerCustomerController.js`
- `src/routes/seller/sellerRoutes.js`

##### 15. **Notifications Feature** (`src/features/notifications/`)
**Structure:**
```
features/notifications/
├── controllers/
│   └── notificationController.js
├── services/
│   └── notificationService.js
├── routes/
│   └── notificationRoutes.js
└── index.js
```

**Files to Move:**
- `src/controllers/shared/notificationController.js`
- `src/routes/shared/notificationRoutes.js`

##### 16. **Miscellaneous Controllers**
**Files to Handle:**
- `src/controllers/buyer/browserHistoryController.js` → `features/users/`
- `src/controllers/buyer/creditbalanceController.js` → `features/users/`
- `src/controllers/buyer/followController.js` → `features/users/`
- `src/controllers/buyer/permissionController.js` → `features/users/`

---

### **Phase 6: Middleware Reorganization** (Priority: MEDIUM)

#### Middleware to Move/Create:

##### Auth Middleware
**From:** `src/controllers/buyer/authController.js` (protect, restrictTo)
**To:** `src/middleware/auth/protect.js`, `src/middleware/auth/restrictTo.js`

**Files to Create:**
- `src/middleware/auth/protect.js`
- `src/middleware/auth/restrictTo.js`
- `src/middleware/auth/tokenBlacklist.js`

##### Error Middleware
**From:** `src/controllers/shared/errorController.js`
**To:** `src/middleware/error/errorHandler.js`

**Files to Create:**
- `src/middleware/error/errorHandler.js`
- `src/middleware/error/asyncHandler.js` (or use existing catchAsync)

##### Validation Middleware
**Existing:**
- `src/middleware/validation/paymentValidator.js`

**To Create:**
- `src/middleware/validation/validate.js` (generic validator wrapper)

---

## 📝 Detailed File Movement Map

### Controllers Movement:

| Current Path | New Path | Notes |
|-------------|----------|-------|
| `controllers/buyer/authController.js` | `features/auth/controllers/authController.js` | Extract business logic first |
| `controllers/admin/authAdminController.js` | `features/auth/services/authService.js` | Merge logic |
| `controllers/seller/authSellerController.js` | `features/auth/services/authService.js` | Merge logic |
| `controllers/buyer/cartController.cjs` | `features/cart/controllers/cartController.js` | Convert .cjs first |
| `controllers/seller/ProductController.cjs` | `features/products/controllers/productController.js` | Convert & rename |
| `controllers/shared/orderController.js` | `features/orders/controllers/orderController.js` | Extract service first |
| `controllers/shared/orderItemController.js` | `features/orders/controllers/orderItemController.js` | |
| `controllers/shared/paymentController.js` | `features/payments/controllers/paymentController.js` | |
| `controllers/shared/paymentMethodController.js` | `features/payments/controllers/paymentMethodController.js` | |
| `controllers/seller/paymentRequestController.js` | `features/payments/controllers/paymentRequestController.js` | |
| `controllers/shared/categoryController.js` | `features/categories/controllers/categoryController.js` | |
| `controllers/shared/reviewController.js` | `features/reviews/controllers/reviewController.js` | |
| `controllers/seller/couponController.js` | `features/coupons/controllers/couponController.js` | |
| `controllers/seller/discountController.js` | `features/discounts/controllers/discountController.js` | |
| `controllers/shared/shippingController.js` | `features/shipping/controllers/shippingController.js` | |
| `controllers/shared/searchController.js` | `features/products/services/searchService.js` | Convert to service |
| `controllers/shared/notificationController.js` | `features/notifications/controllers/notificationController.js` | |
| `controllers/buyer/userController.js` | `features/users/controllers/userController.js` | |
| `controllers/buyer/addressController.js` | `features/users/controllers/addressController.js` | |
| `controllers/buyer/wishlistController.js` | `features/users/controllers/wishlistController.js` | |
| `controllers/buyer/newsletterController.js` | `features/users/controllers/newsletterController.js` | |
| `controllers/buyer/browserHistoryController.js` | `features/users/controllers/browserHistoryController.js` | |
| `controllers/buyer/creditbalanceController.js` | `features/users/controllers/creditbalanceController.js` | |
| `controllers/buyer/followController.js` | `features/users/controllers/followController.js` | |
| `controllers/buyer/permissionController.js` | `features/users/controllers/permissionController.js` | |
| `controllers/admin/adminController.js` | `features/admin/controllers/adminController.js` | |
| `controllers/admin/analyticsController.js` | `features/analytics/controllers/analyticsController.js` | |
| `controllers/seller/sellerController.js` | `features/sellers/controllers/sellerController.js` | |
| `controllers/seller/SellerCustomerController.js` | `features/sellers/controllers/sellerCustomerController.js` | |
| `controllers/shared/handleFactory.js` | `utils/helpers/handleFactory.js` | Keep in utils |
| `controllers/shared/errorController.js` | `middleware/error/errorHandler.js` | Move to middleware |

### Routes Movement:

| Current Path | New Path |
|-------------|----------|
| `routes/buyer/userRoutes.js` | `features/users/routes/userRoutes.js` |
| `routes/buyer/cartRoutes.js` | `features/cart/routes/cartRoutes.js` |
| `routes/buyer/wishlistRoute.js` | `features/users/routes/wishlistRoutes.js` |
| `routes/buyer/addressRoutes.js` | `features/users/routes/addressRoutes.js` |
| `routes/buyer/browserHistoryRoutes.js` | `features/users/routes/browserHistoryRoutes.js` |
| `routes/buyer/creditbalanceRoutes.js` | `features/users/routes/creditbalanceRoutes.js` |
| `routes/buyer/followRoutes.js` | `features/users/routes/followRoutes.js` |
| `routes/buyer/permissionRoutes.js` | `features/users/routes/permissionRoutes.js` |
| `routes/buyer/newsletterRoutes.js` | `features/users/routes/newsletterRoutes.js` |
| `routes/seller/sellerRoutes.js` | `features/sellers/routes/sellerRoutes.js` |
| `routes/seller/paymentRequestRoutes.js` | `features/payments/routes/paymentRequestRoutes.js` |
| `routes/seller/discountRoute.js` | `features/discounts/routes/discountRoutes.js` |
| `routes/seller/couponRoutes.js` | `features/coupons/routes/couponRoutes.js` |
| `routes/admin/adminRoutes.js` | `features/admin/routes/adminRoutes.js` |
| `routes/admin/analyticsRoutes.js` | `features/analytics/routes/analyticsRoutes.js` |
| `routes/shared/productRoutes.js` | `features/products/routes/productRoutes.js` |
| `routes/shared/categoryRoutes.js` | `features/categories/routes/categoryRoutes.js` |
| `routes/shared/orderRoutes.js` | `features/orders/routes/orderRoutes.js` |
| `routes/shared/orderItemRoute.js` | `features/orders/routes/orderItemRoutes.js` |
| `routes/shared/reviewRoutes.js` | `features/reviews/routes/reviewRoutes.js` |
| `routes/shared/paymentMethodRoutes.js` | `features/payments/routes/paymentMethodRoutes.js` |
| `routes/shared/paymentRoutes.js` | `features/payments/routes/paymentRoutes.js` |
| `routes/shared/searchRoutes.js` | `features/products/routes/searchRoutes.js` |
| `routes/shared/notificationRoutes.js` | `features/notifications/routes/notificationRoutes.js` |

### Services Movement:

| Current Path | New Path |
|-------------|----------|
| `services/order/shippingService.js` | `features/shipping/services/shippingService.js` |

---

## 🔄 Import Path Changes

### Common Import Patterns:

#### Before (CommonJS):
```javascript
const Order = require('../../models/order/orderModel');
const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
```

#### After (ES Modules):
```javascript
import Order from '../../../models/order/orderModel.js';
import catchAsync from '../../../utils/helpers/catchAsync.js';
import AppError from '../../../utils/errors/appError.js';
```

### Specific Import Updates:

#### Order Controller → Order Service:
**Before:**
```javascript
// In orderController.js
const Order = require('../../models/order/orderModel');
const OrderItems = require('../../models/order/OrderItemModel');
```

**After:**
```javascript
// In orderService.js
import Order from '../../../models/order/orderModel.js';
import OrderItem from '../../../models/order/OrderItemModel.js';

// In orderController.js (thin)
import * as orderService from '../services/orderService.js';
```

#### Auth Controllers → Auth Service:
**Before:**
```javascript
// In authController.js
const User = require('../../models/user/userModel');
const Admin = require('../../models/user/adminModel');
const Seller = require('../../models/user/sellerModel');
```

**After:**
```javascript
// In authService.js
import User from '../../../models/user/userModel.js';
import Admin from '../../../models/user/adminModel.js';
import Seller from '../../../models/user/sellerModel.js';

// In authController.js (thin)
import * as authService from '../services/authService.js';
```

#### App.js Route Imports:
**Before:**
```javascript
const buyerRoutes = {
  users: require('./routes/buyer/userRoutes'),
  cart: require('./routes/buyer/cartRoutes'),
  // ...
};
```

**After:**
```javascript
import userRoutes from './features/users/routes/userRoutes.js';
import cartRoutes from './features/cart/routes/cartRoutes.js';
// ...

app.use('/api/v1/users', userRoutes);
app.use('/api/v1/cart', cartRoutes);
```

---

## ✅ Migration Checklist

### Phase 1: Security & Configuration
- [ ] Create `.env` from `config.env`
- [ ] Create `.env.example` template
- [ ] Update `.gitignore` to exclude `.env`
- [ ] Update `src/config/env.js` to load from `.env`
- [ ] Delete `config.env`
- [ ] Test environment variable loading

### Phase 2: Convert .cjs Files
- [ ] Convert `cartController.cjs` → `cartController.js`
- [ ] Convert `ProductController.cjs` → `productController.js`
- [ ] Update imports in routes
- [ ] Test cart functionality
- [ ] Test product functionality

### Phase 3: ES Modules Conversion
- [ ] Add `"type": "module"` to `package.json`
- [ ] Convert all `require()` → `import`
- [ ] Convert all `module.exports` → `export`
- [ ] Update all file extensions in imports (add `.js`)
- [ ] Test server startup
- [ ] Test all routes

### Phase 4: Service Layer Extraction
- [ ] Create `orderService.js` (extract from orderController)
- [ ] Create `authService.js` (unify three auth controllers)
- [ ] Create `cartService.js` (extract from cartController)
- [ ] Create `productService.js` (extract from ProductController)
- [ ] Create `paymentService.js` (extract from paymentController)
- [ ] Create `categoryService.js` (extract from categoryController)
- [ ] Create `reviewService.js` (extract from reviewController)
- [ ] Create `couponService.js` (extract from couponController)
- [ ] Create `discountService.js` (extract from discountController)
- [ ] Create `paymentRequestService.js` (extract from paymentRequestController)
- [ ] Update all controllers to use services
- [ ] Test all functionality

### Phase 5: Feature-Based Reorganization
- [ ] Create `features/` directory structure
- [ ] Move auth feature files
- [ ] Move products feature files
- [ ] Move orders feature files
- [ ] Move payments feature files
- [ ] Move cart feature files
- [ ] Move categories feature files
- [ ] Move reviews feature files
- [ ] Move coupons feature files
- [ ] Move discounts feature files
- [ ] Move shipping feature files
- [ ] Move users feature files
- [ ] Move analytics feature files
- [ ] Move admin feature files
- [ ] Move sellers feature files
- [ ] Move notifications feature files
- [ ] Create `index.js` barrel files for each feature
- [ ] Update `app.js` with new route imports
- [ ] Update all internal imports
- [ ] Test all routes

### Phase 6: Middleware Reorganization
- [ ] Move `protect` middleware to `middleware/auth/`
- [ ] Move `restrictTo` middleware to `middleware/auth/`
- [ ] Move error handler to `middleware/error/`
- [ ] Create validation middleware wrapper
- [ ] Update all middleware imports
- [ ] Test authentication
- [ ] Test error handling

---

## 🚀 Execution Order

1. **Phase 1** (Security) - No code changes, just config
2. **Phase 2** (Convert .cjs) - Small, isolated changes
3. **Phase 3** (ES Modules) - Foundation for everything else
4. **Phase 4** (Services) - Extract business logic before moving files
5. **Phase 5** (Features) - Reorganize after services are extracted
6. **Phase 6** (Middleware) - Final cleanup

---

## 📊 Estimated Impact

### Files to Move: ~60 files
### Files to Create: ~40 new service/validator files
### Import Updates: ~400+ import statements
### Lines of Code: ~15,000+ lines to refactor

---

## ⚠️ Risks & Considerations

1. **Breaking Changes:** All imports will change - need comprehensive testing
2. **Service Extraction:** Complex business logic extraction requires careful testing
3. **Auth Unification:** Merging three auth controllers needs thorough testing
4. **ES Modules:** Some dependencies might not support ES modules
5. **Route Changes:** API endpoints should remain the same (only internal structure changes)

---

## 🎯 Success Criteria

- ✅ All routes working
- ✅ No import errors
- ✅ All business logic in services
- ✅ Controllers are thin (< 100 lines)
- ✅ Feature-based structure
- ✅ ES modules throughout
- ✅ No secrets in repository
- ✅ All tests passing (when added)

---

**Ready for implementation after user confirmation.**

