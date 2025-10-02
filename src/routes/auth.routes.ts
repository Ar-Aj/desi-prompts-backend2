import { Router } from 'express';
import { User } from '../models/User.model';
import jwt from 'jsonwebtoken';
import { validate } from '../middleware/validation.middleware';
import { authenticate } from '../middleware/auth.middleware';
import { asyncHandler } from '../middleware/error.middleware';
import { signupSchema, loginSchema } from '../validators/auth.validators';
import { sendEmail, getWelcomeEmail } from '../utils/email.utils';
import passport from '../config/passport.config';
import { env, isGoogleOAuthEnabled } from '../config/environment.config';

const router = Router();

// Generate JWT token
const generateToken = (userId: string): string => {
  return jwt.sign(
    { userId },
    process.env.JWT_SECRET!,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

// Signup
router.post('/signup', validate(signupSchema), asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;

  // Check if user exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    return res.status(400).json({ error: 'Email already registered' });
  }

  // Create user
  const user = new User({ name, email, password });
  await user.save();

  // Send welcome email
  try {
    await sendEmail({
      to: email,
      subject: 'Welcome to Desi Prompts!',
      html: getWelcomeEmail(name)
    });
  } catch (error) {
    console.error('Welcome email failed:', error);
  }

  // Generate token
  const token = generateToken(user._id.toString());

  res.status(201).json({
    success: true,
    token,
    user: user.toJSON()
  });
}));

// Login
router.post('/login', validate(loginSchema), asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  // Find user
  const user = await User.findOne({ email });
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Check password
  const isPasswordValid = await user.comparePassword(password);
  if (!isPasswordValid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Generate token
  const token = generateToken(user._id.toString());

  res.json({
    success: true,
    token,
    user: user.toJSON()
  });
}));

// Get current user
router.get('/me', authenticate, asyncHandler(async (req: any, res) => {
  res.json({
    success: true,
    user: req.user
  });
}));

// Update profile
router.patch('/profile', authenticate, asyncHandler(async (req: any, res) => {
  const { name } = req.body;

  if (name) {
    req.user.name = name;
    await req.user.save();
  }

  res.json({
    success: true,
    user: req.user
  });
}));

// Change password
router.post('/change-password', authenticate, asyncHandler(async (req: any, res) => {
  const { currentPassword, newPassword } = req.body;

  const user = await User.findById(req.user._id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const isPasswordValid = await user.comparePassword(currentPassword);
  if (!isPasswordValid) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  user.password = newPassword;
  await user.save();

  res.json({
    success: true,
    message: 'Password changed successfully'
  });
}));

// Google OAuth routes (only if configured)
if (isGoogleOAuthEnabled()) {
  router.get('/google', 
    passport.authenticate('google', { scope: ['profile', 'email'] })
  );

  router.get('/google/callback',
    passport.authenticate('google', { session: false }),
    asyncHandler(async (req: any, res) => {
      // Generate JWT token for the authenticated user
      const token = generateToken(req.user._id.toString());
      
      // Redirect to frontend with token
      res.redirect(`${env.frontendUrl}/auth/callback?token=${token}`);
    })
  );
} else {
  // Fallback routes when Google OAuth is not configured
  router.get('/google', (req, res) => {
    res.status(503).json({ 
      error: 'Google OAuth not configured',
      message: 'Please configure Google OAuth credentials to use this feature'
    });
  });

  router.get('/google/callback', (req, res) => {
    res.status(503).json({ 
      error: 'Google OAuth not configured',
      message: 'Please configure Google OAuth credentials to use this feature'
    });
  });
}

export default router;
