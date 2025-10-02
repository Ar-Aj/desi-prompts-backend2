import { Router, Request, Response } from 'express';
import { SupportTicket } from '../models/SupportTicket.model';
import { Order } from '../models/Order.model';
import { optionalAuth, authenticate } from '../middleware/auth.middleware';
import { asyncHandler } from '../middleware/error.middleware';

const router: Router = Router();

// Get user's orders for support form (registered users)
router.get('/user-orders', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const orders = await Order.find({ 
    user: (req as any).user._id, 
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
router.post('/verify-purchase', asyncHandler(async (req: Request, res: Response) => {
  const { purchaseId, email } = req.body;

  if (!purchaseId || !email) {
    res.status(400).json({ 
      error: 'Purchase ID and email are required' 
    });
    return;
  }

  const order = await Order.findOne({ 
    purchaseId,
    guestEmail: email,
    paymentStatus: 'completed'
  }).populate('items.product', 'name');

  if (!order) {
    res.status(404).json({ 
      error: 'No purchase found with this ID and email combination' 
    });
    return;
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
router.post('/tickets', optionalAuth, asyncHandler(async (req: Request, res: Response) => {
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
  const userId = (req as any).user?._id;

  // Validate user or guest details
  if (!userId && (!guestEmail || !guestName)) {
    res.status(400).json({ 
      error: 'Please provide guest details or login to continue' 
    });
    return;
  }

  // Validate ticket type
  if (!ticketType || !['purchase_issue', 'general_inquiry'].includes(ticketType)) {
    res.status(400).json({ 
      error: 'Valid ticket type is required (purchase_issue or general_inquiry)' 
    });
    return;
  }

  // For purchase issues, require either orderId or purchaseId
  if (ticketType === 'purchase_issue' && !orderId && !purchaseId) {
    res.status(400).json({ 
      error: 'Purchase issues require either order ID or purchase ID' 
    });
    return;
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
    res.status(500).json({ 
      error: 'Failed to create support ticket. Please try again.' 
    });
    return;
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
router.get('/tickets/my-tickets', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const { page = 1, limit = 10 } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const [tickets, total] = await Promise.all([
    SupportTicket.find({ user: (req as any).user._id })
      .populate('order', 'orderNumber')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    SupportTicket.countDocuments({ user: (req as any).user._id })
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
router.get('/tickets/track/:ticketNumber', asyncHandler(async (req: Request, res: Response) => {
  const { ticketNumber } = req.params;
  const { email } = req.query;

  const ticket = await SupportTicket.findOne({ ticketNumber })
    .populate('order', 'orderNumber');

  if (!ticket) {
    res.status(404).json({ error: 'Ticket not found' });
    return;
  }

  // Verify email for guest tickets
  if (ticket.guestEmail && ticket.guestEmail !== email) {
    res.status(403).json({ error: 'Invalid email for this ticket' });
    return;
  }

  res.json({
    success: true,
    ticket
  });
}));

// Add response to ticket
router.post('/tickets/:ticketId/responses', optionalAuth, asyncHandler(async (req: Request, res: Response) => {
  const { ticketId } = req.params;
  const { message, guestEmail } = req.body;
  const userId = (req as any).user?._id;

  const ticket = await SupportTicket.findById(ticketId);
  if (!ticket) {
    res.status(404).json({ error: 'Ticket not found' });
    return;
  }

  // Verify ownership
  const isOwner = 
    (userId && ticket.user?.toString() === userId.toString()) ||
    (!userId && ticket.guestEmail === guestEmail);
  
  if (!isOwner && (req as any).user?.role !== 'admin') {
    res.status(403).json({ error: 'Unauthorized' });
    return;
  }

  ticket.responses.push({
    message,
    isAdminResponse: (req as any).user?.role === 'admin',
    createdAt: new Date()
  });

  // Update status if admin responds
  if ((req as any).user?.role === 'admin' && ticket.status === 'open') {
    ticket.status = 'in-progress';
  }

  await ticket.save();

  res.json({
    success: true,
    ticket
  });
}));

// Update ticket status
router.patch('/tickets/:ticketId/status', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const { ticketId } = req.params;
  const { status } = req.body;

  const ticket = await SupportTicket.findById(ticketId);
  if (!ticket) {
    res.status(404).json({ error: 'Ticket not found' });
    return;
  }

  // Only ticket owner or admin can update status
  const isOwner = ticket.user?.toString() === (req as any).user._id.toString();
  if (!isOwner && (req as any).user.role !== 'admin') {
    res.status(403).json({ error: 'Unauthorized' });
    return;
  }

  ticket.status = status;
  await ticket.save();

  res.json({
    success: true,
    ticket
  });
}));

export default router;