import { Router, Request, Response } from 'express';
import { Order } from '../models/Order.model';
import { Product } from '../models/Product.model';
import { RazorpayEvent } from '../models/RazorpayEvent.model';
import { asyncHandler } from '../middleware/error.middleware';
import { verifyWebhookSignature } from '../utils/payment.utils';
import { sendEmail, getOrderConfirmationEmail } from '../utils/email.utils';

const router: Router = Router();

// Health check endpoint for webhook
router.get('/health', (_req: Request, res: Response) => {
  res.json({ 
    status: 'ok', 
    message: 'Webhook endpoint is active and ready to receive events',
    timestamp: new Date().toISOString()
  });
});

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
    console.log('Timestamp:', new Date().toISOString());
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
      
      // Save failed event to database
      try {
        const eventId = req.body?.payload?.payment?.entity?.id || req.body?.payload?.refund?.entity?.id || 'unknown';
        await RazorpayEvent.create({
          eventId,
          eventType: req.body?.event || 'unknown',
          payload: req.body,
          signature,
          status: 'failed',
          errorMessage: 'Invalid signature'
        });
      } catch (error) {
        console.error('Failed to save failed webhook event:', error);
      }
      
      res.status(400).json({ error: 'Invalid signature' });
      return;
    }

    const { event, payload } = req.body;
    
    // Extract event ID for idempotency
    const eventId = payload?.payment?.entity?.id || payload?.refund?.entity?.id || 'unknown';
    
    // Check if event has already been processed (idempotency)
    if (processedEvents.has(eventId)) {
      console.log(`Duplicate event received and ignored: ${eventId}`);
      
      // Save duplicate event to database
      try {
        await RazorpayEvent.create({
          eventId,
          eventType: event,
          payload: req.body,
          signature,
          status: 'duplicate',
          errorMessage: 'Duplicate event'
        });
      } catch (error) {
        console.error('Failed to save duplicate webhook event:', error);
      }
      
      res.json({ status: 'ok', message: 'Event already processed' });
      return;
    }

    // Log request ID and event ID for debugging (without secrets)
    const requestId = req.headers['x-request-id'] as string || 'unknown';
    console.log(`Processing webhook event - Request ID: ${requestId}, Event ID: ${eventId}, Event: ${event}`);

    // Save event to database
    let razorpayEvent: any = null;
    try {
      const eventData: any = {
        eventId,
        eventType: event,
        payload: req.body,
        signature,
        status: 'processed'
      };
      
      // Extract common fields
      if (payload?.payment?.entity) {
        const payment = payload.payment.entity;
        eventData.orderId = payment.order_id;
        eventData.paymentId = payment.id;
        eventData.amount = payment.amount;
        eventData.currency = payment.currency;
        eventData.email = payment.email;
        eventData.contact = payment.contact;
        eventData.method = payment.method;
      } else if (payload?.refund?.entity) {
        const refund = payload.refund.entity;
        eventData.refundId = refund.id;
        eventData.paymentId = refund.payment_id;
        eventData.amount = refund.amount;
        eventData.currency = refund.currency;
      }
      
      razorpayEvent = await RazorpayEvent.create(eventData);
      console.log('Saved webhook event to database:', razorpayEvent._id);
    } catch (error) {
      console.error('Failed to save webhook event to database:', error);
    }

    switch (event) {
      case 'payment.captured':
        console.log('Processing payment.captured event:', {
          paymentId: payload.payment.entity.id,
          orderId: payload.payment.entity.order_id,
          amount: payload.payment.entity.amount
        });
        await handlePaymentCaptured(payload.payment.entity, razorpayEvent ? razorpayEvent._id.toString() : undefined);
        break;
      
      case 'payment.failed':
        console.log('Processing payment.failed event:', {
          paymentId: payload.payment.entity.id,
          orderId: payload.payment.entity.order_id,
          errorCode: payload.payment.entity.error_code,
          errorDescription: payload.payment.entity.error_description
        });
        await handlePaymentFailed(payload.payment.entity, razorpayEvent ? razorpayEvent._id.toString() : undefined);
        break;
      
      case 'refund.created':
        console.log('🚨 REFUND CREATED EVENT RECEIVED 🚨', {
          refundId: payload.refund.entity.id,
          paymentId: payload.refund.entity.payment_id,
          amount: payload.refund.entity.amount,
          speed: payload.refund.entity.speed,
          notes: payload.refund.entity.notes,
          createdAt: payload.refund.entity.created_at
        });
        await handleRefundCreated(payload.refund.entity, razorpayEvent ? razorpayEvent._id.toString() : undefined);
        break;
      
      case 'payment.authorized':
        console.log('Processing payment.authorized event:', {
          paymentId: payload.payment.entity.id,
          orderId: payload.payment.entity.order_id,
          amount: payload.payment.entity.amount
        });
        await handlePaymentAuthorized(payload.payment.entity, razorpayEvent ? razorpayEvent._id.toString() : undefined);
        break;
        
      case 'order.paid':
        console.log('Processing order.paid event:', {
          orderId: payload.order.entity.id,
          amount: payload.order.entity.amount
        });
        await handleOrderPaid(payload.order.entity, razorpayEvent ? razorpayEvent._id.toString() : undefined);
        break;
        
      case 'payment.dispute.created':
        console.log('Processing payment.dispute.created event:', {
          paymentId: payload.payment.entity.id,
          disputeId: payload.dispute.entity.id,
          amount: payload.dispute.entity.amount,
          reason: payload.dispute.entity.reason,
          status: payload.dispute.entity.status
        });
        await handlePaymentDisputeCreated(payload.dispute.entity, razorpayEvent ? razorpayEvent._id.toString() : undefined);
        break;
        
      case 'payment.dispute.won':
        console.log('Processing payment.dispute.won event:', {
          paymentId: payload.payment.entity.id,
          disputeId: payload.dispute.entity.id,
          amount: payload.dispute.entity.amount,
          status: payload.dispute.entity.status
        });
        await handlePaymentDisputeWon(payload.dispute.entity, razorpayEvent ? razorpayEvent._id.toString() : undefined);
        break;
        
      case 'payment.dispute.lost':
        console.log('Processing payment.dispute.lost event:', {
          paymentId: payload.payment.entity.id,
          disputeId: payload.dispute.entity.id,
          amount: payload.dispute.entity.amount,
          status: payload.dispute.entity.status
        });
        await handlePaymentDisputeLost(payload.dispute.entity, razorpayEvent ? razorpayEvent._id.toString() : undefined);
        break;
        
      case 'payment.dispute.closed':
        console.log('Processing payment.dispute.closed event:', {
          paymentId: payload.payment.entity.id,
          disputeId: payload.dispute.entity.id,
          amount: payload.dispute.entity.amount,
          status: payload.dispute.entity.status
        });
        await handlePaymentDisputeClosed(payload.dispute.entity, razorpayEvent ? razorpayEvent._id.toString() : undefined);
        break;
        
      case 'subscription.activated':
        console.log('Processing subscription.activated event:', {
          subscriptionId: payload.subscription.entity.id,
          customerId: payload.subscription.entity.customer_id,
          status: payload.subscription.entity.status
        });
        await handleSubscriptionActivated(payload.subscription.entity, razorpayEvent ? razorpayEvent._id.toString() : undefined);
        break;
        
      case 'subscription.cancelled':
        console.log('Processing subscription.cancelled event:', {
          subscriptionId: payload.subscription.entity.id,
          customerId: payload.subscription.entity.customer_id,
          status: payload.subscription.entity.status
        });
        await handleSubscriptionCancelled(payload.subscription.entity, razorpayEvent ? razorpayEvent._id.toString() : undefined);
        break;
        
      default:
        console.log(`Unhandled webhook event: ${event}`);
        console.log('Full event data:', JSON.stringify(req.body, null, 2));
        
        // Update event status if it exists
        if (razorpayEvent) {
          try {
            await RazorpayEvent.findByIdAndUpdate(razorpayEvent._id, {
              errorMessage: `Unhandled event type: ${event}`
            });
          } catch (error) {
            console.error('Failed to update webhook event status:', error);
          }
        }
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

// Handle payment authorized
async function handlePaymentAuthorized(payment: any, eventId?: string) {
  try {
    console.log('💳 HANDLING PAYMENT AUTHORIZED EVENT 💳', {
      paymentId: payment.id,
      orderId: payment.order_id,
      amount: payment.amount,
      email: payment.email,
      contact: payment.contact,
      status: payment.status,
      method: payment.method,
      authorizedAt: payment.authorized_at
    });

    // Update event status if it exists
    if (eventId) {
      try {
        await RazorpayEvent.findByIdAndUpdate(eventId, {
          status: 'processed'
        });
      } catch (error) {
        console.error('Failed to update webhook event status:', error);
      }
    }
  } catch (error) {
    console.error('Error handling payment authorized:', error);
    
    // Update event status if it exists
    if (eventId) {
      try {
        await RazorpayEvent.findByIdAndUpdate(eventId, {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Unknown error'
        });
      } catch (updateError) {
        console.error('Failed to update webhook event status:', updateError);
      }
    }
  }
}

// Handle order paid
async function handleOrderPaid(order: any, eventId?: string) {
  try {
    console.log('💳 HANDLING ORDER PAID EVENT 💳', {
      orderId: order.id,
      amount: order.amount,
      status: order.status,
      paidAt: order.paid_at
    });

    // Update event status if it exists
    if (eventId) {
      try {
        await RazorpayEvent.findByIdAndUpdate(eventId, {
          status: 'processed'
        });
      } catch (error) {
        console.error('Failed to update webhook event status:', error);
      }
    }
  } catch (error) {
    console.error('Error handling order paid:', error);
    
    // Update event status if it exists
    if (eventId) {
      try {
        await RazorpayEvent.findByIdAndUpdate(eventId, {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Unknown error'
        });
      } catch (updateError) {
        console.error('Failed to update webhook event status:', updateError);
      }
    }
  }
}

// Handle successful payment
async function handlePaymentCaptured(payment: any, eventId?: string) {
  try {
    console.log('💳 HANDLING PAYMENT CAPTURED EVENT 💳', {
      paymentId: payment.id,
      orderId: payment.order_id,
      amount: payment.amount,
      email: payment.email,
      contact: payment.contact,
      captured: payment.captured,
      status: payment.status,
      method: payment.method,
      capturedAt: payment.captured_at
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
      
      // Update event status if it exists
      if (eventId) {
        try {
          await RazorpayEvent.findByIdAndUpdate(eventId, {
            status: 'failed',
            errorMessage: 'Order not found'
          });
        } catch (error) {
          console.error('Failed to update webhook event status:', error);
        }
      }
      
      return;
    }

    console.log('Found order for payment:', {
      orderId: order._id,
      orderNumber: order.orderNumber,
      currentStatus: order.paymentStatus,
      razorpayOrderId: order.razorpayOrderId
    });

    // Update order status
    order.paymentStatus = 'completed';
    order.razorpayPaymentId = payment.id;
    await order.save();

    console.log('✅ Updated order status to completed');

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
        
        console.log('📧 Order confirmation email sent successfully');
      } else {
        console.warn('No product found for order item, skipping email send');
      }
    } catch (error) {
      console.error('Failed to send confirmation email:', error);
    }
    
    // Update event status if it exists
    if (eventId) {
      try {
        await RazorpayEvent.findByIdAndUpdate(eventId, {
          status: 'processed'
        });
      } catch (error) {
        console.error('Failed to update webhook event status:', error);
      }
    }
  } catch (error) {
    console.error('Error handling payment captured:', error);
    
    // Update event status if it exists
    if (eventId) {
      try {
        await RazorpayEvent.findByIdAndUpdate(eventId, {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Unknown error'
        });
      } catch (updateError) {
        console.error('Failed to update webhook event status:', updateError);
      }
    }
  }
}

