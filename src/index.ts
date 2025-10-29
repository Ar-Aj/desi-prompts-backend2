import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { errorHandler } from './middleware/error.middleware';
import { env } from './config/environment.config';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Add a test route BEFORE all other middleware
app.post('/test-pdf-endpoint', (_req, res) => {
  console.log('Super simple PDF test endpoint hit');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.status(200).json({ 
    success: true, 
    message: 'Super simple PDF test',
    pdfUrl: 'https://example.com/test.pdf',
    pdfPassword: 'TEST1234'
  });
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Connect to MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(env.mongoUri);
    console.log('✅ MongoDB connected successfully');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    console.log('⚠️  Server will continue without database. Some features may not work.');
  }
};

connectDB();

// Routes
import authRoutes from './routes/auth.routes';
import productRoutes from './routes/product.routes';
import orderRoutes from './routes/order.routes';
import adminRoutes from './routes/admin.routes';
import webhookRoutes from './routes/webhook.routes';
import supportRoutes from './routes/support.routes';
import reviewRoutes from './routes/review.routes';
import subscriberRoutes from './routes/subscriber.routes';

app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/subscribers', subscriberRoutes);

// Error handling middleware
app.use(errorHandler);

// Add a simple test route AFTER all middleware
app.get('/test', (_req, res) => {
  res.json({ message: 'Server is running!' });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV}`);
  console.log(`🌐 Frontend URLs:`);
  console.log(`   Customer: ${process.env.FRONTEND_URL}`);
  console.log(`   Admin: ${process.env.ADMIN_URL}`);
});