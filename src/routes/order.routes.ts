import express, { Request, Response } from 'express';
import { Order } from '../models/Order.model';
import { Product } from '../models/Product.model';
import { authenticate } from '../middleware/auth.middleware';
import { asyncHandler } from '../middleware/error.middleware';
import crypto from 'crypto';
import { checkFirstTimeDiscount } from '../utils/discount.utils';
import { sendEmail, getOrderConfirmationEmail } from '../utils/email.utils';
import { getSignedDownloadUrl } from '../utils/storage.utils';
import { createRazorpayOrder } from '../utils/payment.utils';

const router: express.Router = express.Router();

// Check first-time discount eligibility
router.get('/check-discount', asyncHandler(async (req: Request, res: Response) => {
  const userId = req.query.userId as string;
  const guestEmail = req.query.guestEmail as string;

  try {
    const discountCheck = await checkFirstTimeDiscount(userId, guestEmail);
    res.json({
      success: true,
      ...discountCheck
    });
  } catch (error) {
    console.error('Error checking discount:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check discount eligibility'
    });
  }
}));

// Create order
router.post('/create', asyncHandler(async (req: Request, res: Response) => {
  const { items, guestEmail, guestName } = req.body;
  const userId = (req as any).user?._id;

  console.log('Order creation request:', { items, guestEmail, guestName, userId });

  // Validate user or guest details
  if (!userId && (!guestEmail || !guestName)) {
    res.status(400).json({ 
      error: 'Please provide guest details or login to continue' 
    });
    return;
  }

  // Fetch products and calculate total
  const productIds = items.map((item: any) => item.productId);
  console.log('Requested product IDs:', productIds);
  
  const products = await Product.find({ 
    _id: { $in: productIds },
    isActive: true 
  });

  console.log('Found products:', products.map(p => ({ id: p._id, name: p.name, isActive: p.isActive })));

  if (products.length !== items.length) {
    // More detailed error message for debugging
    const foundIds = products.map(p => String(p._id));
    const missingIds = productIds.filter((id: string) => !foundIds.includes(id));
    console.error('Some products are not available:', { 
      requested: productIds.length, 
      found: products.length, 
      missingIds 
    });
    
    res.status(400).json({ 
      error: 'Some products are not available',
      details: `Missing products: ${missingIds.join(', ')}`
    });
    return;
  }

  let totalAmount = 0;
  const orderItems = items.map((item: any) => {
    const product = products.find(p => (p._id as any).toString() === item.productId);
    if (!product) throw new Error('Product not found');
    
    totalAmount += product.price * item.quantity;
    
    return {
      product: product._id,
      name: product.name,
      price: product.price,
      quantity: item.quantity
    };
  });

  // Create order
  const order = new Order({
    user: userId,
    guestEmail: !userId ? guestEmail : undefined,
    guestName: !userId ? guestName : undefined,
    items: orderItems,
    totalAmount
  });

  await order.save();

  // Create Razorpay order (if Razorpay is configured)
  let razorpayOrder;
  try {
    razorpayOrder = await createRazorpayOrder(
      totalAmount,
      'INR',
      order.orderNumber
    );
    
    order.razorpayOrderId = razorpayOrder.id;
    await order.save();
  } catch (error) {
    console.error('Razorpay order creation failed:', error);
    // If Razorpay fails, we'll still create the order but without Razorpay integration
    // This allows for manual payment processing
    console.log('Proceeding with order creation without Razorpay integration');
  }

  res.status(201).json({
    success: true,
    order: {
      id: order._id,
      orderNumber: order.orderNumber,
      totalAmount: order.totalAmount,
      razorpayOrderId: razorpayOrder?.id,
      razorpayKeyId: process.env.RAZORPAY_KEY_ID
    }
  });
}));

