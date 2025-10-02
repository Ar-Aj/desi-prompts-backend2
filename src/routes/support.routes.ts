import { Router } from 'express';
import { SupportTicket } from '../models/SupportTicket.model';
import { Order } from '../models/Order.model';
import { optionalAuth, authenticate } from '../middleware/auth.middleware';
import { asyncHandler } from '../middleware/error.middleware';

const router = Router();

// Get user's orders for support form (registered users)
router.get('/user-orders', authenticate, asyncHandler(async (req: any, res: any) => {
  const orders = await Order.find({ 
    user: req.user._id, 
    paymentStatus: 'completed' 
  })
    .populate('items.product', 'name')
    .sort({ createdAt: -1 })
    .limit(20);

  const orderOptions = orders.map(order => ({
    id: order._id,
    orderNumber: order.orderNumber,
    purchaseId: order.purchaseId,
    date: order.createdAt,
    products: order.items.map((item: any) => item.name).join(', '),
    totalAmount: order.totalAmount
  }));

  res.json({
    success: true,
    orders: orderOptions
  });
}));

// Verify purchase ID for unregistered users
router.post('/verify-purchase', asyncHandler(async (req: any, res: any) => {
  const { purchaseId, email } = req.body;

  if (!purchaseId || !email) {
    return res.status(400).json({ 
      error: 'Purchase ID and email are required' 
    });
  }

  const order = await Order.findOne({ 
    purchaseId,
    guestEmail: email,
    paymentStatus: 'completed'
  }).populate('items.product', 'name');

  if (!order) {
    return res.status(404).json({ 
      error: 'No purchase found with this ID and email combination' 
    });
  }

  res.json({
    success: true,
    order: {
      id: order._id,
      orderNumber: order.orderNumber,
      purchaseId: order.purchaseId,
      date: order.createdAt,
      products: order.items.map((item: any) => item.name).join(', '),
      totalAmount: order.totalAmount
    }
  });
}));

// Create support ticket
router.post('/tickets', optionalAuth, asyncHandler(async (req: any, res) => {
  const { 
    subject, 
    message, 
    category, 
    ticketType,
    orderId, 
    purchaseId,
    guestEmail, 
    guestName 
  } = req.body;
  const userId = req.user?._id;

  // Validate user or guest details
  if (!userId && (!guestEmail || !guestName)) {
    return res.status(400).json({ 
      error: 'Please provide guest details or login to continue' 
    });
  }

  // Validate ticket type
  if (!ticketType || !['purchase_issue', 'general_inquiry'].includes(ticketType)) {
    return res.status(400).json({ 
      error: 'Valid ticket type is required (purchase_issue or general_inquiry)' 
    });
  }

  // For purchase issues, require either orderId or purchaseId
  if (ticketType === 'purchase_issue' && !orderId && !purchaseId) {
    return res.status(400).json({ 
      error: 'Purchase issues require either order ID or purchase ID' 
    });
  }

  // Clean up empty values
  const cleanOrderId = orderId && orderId.trim() !== '' ? orderId : undefined;
  const cleanPurchaseId = purchaseId && purchaseId.trim() !== '' ? purchaseId : undefined;

  console.log('Creating ticket with data:', {
    user: userId,
    order: cleanOrderId,
    purchaseId: cleanPurchaseId,
    ticketType,
    subject,
    hasGuestDetails: !userId && guestEmail && guestName
  });

  const ticket = new SupportTicket({
    user: userId,
    order: cleanOrderId,
    purchaseId: cleanPurchaseId,
    guestEmail: !userId ? guestEmail : undefined,
    guestName: !userId ? guestName : undefined,
    subject,
    message,
    category: category || 'other',
    ticketType
  });

  try {
    await ticket.save();
  } catch (error) {
    console.error('Error saving ticket:', error);
    return res.status(500).json({ 
      error: 'Failed to create support ticket. Please try again.' 
    });
  }

  res.status(201).json({
    success: true,
    ticket: {
      id: ticket._id,
      ticketNumber: ticket.ticketNumber,
      status: ticket.status,
      ticketType: ticket.ticketType
    }
  });
}));

// Get user's tickets
router.get('/tickets/my-tickets', authenticate, asyncHandler(async (req: any, res) => {
  const { page = 1, limit = 10 } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const [tickets, total] = await Promise.all([
    SupportTicket.find({ user: req.user._id })
      .populate('order', 'orderNumber')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    SupportTicket.countDocuments({ user: req.user._id })
  ]);

  res.json({
    success: true,
    tickets,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      total,
      pages: Math.ceil(total / Number(limit))
    }
  });
}));

// Get ticket by number (for guests)
router.get('/tickets/track/:ticketNumber', asyncHandler(async (req, res) => {
  const { ticketNumber } = req.params;
  const { email } = req.query;

  const ticket = await SupportTicket.findOne({ ticketNumber })
    .populate('order', 'orderNumber');

  if (!ticket) {
    return res.status(404).json({ error: 'Ticket not found' });
  }

  // Verify email for guest tickets
  if (ticket.guestEmail && ticket.guestEmail !== email) {
    return res.status(403).json({ error: 'Invalid email for this ticket' });
  }

  res.json({
    success: true,
    ticket
  });
}));

// Add response to ticket
router.post('/tickets/:ticketId/responses', optionalAuth, asyncHandler(async (req: any, res) => {
  const { ticketId } = req.params;
  const { message, guestEmail } = req.body;
  const userId = req.user?._id;

  const ticket = await SupportTicket.findById(ticketId);
  if (!ticket) {
    return res.status(404).json({ error: 'Ticket not found' });
  }

  // Verify ownership
  const isOwner = 
    (userId && ticket.user?.toString() === userId.toString()) ||
    (!userId && ticket.guestEmail === guestEmail);
  
  if (!isOwner && req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  ticket.responses.push({
    message,
    isAdminResponse: req.user?.role === 'admin',
    createdAt: new Date()
  });

  // Update status if admin responds
  if (req.user?.role === 'admin' && ticket.status === 'open') {
    ticket.status = 'in-progress';
  }

  await ticket.save();

  res.json({
    success: true,
    ticket
  });
}));

// Update ticket status
router.patch('/tickets/:ticketId/status', authenticate, asyncHandler(async (req: any, res) => {
  const { ticketId } = req.params;
  const { status } = req.body;

  const ticket = await SupportTicket.findById(ticketId);
  if (!ticket) {
    return res.status(404).json({ error: 'Ticket not found' });
  }

  // Only ticket owner or admin can update status
  const isOwner = ticket.user?.toString() === req.user._id.toString();
  if (!isOwner && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  ticket.status = status;
  await ticket.save();

  res.json({
    success: true,
    ticket
  });
}));

export default router;
