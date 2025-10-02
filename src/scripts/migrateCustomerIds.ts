import mongoose from 'mongoose';
import { User } from '../models/User.model';
import { Order } from '../models/Order.model';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function migrateCustomerIds() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/indian-promptpack');
    console.log('✅ Connected to MongoDB');

    // Get all users without customer IDs
    const users = await User.find({ 
      role: 'customer',
      $or: [
        { customerId: { $exists: false } },
        { customerId: null },
        { customerId: '' }
      ]
    });

    console.log(`📝 Found ${users.length} users to migrate`);

    // Update each user with customer analytics
    for (const user of users) {
      // Generate unique customer ID
      const timestamp = Date.now().toString(36);
      const randomStr = Math.random().toString(36).substring(2, 8);
      const customerId = `CUST_${timestamp}_${randomStr}`.toUpperCase();

      // Calculate user analytics from orders
      const orders = await Order.find({
        user: user._id,
        paymentStatus: 'completed',
        isFakeOrder: { $ne: true }
      }).sort({ createdAt: 1 });

      const totalOrders = orders.length;
      const totalSpent = orders.reduce((sum, order) => sum + order.totalAmount, 0);
      const averageOrderValue = totalOrders > 0 ? totalSpent / totalOrders : 0;
      const firstPurchaseDate = orders.length > 0 ? orders[0].createdAt : undefined;
      const lastPurchaseDate = orders.length > 0 ? orders[orders.length - 1].createdAt : undefined;

      // Update user with new fields
      await User.findByIdAndUpdate(user._id, {
        customerId,
        totalOrders,
        totalSpent: Math.round(totalSpent * 100) / 100,
        averageOrderValue: Math.round(averageOrderValue * 100) / 100,
        firstPurchaseDate,
        lastPurchaseDate
      });

      console.log(`✅ Updated ${user.name} (${user.email})`);
      console.log(`   Customer ID: ${customerId}`);
      console.log(`   Orders: ${totalOrders}, Spent: ₹${totalSpent.toFixed(2)}`);
    }

    console.log('🎉 All users migrated successfully!');
    console.log('📊 Customer analytics system is now ready!');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('👋 Disconnected from MongoDB');
    process.exit(0);
  }
}

migrateCustomerIds();