// Handle failed payment
async function handlePaymentFailed(payment: any, eventId?: string) {
  try {
    console.log('💳 HANDLING PAYMENT FAILED EVENT 💳', {
      paymentId: payment.id,
      orderId: payment.order_id,
      amount: payment.amount,
      email: payment.email,
      contact: payment.contact,
      errorCode: payment.error_code,
      errorDescription: payment.error_description,
      status: payment.status,
      method: payment.method,
      createdAt: payment.created_at
    });

    const order = await Order.findOne({ 
      razorpayOrderId: payment.order_id 
    });

    if (!order) {
      console.error('Order not found for failed payment:', {
        paymentId: payment.id,
        orderId: payment.order_id
      });
      
      // Update event status if it exists
      if (eventId) {
        try {
          await RazorpayEvent.findByIdAndUpdate(eventId, {
            status: 'failed',
            errorMessage: 'Order not found'
          });
        } catch (error) {
          console.error('Failed to update webhook event status:', error);
        }
      }
      
      return;
    }

    console.log('Found order for failed payment:', {
      orderId: order._id,
      orderNumber: order.orderNumber,
      currentStatus: order.paymentStatus
    });

    order.paymentStatus = 'failed';
    order.razorpayPaymentId = payment.id;
    await order.save();
    
    console.log('Updated order status to failed');
    
    // Update event status if it exists
    if (eventId) {
      try {
        await RazorpayEvent.findByIdAndUpdate(eventId, {
          status: 'processed'
        });
      } catch (error) {
        console.error('Failed to update webhook event status:', error);
      }
    }
  } catch (error) {
    console.error('Error handling payment failed:', error);
    
    // Update event status if it exists
    if (eventId) {
      try {
        await RazorpayEvent.findByIdAndUpdate(eventId, {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Unknown error'
        });
      } catch (updateError) {
        console.error('Failed to update webhook event status:', updateError);
      }
    }
  }
}

