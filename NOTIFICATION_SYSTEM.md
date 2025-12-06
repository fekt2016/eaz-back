# Shared Notification System Documentation

## Overview

This is a **shared notification system** used by all three apps:
- **EazMain** (Buyer app)
- **EazSeller** (Seller app)
- **EazAdmin** (Admin app)

All three apps use the **SAME backend model and API** - no duplicated models.

---

## Backend Implementation

### 1. Notification Model
**Location:** `backend/src/models/notification/notificationModel.js`

**Schema Fields:**
- `user` - ObjectId reference (buyer/seller/admin)
- `userModel` - Dynamic reference ('User', 'Seller', 'Admin')
- `type` - Notification type (order, delivery, refund, return, support, finance, payout, system, product, verification, announcement)
- `title` - Notification title
- `message` - Notification message
- `read` - Boolean (default: false)
- `readAt` - Date when marked as read
- `role` - User role ('buyer', 'seller', 'admin')
- `metadata` - Object containing related IDs (orderId, ticketId, withdrawalId, etc.)
- `priority` - Priority level ('low', 'medium', 'high', 'urgent')
- `actionUrl` - URL to navigate when clicked
- `expiresAt` - Optional expiration date

### 2. Notification Controller
**Location:** `backend/src/controllers/notification/notificationController.js`

**Endpoints:**
- `getNotifications()` - Get all notifications (paginated, filtered by role)
- `getUnreadCount()` - Get unread count
- `markAsRead()` - Mark single notification as read
- `markAllAsRead()` - Mark all notifications as read
- `createNotification()` - Create new notification
- `deleteNotification()` - Delete notification
- `getNotification()` - Get single notification

### 3. Notification Routes
**Location:** `backend/src/routes/notification/notificationRoutes.js`

**API Endpoints:**
- `GET /api/v1/notifications` - Get all notifications
- `GET /api/v1/notifications/unread` - Get unread count
- `GET /api/v1/notifications/:id` - Get single notification
- `PATCH /api/v1/notifications/read/:id` - Mark as read
- `PATCH /api/v1/notifications/read-all` - Mark all as read
- `POST /api/v1/notifications` - Create notification (admin/system)
- `DELETE /api/v1/notifications/:id` - Delete notification

### 4. Notification Service
**Location:** `backend/src/services/notification/notificationService.js`

**Helper Functions:**
- `createOrderNotification()` - For buyers
- `createSellerOrderNotification()` - For sellers
- `createDeliveryNotification()` - Delivery updates
- `createRefundNotification()` - Refund updates
- `createPayoutNotification()` - Seller withdrawal updates
- `createSupportNotification()` - Support ticket updates
- `createProductNotification()` - Product approval/rejection
- `createVerificationNotification()` - Verification updates
- `createAnnouncement()` - System announcements

---

## Integration Points

### Order Flow
Notifications are automatically created when:
1. **Order is placed** - Buyer and sellers are notified
2. **Payment is confirmed** - Buyer and sellers are notified
3. **Order status changes** - Buyer and sellers are notified (confirmed, delivered, etc.)
4. **Delivery updates** - Buyer is notified (out_for_delivery, delivered)

**Files Modified:**
- `backend/src/controllers/shared/orderController.js` - Order creation
- `backend/src/controllers/shared/orderTrackingController.js` - Status updates
- `backend/src/controllers/shared/paymentController.js` - Payment confirmation

---

## Frontend Integration

### All Three Apps Use Same API

**Base URL:** `/api/v1/notifications`

**Example API Calls:**

```javascript
// Get all notifications
GET /api/v1/notifications?page=1&limit=20&read=false

// Get unread count
GET /api/v1/notifications/unread

// Mark as read
PATCH /api/v1/notifications/read/:id

// Mark all as read
PATCH /api/v1/notifications/read-all

// Delete notification
DELETE /api/v1/notifications/:id
```

### Role-Based Filtering

The backend automatically filters notifications by role:
- **Buyers** only see notifications with `role: 'buyer'`
- **Sellers** only see notifications with `role: 'seller'`
- **Admins** only see notifications with `role: 'admin'`

Each user can only access their own notifications.

---

## Frontend UI (To Be Created)

Each app should create its own UI components:

### EazMain (Buyer)
- `BuyerNotificationsPage.jsx` - Buyer notifications UI
- Components for: Order updates, Delivery updates, Returns & refunds, Support replies

### EazSeller (Seller)
- `SellerNotificationsPage.jsx` - Seller notifications UI
- Components for: New orders, Pickup updates, Withdrawals, Ticket responses, Product approval/rejection

### EazAdmin (Admin)
- `AdminNotificationsPage.jsx` - Admin notifications UI
- Components for: Verification requests, Disputes, Refund requests, System alerts

---

## Usage Examples

### Creating Notifications in Backend

```javascript
const notificationService = require('../../services/notification/notificationService');

// Create order notification for buyer
await notificationService.createOrderNotification(
  userId,
  orderId,
  orderNumber,
  'confirmed'
);

// Create seller order notification
await notificationService.createSellerOrderNotification(
  sellerId,
  orderId,
  orderNumber,
  'pending'
);

// Create delivery notification
await notificationService.createDeliveryNotification(
  userId,
  orderId,
  trackingNumber,
  'out_for_delivery'
);
```

### Frontend API Integration

```javascript
// React Query example
import { useQuery, useMutation } from '@tanstack/react-query';
import axios from 'axios';

// Get notifications
const { data: notifications } = useQuery({
  queryKey: ['notifications'],
  queryFn: async () => {
    const res = await axios.get('/api/v1/notifications');
    return res.data.data.notifications;
  }
});

// Get unread count
const { data: unreadCount } = useQuery({
  queryKey: ['notifications', 'unread'],
  queryFn: async () => {
    const res = await axios.get('/api/v1/notifications/unread');
    return res.data.data.unreadCount;
  }
});

// Mark as read
const markAsRead = useMutation({
  mutationFn: async (id) => {
    await axios.patch(`/api/v1/notifications/read/${id}`);
  }
});
```

---

## Important Notes

1. **Single Source of Truth** - All three apps use the same backend model and API
2. **Role-Based Access** - Backend automatically filters by role
3. **User Isolation** - Users can only see their own notifications
4. **Error Handling** - Notification creation failures don't break main flows
5. **Performance** - Indexes added for efficient queries

---

## Next Steps

1. ✅ Backend model created
2. ✅ Backend controller created
3. ✅ Backend routes created
4. ✅ Notification service created
5. ✅ Integrated with order flow
6. ⏳ Frontend UI components (to be created per app)
7. ⏳ Real-time updates (optional - WebSocket/polling)

