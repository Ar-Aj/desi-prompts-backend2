import mongoose from 'mongoose';
import { Product } from '../models/Product.model';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function testProductOrder() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/indian-promptpack');
    console.log('Connected to database');

    // Check if products exist
    const products = await Product.find({}).sort({ order: 1, createdAt: -1 }).limit(5);
    console.log('Found products:', products.length);

    if (products.length > 0) {
      console.log('Product ordering test:');
      products.forEach((product, index) => {
        console.log(`${index + 1}. ${product.name} - Order: ${product.order || 0}`);
      });

      // Update a product's order to test
      if (products.length >= 2) {
        console.log('\nTesting order update...');
        await Product.findByIdAndUpdate(products[0]._id, { order: 10 });
        await Product.findByIdAndUpdate(products[1]._id, { order: 1 });
        
        const updatedProducts = await Product.find({}).sort({ order: 1, createdAt: -1 }).limit(5);
        console.log('After order update:');
        updatedProducts.forEach((product, index) => {
          console.log(`${index + 1}. ${product.name} - Order: ${product.order || 0}`);
        });
      }
    } else {
      console.log('No products found. Order functionality ready for when products are added.');
    }

    process.exit(0);
  } catch (error) {
    console.error('Test failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

testProductOrder();