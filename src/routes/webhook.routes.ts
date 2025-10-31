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
    console.log('=== WEBHOOK REQUEST RECEIVED ===');
    console.log('Headers:', req.headers);
    console.log('Body type:', typeof req.body);
    console.log('Has body:', !!req.body);
    
    if (req.body) {
      console.log('Body keys:', Object.keys(req.body));
      try {
        console.log('Body preview:', JSON.stringify(req.body).substring(0, 200) + '...');
      } catch (e) {
        console.log('Body preview error:', e);
      }
    }
    
    const signature = req.headers['x-razorpay-signature'] as string;
    
    if (!signature) {
      console.error('Missing signature in webhook request');
      res.status(400).json({ error: 'Missing signature' });
      return;
    }

    // Log incoming webhook for debugging
    console.log('Received Razorpay webhook:', {
      signature: signature ? `${signature.substring(0, 10)}...` : 'NONE',
      hasBody: !!req.body,
      eventType: req.body?.event,
      eventId: req.body?.payload?.payment?.entity?.id || req.body?.payload?.refund?.entity?.id || 'unknown',
      timestamp: new Date().toISOString()
    });

    // Verify webhook signature
    const isValid = verifyWebhookSignature(
      JSON.stringify(req.body),
      signature
    );

    if (!isValid) {
      console.error('Invalid webhook signature:', {
        receivedSignature: signature ? `${signature.substring(0, 10)}...` : 'NONE',
        bodyPreview: JSON.stringify(req.body).substring(0, 100) + '...'
      });
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
        console.log('Processing payment.captured event:', {
          paymentId: payload.payment.entity.id,
          orderId: payload.payment.entity.order_id,
          amount: payload.payment.entity.amount
        });
        await handlePaymentCaptured(payload.payment.entity);
        break;
      
      case 'payment.failed':
        console.log('Processing payment.failed event:', {
          paymentId: payload.payment.entity.id,
          orderId: payload.payment.entity.order_id,
          errorCode: payload.payment.entity.error_code,
          errorDescription: payload.payment.entity.error_description
        });
        await handlePaymentFailed(payload.payment.entity);
        break;
      
      case 'refund.created':
        console.log('Processing refund.created event:', {
          refundId: payload.refund.entity.id,
          paymentId: payload.refund.entity.payment_id,
          amount: payload.refund.entity.amount,
          notes: payload.refund.entity.notes
        });
        await handleRefundCreated(payload.refund.entity);
        break;
      
      default:
        console.log(`Unhandled webhook event: ${event}`);
        console.log('Full event data:', JSON.stringify(req.body, null, 2));
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
    console.log('Handling payment captured event:', {
      paymentId: payment.id,
      orderId: payment.order_id,
      amount: payment.amount,
      email: payment.email,
      contact: payment.contact
    });

    const order = await Order.findOne({ 
      razorpayOrderId: payment.order_id 
    }).populate('items.product');

    if (!order) {
      console.error('Order not found for payment:', {
        paymentId: payment.id,
        orderId: payment.order_id,
        email: payment.email
      });
      return;
    }

    console.log('Found order for payment:', {
      orderId: order._id,
      orderNumber: order.orderNumber,
      currentStatus: order.paymentStatus
    });

    // Update order status
    order.paymentStatus = 'completed';
    order.razorpayPaymentId = payment.id;
    await order.save();

    console.log('Updated order status to completed');

    // Update product sales count (both total and real)
    for (const item of order.items) {
      console.log('Updating product sales count:', {
        productId: item.product,
        quantity: item.quantity
      });
      
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

        console.log('Sending order confirmation email:', {
          to: customerEmail,
          orderNumber: order.orderNumber,
          productCount: order.items.length
        });

        await sendEmail({
          to: customerEmail,
          subject: `Order Confirmation - ${order.orderNumber}`,
          html: getOrderConfirmationEmail(
            customerName,
            order.orderNumber,
            order.purchaseId, // Fix: Use purchaseId instead of order ID
            products,
            order.totalAmount,
            firstProduct.pdfPassword,
            'https://s3.eu-north-1.amazonaws.com/desiprompts-prod-files/prompt-pack.pdf' // Placeholder - in a real implementation you would generate a proper link
          )
        });

        order.emailSent = true;
        order.emailSentAt = new Date();
        order.pdfDelivered = true;
        order.pdfDeliveredAt = new Date();
        await order.save();
        
        console.log('Order confirmation email sent successfully');
      } else {
        console.warn('No product found for order item, skipping email send');
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
    console.log('Handling refund created event:', {
      refundId: refund.id,
      paymentId: refund.payment_id,
      amount: refund.amount,
      speed: refund.speed,
      notes: refund.notes
    });

    const order = await Order.findOne({ 
      razorpayPaymentId: refund.payment_id 
    });

    if (!order) {
      console.error('Order not found for refund:', {
        refundId: refund.id,
        paymentId: refund.payment_id
      });
      return;
    }

    console.log('Found order for refund:', {
      orderId: order._id,
      orderNumber: order.orderNumber,
      currentStatus: order.paymentStatus
    });

    order.paymentStatus = 'refunded';
    await order.save();

    console.log('Updated order status to refunded');

    // Decrease product sales count (both total and real)
    for (const item of order.items) {
      console.log('Decreasing product sales count due to refund:', {
        productId: item.product,
        quantity: item.quantity
      });
      
      await Product.findByIdAndUpdate(item.product, {
        $inc: { 
          salesCount: -item.quantity,
          realSalesCount: -item.quantity // Decrease real sales for refunds
        }
      });
    }
    
    console.log('Completed refund processing for order:', order.orderNumber);
  } catch (error) {
    console.error('Error handling refund:', error);
  }
}

export default router;