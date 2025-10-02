import mongoose from 'mongoose';
import { Review } from '../models/Review.model';
import { Product } from '../models/Product.model'; // Import to register schema
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function migrateReviewsSchema() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/indian-promptpack');
    console.log('✅ Connected to MongoDB');

    // Get all reviews
    const reviews = await Review.find();
    console.log(`📝 Found ${reviews.length} reviews to migrate`);

    // Update each review with new schema
    for (const review of reviews) {
      // Move existing helpful counts to fakeHelpful
      const fakeHelpful = review.helpful || 0;
      const fakeNotHelpful = review.notHelpful || 0;

      await Review.findByIdAndUpdate(review._id, {
        fakeHelpful: fakeHelpful,
        fakeNotHelpful: fakeNotHelpful,
        realHelpful: 0, // Start with 0 real votes
        realNotHelpful: 0,
        helpfulVotes: [], // Empty array for vote tracking
        notHelpfulVotes: [],
        // Keep existing helpful/notHelpful for now (will be recalculated by pre-save)
      });

      console.log(`✅ Migrated review "${review.title}" - Fake: ${fakeHelpful} helpful, ${fakeNotHelpful} not helpful`);
    }

    // Manually recalculate total helpful counts (fake + real)
    console.log('🔄 Recalculating total helpful counts...');
    await Review.updateMany({}, [
      {
        $set: {
          helpful: { $add: ['$fakeHelpful', '$realHelpful'] },
          notHelpful: { $add: ['$fakeNotHelpful', '$realNotHelpful'] }
        }
      }
    ]);

    console.log('🎉 All reviews migrated successfully!');
    console.log('📊 Schema changes:');
    console.log('   - helpful/notHelpful = total counts (fake + real)');
    console.log('   - fakeHelpful/fakeNotHelpful = admin-controlled counts');
    console.log('   - realHelpful/realNotHelpful = user vote counts');
    console.log('   - helpfulVotes/notHelpfulVotes = user ID tracking');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('👋 Disconnected from MongoDB');
    process.exit(0);
  }
}

migrateReviewsSchema();
