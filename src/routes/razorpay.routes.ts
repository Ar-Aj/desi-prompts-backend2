import { Router, Request, Response } from 'express';
import { RazorpayEvent } from '../models/RazorpayEvent.model';
import { authenticate, authorizeAdmin } from '../middleware/auth.middleware';
import { asyncHandler } from '../middleware/error.middleware';

const router: Router = Router();

// Get all Razorpay events with pagination
router.get('/events', authenticate, authorizeAdmin, asyncHandler(async (req: Request, res: Response) => {
  try {
    const { page = 1, limit = 20, eventType, status, search } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    // Build query
    const query: any = {};
    
    if (eventType) {
      query.eventType = eventType;
    }
    
    if (status) {
      query.status = status;
    }
    
    if (search) {
      query.$or = [
        { eventId: { $regex: search, $options: 'i' } },
        { paymentId: { $regex: search, $options: 'i' } },
        { orderId: { $regex: search, $options: 'i' } },
        { refundId: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const [events, total] = await Promise.all([
      RazorpayEvent.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      RazorpayEvent.countDocuments(query)
    ]);

    res.json({
      success: true,
      events,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching Razorpay events:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch Razorpay events'
    });
  }
}));

// Get event statistics
router.get('/stats', authenticate, authorizeAdmin, asyncHandler(async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    // const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Overall stats
    const totalEvents = await RazorpayEvent.countDocuments();
    const successfulEvents = await RazorpayEvent.countDocuments({ status: 'processed' });
    const failedEvents = await RazorpayEvent.countDocuments({ status: 'failed' });
    const duplicateEvents = await RazorpayEvent.countDocuments({ status: 'duplicate' });

    // Recent stats (last 24 hours)
    const recentEvents = await RazorpayEvent.countDocuments({ 
      createdAt: { $gte: oneDayAgo } 
    });
    
    const recentSuccessful = await RazorpayEvent.countDocuments({ 
      status: 'processed',
      createdAt: { $gte: oneDayAgo } 
    });
    
    const recentFailed = await RazorpayEvent.countDocuments({ 
      status: 'failed',
      createdAt: { $gte: oneDayAgo } 
    });

    // Event type distribution
    const eventTypeDistribution = await RazorpayEvent.aggregate([
      {
        $group: {
          _id: '$eventType',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);

    // Status distribution
    const statusDistribution = await RazorpayEvent.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    // Recent events (last 10)
    const recentEventsList = await RazorpayEvent.find()
      .sort({ createdAt: -1 })
      .limit(10);

    res.json({
      success: true,
      stats: {
        overall: {
          total: totalEvents,
          successful: successfulEvents,
          failed: failedEvents,
          duplicate: duplicateEvents,
          successRate: totalEvents > 0 ? (successfulEvents / totalEvents) * 100 : 0
        },
        recent24h: {
          total: recentEvents,
          successful: recentSuccessful,
          failed: recentFailed,
          successRate: recentEvents > 0 ? (recentSuccessful / recentEvents) * 100 : 0
        },
        eventTypeDistribution,
        statusDistribution,
        recentEvents: recentEventsList
      }
    });
    return;
  } catch (error) {
    console.error('Error fetching Razorpay stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch Razorpay statistics'
    });
    return;
  }
}));

// Get event by ID
router.get('/events/:id', authenticate, authorizeAdmin, asyncHandler(async (req: Request, res: Response) => {
  try {
    const event = await RazorpayEvent.findById(req.params.id);
    
    if (!event) {
      return res.status(404).json({
        success: false,
        error: 'Event not found'
      });
    }

    res.json({
      success: true,
      event
    });
    return;
  } catch (error) {
    console.error('Error fetching Razorpay event:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch Razorpay event'
    });
    return;
  }
}));

// Get events by payment ID
router.get('/events/payment/:paymentId', authenticate, authorizeAdmin, asyncHandler(async (req: Request, res: Response) => {
  try {
    const events = await RazorpayEvent.find({ paymentId: req.params.paymentId })
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      events
    });
    return;
  } catch (error) {
    console.error('Error fetching Razorpay events by payment ID:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch Razorpay events'
    });
    return;
  }
}));

export default router;