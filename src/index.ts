import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import mongoose from 'mongoose';
import path from 'path';
import passport from './config/passport.config';
import { env } from './config/environment.config';

// Import routes
import authRoutes from './routes/auth.routes';
import productRoutes from './routes/product.routes';
import orderRoutes from './routes/order.routes';
import reviewRoutes from './routes/review.routes';
import supportRoutes from './routes/support.routes';
import adminRoutes from './routes/admin.routes';
import webhookRoutes from './routes/webhook.routes';

// Import middleware
import { errorHandler } from './middleware/error.middleware';

const app: express.Application = express();
const PORT = env.port || 5000;

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://checkout.razorpay.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https://desiprompts.in", "https://*.s3.*.amazonaws.com"],
      connectSrc: ["'self'", "https://lumberjack.razorpay.com"],
      frameSrc: ["'self'", "https://api.razorpay.com", "https://checkout.razorpay.com"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  }
}));

// Enforce HTTPS in production
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      res.redirect(`https://${req.header('host')}${req.url}`);
    } else {
      next();
    }
  });
}

// CORS configuration
const corsOptions = {
  origin: [
    'http://localhost:5173', // Customer frontend
    'http://localhost:5174', // Admin frontend
    'https://desiprompts.in', // Production customer frontend
    'https://desiprompts.in/admin', // Production admin frontend
    'https://www.desiprompts.in', // WWW version
    ...(process.env.CORS_ORIGINS || '').split(',').filter(Boolean)
  ],
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// No rate limiting - for better user experience and workflow

// Webhook routes (before body parser for raw body)
app.use('/api/webhooks', webhookRoutes);

// Body parser middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize passport
app.use(passport.initialize());

// Serve uploaded images
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/admin', adminRoutes);

// Health check endpoint
app.get('/health', (_req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    version: process.env.npm_package_version || '1.0.0',
    uptime: process.uptime()
  });
});

// Error handling middleware
app.use(errorHandler);

// Connect to MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(env.mongoUri);
    console.log('✅ MongoDB connected successfully');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    console.warn('⚠️  Server will continue without database. Some features may not work.');
  }
};

// Start server
const startServer = async () => {
  // Try to connect to MongoDB but don't fail if it's not available
  await connectDB();
  
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📝 Environment: ${process.env.NODE_ENV}`);
    console.log(`🌐 Frontend URLs:`);
    console.log(`   Customer: http://localhost:5173`);
    console.log(`   Admin: http://localhost:5174`);
  });
};

startServer().catch(console.error);

export default app;