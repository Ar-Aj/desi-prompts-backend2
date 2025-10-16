import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { User } from '../models/User.model';
import { env } from '../config/environment.config';

// Load environment variables
dotenv.config();

const seedAdmin = async () => {
  try {
    // Connect to MongoDB using the environment configuration
    await mongoose.connect(env.mongoUri);
    console.log('✅ Connected to MongoDB');
    console.log(`🔗 Connection URL: ${env.mongoUri}`);

    // Check if admin already exists
    const existingAdmin = await User.findOne({ email: 'admin@indianpromptpack.com' });
    
    if (existingAdmin) {
      console.log('❌ Admin user already exists!');
      console.log('📧 Email: admin@indianpromptpack.com');
      console.log('🔑 Password: admin123');
      process.exit(0);
    }

    // Create default admin user
    const adminUser = new User({
      customerId: 'ADMIN_SYSTEM_USER', // Special admin customer ID
      name: 'Admin User',
      email: 'admin@indianpromptpack.com',
      password: 'admin123', // This will be hashed automatically
      role: 'admin',
      isVerified: true,
      totalOrders: 0,
      totalSpent: 0,
      averageOrderValue: 0,
      hasUsedFirstTimeDiscount: false
    });

    await adminUser.save();
    
    console.log('🎉 Default admin user created successfully!');
    console.log('📧 Email: admin@indianpromptpack.com');
    console.log('🔑 Password: admin123');
    console.log('');
    console.log('⚠️  IMPORTANT: Change this password after first login if possible!');
    
  } catch (error) {
    console.error('❌ Error creating admin user:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
};

seedAdmin();