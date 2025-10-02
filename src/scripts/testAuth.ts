import mongoose from 'mongoose';
import { User } from '../models/User.model';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function testAuth() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/indian-promptpack');
    console.log('✅ Connected to MongoDB');

    // Check if JWT_SECRET exists
    console.log('🔑 JWT_SECRET exists:', !!process.env.JWT_SECRET);
    console.log('🔑 JWT_SECRET length:', process.env.JWT_SECRET?.length || 0);

    // Try to find admin user
    const adminUser = await User.findOne({ email: 'admin@indianpromptpack.com' });
    console.log('👤 Admin user exists:', !!adminUser);
    
    if (adminUser) {
      console.log('👤 Admin user details:');
      console.log('   - Name:', adminUser.name);
      console.log('   - Email:', adminUser.email);
      console.log('   - Role:', adminUser.role);
      console.log('   - Verified:', adminUser.isVerified);
      console.log('   - Has password:', !!adminUser.password);

      // Test password comparison
      const isValidPassword = await adminUser.comparePassword('admin123');
      console.log('🔐 Password test (admin123):', isValidPassword);

      // Test JWT generation
      if (process.env.JWT_SECRET) {
        const token = jwt.sign(
          { userId: adminUser._id },
          process.env.JWT_SECRET,
          { expiresIn: '7d' }
        );
        console.log('🎫 JWT token generated:', !!token);
        console.log('🎫 Token length:', token.length);
      }
    }

    // Test creating a new user
    console.log('\n🧪 Testing user creation...');
    const testUser = new User({
      name: 'Test User',
      email: 'test@example.com',
      password: 'testpass123',
      role: 'customer',
      isVerified: true
    });

    // Don't save, just validate
    const validationError = testUser.validateSync();
    console.log('✅ User validation:', validationError ? 'FAILED' : 'PASSED');
    if (validationError) {
      console.log('❌ Validation errors:', validationError.message);
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('👋 Disconnected from MongoDB');
    process.exit(0);
  }
}

testAuth();
