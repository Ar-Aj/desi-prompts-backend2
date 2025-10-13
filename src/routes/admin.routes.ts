import express, { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { User } from '../models/User.model';
import { Product } from '../models/Product.model';
import { Order } from '../models/Order.model';
import { Review } from '../models/Review.model';
import { Demo } from '../models/Demo.model';
import { SupportTicket } from '../models/SupportTicket.model';
import { authenticate } from '../middleware/auth.middleware';
import { authorizeAdmin } from '../middleware/admin.middleware';
import { asyncHandler } from '../middleware/asyncHandler.middleware';

const router: express.Router = express.Router();

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const uploadDir = path.join(process.cwd(), 'uploads', 'images');
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      try {
        fs.mkdirSync(uploadDir, { recursive: true });
        console.log('Created upload directory:', uploadDir);
      } catch (error) {
        console.error('Failed to create upload directory:', error);
      }
    }
    cb(null, uploadDir);
  },
  filename: (_req, _file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `${uniqueSuffix}${path.extname(_file.originalname)}`);
  }
});

// Configure multer for PDF uploads (memory storage for S3)
const pdfStorage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (_req, _file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(_file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(_file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'));
    }
  }
});

// PDF upload configuration
const pdfUpload = multer({
  storage: pdfStorage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit for PDFs
  },
  fileFilter: (_req, _file, cb) => {
    if (_file.mimetype === 'application/pdf') {
      return cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed!'));
    }
  }
});

// Apply admin authentication to all routes
router.use(authenticate);
router.use(authorizeAdmin);

