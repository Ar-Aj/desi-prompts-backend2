import * as express from 'express';
import { Request, Response } from 'express';
import { Order } from '../models/Order.model';
import { Product } from '../models/Product.model';
import { authenticate, optionalAuth } from '../middleware/auth.middleware';
import { asyncHandler } from '../middleware/error.middleware';
import { checkFirstTimeDiscount } from '../utils/discount.utils';
import { sendEmail, getOrderConfirmationEmail } from '../utils/email.utils';
import { getSignedDownloadUrl } from '../utils/storage.utils';
import { createRazorpayOrder } from '../utils/payment.utils';
import { env } from '../config/environment.config';

const router: express.Router = express.Router();

// Check first-time discount eligibility
router.get('/check-discount', optionalAuth, asyncHandler(async (req: Request, res: Response) => {
  // Get user ID from authenticated request if available
  const userId = (req as any).user?._id;
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

// Create order - Use optionalAuth to allow both guest and authenticated users
router.post('/create', optionalAuth, asyncHandler(async (req: Request, res: Response) => {
  try {
    const { items, guestEmail, guestName } = req.body;
    // Get user ID from authenticated request if available
    const userId = (req as any).user?._id;

    console.log('Order creation request:', { items, guestEmail, guestName, userId });

    // Validate user or guest details
    if (!userId && (!guestEmail || !guestName)) {
      console.log('Validation failed: Missing guest details or user ID');
      res.status(400).json({ 
        error: 'Please provide guest details or login to continue' 
      });
      return;
    }

    // Validate items
    if (!items || !Array.isArray(items) || items.length === 0) {
      console.log('Validation failed: No items provided');
      res.status(400).json({ 
        error: 'Please provide at least one item' 
      });
      return;
    }

    // Validate each item
    for (const item of items) {
      if (!item.productId) {
        console.log('Validation failed: Missing productId in item', item);
        res.status(400).json({ 
          error: 'Each item must have a productId' 
        });
        return;
      }
      if (!item.quantity || item.quantity <= 0) {
        console.log('Validation failed: Invalid quantity in item', item);
        res.status(400).json({ 
          error: 'Each item must have a valid quantity' 
        });
        return;
      }
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
      if (!product) {
        console.error('Product not found in products array:', item.productId);
        throw new Error('Product not found');
      }
      
      totalAmount += product.price * item.quantity;
      
      return {
        product: product._id,
        name: product.name,
        price: product.price,
        quantity: item.quantity
      };
    });

    console.log('Order items:', orderItems);
    console.log('Total amount:', totalAmount);

    // Create order
    const order = new Order({
      user: userId, // This will be set if user is authenticated
      guestEmail: !userId ? guestEmail : undefined, // Only set for guest orders
      guestName: !userId ? guestName : undefined, // Only set for guest orders
      items: orderItems,
      totalAmount,
      // accessToken field removed - direct S3 access used instead
    });

    console.log('Order object before save:', JSON.stringify(order, null, 2));
    
    await order.save();
    console.log('Order saved:', order._id);
    console.log('Order after save:', {
      id: order._id,
      orderNumber: order.orderNumber,
      purchaseId: order.purchaseId
    });

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
      console.log('Razorpay order created:', razorpayOrder.id);
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
  } catch (error: any) {
    console.error('Order creation failed:', error);
    if (error.name === 'ValidationError') {
      console.error('Validation errors:', error.errors);
      res.status(400).json({
        error: 'Order validation failed',
        details: Object.keys(error.errors).map(key => ({
          field: key,
          message: error.errors[key].message
        }))
      });
    } else {
      res.status(500).json({
        error: 'Failed to create order',
        details: error.message || 'Unknown error'
      });
    }
  }
}));

// Verify payment
router.post('/verify-payment', optionalAuth, asyncHandler(async (req: Request, res: Response) => {
  try {
    console.log('=== PAYMENT VERIFICATION DEBUG INFO ===');
    console.log('Raw request body:', req.body);
    console.log('Request headers:', req.headers);
    console.log('Content-Type header:', req.headers['content-type']);
    console.log('Request method:', req.method);
    console.log('Request URL:', req.url);
    console.log('Full request keys:', Object.keys(req));
    console.log('Has body parser:', !!req.body);
    if (req.body) {
      console.log('Body type:', typeof req.body);
      console.log('Body keys:', Object.keys(req.body));
      console.log('Body stringified:', JSON.stringify(req.body));
    }
    console.log('=== END DEBUG INFO ===');
    
    // Fix: Handle all possible parameter names from frontend
    const { 
      razorpayOrderId, 
      razorpayPaymentId, 
      razorpaySignature, 
      orderId,
      order_id // Handle different naming conventions
    } = req.body;
    
    // Use the first available order ID parameter
    const searchOrderId = razorpayOrderId || orderId || order_id;

    console.log('Extracted parameters:', {
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      orderId,
      order_id,
      searchOrderId
    });

    // Validate required parameters
    if (!searchOrderId) {
      console.log('Validation failed: Missing order ID');
      return res.status(400).json({ 
        success: false,
        error: 'Order ID is required' 
      });
    }

    // Find order
    console.log('Looking for order with orderId:', searchOrderId);
    const order = await Order.findById(searchOrderId).populate('items.product');
    if (!order) {
      console.log('Order not found for orderId:', searchOrderId);
      return res.status(404).json({ 
        success: false,
        error: 'Order not found' 
      });
    }

    console.log('Order found:', {
      id: order._id,
      orderNumber: order.orderNumber,
      razorpayOrderId: order.razorpayOrderId,
      paymentStatus: order.paymentStatus
    });

    // Check if we have all required Razorpay parameters for proper verification
    const hasRazorpayParams = razorpayOrderId && razorpayPaymentId && razorpaySignature;
    
    if (!hasRazorpayParams) {
      console.warn('⚠️  Missing Razorpay verification parameters - performing manual verification:', {
        hasOrderId: !!razorpayOrderId,
        hasPaymentId: !!razorpayPaymentId,
        hasSignature: !!razorpaySignature
      });
      console.warn('This may cause refunds if webhook is not properly configured');
    }

    // If no Razorpay integration, mark as completed manually
    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      console.log('⚠️  Manual payment verification - Missing one or more Razorpay parameters');
      console.log('This may cause refunds if webhook is not properly configured');
      
      // For manual verification or testing without Razorpay
      order.paymentStatus = 'completed';
      order.razorpayPaymentId = 'manual_' + Date.now();
      order.razorpaySignature = 'manual_signature';
      await order.save();
      
      console.log('✅ Order marked as completed via manual verification');
    } else {
      console.log('🔐 Verifying Razorpay signature');
      // Verify signature using the proper utility function
      const { verifyRazorpaySignature } = require('../utils/payment.utils');
      const isValid = verifyRazorpaySignature(
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature
      );

      if (!isValid) {
        console.log('❌ Payment verification failed - invalid signature');
        order.paymentStatus = 'failed';
        await order.save();
        return res.status(400).json({ 
          success: false,
          error: 'Payment verification failed' 
        });
      }

      // Update order
      console.log('✅ Payment verified successfully via signature verification');
      order.paymentStatus = 'completed';
      order.razorpayPaymentId = razorpayPaymentId;
      order.razorpaySignature = razorpaySignature;
      await order.save();
    }

    // Update product sales count (both total and real)
    console.log('Updating product sales count');
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
      console.log('Preparing to send confirmation email');
      const products = order.items.map((item: any) => ({
        name: item.name,
        price: item.price
      }));

      // Get the first product's PDF for now (in real app, you'd handle multiple PDFs)
      const firstProduct = await Product.findById(order.items[0].product);
      if (firstProduct) {
        console.log('Generating download link for product:', firstProduct._id);
        const downloadLink = await getSignedDownloadUrl(firstProduct.pdfUrl);
        
        const customerEmail = order.guestEmail || (req as any).user?.email;
        const customerName = order.guestName || (req as any).user?.name;
        
        console.log('Email details:', {
          to: customerEmail,
          from: env.email.from,
          subject: `Order Confirmation - ${order.orderNumber}`,
          customerName: customerName || 'Customer',
          orderNumber: order.orderNumber,
          purchaseId: order.purchaseId,
          totalAmount: order.totalAmount,
          pdfPassword: firstProduct.pdfPassword ? '***PROVIDED***' : 'MISSING',
          downloadLink: downloadLink ? '***GENERATED***' : 'MISSING'
        });

        if (customerEmail) {
          await sendEmail({
            to: customerEmail,
            subject: `Order Confirmation - ${order.orderNumber}`,
            html: getOrderConfirmationEmail(
              customerName || 'Customer',
              order.orderNumber,
              order.purchaseId,
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
          console.log('Order confirmation email sent successfully');
        } else {
          console.log('No customer email found, skipping email send');
        }
      } else {
        console.log('No product found for order item, skipping email send');
      }
    } catch (error) {
      console.error('Email sending failed:', error);
      // Even if email fails, we still want to mark the order as successful
      // The user can use the resend email feature
      console.log('Continuing with order completion despite email failure');
    }

    return res.json({
      success: true,
      message: 'Payment verified successfully',
      order: {
        id: order._id,
        orderNumber: order.orderNumber,
        paymentStatus: order.paymentStatus
      }
    });
  } catch (error) {
    console.error('Payment verification error:', error);
    // Ensure we always return a valid JSON response
    return res.status(500).json({
      success: false,
      error: 'Internal server error during payment verification',
      message: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : 'Unknown error') : undefined
    });
  }
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
router.get('/:id', optionalAuth, asyncHandler(async (req: Request, res: Response) => {
  const order = await Order.findById(req.params.id)
    .populate('items.product', 'name slug images');

  if (!order) {
    res.status(404).json({ error: 'Order not found' });
    return;
  }

  // Check authorization
  const isAuthorized = 
    (order.user && order.user.toString() === (req as any).user?._id?.toString()) ||
    (order.guestEmail && req.query.guestEmail === order.guestEmail);

  if (!isAuthorized && (req as any).user?.role !== 'admin') {
    res.status(403).json({ error: 'Unauthorized' });
    return;
  }

  res.json({
    success: true,
    order
  });
}));

// Resend order confirmation email
router.post('/:id/resend-email', authenticate, asyncHandler(async (req: Request, res: Response) => {
  try {
    const orderId = req.params.id;
    const order = await Order.findById(orderId).populate('items.product');
    
    if (!order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    // Check authorization
    if (order.user?.toString() !== (req as any).user._id.toString()) {
      res.status(403).json({ error: 'Unauthorized' });
      return;
    }

    // Check if order is completed
    if (order.paymentStatus !== 'completed') {
      res.status(400).json({ error: 'Order not completed' });
      return;
    }

    // Get the first product's PDF for now (in real app, you'd handle multiple PDFs)
    const firstProduct = await Product.findById(order.items[0].product);
    if (!firstProduct) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    const products = order.items.map((item: any) => ({
      name: item.name,
      price: item.price
    }));

    const customerEmail = order.guestEmail || (req as any).user?.email;
    const customerName = order.guestName || (req as any).user?.name;
    
    if (!customerEmail) {
      res.status(400).json({ error: 'No email address found for customer' });
      return;
    }

    // Generate download link for resend
    const downloadLink = firstProduct.pdfUrl.startsWith('http') 
      ? firstProduct.pdfUrl 
      : `https://s3.eu-north-1.amazonaws.com/desiprompts-prod-files/${firstProduct.pdfUrl}`;

    await sendEmail({
      to: customerEmail,
      subject: `Order Confirmation - ${order.orderNumber}`,
      html: getOrderConfirmationEmail(
        customerName || 'Customer',
        order.orderNumber,
        order.purchaseId,
        products,
        order.totalAmount,
        firstProduct.pdfPassword,
        downloadLink
      )
    });

    order.emailSent = true;
    order.emailSentAt = new Date();
    // Only update pdfDelivered if it wasn't already delivered
    if (!order.pdfDelivered) {
      order.pdfDelivered = true;
      order.pdfDeliveredAt = new Date();
    }
    await order.save();

    res.json({
      success: true,
      message: 'Order confirmation email resent successfully'
    });
  } catch (error) {
    console.error('Failed to resend email:', error);
    res.status(500).json({ 
      error: 'Failed to resend email', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
}));

// Get download link for purchased product
router.get('/:orderId/download/:productId', optionalAuth, asyncHandler(async (req: Request, res: Response) => {
  console.log('Download request received:', { 
    orderId: req.params.orderId, 
    productId: req.params.productId,
    userId: (req as any).user?._id,
    query: req.query
  });

  const { orderId, productId } = req.params;

  const order = await Order.findById(orderId);
  if (!order || order.paymentStatus !== 'completed') {
    console.log('Order not found or not completed:', { orderId, paymentStatus: order?.paymentStatus });
    res.status(404).json({ error: 'Order not found or payment not completed' });
    return;
  }

  // Check if product is in order
  const orderItem = order.items.find(item => 
    item.product.toString() === productId
  );
  if (!orderItem) {
    console.log('Product not found in order:', { orderId, productId });
    res.status(404).json({ error: 'Product not found in order' });
    return;
  }

  // Check authorization
  const isAuthorized = 
    (order.user && order.user.toString() === (req as any).user?._id?.toString()) ||
    (order.guestEmail && req.query.guestEmail === order.guestEmail);

  if (!isAuthorized) {
    console.log('Unauthorized download attempt:', { 
      orderId, 
      productId, 
      userId: (req as any).user?._id,
      orderUser: order.user,
      guestEmail: order.guestEmail,
      queryEmail: req.query.guestEmail
    });
    res.status(403).json({ error: 'Unauthorized' });
    return;
  }

  const product = await Product.findById(productId);
  if (!product) {
    console.log('Product not found:', { productId });
    res.status(404).json({ error: 'Product not found' });
    return;
  }

  // Handle both local and S3 storage
  let downloadUrl;
  const isProduction = process.env.MODE === 'production' || process.env.NODE_ENV === 'production';
  
  console.log('Generating download URL:', { 
    isProduction, 
    pdfUrl: product.pdfUrl,
    product: product._id
  });
  
  if (isProduction) {
    // Production: Use S3 signed URL
    // The product.pdfUrl should contain the S3 key
    downloadUrl = await getSignedDownloadUrl(product.pdfUrl);
    console.log('Generated S3 signed URL:', downloadUrl);
  } else {
    // Development: Use direct URL
    // The product.pdfUrl should contain the full local URL
    downloadUrl = product.pdfUrl;
    console.log('Using local URL:', downloadUrl);
  }

  // Fix: Ensure we always return a proper response
  if (!downloadUrl) {
    console.error('Failed to generate download URL for product:', productId);
    res.status(500).json({ error: 'Failed to generate download link' });
    return;
  }

  res.json({
    success: true,
    downloadUrl,
    password: product.pdfPassword,
    expiresIn: isProduction ? '30 minutes' : 'permanent'
  });
}));

export default router;