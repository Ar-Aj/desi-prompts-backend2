interface EnvironmentConfig {
  port: number;
  nodeEnv: string;
  mongoUri: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  frontendUrl: string;
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
}

const getEnvironmentConfig = (): EnvironmentConfig => {
  const nodeEnv = process.env.NODE_ENV || 'development';
  
  // Base configuration
  const config: EnvironmentConfig = {
    port: parseInt(process.env.PORT || '5000'),
    nodeEnv,
    mongoUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/indian-promptpack',
    jwtSecret: process.env.JWT_SECRET || 'fallback-secret-change-in-production',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
    corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:5174').split(','),
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      callbackUrl: process.env.GOOGLE_CALLBACK_URL || '/api/auth/google/callback',
    },
  };

  // Add Razorpay config if available
  if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
    config.razorpay = {
      keyId: process.env.RAZORPAY_KEY_ID,
      keySecret: process.env.RAZORPAY_KEY_SECRET,
      webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
    };
  }

  // Validate required Google OAuth credentials
  if (!config.google.clientId || !config.google.clientSecret) {
    console.warn('⚠️  Google OAuth credentials not configured. Google authentication will be disabled.');
  }

  return config;
};

export const env = getEnvironmentConfig();

// Helper to check if Google OAuth is configured
export const isGoogleOAuthEnabled = (): boolean => {
  return !!(env.google.clientId && env.google.clientSecret);
};

// Helper to get the correct callback URL based on environment
export const getGoogleCallbackUrl = (): string => {
  const baseUrl = env.nodeEnv === 'production' 
    ? env.frontendUrl.replace(/\/+$/, '') // Remove trailing slashes
    : 'http://localhost:5000';
  
  return `${baseUrl}${env.google.callbackUrl}`;
};
