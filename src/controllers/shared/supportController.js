const SupportTicket = require('../../models/support/supportTicketModel');
const SupportMessage = require('../../models/support/supportMessageModel');
const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const SellerOrder = require('../../models/order/sellerOrderModel');

// Configure multer for file uploads
const { safeFs } = require('../../utils/safePath');

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = 'uploads/support';
    // USE SAFE VERSION - never crashes
    if (!safeFs.existsSyncSafe(uploadPath, { label: 'support uploads directory' })) {
      // Directory doesn't exist, create it
      try {
        fs.mkdirSync(uploadPath, { recursive: true });
      } catch (mkdirError) {
        console.error('[supportController] Error creating upload directory:', mkdirError.message);
        return cb(mkdirError);
      }
    }
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `support-${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

const fileFilter = (req, file, cb) => {
  // Allow images and documents
  if (file.mimetype.startsWith('image/') || 
      file.mimetype === 'application/pdf' ||
      file.mimetype === 'application/msword' ||
      file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    cb(null, true);
  } else {
    cb(new AppError('Invalid file type. Only images and documents are allowed.', 400), false);
  }
};

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter,
});

exports.uploadSupportFiles = upload.array('attachments', 5);

/**
 * Create a new support ticket
 * POST /api/v1/support/tickets
 */
exports.createTicket = catchAsync(async (req, res, next) => {
  const { department, priority, issueType, title, message, relatedOrderId, relatedPayoutId, relatedProductId } = req.body;

  // Validate required fields
  if (!department || !title || !message) {
    return next(new AppError('Department, title, and message are required', 400));
  }

  // SECURITY FIX #10: Sanitize user-generated content to prevent XSS
  const { sanitizeText, sanitizeTitle } = require('../../utils/helpers/sanitizeUserContent');
  const sanitizedMessage = sanitizeText(message);
  const sanitizedTitle = sanitizeTitle(title);
  
  // Validate sanitized content is not empty
  if (!sanitizedMessage || sanitizedMessage.trim().length === 0) {
    return next(new AppError('Message cannot be empty', 400));
  }
  if (!sanitizedTitle || sanitizedTitle.trim().length === 0) {
    return next(new AppError('Title cannot be empty', 400));
  }

  // If product is related, get the seller from the product
  let relatedSellerId = null;
  if (relatedProductId) {
    const Product = mongoose.model('Product');
    const product = await Product.findById(relatedProductId).select('seller');
    if (product) {
      relatedSellerId = product.seller;
    }
  }

  // Determine user model and role
  let userId, userModel, role, userName, userEmail;

  if (req.user) {
    userId = req.user.id;
    
    // Determine role and model based on user type
    if (req.user.role === 'admin') {
      userModel = 'Admin';
      role = 'admin';
      userName = req.user.name || 'Admin';
      userEmail = req.user.email;
    } else if (req.user.role === 'seller') {
      userModel = 'Seller';
      role = 'seller';
      userName = req.user.name || req.user.shopName || 'Seller';
      userEmail = req.user.email;
    } else {
      userModel = 'User';
      role = 'buyer';
      userName = req.user.name || 'Customer';
      userEmail = req.user.email;
    }
  } else {
    // Fallback for unauthenticated (shouldn't happen with protect middleware)
    return next(new AppError('Authentication required', 401));
  }

  // Handle file uploads
  const attachments = [];
  if (req.files && req.files.length > 0) {
    req.files.forEach((file) => {
      attachments.push({
        url: `/uploads/support/${file.filename}`,
        filename: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
      });
    });
  }

  // Create ticket
  const ticket = await SupportTicket.create({
    userId,
    userModel,
    role,
    department,
    priority: priority || 'medium',
    issueType,
    title: sanitizedTitle, // SECURITY FIX #10: Use sanitized title
    message: sanitizedMessage, // SECURITY FIX #10: Use sanitized message
    relatedOrderId: relatedOrderId || undefined,
    relatedPayoutId: relatedPayoutId || undefined,
    relatedProductId: relatedProductId || undefined,
    relatedSellerId: relatedSellerId || undefined,
    attachments,
    status: 'open',
  });

  // Create initial message
  await SupportMessage.create({
    ticketId: ticket._id,
    senderId: userId,
    senderModel: userModel,
    senderRole: role,
    senderName: userName,
    message: sanitizedMessage, // SECURITY FIX #10: Use sanitized message
    attachments,
  });

  // Update ticket last message time
  ticket.lastMessageAt = new Date();
  await ticket.save();

  // Notify all admins about new support ticket (only if not created by admin)
  if (role !== 'admin') {
    try {
      const notificationService = require('../../services/notification/notificationService');
      await notificationService.createSupportTicketNotification(
        ticket._id,
        ticket.ticketNumber || ticket._id.toString(),
        ticket.title,
        userName,
        role
      );
      console.log(`[Support Ticket] Admin notification created for ticket ${ticket._id}`);
    } catch (notificationError) {
      console.error('[Support Ticket] Error creating admin notification:', notificationError);
      // Don't fail ticket creation if notification fails
    }
  }

  res.status(201).json({
    status: 'success',
    message: 'Support ticket created successfully',
    data: {
      ticket,
    },
  });
});

/**
 * Get current user's tickets
 * GET /api/v1/support/tickets/my
 */
exports.getMyTickets = catchAsync(async (req, res, next) => {
  const { status, department, priority, page = 1, limit = 20 } = req.query;
  
  // Determine user model
  let userModel = 'User';
  if (req.user.role === 'admin') {
    userModel = 'Admin';
  } else if (req.user.role === 'seller') {
    userModel = 'Seller';
  }

  // Build query
  const query = {
    userId: req.user.id,
    userModel,
  };

  if (status) {
    query.status = status;
  }
  if (department) {
    query.department = department;
  }
  if (priority) {
    query.priority = priority;
  }

  // Pagination
  const skip = (parseInt(page) - 1) * parseInt(limit);
  const limitNum = parseInt(limit);

  // Get tickets
  const tickets = await SupportTicket.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limitNum)
    .populate('relatedOrderId', 'orderNumber')
    .populate('relatedPayoutId', 'amount status')
    .populate('relatedProductId', 'name imageCover')
    .lean();

  // Get total count
  const total = await SupportTicket.countDocuments(query);

  res.status(200).json({
    status: 'success',
    results: tickets.length,
    total,
    page: parseInt(page),
    limit: limitNum,
    totalPages: Math.ceil(total / limitNum),
    data: {
      tickets,
    },
  });
});

/**
 * Get tickets related to seller's products
 * GET /api/v1/support/tickets/product-related
 */
exports.getProductRelatedTickets = catchAsync(async (req, res, next) => {
  // Only sellers can access this
  if (req.user.role !== 'seller') {
    return next(new AppError('Only sellers can access product-related tickets', 403));
  }

  const { status, department, priority, page = 1, limit = 20 } = req.query;

  // Build query - tickets related to seller's products
  const query = {
    relatedSellerId: req.user.id,
  };

  if (status) {
    query.status = status;
  }
  if (department) {
    query.department = department;
  }
  if (priority) {
    query.priority = priority;
  }

  // Pagination
  const skip = (parseInt(page) - 1) * parseInt(limit);
  const limitNum = parseInt(limit);

  // Get tickets
  const tickets = await SupportTicket.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limitNum)
    .populate('relatedOrderId', 'orderNumber')
    .populate('relatedProductId', 'name imageCover slug')
    .populate('userId', 'name email')
    .lean();

  // Get total count
  const total = await SupportTicket.countDocuments(query);

  res.status(200).json({
    status: 'success',
    results: tickets.length,
    total,
    page: parseInt(page),
    limit: limitNum,
    totalPages: Math.ceil(total / limitNum),
    data: {
      tickets,
    },
  });
});

/**
 * Get single ticket with messages
 * GET /api/v1/support/tickets/:id
 */
exports.getTicketById = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  // Determine user model
  let userModel = 'User';
  if (req.user.role === 'admin') {
    userModel = 'Admin';
  } else if (req.user.role === 'seller') {
    userModel = 'Seller';
  }

  // Get ticket
  let ticket = await SupportTicket.findOne({
    _id: id,
    userId: req.user.id,
    userModel,
  })
    .populate('relatedOrderId', 'orderNumber totalPrice')
    .populate('relatedPayoutId', 'amount status')
    .populate('relatedProductId', 'name imageCover')
    .populate('assignedTo', 'name email')
    .lean();

  // If seller, also check if ticket is related to their products
  if (!ticket && req.user.role === 'seller') {
    ticket = await SupportTicket.findOne({
      _id: id,
      relatedSellerId: req.user.id,
    })
      .populate('relatedOrderId', 'orderNumber totalPrice')
      .populate('relatedPayoutId', 'amount status')
      .populate('relatedProductId', 'name imageCover')
      .populate('userId', 'name email')
      .populate('assignedTo', 'name email')
      .lean();
  }

  if (!ticket) {
    // Check if admin is trying to access any ticket
    if (req.user.role === 'admin') {
      const adminTicket = await SupportTicket.findById(id)
        .populate('relatedOrderId', 'orderNumber totalPrice')
        .populate('relatedPayoutId', 'amount status')
        .populate('relatedProductId', 'name imageCover')
        .populate('assignedTo', 'name email')
        .populate('userId', 'name email')
        .lean();
      
      if (adminTicket) {
        // Get ALL messages for admin (including internal notes)
        const messages = await SupportMessage.find({
          ticketId: id,
        })
          .sort({ createdAt: 1 })
          .lean();

        return res.status(200).json({
          status: 'success',
          data: {
            ticket: adminTicket,
            messages,
          },
        });
      }
    }
    
    return next(new AppError('Ticket not found', 404));
  }

  // Get messages (exclude internal notes for non-admins)
  const messageQuery = { ticketId: id };
  if (req.user.role !== 'admin') {
    messageQuery.isInternal = false;
  }

  const messages = await SupportMessage.find(messageQuery)
    .sort({ createdAt: 1 })
    .lean();

  res.status(200).json({
    status: 'success',
    data: {
      ticket,
      messages,
    },
  });
});

/**
 * Reply to a ticket
 * POST /api/v1/support/tickets/:id/reply
 */
exports.replyToTicket = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { message, isInternal } = req.body;

  if (!message || message.trim().length === 0) {
    return next(new AppError('Message is required', 400));
  }

  // SECURITY FIX #10: Sanitize user-generated content to prevent XSS
  const { sanitizeText } = require('../../utils/helpers/sanitizeUserContent');
  const sanitizedMessage = sanitizeText(message);
  
  // Validate sanitized content is not empty
  if (!sanitizedMessage || sanitizedMessage.trim().length === 0) {
    return next(new AppError('Message cannot be empty', 400));
  }

  // Determine user model and role
  let userModel = 'User';
  let role = 'buyer';
  let userName = req.user.name || 'Customer';

  if (req.user.role === 'admin') {
    userModel = 'Admin';
    role = 'admin';
    userName = req.user.name || 'Admin';
  } else if (req.user.role === 'seller') {
    userModel = 'Seller';
    role = 'seller';
    userName = req.user.name || req.user.shopName || 'Seller';
  }

  // Get ticket
  const ticket = await SupportTicket.findById(id);
  if (!ticket) {
    return next(new AppError('Ticket not found', 404));
  }

  // Check access (user can only reply to their own tickets, seller can reply to tickets related to their orders/products, admin can reply to any)
  if (req.user.role !== 'admin') {
    if (req.user.role === 'seller') {
      const sellerId = req.user.id;
      
      // Find all orders that belong to this seller
      const sellerOrders = await SellerOrder.find({ seller: sellerId }).select('order');
      const orderIds = sellerOrders
        .map((so) => so.order)
        .filter((id) => id)
        .map((id) => id.toString());

      // Find all products that belong to this seller
      const Product = mongoose.model('Product');
      const sellerProducts = await Product.find({ seller: sellerId }).select('_id');
      const productIds = sellerProducts.map((p) => p._id.toString());

      // Seller can reply if:
      // 1) It's their own ticket, OR
      // 2) It's related to their orders, OR
      // 3) It's related to their products
      const isOwnTicket = ticket.userId.toString() === sellerId.toString() && ticket.userModel === userModel;
      const isOrderRelated = ticket.relatedOrderId && orderIds.includes(ticket.relatedOrderId.toString());
      const isProductRelated = ticket.relatedProductId && productIds.includes(ticket.relatedProductId.toString());
      
      if (!isOwnTicket && !isOrderRelated && !isProductRelated) {
        return next(new AppError('You do not have permission to reply to this ticket', 403));
      }
    } else {
      // Regular users can only reply to their own tickets
    if (ticket.userId.toString() !== req.user.id.toString() || ticket.userModel !== userModel) {
      return next(new AppError('You do not have permission to reply to this ticket', 403));
      }
    }
  }

  // Handle file uploads
  const attachments = [];
  if (req.files && req.files.length > 0) {
    req.files.forEach((file) => {
      attachments.push({
        url: `/uploads/support/${file.filename}`,
        filename: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
      });
    });
  }

  // Create message
  const supportMessage = await SupportMessage.create({
    ticketId: ticket._id,
    senderId: req.user.id,
    senderModel: userModel,
    senderRole: role,
    senderName: userName,
    message: sanitizedMessage, // SECURITY FIX #10: Use sanitized message
    attachments,
    isInternal: isInternal === true && req.user.role === 'admin',
  });

  // Update ticket
  ticket.lastMessageAt = new Date();
  
  // Auto-update status based on who replied
  if (req.user.role === 'admin') {
    // Admin replied - set to in_progress or awaiting_user
    if (ticket.status === 'awaiting_user') {
      ticket.status = 'in_progress';
    } else if (ticket.status === 'open') {
      ticket.status = 'in_progress';
    }
  } else {
    // User replied - if awaiting_user, set to in_progress
    if (ticket.status === 'awaiting_user') {
      ticket.status = 'in_progress';
    }
  }

  // Notify ticket owner if someone else replied
  try {
    const notificationService = require('../../services/notification/notificationService');
    
    // Only notify if the reply is from a different user
    if (ticket.userId.toString() !== req.user.id.toString() || ticket.userModel !== userModel) {
      // Determine who replied
      const replierName = req.user.role === 'admin' 
        ? 'Admin' 
        : req.user.role === 'seller' 
          ? (req.user.shopName || req.user.name || 'Seller')
          : (req.user.name || 'Customer');
      
      await notificationService.createSupportNotification(
        ticket.userId,
        ticket._id,
        ticket.role,
        `${replierName} replied to your support ticket: "${ticket.title}"`
      );
      console.log(`[Support Reply] Notification created for ticket owner ${ticket.userId}`);

      // Send push notification
      try {
        const pushNotificationService = require('../../services/pushNotificationService');
        await pushNotificationService.sendSupportNotification(
          ticket.userId,
          ticket._id,
          'New Reply to Your Support Ticket',
          `${replierName} replied to your support ticket: "${ticket.title}"`
        );
        console.log(`[Support Reply] ✅ Push notification sent for ticket ${ticket._id}`);
      } catch (pushError) {
        console.error('[Support Reply] Error sending push notification:', pushError.message);
        // Don't fail ticket reply if push notification fails
      }
    }
    
    // If ticket is related to seller's order/product, notify the seller
    if (ticket.role === 'buyer' && (ticket.relatedOrderId || ticket.relatedProductId)) {
      const SellerOrder = require('../../models/order/sellerOrderModel');
      const Product = mongoose.model('Product');
      let sellerId = null;
      
      if (ticket.relatedOrderId) {
        const sellerOrder = await SellerOrder.findOne({ order: ticket.relatedOrderId }).select('seller');
        if (sellerOrder) sellerId = sellerOrder.seller;
      } else if (ticket.relatedProductId) {
        const product = await Product.findById(ticket.relatedProductId).select('seller');
        if (product) sellerId = product.seller;
      }
      
      if (sellerId && sellerId.toString() !== req.user.id.toString()) {
        const replierName = req.user.role === 'admin' 
          ? 'Admin' 
          : (req.user.name || 'Customer');
        
        await notificationService.createSupportNotification(
          sellerId,
          ticket._id,
          'seller',
          `${replierName} replied to a support ticket related to your order/product: "${ticket.title}"`
        );
        console.log(`[Support Reply] Notification created for seller ${sellerId}`);
      }
    }
  } catch (notificationError) {
    console.error('[Support Reply] Error creating notifications:', notificationError);
    // Don't fail ticket reply if notification fails
  }
  
  await ticket.save();

  res.status(201).json({
    status: 'success',
    message: 'Reply sent successfully',
    data: {
      message: supportMessage,
    },
  });
});

/**
 * Update ticket status (Admin only)
 * PATCH /api/v1/support/tickets/:id/status
 */
exports.updateTicketStatus = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { status, priority, department, assignedTo, internalNote } = req.body;

  // Only admins can update status
  if (req.user.role !== 'admin') {
    return next(new AppError('Only admins can update ticket status', 403));
  }

  const ticket = await SupportTicket.findById(id);
  if (!ticket) {
    return next(new AppError('Ticket not found', 404));
  }

  // Update fields
  if (status) {
    ticket.status = status;
  }
  if (priority) {
    ticket.priority = priority;
  }
  if (department) {
    ticket.department = department;
  }
  if (assignedTo !== undefined) {
    ticket.assignedTo = assignedTo || null;
  }

  // Add internal note if provided
  if (internalNote) {
    ticket.internalNotes.push({
      note: internalNote,
      addedBy: req.user.id,
      addedByModel: 'Admin',
      createdAt: new Date(),
    });
  }

  await ticket.save();

  res.status(200).json({
    status: 'success',
    message: 'Ticket updated successfully',
    data: {
      ticket,
    },
  });
});

/**
 * Get all tickets (Admin only)
 * GET /api/v1/support/admin/tickets
 * Returns ALL tickets in the system (buyers, sellers, admins)
 */
exports.getAllTickets = catchAsync(async (req, res, next) => {
  // Verify admin role
  if (req.user.role !== 'admin') {
    return next(new AppError('Only admins can access all tickets', 403));
  }

  const {
    status,
    department,
    priority,
    role, // Filter by user role (buyer, seller, admin)
    userModel, // Filter by userModel (User, Seller, Admin)
    assignedTo,
    page = 1,
    limit = 20,
    search,
  } = req.query;

  // Build query - NO filtering by userId or userModel by default
  // Admins should see ALL tickets from ALL users (buyers, sellers, admins)
  // Start with empty query object - this will match ALL tickets
  const query = {};

  // Apply filters if provided
  if (status) {
    query.status = status;
  }
  if (department) {
    query.department = department;
  }
  if (priority) {
    query.priority = priority;
  }
  // Filter by user role if provided (buyer, seller, admin)
  if (role) {
    query.role = role;
  }
  // Filter by userModel if provided (User, Seller, Admin)
  if (userModel) {
    query.userModel = userModel;
  }
  if (assignedTo) {
    query.assignedTo = assignedTo === 'unassigned' ? null : assignedTo;
  }

  // Search in title or ticket number
  // MongoDB will AND the $or with other query conditions automatically
  if (search) {
    query.$or = [
      { title: { $regex: search, $options: 'i' } },
      { ticketNumber: { $regex: search, $options: 'i' } },
    ];
  }

  // Debug logging for admin queries
  console.log('[getAllTickets] Admin user:', {
    id: req.user.id,
    role: req.user.role,
    email: req.user.email,
  });
  console.log('[getAllTickets] Query parameters:', {
    status,
    department,
    priority,
    role,
    userModel,
    assignedTo,
    search,
    page,
    limit,
  });
  console.log('[getAllTickets] Final query:', JSON.stringify(query, null, 2));

  // Pagination
  const skip = (parseInt(page) - 1) * parseInt(limit);
  const limitNum = parseInt(limit);

  // Get total count first (before pagination)
  const total = await SupportTicket.countDocuments(query);
  console.log('[getAllTickets] Total tickets found:', total);

  // Get tickets - NO filtering by userId, returns ALL tickets
  const tickets = await SupportTicket.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limitNum)
    .populate('userId', 'name email phone')
    .populate('relatedOrderId', 'orderNumber totalPrice')
    .populate('relatedPayoutId', 'amount status')
    .populate('relatedProductId', 'name imageCover slug')
    .populate('assignedTo', 'name email')
    .lean();

  console.log('[getAllTickets] Tickets returned:', tickets.length);
  if (tickets.length > 0) {
    console.log('[getAllTickets] Sample ticket:', {
      id: tickets[0]._id,
      title: tickets[0].title,
      userId: tickets[0].userId,
      userModel: tickets[0].userModel,
      role: tickets[0].role,
    });
  }

  res.status(200).json({
    status: 'success',
    results: tickets.length,
    total,
    page: parseInt(page),
    limit: limitNum,
    totalPages: Math.ceil(total / limitNum),
    data: {
      tickets,
    },
  });
});

/**
 * Get support statistics (Admin only)
 * GET /api/v1/support/admin/stats
 */
exports.getSupportStats = catchAsync(async (req, res, next) => {
  const stats = await SupportTicket.aggregate([
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        open: {
          $sum: { $cond: [{ $eq: ['$status', 'open'] }, 1, 0] },
        },
        inProgress: {
          $sum: { $cond: [{ $eq: ['$status', 'in_progress'] }, 1, 0] },
        },
        awaitingUser: {
          $sum: { $cond: [{ $eq: ['$status', 'awaiting_user'] }, 1, 0] },
        },
        resolved: {
          $sum: { $cond: [{ $eq: ['$status', 'resolved'] }, 1, 0] },
        },
        closed: {
          $sum: { $cond: [{ $eq: ['$status', 'closed'] }, 1, 0] },
        },
        critical: {
          $sum: { $cond: [{ $eq: ['$priority', 'critical'] }, 1, 0] },
        },
        high: {
          $sum: { $cond: [{ $eq: ['$priority', 'high'] }, 1, 0] },
        },
      },
    },
  ]);

  const departmentStats = await SupportTicket.aggregate([
    {
      $group: {
        _id: '$department',
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
  ]);

  const roleStats = await SupportTicket.aggregate([
    {
      $group: {
        _id: '$role',
        count: { $sum: 1 },
      },
    },
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      overview: stats[0] || {
        total: 0,
        open: 0,
        inProgress: 0,
        awaitingUser: 0,
        resolved: 0,
        closed: 0,
        critical: 0,
        high: 0,
      },
      byDepartment: departmentStats,
      byRole: roleStats,
    },
  });
});

/**
 * Get seller's tickets (only tickets related to their orders or products)
 * GET /api/v1/support/seller/tickets
 */
exports.getSellerTickets = catchAsync(async (req, res, next) => {
  // Only sellers can access this
  if (req.user.role !== 'seller') {
    return next(new AppError('Only sellers can access this endpoint', 403));
  }

  const sellerId = req.user.id;
  const { status, department, priority, page = 1, limit = 20 } = req.query;

  // Find all orders that belong to this seller
  const sellerOrders = await SellerOrder.find({ seller: sellerId }).select('order');
  const orderIds = sellerOrders
    .map((so) => so.order)
    .filter((id) => id) // Filter out null/undefined
    .map((id) => id.toString());

  // Find all products that belong to this seller
  const Product = mongoose.model('Product');
  const sellerProducts = await Product.find({ seller: sellerId }).select('_id');
  const productIds = sellerProducts.map((p) => p._id.toString());

  // Build query - tickets that are:
  // 1. Created by the seller themselves (userId === sellerId && userModel === 'Seller'), OR
  // 2. Related to seller's orders, OR
  // 3. Related to seller's products
  const queryConditions = [
    // Tickets created by seller
    { userId: sellerId, userModel: 'Seller' },
  ];

  // Add order-related tickets if seller has orders
  if (orderIds.length > 0) {
    queryConditions.push({ relatedOrderId: { $in: orderIds } });
  }

  // Add product-related tickets if seller has products
  if (productIds.length > 0) {
    queryConditions.push({ relatedProductId: { $in: productIds } });
  }

  // Build query with $or
  const query = {
    $or: queryConditions,
  };

  if (status) {
    query.status = status;
  }
  if (department) {
    query.department = department;
  }
  if (priority) {
    query.priority = priority;
  }

  // Pagination
  const skip = (parseInt(page) - 1) * parseInt(limit);
  const limitNum = parseInt(limit);

  // Get tickets
  const tickets = await SupportTicket.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limitNum)
    .populate('relatedOrderId', 'orderNumber totalPrice')
    .populate('relatedProductId', 'name imageCover slug')
    .populate('userId', 'name email')
    .populate('assignedTo', 'name email')
    .lean();

  // Get total count
  const total = await SupportTicket.countDocuments(query);

  res.status(200).json({
    status: 'success',
    results: tickets.length,
    total,
    page: parseInt(page),
    limit: limitNum,
    totalPages: Math.ceil(total / limitNum),
    data: {
      tickets,
    },
  });
});

/**
 * Get seller's single ticket (only if related to their orders or products)
 * GET /api/v1/support/seller/tickets/:id
 */
exports.getSellerTicketById = catchAsync(async (req, res, next) => {
  // Only sellers can access this
  if (req.user.role !== 'seller') {
    return next(new AppError('Only sellers can access this endpoint', 403));
  }

  const { id } = req.params;
  const sellerId = req.user.id;

  // Find all orders that belong to this seller
  const sellerOrders = await SellerOrder.find({ seller: sellerId }).select('order');
  const orderIds = sellerOrders
    .map((so) => so.order)
    .filter((id) => id) // Filter out null/undefined
    .map((id) => id.toString());

  // Find all products that belong to this seller
  const Product = mongoose.model('Product');
  const sellerProducts = await Product.find({ seller: sellerId }).select('_id');
  const productIds = sellerProducts.map((p) => p._id.toString());

  // Get ticket
  const ticket = await SupportTicket.findById(id)
    .populate('relatedOrderId', 'orderNumber totalPrice')
    .populate('relatedPayoutId', 'amount status')
    .populate('relatedProductId', 'name imageCover slug')
    .populate('assignedTo', 'name email')
    .populate('userId', 'name email')
    .lean();

  if (!ticket) {
    return next(new AppError('Ticket not found', 404));
  }

  // Check if seller created this ticket themselves
  const isTicketCreator = ticket.userId && (
    (ticket.userId._id && ticket.userId._id.toString() === sellerId.toString()) ||
    (ticket.userId.toString && ticket.userId.toString() === sellerId.toString()) ||
    (ticket.userId === sellerId.toString())
  ) && ticket.userModel === 'Seller';

  // Validate authorization - ticket must be:
  // 1. Created by the seller themselves, OR
  // 2. Related to seller's order, OR
  // 3. Related to seller's product
  // Handle both populated and non-populated cases
  const ticketOrderId = ticket.relatedOrderId?._id 
    ? ticket.relatedOrderId._id.toString() 
    : ticket.relatedOrderId?.toString();
  const ticketProductId = ticket.relatedProductId?._id 
    ? ticket.relatedProductId._id.toString() 
    : ticket.relatedProductId?.toString();
  
  const isOrderRelated = ticketOrderId && orderIds.includes(ticketOrderId);
  const isProductRelated = ticketProductId && productIds.includes(ticketProductId);

  // Allow access if seller created the ticket, or if it's related to their orders/products
  if (!isTicketCreator && !isOrderRelated && !isProductRelated) {
    return next(new AppError('You are not authorized to view this ticket. Please ensure you are logged in as a seller.', 403));
  }

  // Get messages (exclude internal notes for sellers)
  const messages = await SupportMessage.find({
    ticketId: id,
    isInternal: false, // Sellers cannot see internal notes
  })
    .sort({ createdAt: 1 })
    .lean();

  res.status(200).json({
    status: 'success',
    data: {
      ticket,
      messages,
    },
  });
});

