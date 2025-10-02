import mongoose from 'mongoose';
import { Review } from '../models/Review.model';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function checkReviews() {
  try {
    // Connect to MongoDB
    const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/indian-promptpack-store';
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    // Get all reviews
    const reviews = await Review.find({})
      .populate('product')
      .populate('user')
      .populate('order')
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    console.log('\n=== Recent Reviews ===');
    console.log(`Total reviews: ${await Review.countDocuments()}`);
    
    if (reviews.length === 0) {
      console.log('No reviews found');
    } else {
      reviews.forEach((review: any, index: number) => {
        console.log(`${index + 1}. Product: ${review.product?.name || 'Unknown'}`);
        console.log(`   Rating: ${review.rating}/5`);
        console.log(`   Title: ${review.title}`);
        console.log(`   Comment: ${review.comment?.substring(0, 50)}${review.comment && review.comment.length > 50 ? '...' : ''}`);
        console.log(`   Verified Purchase: ${review.isVerifiedPurchase ? 'Yes' : 'No'}`);
        console.log(`   Fake Review: ${review.isFakeReview ? 'Yes' : 'No'}`);
        console.log(`   Active: ${review.isActive ? 'Yes' : 'No'}`);
        console.log(`   Helpful: ${review.helpful} | Not Helpful: ${review.notHelpful}`);
        console.log(`   Created: ${review.createdAt?.toLocaleString()}`);
        console.log('');
      });
    }

    // Get review statistics
    const stats = await Review.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          averageRating: { $avg: '$rating' },
          verifiedPurchases: {
            $sum: { $cond: [{ $eq: ['$isVerifiedPurchase', true] }, 1, 0] }
          },
          fakeReviews: {
            $sum: { $cond: [{ $eq: ['$isFakeReview', true] }, 1, 0] }
          },
          activeReviews: {
            $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] }
          }
        }
      }
    ]);

    if (stats.length > 0) {
      const stat = stats[0];
      console.log('\n=== Review Statistics ===');
      console.log(`Total Reviews: ${stat.total}`);
      console.log(`Average Rating: ${stat.averageRating?.toFixed(2)}/5`);
      console.log(`Verified Purchases: ${stat.verifiedPurchases}`);
      console.log(`Fake Reviews: ${stat.fakeReviews}`);
      console.log(`Active Reviews: ${stat.activeReviews}`);
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('Database connection closed');
  }
}

// Only run if this file is executed directly
if (require.main === module) {
  checkReviews();
}

export { checkReviews };