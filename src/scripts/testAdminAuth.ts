import mongoose from 'mongoose';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
dotenv.config();

import { User } from '../models/User.model';

const testAuth = async () => {
  await mongoose.connect(process.env.MONGODB_URI_PROD || process.env.MONGODB_URI_DEV);
  
  // Find admin user
  const admin = await User.findOne({ email: 'admin@indianpromptpack.com' });
  if (!admin) {
    console.log('Admin user not found');
    await mongoose.disconnect();
    return;
  }
  
  console.log('Admin user found:');
  console.log('Email:', admin.email);
  console.log('Role:', admin.role);
  console.log('Is verified:', admin.isVerified);
  
  // Generate token
  const secret = process.env.JWT_SECRET_PROD || process.env.JWT_SECRET || 'fallback-secret';
  const token = jwt.sign({ userId: admin._id.toString() }, secret, { expiresIn: '7d' });
  console.log('Generated token:', token);
  
  // Verify token
  try {
    const decoded = jwt.verify(token, secret);
    console.log('Decoded token:', decoded);
  } catch (error) {
    console.log('Token verification failed:', error);
  }
  
  await mongoose.disconnect();
};

testAuth().catch(console.error);