// Handle refund
async function handleRefundCreated(refund: any, eventId?: string) {
  try {
    console.log('🚨 HANDLING REFUND CREATED EVENT 🚨', {
      refundId: refund.id,
      paymentId: refund.payment_id,
      amount: refund.amount,
      speed: refund.speed,
      notes: refund.notes,
      createdAt: refund.created_at,
      entityId: refund.entity_id,
      refundStatus: refund.status
    });

    const order = await Order.findOne({ 
      razorpayPaymentId: refund.payment_id 
    });

    if (!order) {
      console.error('Order not found for refund:', {
        refundId: refund.id,
        paymentId: refund.payment_id
      });
      
      // Update event status if it exists
      if (eventId) {
        try {
          await RazorpayEvent.findByIdAndUpdate(eventId, {
            status: 'failed',
            errorMessage: 'Order not found'
          });
        } catch (error) {
          console.error('Failed to update webhook event status:', error);
        }
      }
      
      return;
    }

    console.log('Found order for refund:', {
      orderId: order._id,
      orderNumber: order.orderNumber,
      currentStatus: order.paymentStatus,
      razorpayOrderId: order.razorpayOrderId,
      razorpayPaymentId: order.razorpayPaymentId
    });

    // Log the reason for refund if available
    if (refund.notes) {
      console.log('Refund notes:', refund.notes);
    }

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
    
    // Update event status if it exists
    if (eventId) {
      try {
        await RazorpayEvent.findByIdAndUpdate(eventId, {
          status: 'processed'
        });
      } catch (error) {
        console.error('Failed to update webhook event status:', error);
      }
    }
  } catch (error) {
    console.error('Error handling refund:', error);
    
    // Update event status if it exists
    if (eventId) {
      try {
        await RazorpayEvent.findByIdAndUpdate(eventId, {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Unknown error'
        });
      } catch (updateError) {
        console.error('Failed to update webhook event status:', updateError);
      }
    }
  }
}

