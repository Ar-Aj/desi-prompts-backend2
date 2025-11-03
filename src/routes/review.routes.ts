import { Router, Request, Response } from 'express';
import { Review } from '../models/Review.model';
import { Order } from '../models/Order.model';
import { validate } from '../middleware/validation.middleware';
import { optionalAuth, authenticate } from '../middleware/auth.middleware';
import { asyncHandler } from '../middleware/error.middleware';
import { createReviewSchema } from '../validators/review.validators';

const router: Router = Router();

// Check if user has purchased a product (for review eligibility)
router.get('/purchase-verification/:productId', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const { productId } = req.params;
  const userId = (req as any).user._id;

  // Find completed orders for this user that contain the product
  const orders = await Order.find({
    user: userId,
    paymentStatus: 'completed',
    'items.product': productId
  }).select('_id orderNumber createdAt items');

  console.log('Purchase verification request:', { productId, userId, ordersCount: orders.length });

  // Check if user has already reviewed this product
  const existingReview = await Review.findOne({
    product: productId,
    user: userId
  });

  const hasPurchased = orders.length > 0;
  const hasReviewed = !!existingReview;

  res.json({
    success: true,
    hasPurchased,
    hasReviewed,
    canReview: hasPurchased && !hasReviewed,
    orders: orders.map(order => ({
      _id: order._id,
      orderNumber: order.orderNumber,
      createdAt: order.createdAt
    }))
  });
}));

