import mongoose from 'mongoose';
import { Review } from '../models/Review.model';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function migrateReviewsSchema() {
  try {
    // Connect to MongoDB
    const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/indian-promptpack-store';
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    // Get all reviews that need migration
    const reviews = await Review.find({
      $or: [
        { helpful: { $exists: false } },
        { notHelpful: { $exists: false } },
        { realHelpful: { $exists: false } },
        { realNotHelpful: { $exists: false } }
      ]
    });

    console.log(`Found ${reviews.length} reviews that need migration`);

    let migratedCount = 0;
    for (const review of reviews) {
      // Set default values for missing fields
      if (review.helpful === undefined) review.helpful = 0;
      if (review.notHelpful === undefined) review.notHelpful = 0;
      if (review.realHelpful === undefined) review.realHelpful = 0;
      if (review.realNotHelpful === undefined) review.realNotHelpful = 0;
      
      // Save the updated review
      await review.save();
      migratedCount++;
      
      if (migratedCount % 10 === 0) {
        console.log(`Migrated ${migratedCount}/${reviews.length} reviews...`);
      }
    }

    console.log(`Successfully migrated ${migratedCount} reviews`);

    // Verify migration
    const totalReviews = await Review.countDocuments();
    const migratedReviews = await Review.countDocuments({
      helpful: { $exists: true },
      notHelpful: { $exists: true },
      realHelpful: { $exists: true },
      realNotHelpful: { $exists: true }
    });

    console.log(`\n=== Migration Verification ===`);
    console.log(`Total reviews: ${totalReviews}`);
    console.log(`Fully migrated reviews: ${migratedReviews}`);
    console.log(`Migration status: ${migratedReviews === totalReviews ? '✅ COMPLETE' : '❌ INCOMPLETE'}`);

  } catch (error) {
    console.error('Migration error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('Database connection closed');
  }
}

// Only run if this file is executed directly
if (require.main === module) {
  migrateReviewsSchema();
}

export { migrateReviewsSchema };