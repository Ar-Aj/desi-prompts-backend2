import mongoose from 'mongoose';
import { Product } from '../models/Product.model';
import { Order } from '../models/Order.model';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function initializeRealSalesCount() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/indian-promptpack');
    console.log('✅ Connected to MongoDB');

    // Get all products
    const products = await Product.find();
    console.log(`📦 Found ${products.length} products to update`);

    // Calculate real sales count for each product
    for (const product of products) {
      // Count real orders (not fake) for this product
      const realSalesData = await Order.aggregate([
        {
          $match: {
            paymentStatus: 'completed',
            isFakeOrder: { $ne: true }, // Exclude fake orders
            'items.product': product._id
          }
        },
        {
          $unwind: '$items'
        },
        {
          $match: {
            'items.product': product._id
          }
        },
        {
          $group: {
            _id: null,
            totalQuantity: { $sum: '$items.quantity' }
          }
        }
      ]);

      const realSalesCount = realSalesData.length > 0 ? realSalesData[0].totalQuantity : 0;

      // Update the product with real sales count
      await Product.findByIdAndUpdate(product._id, {
        realSalesCount: realSalesCount
      });

      console.log(`✅ Updated "${product.name}": Total sales: ${product.salesCount}, Real sales: ${realSalesCount}`);
    }

    console.log('🎉 All products updated with real sales counts!');
    console.log('📊 Dashboard will now show only real revenue from actual customers');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('👋 Disconnected from MongoDB');
    process.exit(0);
  }
}

initializeRealSalesCount();