// Get reviews for a product
router.get('/product/:productId', asyncHandler(async (req: Request, res: Response) => {
  const { productId } = req.params;
  const { page = 1, limit = 10, sortBy = 'createdAt' } = req.query;
  
  const skip = (Number(page) - 1) * Number(limit);
  
  const [reviews, total] = await Promise.all([
    Review.find({ product: productId, isActive: true })
      .populate('user', 'name')
      .sort({ [sortBy as string]: -1 })
      .skip(skip)
      .limit(Number(limit)),
    Review.countDocuments({ product: productId, isActive: true })
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

// Get a specific review by ID
router.get('/:reviewId', asyncHandler(async (req: Request, res: Response) => {
  const { reviewId } = req.params;

  const review = await Review.findById(reviewId)
    .populate('user', 'name')
    .populate('product', 'name slug images');

  if (!review || !review.isActive) {
    res.status(404).json({ error: 'Review not found' });
    return;
  }

  res.json({
    success: true,
    review
  });
}));

// Create review (verified purchase only)
router.post('/', optionalAuth, validate(createReviewSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const { productId, orderId, rating, title, comment } = req.body;
    const userId = (req as any).user?._id;
    
    console.log('=== REVIEW SUBMISSION DEBUG INFO ===');
    console.log('Request body:', req.body);
    console.log('User ID from token:', userId);
    console.log('Product ID:', productId);
    console.log('Order ID:', orderId);
    console.log('Rating:', rating);
    console.log('Title:', title);
    console.log('Comment length:', comment?.length);

    // Verify order exists and is completed
    console.log('Looking up order...');
    const order = await Order.findById(orderId);
    console.log('Order lookup result:', { 
      orderId, 
      orderExists: !!order, 
      orderPaymentStatus: order?.paymentStatus,
      orderUserId: order?.user?.toString(),
      orderGuestEmail: order?.guestEmail
    });
    
    if (!order) {
      console.log('ERROR: Order not found');
      res.status(400).json({ error: 'Order not found' });
      return;
    }
    
    if (order.paymentStatus !== 'completed') {
      console.log('ERROR: Order not completed, status:', order.paymentStatus);
      res.status(400).json({ error: `Order not completed. Current status: ${order.paymentStatus}` });
      return;
    }

    // Verify product is in order
    console.log('Checking if product is in order items...');
    console.log('Order items:', order.items);
    const orderItem = order.items.find(item => {
      const itemProductId = item.product.toString();
      const isMatch = itemProductId === productId;
      console.log(`Comparing item product ID ${itemProductId} with request product ID ${productId}: ${isMatch}`);
      return isMatch;
    });
    
    if (!orderItem) {
      console.log('ERROR: Product not found in order');
      res.status(400).json({ error: 'Product not found in your order' });
      return;
    }

    // Verify user/guest owns the order
    console.log('Verifying order ownership...');
    console.log('Order user ID:', order.user?.toString());
    console.log('Request user ID:', userId);
    console.log('Order guest email:', order.guestEmail);
    console.log('Request guest email:', req.body.guestEmail);
    
    const isOwner = 
      (userId && order.user && order.user.toString() === userId.toString()) ||
      (!userId && order.guestEmail && order.guestEmail === req.body.guestEmail);
    
    console.log('Ownership verification result:', isOwner);
    
    if (!isOwner) {
      console.log('ERROR: User does not own order');
      res.status(403).json({ error: 'You can only review products from your own orders' });
      return;
    }

    // Check if review already exists for this order and product
    console.log('Checking for existing review...');
    const existingReview = await Review.findOne({
      product: productId,
      order: orderId
    });
    console.log('Existing review check result:', { 
      productId, 
      orderId, 
      existingReviewExists: !!existingReview,
      existingReviewId: existingReview?._id
    });
    
    if (existingReview) {
      console.log('ERROR: Review already exists for this order');
      res.status(400).json({ error: 'You have already reviewed this product with this order' });
      return;
    }

    // Create review
    console.log('Creating new review...');
    const review = new Review({
      product: productId,
      user: userId,
      order: orderId,
      guestName: !userId ? order.guestName : undefined,
      guestEmail: !userId ? order.guestEmail : undefined,
      rating,
      title,
      comment,
      isVerifiedPurchase: true
    });

    await review.save();
    
    console.log('Review created successfully:', review._id);

    res.status(201).json({
      success: true,
      review
    });
  } catch (error) {
    console.error('FATAL ERROR creating review:', error);
    res.status(500).json({ error: 'Internal server error occurred while creating review' });
  }
}));

// Create review (verified purchase only) - BULLETPROOF VERSION
router.post('/bulletproof', optionalAuth, asyncHandler(async (req: Request, res: Response) => {
  try {
    console.log('=== BULLETPROOF REVIEW SUBMISSION ===');
    console.log('Full request body:', req.body);
    console.log('Headers:', req.headers);
    console.log('User from token:', (req as any).user);
    
    const { productId, orderId, rating, title, comment } = req.body;
    
    // Basic validation
    if (!productId || !orderId || !rating || !title || !comment) {
      console.log('Missing required fields');
      return res.status(400).json({ 
        error: 'Missing required fields', 
        required: ['productId', 'orderId', 'rating', 'title', 'comment'],
        provided: { productId, orderId, rating, title: !!title, comment: !!comment }
      });
    }
    
    // Type validation
    if (typeof rating !== 'number' || rating < 1 || rating > 5) {
      console.log('Invalid rating');
      return res.status(400).json({ error: 'Rating must be a number between 1 and 5' });
    }
    
    if (typeof title !== 'string' || title.length < 3 || title.length > 100) {
      console.log('Invalid title');
      return res.status(400).json({ error: 'Title must be between 3 and 100 characters' });
    }
    
    if (typeof comment !== 'string' || comment.length < 10 || comment.length > 1000) {
      console.log('Invalid comment');
      return res.status(400).json({ error: 'Comment must be between 10 and 1000 characters' });
    }
    
    const userId = (req as any).user?._id;
    console.log('Processing review for user:', userId);
    
    // Verify order exists and is completed
    console.log('Looking up order:', orderId);
    const order = await Order.findById(orderId);
    if (!order) {
      console.log('Order not found');
      return res.status(400).json({ error: 'Order not found' });
    }
    
    if (order.paymentStatus !== 'completed') {
      console.log('Order not completed:', order.paymentStatus);
      return res.status(400).json({ error: `Order not completed. Status: ${order.paymentStatus}` });
    }
    
    // Verify product is in order
    console.log('Order items:', order.items);
    const orderItem = order.items.find(item => 
      item.product.toString() === productId
    );
    
    if (!orderItem) {
      console.log('Product not in order');
      return res.status(400).json({ error: 'Product not found in order' });
    }
    
    // Verify ownership
    const isOwner = 
      (userId && order.user && order.user.toString() === userId.toString()) ||
      (!userId && order.guestEmail && order.guestEmail === req.body.guestEmail);
    
    if (!isOwner) {
      console.log('Not owner of order');
      return res.status(403).json({ error: 'Not authorized to review this order' });
    }
    
    // Check for duplicate review
    const existingReview = await Review.findOne({
      product: productId,
      order: orderId
    });
    
    if (existingReview) {
      console.log('Review already exists');
      return res.status(400).json({ error: 'Review already exists for this order' });
    }
    
    // Create review
    console.log('Creating review...');
    const review = new Review({
      product: productId,
      user: userId || undefined,
      order: orderId,
      guestName: !userId ? order.guestName : undefined,
      guestEmail: !userId ? order.guestEmail : undefined,
      rating,
      title,
      comment,
      isVerifiedPurchase: true
    });
    
    const savedReview = await review.save();
    console.log('Review created successfully:', savedReview._id);
    
    res.status(201).json({
      success: true,
      review: savedReview
    });
  } catch (error) {
    console.error('FATAL ERROR:', error);
    res.status(500).json({ error: 'Internal server error', details: (error as Error).message });
  }
}));

// Mark review as helpful (requires authentication)
router.post('/:reviewId/helpful', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const { reviewId } = req.params;
  const { helpful } = req.body;
  const userId = (req as any).user._id;

  const review = await Review.findById(reviewId);
  if (!review) {
    res.status(404).json({ error: 'Review not found' });
    return;
  }

  // Check if user already voted
  const hasVotedHelpful = review.helpfulVotes.includes(userId);
  const hasVotedNotHelpful = review.notHelpfulVotes.includes(userId);

  if (hasVotedHelpful || hasVotedNotHelpful) {
    res.status(400).json({ 
      error: 'You have already voted on this review',
      message: 'Each user can only vote once per review'
    });
    return;
  }

  // Add vote and update counts
  if (helpful) {
    review.helpfulVotes.push(userId);
    review.realHelpful += 1;
  } else {
    review.notHelpfulVotes.push(userId);
    review.realNotHelpful += 1;
  }

  await review.save(); // This will trigger pre-save middleware to update totals

  res.json({
    success: true,
    message: helpful ? 'Marked as helpful' : 'Marked as not helpful',
    review: {
      _id: review._id,
      helpful: review.helpful,
      notHelpful: review.notHelpful,
      realHelpful: review.realHelpful,
      realNotHelpful: review.realNotHelpful
    }
  });
}));

// Get review statistics for a product
router.get('/product/:productId/stats', asyncHandler(async (req: Request, res: Response) => {
  const { productId } = req.params;

  const stats = await Review.aggregate([
    { $match: { product: productId, isActive: true } },
    {
      $group: {
        _id: null,
        totalReviews: { $sum: 1 },
        averageRating: { $avg: '$rating' },
        ratingDistribution: {
          $push: '$rating'
        }
      }
    },
    {
      $project: {
        totalReviews: 1,
        averageRating: { $round: ['$averageRating', 1] },
        ratingDistribution: {
          5: {
            $size: {
              $filter: {
                input: '$ratingDistribution',
                cond: { $eq: ['$$this', 5] }
              }
            }
          },
          4: {
            $size: {
              $filter: {
                input: '$ratingDistribution',
                cond: { $eq: ['$$this', 4] }
              }
            }
          },
          3: {
            $size: {
              $filter: {
                input: '$ratingDistribution',
                cond: { $eq: ['$$this', 3] }
              }
            }
          },
          2: {
            $size: {
              $filter: {
                input: '$ratingDistribution',
                cond: { $eq: ['$$this', 2] }
              }
            }
          },
          1: {
            $size: {
              $filter: {
                input: '$ratingDistribution',
                cond: { $eq: ['$$this', 1] }
              }
            }
          }
        }
      }
    }
  ]);

  res.json({
    success: true,
    stats: stats[0] || {
      totalReviews: 0,
      averageRating: 0,
      ratingDistribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 }
    }
  });
}));

export default router;