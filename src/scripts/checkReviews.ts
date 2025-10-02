import mongoose from 'mongoose';
import { Review } from '../models/Review.model';
import { Product } from '../models/Product.model';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function checkReviews() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/indian-promptpack');
    console.log('✅ Connected to MongoDB');

    // Get all reviews
    const reviews = await Review.find().populate('product', 'name slug');
    console.log(`📝 Total reviews in database: ${reviews.length}`);

    if (reviews.length > 0) {
      console.log('\n📋 Reviews found:');
      reviews.forEach((review, index) => {
        console.log(`${index + 1}. Product: ${review.product?.name || 'Unknown'}`);
        console.log(`   Title: ${review.title}`);
        console.log(`   Rating: ${review.rating}/5`);
        console.log(`   Fake: ${review.isFakeReview}`);
        console.log(`   Active: ${review.isActive}`);
        console.log(`   Product ID: ${review.product?._id}`);
        console.log('');
      });
    }

    // Get all products
    const products = await Product.find().select('name slug _id');
    console.log(`🛍️ Total products: ${products.length}`);
    
    if (products.length > 0) {
      console.log('\n🛍️ Products found:');
      products.forEach((product, index) => {
        console.log(`${index + 1}. ${product.name} (${product.slug}) - ID: ${product._id}`);
      });
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('👋 Disconnected from MongoDB');
    process.exit(0);
  }
}

checkReviews();