// Handle payment dispute created
async function handlePaymentDisputeCreated(dispute: any, eventId?: string) {
  try {
    console.log('⚖️ HANDLING PAYMENT DISPUTE CREATED EVENT ⚖️', {
      disputeId: dispute.id,
      paymentId: dispute.payment_id,
      amount: dispute.amount,
      currency: dispute.currency,
      reason: dispute.reason,
      status: dispute.status,
      createdAt: dispute.created_at
    });

    // Update event status if it exists
    if (eventId) {
      try {
        await RazorpayEvent.findByIdAndUpdate(eventId, {
          status: 'processed'
        });
      } catch (error) {
        console.error('Failed to update webhook event status:', error);
      }
    }
  } catch (error) {
    console.error('Error handling payment dispute created:', error);
    
    // Update event status if it exists
    if (eventId) {
      try {
        await RazorpayEvent.findByIdAndUpdate(eventId, {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Unknown error'
        });
      } catch (updateError) {
        console.error('Failed to update webhook event status:', updateError);
      }
    }
  }
}

// Handle payment dispute won
async function handlePaymentDisputeWon(dispute: any, eventId?: string) {
  try {
    console.log('✅ HANDLING PAYMENT DISPUTE WON EVENT ✅', {
      disputeId: dispute.id,
      paymentId: dispute.payment_id,
      amount: dispute.amount,
      currency: dispute.currency,
      status: dispute.status,
      resolvedAt: dispute.resolved_at
    });

    // Update event status if it exists
    if (eventId) {
      try {
        await RazorpayEvent.findByIdAndUpdate(eventId, {
          status: 'processed'
        });
      } catch (error) {
        console.error('Failed to update webhook event status:', error);
      }
    }
  } catch (error) {
    console.error('Error handling payment dispute won:', error);
    
    // Update event status if it exists
    if (eventId) {
      try {
        await RazorpayEvent.findByIdAndUpdate(eventId, {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Unknown error'
        });
      } catch (updateError) {
        console.error('Failed to update webhook event status:', updateError);
      }
    }
  }
}