// Verify payment
router.post('/verify-payment', asyncHandler(async (req: Request, res: Response) => {
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

  // Find order
  const order = await Order.findOne({ razorpayOrderId }).populate('items.product');
  if (!order) {
    res.status(404).json({ error: 'Order not found' });
    return;
  }

  // If no Razorpay integration, mark as completed manually
  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    // For manual verification or testing without Razorpay
    order.paymentStatus = 'completed';
    order.razorpayPaymentId = 'manual_' + Date.now();
    order.razorpaySignature = 'manual_signature';
    await order.save();
  } else {
    // Verify signature (simplified for now)
    const isValid = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '')
      .update(razorpayOrderId + '|' + razorpayPaymentId)
      .digest('hex') === razorpaySignature;

    if (!isValid) {
      order.paymentStatus = 'failed';
      await order.save();
      res.status(400).json({ error: 'Payment verification failed' });
      return;
    }

    // Update order
    order.paymentStatus = 'completed';
    order.razorpayPaymentId = razorpayPaymentId;
    order.razorpaySignature = razorpaySignature;
    await order.save();
  }

  // Update product sales count (both total and real)
  for (const item of order.items) {
    await Product.findByIdAndUpdate(item.product, {
      $inc: { 
        salesCount: item.quantity,
        realSalesCount: item.quantity // Increment real sales for actual orders
      }
    });
  }

  // Send confirmation email with PDF links
  try {
    const products = order.items.map((item: any) => ({
      name: item.name,
      price: item.price
    }));

    // Get the first product's PDF for now (in real app, you'd handle multiple PDFs)
    const firstProduct = await Product.findById(order.items[0].product);
    if (firstProduct) {
      const downloadLink = await getSignedDownloadUrl(firstProduct.pdfUrl);
      
      const customerEmail = order.guestEmail || (req as any).user?.email;
      const customerName = order.guestName || (req as any).user?.name;

      await sendEmail({
        to: customerEmail,
        subject: `Order Confirmation - ${order.orderNumber}`,
        html: getOrderConfirmationEmail(
          customerName,
          order.orderNumber,
          (order._id as any).toString(),
          products,
          order.totalAmount,
          firstProduct.pdfPassword,
          downloadLink
        )
      });

      order.emailSent = true;
      order.emailSentAt = new Date();
      order.pdfDelivered = true;
      order.pdfDeliveredAt = new Date();
      await order.save();
    }
  } catch (error) {
    console.error('Email sending failed:', error);
  }

  res.json({
    success: true,
    message: 'Payment verified successfully',
    order: {
      id: order._id,
      orderNumber: order.orderNumber,
      paymentStatus: order.paymentStatus
    }
  });
}));

// Get user orders
router.get('/my-orders', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const { page = 1, limit = 10 } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const [orders, total] = await Promise.all([
    Order.find({ user: (req as any).user._id })
      .populate('items.product', 'name slug images')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    Order.countDocuments({ user: (req as any).user._id })
  ]);

  res.json({
    success: true,
    orders,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      total,
      pages: Math.ceil(total / Number(limit))
    }
  });
}));

// Get order by ID
router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const order = await Order.findById(req.params.id)
    .populate('items.product', 'name slug images');

  if (!order) {
    res.status(404).json({ error: 'Order not found' });
    return;
  }

  // Check authorization
  const isAuthorized = 
    (order.user && order.user.toString() === (req as any).user?._id?.toString()) ||
    (order.guestEmail && req.body.guestEmail === order.guestEmail);

  if (!isAuthorized && (req as any).user?.role !== 'admin') {
    res.status(403).json({ error: 'Unauthorized' });
    return;
  }

  res.json({
    success: true,
    order
  });
}));

// Get download link for purchased product
router.get('/:orderId/download/:productId', asyncHandler(async (req: Request, res: Response) => {
  const { orderId, productId } = req.params;

  const order = await Order.findById(orderId);
  if (!order || order.paymentStatus !== 'completed') {
    res.status(404).json({ error: 'Order not found or payment not completed' });
    return;
  }

  // Check if product is in order
  const orderItem = order.items.find(item => 
    item.product.toString() === productId
  );
  if (!orderItem) {
    res.status(404).json({ error: 'Product not found in order' });
    return;
  }

  // Check authorization
  const isAuthorized = 
    (order.user && order.user.toString() === (req as any).user?._id?.toString()) ||
    (order.guestEmail && req.body.guestEmail === order.guestEmail);

  if (!isAuthorized) {
    res.status(403).json({ error: 'Unauthorized' });
    return;
  }

  const product = await Product.findById(productId);
  if (!product) {
    res.status(404).json({ error: 'Product not found' });
    return;
  }

  // Handle both local and S3 storage
  let downloadUrl;
  const isProduction = process.env.MODE === 'production' || process.env.NODE_ENV === 'production';
  
  if (isProduction) {
    // Production: Use S3 signed URL
    // The product.pdfUrl should contain the S3 key
    downloadUrl = await getSignedDownloadUrl(product.pdfUrl);
  } else {
    // Development: Use direct URL
    // The product.pdfUrl should contain the full local URL
    downloadUrl = product.pdfUrl;
  }

  res.json({
    success: true,
    downloadUrl,
    password: product.pdfPassword,
    expiresIn: isProduction ? '30 minutes' : 'permanent'
  });
}));

export default router;