import mongoose from 'mongoose';
import { Review } from '../models/Review.model';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function updateReviewHelpful() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/indian-promptpack');
    console.log('✅ Connected to MongoDB');

    // Get all reviews
    const reviews = await Review.find();
    console.log(`📝 Found ${reviews.length} reviews`);

    // Update each review with random helpful counts
    for (const review of reviews) {
      const randomHelpful = Math.floor(Math.random() * 15) + 1; // 1-15 helpful
      const randomNotHelpful = Math.floor(Math.random() * 3); // 0-2 not helpful
      
      await Review.findByIdAndUpdate(review._id, {
        helpful: randomHelpful,
        notHelpful: randomNotHelpful
      });

      console.log(`✅ Updated review "${review.title}" - ${randomHelpful} helpful, ${randomNotHelpful} not helpful`);
    }

    console.log('🎉 All reviews updated with helpful counts!');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('👋 Disconnected from MongoDB');
    process.exit(0);
  }
}

updateReviewHelpful();
