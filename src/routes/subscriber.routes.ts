import { Router, Request, Response } from 'express';
import { Subscriber } from '../models/Subscriber.model';
import { asyncHandler } from '../middleware/error.middleware';

const router: Router = Router();

// Subscribe to newsletter
router.post('/subscribe', asyncHandler(async (req: Request, res: Response) => {
  try {
    const { email, source = 'other' } = req.body;
    
    // Validate email
    if (!email) {
      res.status(400).json({
        success: false,
        error: 'Email is required'
      });
      return;
    }

    // Check if subscriber already exists
    const existingSubscriber = await Subscriber.findOne({ email });
    
    if (existingSubscriber) {
      res.json({
        success: true,
        message: 'Email already subscribed',
        subscriber: existingSubscriber
      });
      return;
    }

    // Get IP address and user agent
    const ipAddress = req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || '';
    const userAgent = req.headers['user-agent'] || '';

    // Create new subscriber
    const subscriber = new Subscriber({
      email,
      source,
      ipAddress: ipAddress.split(',')[0].trim(), // Get first IP if multiple
      userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent
    });

    await subscriber.save();

    res.status(201).json({
      success: true,
      message: 'Successfully subscribed to newsletter',
      subscriber
    });
  } catch (error: any) {
    console.error('Subscription error:', error);
    
    // Handle duplicate key error
    if (error.code === 11000) {
      res.status(400).json({
        success: false,
        error: 'Email already subscribed'
      });
      return;
    }
    
    // Handle validation errors
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map((err: any) => err.message);
      res.status(400).json({
        success: false,
        error: 'Validation error',
        details: messages
      });
      return;
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to subscribe'
    });
  }
}));

// Get all subscribers (admin only)
router.get('/', asyncHandler(async (_req: Request, res: Response) => {
  try {
    const subscribers = await Subscriber.find({}).sort({ createdAt: -1 });
    
    res.json({
      success: true,
      subscribers
    });
  } catch (error) {
    console.error('Error fetching subscribers:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch subscribers'
    });
  }
}));

// Get subscriber count
router.get('/count', asyncHandler(async (_req: Request, res: Response) => {
  try {
    const count = await Subscriber.countDocuments();
    
    res.json({
      success: true,
      count
    });
  } catch (error) {
    console.error('Error fetching subscriber count:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch subscriber count'
    });
  }
}));

// Unsubscribe
router.delete('/unsubscribe/:email', asyncHandler(async (req: Request, res: Response) => {
  try {
    const { email } = req.params;
    
    const subscriber = await Subscriber.findOneAndDelete({ email });
    
    if (!subscriber) {
      res.status(404).json({
        success: false,
        error: 'Subscriber not found'
      });
      return;
    }
    
    res.json({
      success: true,
      message: 'Successfully unsubscribed'
    });
  } catch (error) {
    console.error('Unsubscribe error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to unsubscribe'
    });
  }
}));

export default router;