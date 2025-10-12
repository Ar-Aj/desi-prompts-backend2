import mongoose from 'mongoose';
import { Product } from '../models/Product.model';
import { env } from '../config/environment.config';

// Connect to MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(env.mongoUri);
    console.log('✅ MongoDB connected successfully');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

// Fix image URLs for all products
const fixImageUrls = async () => {
  try {
    // Get all products
    const products = await Product.find({});
    console.log(`Found ${products.length} products to process`);
    
    let updatedCount = 0;
    
    for (const product of products) {
      let updated = false;
      const newImages = [...product.images];
      
      // Check each image URL
      for (let i = 0; i < newImages.length; i++) {
        const imageUrl = newImages[i];
        
        // Check if the image URL starts with localhost
        if (imageUrl.startsWith('http://localhost:5000')) {
          // Replace with relative URL
          const newImageUrl = imageUrl.replace('http://localhost:5000', '');
          newImages[i] = newImageUrl;
          updated = true;
          console.log(`Updated image URL for product ${product.name}: ${imageUrl} -> ${newImageUrl}`);
        }
      }
      
      // If any image URLs were updated, save the product
      if (updated) {
        product.images = newImages;
        await product.save();
        updatedCount++;
      }
    }
    
    console.log(`✅ Updated image URLs for ${updatedCount} products`);
  } catch (error) {
    console.error('❌ Error fixing image URLs:', error);
  }
};

// Run the script
const run = async () => {
  await connectDB();
  await fixImageUrls();
  await mongoose.connection.close();
  console.log('✅ Script completed');
};

run().catch(console.error);