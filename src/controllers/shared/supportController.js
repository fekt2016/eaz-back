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
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = 'uploads/support';
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
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
    title,
    message,
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
    message,
    attachments,
  });

  // Update ticket last message time
  ticket.lastMessageAt = new Date();
  await ticket.save();

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
    message,
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
 */
exports.getAllTickets = catchAsync(async (req, res, next) => {
  const {
    status,
    department,
    priority,
    role,
    assignedTo,
    page = 1,
    limit = 20,
    search,
  } = req.query;

  // Build query
  const query = {};

  if (status) {
    query.status = status;
  }
  if (department) {
    query.department = department;
  }
  if (priority) {
    query.priority = priority;
  }
  if (role) {
    query.role = role;
  }
  if (assignedTo) {
    query.assignedTo = assignedTo === 'unassigned' ? null : assignedTo;
  }

  // Search in title or ticket number
  if (search) {
    query.$or = [
      { title: { $regex: search, $options: 'i' } },
      { ticketNumber: { $regex: search, $options: 'i' } },
    ];
  }

  // Pagination
  const skip = (parseInt(page) - 1) * parseInt(limit);
  const limitNum = parseInt(limit);

  // Get tickets
  const tickets = await SupportTicket.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limitNum)
    .populate('userId', 'name email')
    .populate('relatedOrderId', 'orderNumber')
    .populate('relatedPayoutId', 'amount status')
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

  // Build query - tickets related to seller's orders OR products
  const query = {
    $or: [
      ...(orderIds.length > 0 ? [{ relatedOrderId: { $in: orderIds } }] : []),
      ...(productIds.length > 0 ? [{ relatedProductId: { $in: productIds } }] : []),
    ],
  };

  // If no orders or products, return empty result
  if (orderIds.length === 0 && productIds.length === 0) {
    return res.status(200).json({
      status: 'success',
      results: 0,
      total: 0,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: 0,
      data: {
        tickets: [],
      },
    });
  }

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

  // Validate authorization - ticket must be related to seller's order or product
  // Handle both populated and non-populated cases
  const ticketOrderId = ticket.relatedOrderId?._id 
    ? ticket.relatedOrderId._id.toString() 
    : ticket.relatedOrderId?.toString();
  const ticketProductId = ticket.relatedProductId?._id 
    ? ticket.relatedProductId._id.toString() 
    : ticket.relatedProductId?.toString();
  
  const isOrderRelated = ticketOrderId && orderIds.includes(ticketOrderId);
  const isProductRelated = ticketProductId && productIds.includes(ticketProductId);

  if (!isOrderRelated && !isProductRelated) {
    return next(new AppError('Not authorized to view this ticket', 403));
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

