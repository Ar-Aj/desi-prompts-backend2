import { Router, Request, Response } from 'express';
import { Order } from '../models/Order.model';
import { Product } from '../models/Product.model';
import { asyncHandler } from '../middleware/error.middleware';
import { verifyWebhookSignature } from '../utils/payment.utils';
import { sendEmail, getOrderConfirmationEmail } from '../utils/email.utils';

const router: Router = Router();

// Simple in-memory store for processed event IDs (for idempotency)
// In production, this should be stored in a database
const processedEvents = new Set<string>();
const EVENT_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Clean up old events periodically
setInterval(() => {
  // In a real implementation, we would clean up database entries
  // For this in-memory implementation, we'll just log the size
  console.log(`Currently tracking ${processedEvents.size} processed events`);
}, 60 * 60 * 1000); // Every hour

// Razorpay webhook endpoint
router.post('/razorpay', 
  // Raw body parser for webhook signature verification
  asyncHandler(async (req: Request, res: Response) => {
    const signature = req.headers['x-razorpay-signature'] as string;
    
    if (!signature) {
      res.status(400).json({ error: 'Missing signature' });
      return;
    }

    // Verify webhook signature
    const isValid = verifyWebhookSignature(
      JSON.stringify(req.body),
      signature
    );

    if (!isValid) {
      res.status(400).json({ error: 'Invalid signature' });
      return;
    }

    const { event, payload } = req.body;
    
    // Extract event ID for idempotency
    const eventId = payload?.payment?.entity?.id || payload?.refund?.entity?.id || 'unknown';
    
    // Check if event has already been processed (idempotency)
    if (processedEvents.has(eventId)) {
      console.log(`Duplicate event received and ignored: ${eventId}`);
      res.json({ status: 'ok', message: 'Event already processed' });
      return;
    }

    // Log request ID and event ID for debugging (without secrets)
    const requestId = req.headers['x-request-id'] as string || 'unknown';
    console.log(`Processing webhook event - Request ID: ${requestId}, Event ID: ${eventId}, Event: ${event}`);

    switch (event) {
      case 'payment.captured':
        await handlePaymentCaptured(payload.payment.entity);
        break;
      
      case 'payment.failed':
        await handlePaymentFailed(payload.payment.entity);
        break;
      
      case 'refund.created':
        await handleRefundCreated(payload.refund.entity);
        break;
      
      default:
        console.log(`Unhandled webhook event: ${event}`);
    }

    // Mark event as processed
    processedEvents.add(eventId);
    
    // Set a timeout to remove the event from the set after TTL
    // In production, this should be handled by a database with TTL
    setTimeout(() => {
      processedEvents.delete(eventId);
    }, EVENT_TTL);

    res.json({ status: 'ok' });
  })
);

// Handle successful payment
async function handlePaymentCaptured(payment: any) {
  try {
    const order = await Order.findOne({ 
      razorpayOrderId: payment.order_id 
    }).populate('items.product');

    if (!order) {
      console.error('Order not found for payment:', payment.id);
      return;
    }

    // Update order status
    order.paymentStatus = 'completed';
    order.razorpayPaymentId = payment.id;
    await order.save();

    // Update product sales count (both total and real)
    for (const item of order.items) {
      await Product.findByIdAndUpdate(item.product, {
        $inc: { 
          salesCount: item.quantity,
          realSalesCount: item.quantity // Increment real sales for actual orders
        }
      });
    }

    // Send confirmation email
    try {
      const products = order.items.map((item: any) => ({
        name: item.name,
        price: item.price
      }));

      const firstProduct = await Product.findById(order.items[0].product);
      if (firstProduct) {
        
        const customerEmail = payment.email || order.guestEmail;
        const customerName = order.guestName || 'Customer';

        await sendEmail({
          to: customerEmail,
          subject: `Order Confirmation - ${order.orderNumber}`,
          html: getOrderConfirmationEmail(
            customerName,
            order.orderNumber,
            order.purchaseId, // Fix: Use purchaseId instead of order ID
            order.accessToken || 'N/A',
            products,
            order.totalAmount,
            firstProduct.pdfPassword
          )
        });

        order.emailSent = true;
        order.emailSentAt = new Date();
        order.pdfDelivered = true;
        order.pdfDeliveredAt = new Date();
        await order.save();
      }
    } catch (error) {
      console.error('Failed to send confirmation email:', error);
    }
  } catch (error) {
    console.error('Error handling payment captured:', error);
  }
}

// Handle failed payment
async function handlePaymentFailed(payment: any) {
  try {
    const order = await Order.findOne({ 
      razorpayOrderId: payment.order_id 
    });

    if (!order) {
      console.error('Order not found for failed payment:', payment.id);
      return;
    }

    order.paymentStatus = 'failed';
    order.razorpayPaymentId = payment.id;
    await order.save();
  } catch (error) {
    console.error('Error handling payment failed:', error);
  }
}

// Handle refund
async function handleRefundCreated(refund: any) {
  try {
    const order = await Order.findOne({ 
      razorpayPaymentId: refund.payment_id 
    });

    if (!order) {
      console.error('Order not found for refund:', refund.id);
      return;
    }

    order.paymentStatus = 'refunded';
    await order.save();

    // Decrease product sales count (both total and real)
    for (const item of order.items) {
      await Product.findByIdAndUpdate(item.product, {
        $inc: { 
          salesCount: -item.quantity,
          realSalesCount: -item.quantity // Decrease real sales for refunds
        }
      });
    }
  } catch (error) {
    console.error('Error handling refund:', error);
  }
}

export default router;