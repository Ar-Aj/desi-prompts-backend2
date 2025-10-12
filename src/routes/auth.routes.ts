import { Router, Request, Response } from 'express';
import { User } from '../models/User.model';
import jwt from 'jsonwebtoken';
import { validate } from '../middleware/validation.middleware';
import { authenticate } from '../middleware/auth.middleware';
import { asyncHandler } from '../middleware/error.middleware';
import { signupSchema, loginSchema } from '../validators/auth.validators';
import { sendEmail, getWelcomeEmail } from '../utils/email.utils';
import passport from '../config/passport.config';
import { env, isGoogleOAuthEnabled } from '../config/environment.config';

const router: Router = Router();

// Generate JWT token
const generateToken = (userId: string): string => {
  // @ts-ignore
  return jwt.sign({ userId }, env.jwtSecret, { expiresIn: '7d' });
};

// Signup
router.post('/signup', validate(signupSchema), asyncHandler(async (req: Request, res: Response) => {
  const { name, email, password } = req.body;

  // Check if user exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    res.status(400).json({ error: 'Email already registered' });
    return;
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
  const token = generateToken((user._id as any).toString());

  res.status(201).json({
    success: true,
    token,
    user: user.toJSON()
  });
}));

// Login
router.post('/login', validate(loginSchema), asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body;

  // Find user
  const user = await User.findOne({ email });
  if (!user) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  // Check password
  const isPasswordValid = await user.comparePassword(password);
  if (!isPasswordValid) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  // Generate token
  const token = generateToken((user._id as any).toString());

  res.json({
    success: true,
    token,
    user: user.toJSON()
  });
}));

// Get current user
router.get('/me', authenticate, asyncHandler(async (req: Request, res: Response) => {
  res.json({
    success: true,
    user: (req as any).user
  });
}));

// Update profile
router.patch('/profile', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const { name } = req.body;

  if (name) {
    (req as any).user.name = name;
    await (req as any).user.save();
  }

  res.json({
    success: true,
    user: (req as any).user
  });
}));

// Change password
router.post('/change-password', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body;

  const user = await User.findById((req as any).user._id);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const isPasswordValid = await user.comparePassword(currentPassword);
  if (!isPasswordValid) {
    res.status(401).json({ error: 'Current password is incorrect' });
    return;
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
    asyncHandler(async (req: Request, res: Response) => {
      // Generate JWT token for the authenticated user
      const token = generateToken((req as any).user._id.toString());
      
      // Redirect to frontend with token
      res.redirect(`${env.frontendUrl}/auth/callback?token=${token}`);
    })
  );
} else {
  // Fallback routes when Google OAuth is not configured
  router.get('/google', (_req: Request, res: Response) => {
    res.status(503).json({ 
      error: 'Google OAuth not configured',
      message: 'Please configure Google OAuth credentials to use this feature'
    });
  });

  router.get('/google/callback', (_req: Request, res: Response) => {
    res.status(503).json({ 
      error: 'Google OAuth not configured',
      message: 'Please configure Google OAuth credentials to use this feature'
    });
  });
}

export default router;