import mongoose from 'mongoose';
import { Demo } from '../models/Demo.model';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function checkDemoOrders() {
  try {
    // Connect to MongoDB
    const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/indian-promptpack-store';
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    // Get all demos and their order values
    const demos = await Demo.find({ isActive: true })
      .sort({ order: 1, createdAt: -1 })
      .lean(); // Use lean() to get plain objects

    console.log('\n=== Demo Orders ===');
    console.log(`Total active demos: ${demos.length}`);
    
    if (demos.length === 0) {
      console.log('No active demos found');
    } else {
      demos.forEach((demo: any, index: number) => {
        console.log(`${index + 1}. Title: "${demo.title}"`);
        console.log(`   Order: ${demo.order}`);
        console.log(`   Product ID: ${demo.product}`);
        console.log(`   Before Image: ${demo.beforeImage ? 'Yes' : 'No'}`);
        console.log(`   After Images: ${demo.afterImages?.length || 0}`);
        console.log('');
      });

      // Check if there's a demo with order 0
      const orderZeroDemo = demos.find((demo: any) => demo.order === 0);
      if (orderZeroDemo) {
        console.log('✅ Demo with order 0 found:', orderZeroDemo.title);
      } else {
        console.log('❌ No demo with order 0 found');
        console.log('Available orders:', demos.map((d: any) => d.order).join(', '));
      }
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
  checkDemoOrders();
}

export { checkDemoOrders };