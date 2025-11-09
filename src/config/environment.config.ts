import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

interface EnvironmentConfig {
  mode: 'development' | 'production';
  port: number;
  nodeEnv: string;
  mongoUri: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  frontendUrl: string;
  adminUrl: string;
  corsOrigins: string[];
  google: {
    clientId: string;
    clientSecret: string;
    callbackUrl: string;
  };
  razorpay?: {
    keyId: string;
    keySecret: string;
    webhookSecret: string;
  };
  email: {
    from: string;
    resendApiKey: string;
  };
  s3: {
    bucketName: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    endpoint: string;
  };
}

const getEnvironmentConfig = (): EnvironmentConfig => {
  // Check both MODE and NODE_ENV for production detection
  const mode = (process.env.MODE || process.env.NODE_ENV || 'development') as 'development' | 'production';
  const isProduction = mode === 'production';
  
  // Base configuration
  const config: EnvironmentConfig = {
    mode,
    port: parseInt(process.env.PORT || '5000'),
    nodeEnv: process.env.NODE_ENV || 'development',
    mongoUri: isProduction 
      ? process.env.MONGODB_URI_PROD || 'mongodb+srv://abbajumma50_db_user:W3jgc8tUBVb7sChF@cluster0.yu7ejsh.mongodb.net/desiprompts-prod?retryWrites=true&w=majority&appName=Cluster0'
      : process.env.MONGODB_URI_DEV || process.env.MONGODB_URI_PROD || 'mongodb+srv://abbajumma50_db_user:W3jgc8tUBVb7sChF@cluster0.yu7ejsh.mongodb.net/indian-promptpack?retryWrites=true&w=majority&appName=Cluster0',
    jwtSecret: isProduction
      ? process.env.JWT_SECRET_PROD || process.env.JWT_SECRET || 'fallback-production-secret'
      : process.env.JWT_SECRET_DEV || process.env.JWT_SECRET || 'fallback-development-secret',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
    frontendUrl: isProduction
      ? process.env.FRONTEND_URL_PROD || process.env.FRONTEND_URL || 'https://desiprompts.in'
      : process.env.FRONTEND_URL_DEV || process.env.FRONTEND_URL || 'http://localhost:5173',
    adminUrl: isProduction
      ? process.env.ADMIN_URL_PROD || 'https://desiprompts.in/admin'
      : process.env.ADMIN_URL_DEV || 'http://localhost:5174',
    corsOrigins: (isProduction
      ? process.env.CORS_ORIGINS_PROD || process.env.CORS_ORIGINS || 'https://desiprompts.in,https://www.desiprompts.in'
      : process.env.CORS_ORIGINS_DEV || process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:5174').split(','),
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      callbackUrl: process.env.GOOGLE_CALLBACK_URL || '/api/auth/google/callback',
    },
    email: {
      from: isProduction
        ? process.env.EMAIL_FROM_PROD || process.env.EMAIL_FROM || 'noreply@desiprompts.in'
        : process.env.EMAIL_FROM_DEV || process.env.EMAIL_FROM || 'noreply@localhost',
      resendApiKey: process.env.RESEND_API_KEY || '',
    },
    s3: {
      bucketName: process.env.S3_BUCKET_NAME || 'desiprompts-prod-files',
      region: process.env.S3_REGION || 'eu-north-1',
      accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
      endpoint: process.env.S3_ENDPOINT || 'https://s3.eu-north-1.amazonaws.com',
    }
  };

  // Add Razorpay config if available
  if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
    config.razorpay = {
      keyId: process.env.RAZORPAY_KEY_ID,
      keySecret: process.env.RAZORPAY_KEY_SECRET,
      webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || 'dcbd25aa93a65c25be360b7e9f118a1e', // Use your actual secret as fallback
    };
    
    // Log Razorpay configuration status
    console.log('💳 Razorpay Configuration Status:', {
      keyIdConfigured: !!process.env.RAZORPAY_KEY_ID,
      keySecretConfigured: !!process.env.RAZORPAY_KEY_SECRET,
      webhookSecretConfigured: !!process.env.RAZORPAY_WEBHOOK_SECRET,
      keyId: process.env.RAZORPAY_KEY_ID ? `${process.env.RAZORPAY_KEY_ID.substring(0, 5)}...` : 'MISSING',
      webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ? `${process.env.RAZORPAY_WEBHOOK_SECRET.substring(0, 5)}...` : 'USING DEFAULT'
    });
  } else {
    console.warn('⚠️  Razorpay credentials not configured. Payment processing will be disabled.');
  }

  // Validate required configurations
  if (!config.mongoUri) {
    console.warn('⚠️  MongoDB URI not configured');
  }

  if (!config.s3.accessKeyId || !config.s3.secretAccessKey) {
    console.warn('⚠️  S3 credentials not configured. File uploads will be disabled.');
  }

  // Validate required Google OAuth credentials
  if (!config.google.clientId || !config.google.clientSecret) {
    console.warn('⚠️  Google OAuth credentials not configured. Google authentication will be disabled.');
  }

  // Log important URLs
  console.log('🌐 Application URLs:', {
    frontend: config.frontendUrl,
    admin: config.adminUrl,
    corsOrigins: config.corsOrigins
  });

  return config;
};

export const env = getEnvironmentConfig();

// Helper to check if Google OAuth is configured
export const isGoogleOAuthEnabled = (): boolean => {
  return !!(env.google.clientId && env.google.clientSecret);
};

// Helper to get the correct callback URL based on environment
export const getGoogleCallbackUrl = (): string => {
  // For the callback URL, we need to use the backend URL, not the frontend URL
  // The callback URL is where Google redirects after authentication
  const backendUrl = process.env.BACKEND_URL || 
    (env.mode === 'production' 
      ? 'https://desi-prompts-backend2-3.onrender.com' 
      : 'http://localhost:5000');
  
  // Make sure the callback URL starts with /api if it doesn't already
  const callbackUrl = env.google.callbackUrl.startsWith('/api') 
    ? env.google.callbackUrl 
    : `/api${env.google.callbackUrl}`;
  
  return `${backendUrl}${callbackUrl}`;
};
