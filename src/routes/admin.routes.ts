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

const router = express.Router();

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(process.cwd(), 'uploads', 'images');
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

// Configure multer for PDF uploads (memory storage for S3)
const pdfStorage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

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
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
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
router.post('/upload-image', upload.single('image'), asyncHandler(async (req: any, res: any) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      error: 'No image file provided'
    });
  }

  const imageUrl = `/uploads/images/${req.file.filename}`;
  
  res.json({
    success: true,
    imageUrl: `http://localhost:5000${imageUrl}`,
    filename: req.file.filename
  });
}));

// PDF upload endpoint for S3
router.post('/upload-pdf', pdfUpload.single('pdf'), asyncHandler(async (req: any, res: any) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      error: 'No PDF file provided'
    });
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
router.get('/stats', asyncHandler(async (req: any, res: any) => {
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

  res.json({
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
router.get('/users', asyncHandler(async (req: any, res: any) => {
  const { page = 1, limit = 20, search } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const query: any = { role: 'customer' };
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } }
    ];
  }

  const [users, total] = await Promise.all([
    User.find(query)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    User.countDocuments(query)
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
router.get('/support-tickets', asyncHandler(async (req: any, res: any) => {
  const { 
    page = 1, 
    limit = 20,
    status,
    priority,
    ticketType
  } = req.query;
  
  const skip = (Number(page) - 1) * Number(limit);
  const query: any = {};

  if (status) query.status = status;
  if (priority) query.priority = priority;
  if (ticketType) query.ticketType = ticketType;

  const [tickets, total] = await Promise.all([
    SupportTicket.find(query)
      .populate('user', 'name email')
      .populate('order', 'orderNumber')
      .sort({ priority: -1, createdAt: -1 })
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

// Get product analytics
router.get('/products/analytics', asyncHandler(async (req, res) => {
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
router.get('/reviews', asyncHandler(async (req, res) => {
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
    isVerifiedPurchase = true // Always true for fake reviews to show "Verified Purchase"
  } = req.body;

  // Validate required fields
  if (!product || !fakeReviewerName || !rating || !title || !comment) {
    return res.status(400).json({ 
      error: 'Missing required fields: product, fakeReviewerName, rating, title, comment' 
    });
  }

  // Check if product exists
  const productExists = await Product.findById(product);
  if (!productExists) {
    return res.status(404).json({ error: 'Product not found' });
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
router.get('/reviews/moderation', asyncHandler(async (req, res) => {
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
router.patch('/reviews/:reviewId/toggle', asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.reviewId);
  if (!review) {
    return res.status(404).json({ error: 'Review not found' });
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
router.patch('/reviews/:reviewId/update-fake-helpful', asyncHandler(async (req, res) => {
  const { reviewId } = req.params;
  const { fakeHelpful, fakeNotHelpful } = req.body;

  const updateData: any = {};
  if (typeof fakeHelpful === 'number') updateData.fakeHelpful = Math.max(0, fakeHelpful);
  if (typeof fakeNotHelpful === 'number') updateData.fakeNotHelpful = Math.max(0, fakeNotHelpful);

  const review = await Review.findByIdAndUpdate(
    reviewId,
    updateData,
    { new: true }
  ).populate('product', 'name');

  if (!review) {
    return res.status(404).json({ error: 'Review not found' });
  }

  // Save to trigger pre-save middleware that calculates totals
  await review.save();

  res.json({
    success: true,
    message: 'Review fake helpful counts updated successfully',
    review: {
      _id: review._id,
      helpful: review.helpful,
      notHelpful: review.notHelpful,
      fakeHelpful: review.fakeHelpful,
      fakeNotHelpful: review.fakeNotHelpful,
      realHelpful: review.realHelpful,
      realNotHelpful: review.realNotHelpful
    }
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
    return res.status(400).json({ 
      error: 'Missing required fields: product, fakeCustomerName' 
    });
  }

  // Check if product exists
  const productExists = await Product.findById(product);
  if (!productExists) {
    return res.status(404).json({ error: 'Product not found' });
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
router.get('/products/metrics', asyncHandler(async (req, res) => {
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
router.get('/demos', asyncHandler(async (req, res) => {
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
router.post('/demos', asyncHandler(async (req, res) => {
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
    return res.status(400).json({
      error: 'Missing required fields: title, description, product, beforeImage, afterImages (array with at least one image and prompt info)'
    });
  }

  // Validate each after image has required prompt info
  for (let i = 0; i < afterImages.length; i++) {
    const afterImage = afterImages[i];
    if (!afterImage.image || !afterImage.promptName || !afterImage.promptDescription) {
      return res.status(400).json({
        error: `After image ${i + 1} is missing required fields: image, promptName, or promptDescription`
      });
    }
  }

  // Check if product exists
  const productExists = await Product.findById(product);
  if (!productExists) {
    return res.status(404).json({ error: 'Product not found' });
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
router.put('/demos/:demoId', asyncHandler(async (req, res) => {
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
    return res.status(404).json({ error: 'Demo not found' });
  }

  // If product is being changed, validate it exists
  if (product && product !== demo.product.toString()) {
    const productExists = await Product.findById(product);
    if (!productExists) {
      return res.status(404).json({ error: 'Product not found' });
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
router.delete('/demos/:demoId', asyncHandler(async (req, res) => {
  const { demoId } = req.params;

  const demo = await Demo.findById(demoId);
  if (!demo) {
    return res.status(404).json({ error: 'Demo not found' });
  }

  await Demo.findByIdAndDelete(demoId);

  res.json({
    success: true,
    message: 'Demo deleted successfully'
  });
}));

// Toggle demo status
router.patch('/demos/:demoId/toggle', asyncHandler(async (req, res) => {
  const demo = await Demo.findById(req.params.demoId);
  if (!demo) {
    return res.status(404).json({ error: 'Demo not found' });
  }

  demo.isActive = !demo.isActive;
  await demo.save();

  res.json({
    success: true,
    demo
  });
}));

// Get customer analytics
router.get('/customers/analytics', asyncHandler(async (req: Request, res: Response) => {
  try {
    // Get all customers with their orders and reviews
    const customers = await User.aggregate([
      {
        $match: { role: 'customer' }
      },
      {
        $lookup: {
          from: 'orders',
          let: { userId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$user', '$$userId'] },
                paymentStatus: 'completed',
                isFakeOrder: { $ne: true }
              }
            },
            {
              $lookup: {
                from: 'products',
                localField: 'items.product',
                foreignField: '_id',
                as: 'productDetails'
              }
            },
            {
              $sort: { createdAt: -1 }
            }
          ],
          as: 'orders'
        }
      },
      {
        $lookup: {
          from: 'reviews',
          let: { userId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$user', '$$userId'] },
                isActive: true,
                isFakeReview: { $ne: true }
              }
            },
            {
              $lookup: {
                from: 'products',
                localField: 'product',
                foreignField: '_id',
                as: 'product'
              }
            },
            {
              $unwind: '$product'
            },
            {
              $sort: { createdAt: -1 }
            }
          ],
          as: 'reviews'
        }
      },
      {
        $addFields: {
          totalOrders: { $size: '$orders' },
          totalSpent: {
            $sum: {
              $map: {
                input: '$orders',
                as: 'order',
                in: '$$order.totalAmount'
              }
            }
          },
          averageOrderValue: {
            $cond: {
              if: { $gt: [{ $size: '$orders' }, 0] },
              then: {
                $divide: [
                  {
                    $sum: {
                      $map: {
                        input: '$orders',
                        as: 'order',
                        in: '$$order.totalAmount'
                      }
                    }
                  },
                  { $size: '$orders' }
                ]
              },
              else: 0
            }
          },
          firstPurchaseDate: {
            $min: {
              $map: {
                input: '$orders',
                as: 'order',
                in: '$$order.createdAt'
              }
            }
          },
          lastPurchaseDate: {
            $max: {
              $map: {
                input: '$orders',
                as: 'order',
                in: '$$order.createdAt'
              }
            }
          }
        }
      },
      {
        $sort: { totalSpent: -1 }
      }
    ]);

    // Calculate overall stats
    const totalCustomers = customers.length;
    const activeCustomers = customers.filter(c => c.totalOrders > 0).length;
    const repeatCustomers = customers.filter(c => c.totalOrders > 1).length;
    const totalRevenue = customers.reduce((sum, c) => sum + c.totalSpent, 0);
    const averageOrderValue = activeCustomers > 0 ? totalRevenue / customers.reduce((sum, c) => sum + c.totalOrders, 0) : 0;

    const stats = {
      totalCustomers,
      activeCustomers,
      repeatCustomers,
      totalRevenue: Math.round(totalRevenue),
      averageOrderValue: Math.round(averageOrderValue)
    };

    res.json({
      success: true,
      customers,
      stats
    });
  } catch (error) {
    console.error('Error fetching customer analytics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch customer analytics'
    });
  }
}));

export default router;
