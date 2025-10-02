import { Router, Request, Response } from 'express';
import { Review } from '../models/Review.model';
import { Order } from '../models/Order.model';
import { validate } from '../middleware/validation.middleware';
import { optionalAuth, authenticate } from '../middleware/auth.middleware';
import { asyncHandler } from '../middleware/error.middleware';
import { createReviewSchema } from '../validators/review.validators';

const router = Router();

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
router.get('/product/:productId', asyncHandler(async (req, res) => {
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

// Create review (verified purchase only)
router.post('/', optionalAuth, validate(createReviewSchema), asyncHandler(async (req: any, res) => {
  const { productId, orderId, rating, title, comment } = req.body;
  const userId = req.user?._id;

  // Verify order exists and is completed
  const order = await Order.findById(orderId);
  if (!order || order.paymentStatus !== 'completed') {
    return res.status(400).json({ error: 'Invalid order or payment not completed' });
  }

  // Verify product is in order
  const orderItem = order.items.find(item => 
    item.product.toString() === productId
  );
  if (!orderItem) {
    return res.status(400).json({ error: 'Product not found in order' });
  }

  // Verify user/guest owns the order
  const isOwner = 
    (userId && order.user?.toString() === userId.toString()) ||
    (!userId && order.guestEmail === req.body.guestEmail);
  
  if (!isOwner) {
    return res.status(403).json({ error: 'You can only review products you purchased' });
  }

  // Check if review already exists
  const existingReview = await Review.findOne({
    product: productId,
    order: orderId
  });
  if (existingReview) {
    return res.status(400).json({ error: 'You have already reviewed this product' });
  }

  // Create review
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

  res.status(201).json({
    success: true,
    review
  });
}));

// Mark review as helpful (requires authentication)
router.post('/:reviewId/helpful', authenticate, asyncHandler(async (req, res) => {
  const { reviewId } = req.params;
  const { helpful } = req.body;
  const userId = (req as any).user._id;

  const review = await Review.findById(reviewId);
  if (!review) {
    return res.status(404).json({ error: 'Review not found' });
  }

  // Check if user already voted
  const hasVotedHelpful = review.helpfulVotes.includes(userId);
  const hasVotedNotHelpful = review.notHelpfulVotes.includes(userId);

  if (hasVotedHelpful || hasVotedNotHelpful) {
    return res.status(400).json({ 
      error: 'You have already voted on this review',
      message: 'Each user can only vote once per review'
    });
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
router.get('/product/:productId/stats', asyncHandler(async (req, res) => {
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