// Handle payment dispute lost
async function handlePaymentDisputeLost(dispute: any, eventId?: string) {
  try {
    console.log('❌ HANDLING PAYMENT DISPUTE LOST EVENT ❌', {
      disputeId: dispute.id,
      paymentId: dispute.payment_id,
      amount: dispute.amount,
      currency: dispute.currency,
      status: dispute.status,
      resolvedAt: dispute.resolved_at
    });

    // Update event status if it exists
    if (eventId) {
      try {
        await RazorpayEvent.findByIdAndUpdate(eventId, {
          status: 'processed'
        });
      } catch (error) {
        console.error('Failed to update webhook event status:', error);
      }
    }
  } catch (error) {
    console.error('Error handling payment dispute lost:', error);
    
    // Update event status if it exists
    if (eventId) {
      try {
        await RazorpayEvent.findByIdAndUpdate(eventId, {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Unknown error'
        });
      } catch (updateError) {
        console.error('Failed to update webhook event status:', updateError);
      }
    }
  }
}

// Handle payment dispute closed
async function handlePaymentDisputeClosed(dispute: any, eventId?: string) {
  try {
    console.log('🔒 HANDLING PAYMENT DISPUTE CLOSED EVENT 🔒', {
      disputeId: dispute.id,
      paymentId: dispute.payment_id,
      amount: dispute.amount,
      currency: dispute.currency,
      status: dispute.status,
      resolvedAt: dispute.resolved_at
    });

    // Update event status if it exists
    if (eventId) {
      try {
        await RazorpayEvent.findByIdAndUpdate(eventId, {
          status: 'processed'
        });
      } catch (error) {
        console.error('Failed to update webhook event status:', error);
      }
    }
  } catch (error) {
    console.error('Error handling payment dispute closed:', error);
    
    // Update event status if it exists
    if (eventId) {
      try {
        await RazorpayEvent.findByIdAndUpdate(eventId, {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Unknown error'
        });
      } catch (updateError) {
        console.error('Failed to update webhook event status:', updateError);
      }
    }
  }
}

// Handle subscription activated
async function handleSubscriptionActivated(subscription: any, eventId?: string) {
  try {
    console.log('🔄 HANDLING SUBSCRIPTION ACTIVATED EVENT 🔄', {
      subscriptionId: subscription.id,
      customerId: subscription.customer_id,
      status: subscription.status,
      currentStart: subscription.current_start,
      currentEnd: subscription.current_end
    });

    // Update event status if it exists
    if (eventId) {
      try {
        await RazorpayEvent.findByIdAndUpdate(eventId, {
          status: 'processed'
        });
      } catch (error) {
        console.error('Failed to update webhook event status:', error);
      }
    }
  } catch (error) {
    console.error('Error handling subscription activated:', error);
    
    // Update event status if it exists
    if (eventId) {
      try {
        await RazorpayEvent.findByIdAndUpdate(eventId, {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Unknown error'
        });
      } catch (updateError) {
        console.error('Failed to update webhook event status:', updateError);
      }
    }
  }
}

// Handle subscription cancelled
async function handleSubscriptionCancelled(subscription: any, eventId?: string) {
  try {
    console.log('⏹️ HANDLING SUBSCRIPTION CANCELLED EVENT ⏹️', {
      subscriptionId: subscription.id,
      customerId: subscription.customer_id,
      status: subscription.status,
      endedAt: subscription.ended_at
    });

    // Update event status if it exists
    if (eventId) {
      try {
        await RazorpayEvent.findByIdAndUpdate(eventId, {
          status: 'processed'
        });
      } catch (error) {
        console.error('Failed to update webhook event status:', error);
      }
    }
  } catch (error) {
    console.error('Error handling subscription cancelled:', error);
    
    // Update event status if it exists
    if (eventId) {
      try {
        await RazorpayEvent.findByIdAndUpdate(eventId, {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Unknown error'
        });
      } catch (updateError) {
        console.error('Failed to update webhook event status:', updateError);
      }
    }
  }
}

export default router;