// Image upload endpoint
router.post('/upload-image', upload.single('image'), asyncHandler(async (req: Request, res: Response) => {
  console.log('=== Image Upload Request ===');
  console.log('Request received at:', new Date().toISOString());
  console.log('File info:', req.file);
  console.log('Headers:', req.headers);
  
  if (!req.file) {
    console.log('No file provided in request');
    res.status(400).json({
      success: false,
      error: 'No image file provided'
    });
    return;
  }

  try {
    const imageUrl = `/uploads/images/${req.file.filename}`;
    
    // In production, use absolute URLs pointing to the backend server
    // In development, use relative URLs
    const isProduction = process.env.MODE === 'production';
    const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5000}`;
    
    // Ensure backendUrl doesn't end with a slash
    const cleanBackendUrl = backendUrl.endsWith('/') ? backendUrl.slice(0, -1) : backendUrl;
    // Ensure imageUrl starts with a slash
    const cleanImageUrl = imageUrl.startsWith('/') ? imageUrl : `/${imageUrl}`;
    
    const fullImageUrl = isProduction ? `${cleanBackendUrl}${cleanImageUrl}` : cleanImageUrl;
    
    // Log the generated URL for debugging
    console.log('=== Image URL Generation ===');
    console.log('Original backendUrl:', backendUrl);
    console.log('Cleaned backendUrl:', cleanBackendUrl);
    console.log('Original imageUrl:', imageUrl);
    console.log('Cleaned imageUrl:', cleanImageUrl);
    console.log('Full image URL:', fullImageUrl);
    console.log('Backend URL from env:', process.env.BACKEND_URL);
    console.log('Is production mode:', isProduction);
    
    // Verify the file exists
    const filePath = path.join(process.cwd(), 'uploads', 'images', req.file.filename);
    const fileExists = fs.existsSync(filePath);
    console.log('File exists at:', filePath, fileExists);
    
    res.json({
      success: true,
      imageUrl: fullImageUrl,
      filename: req.file.filename,
      debug: {
        backendUrl: cleanBackendUrl,
        isProduction,
        fileExists,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Image upload error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process image upload',
      debug: {
        timestamp: new Date().toISOString(),
        errorMessage: error instanceof Error ? error.message : String(error)
      }
    });
  }
}));

// PDF upload endpoint for S3
router.post('/upload-pdf', pdfUpload.single('pdf'), asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({
      success: false,
      error: 'No PDF file provided'
    });
    return;
  }

  try {
    // Import S3 utilities
    const { uploadFile } = require('../utils/storage.utils');
    
    // Generate unique file key
    const fileKey = `pdfs/${Date.now()}-${Math.round(Math.random() * 1E9)}.pdf`;
    
    // Upload to S3
    await uploadFile(req.file.buffer, fileKey, 'application/pdf');
    
    res.json({
      success: true,
      fileKey,
      message: 'PDF uploaded successfully to S3'
    });
  } catch (error) {
    console.error('PDF upload error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to upload PDF to S3'
    });
  }
}));

// Get admin stats
router.get('/stats', asyncHandler(async (_req: Request, _res: Response) => {
  const [
    totalUsers,
    totalOrders,
    totalProducts,
    totalRevenue,
    recentOrders,
    topProducts,
    openTickets,
    monthlyRevenue
  ] = await Promise.all([
    User.countDocuments({ role: 'customer' }),
    Order.countDocuments({ 
      paymentStatus: 'completed',
      isFakeOrder: { $ne: true } // Exclude fake orders
    }),
    Product.countDocuments({ isActive: true }),
    Order.aggregate([
      { 
        $match: { 
          paymentStatus: 'completed',
          isFakeOrder: { $ne: true } // Exclude fake orders from revenue
        } 
      },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } }
    ]),
    Order.find({ 
      paymentStatus: 'completed',
      isFakeOrder: { $ne: true } // Exclude fake orders from recent orders
    })
      .populate('user', 'name email')
      .populate('items.product', 'name')
      .sort({ createdAt: -1 })
      .limit(5),
    Product.find({ isActive: true })
      .sort({ realSalesCount: -1 })
      .limit(5)
      .select('name salesCount realSalesCount averageRating'),
    SupportTicket.countDocuments({ status: 'open' }),
    Order.aggregate([
      {
        $match: {
          paymentStatus: 'completed',
          isFakeOrder: { $ne: true } // Exclude fake orders
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          revenue: { $sum: '$totalAmount' },
          orders: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
      { $limit: 12 }
    ])
  ]);

  _res.json({
    success: true,
    stats: {
      totalUsers,
      totalOrders,
      totalProducts,
      totalRevenue: totalRevenue[0]?.total || 0,
      openTickets,
      recentOrders,
      topProducts,
      monthlyRevenue: monthlyRevenue.map(item => ({
        month: `${item._id.year}-${String(item._id.month).padStart(2, '0')}`,
        revenue: item.revenue,
        orders: item.orders
      }))
    }
  });
}));

// Get all users
router.get('/users', asyncHandler(async (req: Request, res: Response) => {
  const { page = 1, limit = 20 } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const [users, total] = await Promise.all([
    User.find({ role: 'customer' })
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    User.countDocuments({ role: 'customer' })
  ]);

  res.json({
    success: true,
    users,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      total,
      pages: Math.ceil(total / Number(limit))
    }
  });
}));

// Get all orders
router.get('/orders', asyncHandler(async (req: any, res: any) => {
  const { 
    page = 1, 
    limit = 20, 
    status,
    startDate,
    endDate,
    search
  } = req.query;
  
  const skip = (Number(page) - 1) * Number(limit);
  const query: any = {};

  if (status) query.paymentStatus = status;
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate as string);
    if (endDate) query.createdAt.$lte = new Date(endDate as string);
  }
  if (search) {
    query.$or = [
      { orderNumber: { $regex: search, $options: 'i' } },
      { guestEmail: { $regex: search, $options: 'i' } }
    ];
  }

  const [orders, total] = await Promise.all([
    Order.find(query)
      .populate('user', 'name email')
      .populate('items.product', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    Order.countDocuments(query)
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

// Get unregistered purchases (guest orders)
router.get('/orders/unregistered', asyncHandler(async (req: any, res: any) => {
  const { 
    page = 1, 
    limit = 20, 
    status,
    startDate,
    endDate,
    search
  } = req.query;
  
  const skip = (Number(page) - 1) * Number(limit);
  const query: any = {
    user: { $exists: false }, // Orders without registered user
    guestEmail: { $exists: true }, // Must have guest email
    isFakeOrder: { $ne: true } // Exclude fake orders
  };

  if (status) query.paymentStatus = status;
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate as string);
    if (endDate) query.createdAt.$lte = new Date(endDate as string);
  }
  if (search) {
    query.$or = [
      { orderNumber: { $regex: search, $options: 'i' } },
      { guestEmail: { $regex: search, $options: 'i' } },
      { guestName: { $regex: search, $options: 'i' } }
    ];
  }

  const [orders, total] = await Promise.all([
    Order.find(query)
      .populate('items.product', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    Order.countDocuments(query)
  ]);

  // Calculate summary stats for unregistered purchases
  const [totalRevenue, totalCount] = await Promise.all([
    Order.aggregate([
      {
        $match: {
          user: { $exists: false },
          guestEmail: { $exists: true },
          isFakeOrder: { $ne: true },
          paymentStatus: 'completed'
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$totalAmount' }
        }
      }
    ]),
    Order.countDocuments({
      user: { $exists: false },
      guestEmail: { $exists: true },
      isFakeOrder: { $ne: true },
      paymentStatus: 'completed'
    })
  ]);

  res.json({
    success: true,
    orders,
    summary: {
      totalRevenue: totalRevenue[0]?.total || 0,
      totalCount
    },
    pagination: {
      page: Number(page),
      limit: Number(limit),
      total,
      pages: Math.ceil(total / Number(limit))
    }
  });
}));

// Export orders to CSV
router.get('/orders/export', asyncHandler(async (req: any, res: any) => {
  const { startDate, endDate, unregisteredOnly } = req.query;
  
  const query: any = { paymentStatus: 'completed' };
  
  // Filter for unregistered purchases only if requested
  if (unregisteredOnly === 'true') {
    query.user = { $exists: false };
    query.guestEmail = { $exists: true };
    query.isFakeOrder = { $ne: true };
  }
  
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate as string);
    if (endDate) query.createdAt.$lte = new Date(endDate as string);
  }

  const orders = await Order.find(query)
    .populate('user', 'name email')
    .populate('items.product', 'name')
    .sort({ createdAt: -1 });

  // Create CSV
  const csv = [
    'Order Number,Date,Customer Type,Customer Name,Customer Email,Products,Total Amount,Payment Status,Payment ID',
    ...orders.map(order => {
      const customerType = order.user ? 'Registered' : 'Unregistered';
      const customerName = order.user ? (order.user as any).name : order.guestName;
      const customerEmail = order.user ? (order.user as any).email : order.guestEmail;
      const products = order.items.map(item => (item as any).name).join('; ');
      return `"${order.orderNumber}","${order.createdAt.toISOString()}","${customerType}","${customerName}","${customerEmail}","${products}","${order.totalAmount}","${order.paymentStatus}","${order.razorpayPaymentId || 'N/A'}"`;
    })
  ].join('\n');

  const filename = unregisteredOnly === 'true' ? 'unregistered-orders.csv' : 'orders.csv';
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
  res.send(csv);
}));

// Get all support tickets
router.get('/support/tickets', asyncHandler(async (req: Request, res: Response) => {
  const { page = 1, limit = 20, status } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const query: any = {};
  if (status && status !== 'all') {
    query.status = status;
  }

  const [tickets, total] = await Promise.all([
    SupportTicket.find(query)
      .populate('user', 'name email')
      .populate('order', 'orderNumber')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    SupportTicket.countDocuments(query)
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

// Update ticket status
router.patch('/support/tickets/:ticketId/status', asyncHandler(async (req: Request, res: Response) => {
  const { ticketId } = req.params;
  const { status } = req.body;

  const ticket = await SupportTicket.findByIdAndUpdate(
    ticketId,
    { status },
    { new: true }
  ).populate('user', 'name email')
   .populate('order', 'orderNumber');

  if (!ticket) {
    res.status(404).json({ error: 'Ticket not found' });
    return;
  }

  res.json({
    success: true,
    ticket
  });
}));

// Get product analytics
router.get('/products/analytics', asyncHandler(async (_req: Request, res: Response) => {
  const analytics = await Product.aggregate([
    { $match: { isActive: true } },
    {
      $lookup: {
        from: 'reviews',
        localField: '_id',
        foreignField: 'product',
        as: 'reviews'
      }
    },
    {
      $project: {
        name: 1,
        category: 1,
        price: 1,
        salesCount: 1,
        averageRating: 1,
        totalReviews: 1,
        revenue: { $multiply: ['$price', '$realSalesCount'] },
        reviewTrend: {
          $map: {
            input: '$reviews',
            as: 'review',
            in: {
              date: '$$review.createdAt',
              rating: '$$review.rating'
            }
          }
        }
      }
    },
    { $sort: { revenue: -1 } }
  ]);

  res.json({
    success: true,
    analytics
  });
}));

// Get all reviews (including fake ones for admin)
router.get('/reviews', asyncHandler(async (req: Request, res: Response) => {
  const { page = 1, limit = 20 } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const [reviews, total] = await Promise.all([
    Review.find()
      .populate('product', 'name')
      .populate('user', 'name email')
      .populate('order', 'orderNumber')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    Review.countDocuments()
  ]);

  res.json({
    success: true,
    reviews,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      total,
      pages: Math.ceil(total / Number(limit))
    }
  });
}));

// Create fake review
router.post('/reviews/fake', asyncHandler(async (req: Request, res: Response) => {
  const {
    product,
    fakeReviewerName,
    rating,
    title,
    comment,
    isVerifiedPurchase: _isVerifiedPurchase = true // Always true for fake reviews to show "Verified Purchase"
  } = req.body;

  // Validate required fields
  if (!product || !fakeReviewerName || !rating || !title || !comment) {
    res.status(400).json({ 
      error: 'Missing required fields: product, fakeReviewerName, rating, title, comment' 
    });
    return;
  }

  // Check if product exists
  const productExists = await Product.findById(product);
  if (!productExists) {
    res.status(404).json({ error: 'Product not found' });
    return;
  }

  // Create fake order first (to support verified purchase)
  const fakeOrder = new Order({
    orderNumber: `FAKE-${Date.now()}`,
    guestName: fakeReviewerName,
    guestEmail: `fake-${Date.now()}@example.com`, // Generate fake email
    items: [{
      product: productExists._id,
      name: productExists.name,
      price: productExists.price,
      quantity: 1
    }],
    totalAmount: productExists.price,
    paymentStatus: 'completed',
    paymentMethod: 'fake',
    isFakeOrder: true,
    pdfDelivered: true,
    emailSent: true
  });

  await fakeOrder.save();

  // Update product sales count
  await Product.findByIdAndUpdate(product, {
    $inc: { salesCount: 1 }
  });

  // Create fake review linked to fake order
  const fakeReview = new Review({
    product,
    order: fakeOrder._id,
    fakeReviewerName,
    rating: Number(rating),
    title,
    comment,
    isFakeReview: true,
    isVerifiedPurchase: true, // Always true since we created a fake order
    isActive: true
  });

  await fakeReview.save();

  // Populate the review for response
  await fakeReview.populate('product', 'name');

  res.status(201).json({
    success: true,
    review: fakeReview,
    order: fakeOrder,
    message: 'Fake review and purchase created successfully'
  });
}));

// Get review moderation queue
router.get('/reviews/moderation', asyncHandler(async (req: Request, res: Response) => {
  const { page = 1, limit = 20 } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const [reviews, total] = await Promise.all([
    Review.find({ isActive: true })
      .populate('product', 'name')
      .populate('user', 'name email')
      .populate('order', 'orderNumber')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    Review.countDocuments({ isActive: true })
  ]);

  res.json({
    success: true,
    reviews,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      total,
      pages: Math.ceil(total / Number(limit))
    }
  });
}));

// Toggle review status
router.patch('/reviews/:reviewId/toggle', asyncHandler(async (req: Request, res: Response) => {
  const review = await Review.findById(req.params.reviewId);
  if (!review) {
    res.status(404).json({ error: 'Review not found' });
    return;
  }

  review.isActive = !review.isActive;
  await review.save();

  res.json({
    success: true,
    message: `Review ${review.isActive ? 'activated' : 'deactivated'} successfully`,
    review
  });
}));

// Update review fake helpful counts (Admin only)
router.patch('/reviews/:reviewId/update-fake-helpful', asyncHandler(async (req: Request, res: Response) => {
  const { reviewId } = req.params;
  const { fakeHelpful, fakeNotHelpful } = req.body;

  const updateData: any = {};
  if (typeof fakeHelpful === 'number') updateData.fakeHelpful = Math.max(0, fakeHelpful);
  if (typeof fakeNotHelpful === 'number') updateData.fakeNotHelpful = Math.max(0, fakeNotHelpful);

  const review = await Review.findByIdAndUpdate(
    reviewId,
    updateData,
    { new: true }
  );

  if (!review) {
    res.status(404).json({ error: 'Review not found' });
    return;
  }

  res.json({
    success: true,
    review
  });
}));

// Create fake purchase (without review)
router.post('/orders/fake', asyncHandler(async (req: Request, res: Response) => {
  const {
    product,
    fakeCustomerName,
    quantity = 1
  } = req.body;

  // Validate required fields
  if (!product || !fakeCustomerName) {
    res.status(400).json({ 
      error: 'Missing required fields: product, fakeCustomerName' 
    });
    return;
  }

  // Check if product exists
  const productExists = await Product.findById(product);
  if (!productExists) {
    res.status(404).json({ error: 'Product not found' });
    return;
  }

  // Create fake order
  const fakeOrder = new Order({
    orderNumber: `FAKE-${Date.now()}`,
    guestName: fakeCustomerName,
    guestEmail: `fake-${Date.now()}@example.com`, // Generate fake email
    fakeCustomerName, // Keep this for admin reference
    items: [{
      product: productExists._id,
      name: productExists.name,
      price: productExists.price,
      quantity: Number(quantity)
    }],
    totalAmount: productExists.price * Number(quantity),
    paymentStatus: 'completed',
    paymentMethod: 'fake',
    isFakeOrder: true,
    pdfDelivered: true,
    emailSent: true
  });

  await fakeOrder.save();

  // Update product sales count
  await Product.findByIdAndUpdate(product, {
    $inc: { salesCount: Number(quantity) }
  });

  // Populate the order for response
  await fakeOrder.populate('items.product', 'name');

  res.status(201).json({
    success: true,
    order: fakeOrder,
    message: 'Fake purchase created successfully'
  });
}));

// Get detailed product metrics with fake vs real data
router.get('/products/metrics', asyncHandler(async (_req: Request, res: Response) => {
  const metrics = await Product.aggregate([
    {
      $lookup: {
        from: 'orders',
        let: { productId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $in: ['$$productId', '$items.product'] },
                  { $eq: ['$paymentStatus', 'completed'] }
                ]
              }
            }
          },
          {
            $unwind: '$items'
          },
          {
            $match: {
              $expr: { $eq: ['$items.product', '$$productId'] }
            }
          }
        ],
        as: 'orders'
      }
    },
    {
      $lookup: {
        from: 'reviews',
        localField: '_id',
        foreignField: 'product',
        as: 'reviews'
      }
    },
    {
      $addFields: {
        // Real orders (not fake)
        realOrders: {
          $filter: {
            input: '$orders',
            cond: { $ne: ['$$this.isFakeOrder', true] }
          }
        },
        // Fake orders
        fakeOrders: {
          $filter: {
            input: '$orders',
            cond: { $eq: ['$$this.isFakeOrder', true] }
          }
        },
        // Real reviews (not fake)
        realReviews: {
          $filter: {
            input: '$reviews',
            cond: { $and: [
              { $ne: ['$$this.isFakeReview', true] },
              { $eq: ['$$this.isActive', true] }
            ]}
          }
        },
        // Fake reviews
        fakeReviews: {
          $filter: {
            input: '$reviews',
            cond: { $and: [
              { $eq: ['$$this.isFakeReview', true] },
              { $eq: ['$$this.isActive', true] }
            ]}
          }
        }
      }
    },
    {
      $project: {
        name: 1,
        slug: 1,
        price: 1,
        category: 1,
        isActive: 1,
        createdAt: 1,
        
        // Sales metrics
        totalSales: { $size: '$orders' },
        realSales: { $size: '$realOrders' },
        fakeSales: { $size: '$fakeOrders' },
        
        // Revenue metrics
        totalRevenue: {
          $sum: {
            $map: {
              input: '$orders',
              as: 'order',
              in: { $multiply: ['$$order.items.price', '$$order.items.quantity'] }
            }
          }
        },
        realRevenue: {
          $sum: {
            $map: {
              input: '$realOrders',
              as: 'order',
              in: { $multiply: ['$$order.items.price', '$$order.items.quantity'] }
            }
          }
        },
        fakeRevenue: {
          $sum: {
            $map: {
              input: '$fakeOrders',
              as: 'order',
              in: { $multiply: ['$$order.items.price', '$$order.items.quantity'] }
            }
          }
        },
        
        // Review metrics
        totalReviews: { $size: '$reviews' },
        realReviews: { $size: '$realReviews' },
        fakeReviews: { $size: '$fakeReviews' },
        
        // Rating metrics
        averageRating: {
          $cond: {
            if: { $gt: [{ $size: '$reviews' }, 0] },
            then: { $avg: '$reviews.rating' },
            else: 0
          }
        },
        realAverageRating: {
          $cond: {
            if: { $gt: [{ $size: '$realReviews' }, 0] },
            then: { $avg: '$realReviews.rating' },
            else: 0
          }
        },
        fakeAverageRating: {
          $cond: {
            if: { $gt: [{ $size: '$fakeReviews' }, 0] },
            then: { $avg: '$fakeReviews.rating' },
            else: 0
          }
        }
      }
    },
    {
      $sort: { totalRevenue: -1 }
    }
  ]);

  res.json({
    success: true,
    metrics
  });
}));

// DEMO MANAGEMENT ROUTES

// Get all demos
router.get('/demos', asyncHandler(async (req: Request, res: Response) => {
  const { page = 1, limit = 20 } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const [demos, total] = await Promise.all([
    Demo.find()
      .populate('product', 'name category price')
      .sort({ order: 1, createdAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    Demo.countDocuments()
  ]);

  res.json({
    success: true,
    demos,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      total,
      pages: Math.ceil(total / Number(limit))
    }
  });
}));

// Create demo
router.post('/demos', asyncHandler(async (req: Request, res: Response) => {
  const {
    title,
    description,
    product,
    beforeImage,
    afterImages,
    order = 0
  } = req.body;

  // Validate required fields
  if (!title || !description || !product || !beforeImage || !afterImages || !Array.isArray(afterImages) || afterImages.length === 0) {
    res.status(400).json({
      error: 'Missing required fields: title, description, product, beforeImage, afterImages (array with at least one image and prompt info)'
    });
    return;
  }

  // Validate each after image has required prompt info
  for (let i = 0; i < afterImages.length; i++) {
    const afterImage = afterImages[i];
    if (!afterImage.image || !afterImage.promptName || !afterImage.promptDescription) {
      res.status(400).json({
        error: `After image ${i + 1} is missing required fields: image, promptName, or promptDescription`
      });
      return;
    }
  }

  // Check if product exists
  const productExists = await Product.findById(product);
  if (!productExists) {
    res.status(404).json({ error: 'Product not found' });
    return;
  }

  // Create demo
  const demo = new Demo({
    title,
    description,
    product,
    beforeImage,
    afterImages,
    order: Number(order),
    isActive: true
  });

  await demo.save();

  // Populate the demo for response
  await demo.populate('product', 'name category price');

  res.status(201).json({
    success: true,
    demo,
    message: 'Demo created successfully'
  });
}));

// Update demo
router.put('/demos/:demoId', asyncHandler(async (req: Request, res: Response) => {
  const { demoId } = req.params;
  const {
    title,
    description,
    product,
    beforeImage,
    afterImages,
    order,
    isActive
  } = req.body;

  const demo = await Demo.findById(demoId);
  if (!demo) {
    res.status(404).json({ error: 'Demo not found' });
    return;
  }

  // If product is being changed, validate it exists
  if (product && product !== demo.product.toString()) {
    const productExists = await Product.findById(product);
    if (!productExists) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }
  }

  // Update fields
  if (title !== undefined) demo.title = title;
  if (description !== undefined) demo.description = description;
  if (product !== undefined) demo.product = product;
  if (beforeImage !== undefined) demo.beforeImage = beforeImage;
  if (afterImages !== undefined) demo.afterImages = afterImages;
  if (order !== undefined) demo.order = Number(order);
  if (isActive !== undefined) demo.isActive = isActive;

  await demo.save();
  await demo.populate('product', 'name category price');

  res.json({
    success: true,
    demo,
    message: 'Demo updated successfully'
  });
}));

// Delete demo
router.delete('/demos/:demoId', asyncHandler(async (req: Request, res: Response) => {
  const { demoId } = req.params;

  const demo = await Demo.findById(demoId);
  if (!demo) {
    res.status(404).json({ error: 'Demo not found' });
    return;
  }

  await Demo.findByIdAndDelete(demoId);

  res.json({
    success: true,
    message: 'Demo deleted successfully'
  });
}));

// Toggle demo status
router.patch('/demos/:demoId/toggle', asyncHandler(async (req: Request, res: Response) => {
  const demo = await Demo.findById(req.params.demoId);
  if (!demo) {
    res.status(404).json({ error: 'Demo not found' });
    return;
  }

  demo.isActive = !demo.isActive;
  await demo.save();

  res.json({
    success: true,
    demo
  });
}));

// Get customer analytics
router.get('/customers/analytics', asyncHandler(async (_req: Request, _res: Response) => {
  const [
    totalCustomers,
    newCustomers,
    activeCustomers,
    customerSpending,
    topCustomers
  ] = await Promise.all([
    User.countDocuments({ role: 'customer' }),
    User.countDocuments({ 
      role: 'customer',
      createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } // Last 30 days
    }),
    Order.distinct('user', { 
      paymentStatus: 'completed',
      createdAt: { $gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) } // Last 90 days
    }).then(userIds => userIds.length),
    Order.aggregate([
      { $match: { paymentStatus: 'completed' } },
      {
        $group: {
          _id: '$user',
          totalSpent: { $sum: '$totalAmount' },
          orderCount: { $sum: 1 }
        }
      },
      { $sort: { totalSpent: -1 } },
      { $limit: 10 }
    ]).then(async (results) => {
      const enriched = await Promise.all(
        results.map(async (result: any) => {
          if (result._id) {
            const user = await User.findById(result._id).select('name email');
            return {
              ...result,
              user: user ? { name: user.name, email: user.email } : null
            };
          }
          return result;
        })
      );
      return enriched.filter((item: any) => item.user !== null);
    }),
    User.find({ role: 'customer' })
      .sort({ totalSpent: -1 })
      .limit(10)
      .select('name email totalSpent')
  ]);

  _res.json({
    success: true,
    analytics: {
      totalCustomers,
      newCustomers,
      activeCustomers,
      customerSpending,
      topCustomers
    }
  });
}));

export default router;
