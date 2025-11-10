import { Router, Request, Response } from 'express';
import { Order } from '../models/Order.model';
import { Product } from '../models/Product.model';
import { RazorpayEvent } from '../models/RazorpayEvent.model';
import { asyncHandler } from '../middleware/error.middleware';
import { verifyWebhookSignature } from '../utils/payment.utils';
import { sendEmail, getOrderConfirmationEmail } from '../utils/email.utils';
import { env } from '../config/environment.config';

const router: Router = Router();

// Health check endpoint for webhook
router.get('/health', (_req: Request, res: Response) => {
  const webhookSecretConfigured = !!process.env.RAZORPAY_WEBHOOK_SECRET;
  const razorpayKeyIdConfigured = !!process.env.RAZORPAY_KEY_ID;
  const razorpayKeySecretConfigured = !!process.env.RAZORPAY_KEY_SECRET;
  
  // Check if webhook secret matches what we're using
  const configWebhookSecret = env.razorpay?.webhookSecret;
  const envWebhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  
  const secretsMatch = configWebhookSecret === envWebhookSecret;
  
  res.json({ 
    status: 'ok', 
    message: 'Webhook endpoint is active and ready to receive events',
    timestamp: new Date().toISOString(),
    webhookUrl: `${process.env.FRONTEND_URL || 'http://localhost:5000'}/api/webhook/razorpay`,
    configuration: {
      webhookSecretConfigured,
      razorpayKeyIdConfigured,
      razorpayKeySecretConfigured,
      secretsMatch,
      configWebhookSecret: configWebhookSecret ? `${configWebhookSecret.substring(0, 5)}...` : 'NOT SET',
      envWebhookSecret: envWebhookSecret ? `${envWebhookSecret.substring(0, 5)}...` : 'NOT SET'
    },
    razorpay: {
      keyId: process.env.RAZORPAY_KEY_ID ? `${process.env.RAZORPAY_KEY_ID.substring(0, 10)}...` : 'NOT SET',
      keySecretConfigured: !!process.env.RAZORPAY_KEY_SECRET
    }
  });
});

// Test endpoint for webhook verification
router.post('/test', (req: Request, res: Response) => {
  console.log('=== WEBHOOK TEST ENDPOINT CALLED ===');
  console.log('Headers:', req.headers);
  console.log('Body:', req.body);
  
  // @ts-ignore - Accessing rawBody property
  if (req.rawBody) {
    // @ts-ignore
    console.log('Raw body:', req.rawBody.substring(0, 200) + '...');
  }
  
  // Test webhook secret configuration
  const webhookSecret = env.razorpay?.webhookSecret;
  const hasWebhookSecret = !!webhookSecret;
  
  res.json({ 
    status: 'ok', 
    message: 'Webhook test endpoint working',
    timestamp: new Date().toISOString(),
    hasRawBody: !!(req as any).rawBody,
    // @ts-ignore
    rawBodyLength: (req as any).rawBody ? (req as any).rawBody.length : 0,
    webhookSecretConfigured: hasWebhookSecret,
    webhookSecretPreview: webhookSecret ? `${webhookSecret.substring(0, 10)}...` : 'NOT SET',
    webhookSecretLength: webhookSecret ? webhookSecret.length : 0
  });
});

// Debug endpoint to test webhook secret verification
router.post('/debug-verify', (req: Request, res: Response) => {
  console.log('=== WEBHOOK DEBUG VERIFICATION ENDPOINT CALLED ===');
  
  const { body, signature } = req.body;
  
  if (!body || !signature) {
    return res.status(400).json({ 
      error: 'Both body and signature are required for verification' 
    });
  }
  
  console.log('Debug verification request:', {
    bodyLength: typeof body === 'string' ? body.length : JSON.stringify(body).length,
    signatureLength: signature.length,
    signaturePreview: signature.substring(0, 20) + '...'
  });
  
  const isValid = verifyWebhookSignature(
    typeof body === 'string' ? body : JSON.stringify(body),
    signature
  );
  
  return res.json({ 
    isValid,
    webhookSecret: env.razorpay?.webhookSecret ? `${env.razorpay?.webhookSecret.substring(0, 10)}...` : 'NOT SET'
  });
});

// Add a simple health check at the root of this router as well
router.get('/', (_req: Request, res: Response) => {
  res.json({ 
    status: 'ok', 
    message: 'Webhook router is active',
    timestamp: new Date().toISOString()
  });
});

// Simple in-memory store for processed event IDs (for idempotency)
// In production, this should be stored in a database
const processedEvents = new Set<string>();
const EVENT_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Add debugging for processed events
console.log('Intialized processedEvents set for webhook deduplication');

// Clean up old events periodically
setInterval(() => {
  // In a real implementation, we would clean up database entries
  // For this in-memory implementation, we'll just log the size
  console.log(`Currently tracking ${processedEvents.size} processed events`);
}, 60 * 60 * 1000); // Every hour

// Middleware to capture raw body for webhook signature verification
router.use('/razorpay', (req, _res, next) => {
  console.log('🔧 WEBHOOK RAW BODY CAPTURE MIDDLEWARE ACTIVATED');
  console.log('Content-Type:', req.headers['content-type']);
  console.log('Content-Length:', req.headers['content-length']);
  console.log('Method:', req.method);
  console.log('URL:', req.url);
  
  // Only capture raw body for JSON content type and POST requests
  if (req.method === 'POST' && req.headers['content-type'] === 'application/json') {
    console.log('Setting up raw body capture for JSON content');
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      console.log('Received chunk:', chunk.length, 'bytes');
    });
    req.on('end', () => {
      console.log('Raw body capture complete:', data.length, 'bytes');
      console.log('Raw body content:', data.substring(0, Math.min(200, data.length)) + (data.length > 200 ? '...' : ''));
      // @ts-ignore - Adding rawBody property to request
      req.rawBody = data;
      next();
    });
  } else {
    console.log('Skipping raw body capture, method:', req.method, 'content-type:', req.headers['content-type']);
    next();
  }
});

// Add a debug endpoint to check webhook configuration
router.get('/razorpay/debug', (_req: Request, res: Response) => {
  console.log('=== WEBHOOK DEBUG ENDPOINT CALLED ===');
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const configWebhookSecret = require('../config/environment.config').env.razorpay?.webhookSecret;
  
  res.json({ 
    status: 'ok', 
    message: 'Webhook debug endpoint',
    timestamp: new Date().toISOString(),
    webhookUrl: `${process.env.FRONTEND_URL || 'http://localhost:5000'}/api/webhook/razorpay`,
    environment: {
      RAZORPAY_WEBHOOK_SECRET: webhookSecret ? `${webhookSecret.substring(0, 5)}...` : 'NOT SET',
      CONFIG_WEBHOOK_SECRET: configWebhookSecret ? `${configWebhookSecret.substring(0, 5)}...` : 'NOT SET',
      secretsMatch: webhookSecret === configWebhookSecret,
      webhookSecretLength: webhookSecret ? webhookSecret.length : 0
    }
  });
});

// Razorpay webhook endpoint
router.post('/razorpay', 
  asyncHandler(async (req: Request, res: Response) => {
    console.log('=== 🔴 CRITICAL: RAZORPAY WEBHOOK REQUEST RECEIVED ===');
    console.log('🚨 TIMESTAMP:', new Date().toISOString());
    console.log('🚨 METHOD:', req.method);
    console.log('🚨 URL:', req.url);
    console.log('🚨 HEADERS:', JSON.stringify(req.headers, null, 2));
    console.log('🚨 BODY TYPE:', typeof req.body);
    console.log('🚨 HAS BODY:', !!req.body);
    
    // @ts-ignore - Accessing rawBody property
    const rawBody = req.rawBody;
    console.log('🚨 RAW BODY AVAILABLE:', !!rawBody);
    if (rawBody) {
      console.log('🚨 RAW BODY LENGTH:', rawBody.length);
      console.log('🚨 RAW BODY PREVIEW:', rawBody.substring(0, Math.min(200, rawBody.length)) + (rawBody.length > 200 ? '...' : ''));
    }
    
    if (req.body) {
      console.log('🚨 BODY KEYS:', Object.keys(req.body));
      try {
        console.log('🚨 BODY PREVIEW:', JSON.stringify(req.body, null, 2).substring(0, 200) + '...');
      } catch (e) {
        console.log('🚨 BODY PREVIEW ERROR:', e);
      }
    }
    
    const signature = req.headers['x-razorpay-signature'] as string;
    console.log('🚨 SIGNATURE:', signature ? `${signature.substring(0, 20)}...` : 'NONE');
    
    // CRITICAL: If we don't have a signature, this is NOT a Razorpay webhook
    if (!signature) {
      console.log('⚠️ This request is NOT a Razorpay webhook - no signature found');
      console.log('⚠️ This might be a health check or other request to the webhook endpoint');
      
      // Return success for health checks
      if (req.body && req.body.event === 'health.check') {
        console.log('Health check request - returning success');
        res.json({ status: 'ok' });
        return;
      }
      
      // For other non-webhook requests, return 404
      res.status(404).json({ error: 'Not a Razorpay webhook' });
      return;
    }

    // Log incoming webhook for debugging
    console.log('🚨 RECEIVED RAZORPAY WEBHOOK:', {
      signature: signature ? `${signature.substring(0, 20)}...` : 'NONE',
      hasBody: !!req.body,
      hasRawBody: !!rawBody,
      eventType: req.body?.event,
      eventId: req.body?.payload?.payment?.entity?.id || req.body?.payload?.refund?.entity?.id || 'unknown',
      timestamp: new Date().toISOString()
    });

    // Verify webhook signature using raw body
    const bodyToVerify = rawBody || (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
    console.log('🔐 WEBHOOK SIGNATURE VERIFICATION DATA:', {
      usingRawBody: !!rawBody,
      usingReqBody: !rawBody && !!req.body,
      bodyLength: bodyToVerify.length,
      bodyPreview: bodyToVerify.substring(0, Math.min(100, bodyToVerify.length)) + (bodyToVerify.length > 100 ? '...' : '')
    });
    
    const isValid = verifyWebhookSignature(
      bodyToVerify,
      signature
    );

    if (!isValid) {
      console.error('❌ CRITICAL ERROR: Invalid webhook signature');
      console.error('This will cause auto-refunds! Possible causes:');
      console.error('1. Webhook secret mismatch between app and Razorpay dashboard');
      console.error('2. Raw body parsing issue');
      console.error('3. Network corruption');
      console.error('Received data:', {
        signature: signature ? `${signature.substring(0, 20)}...` : 'NONE',
        bodyPreview: bodyToVerify.substring(0, Math.min(100, bodyToVerify.length)) + (bodyToVerify.length > 100 ? '...' : '')
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
        console.log('💾 Saved failed webhook event to database');
      } catch (error) {
        console.error('❌ Failed to save failed webhook event:', error);
      }
      
      res.status(400).json({ error: 'Invalid signature' });
      return;
    }

    console.log('✅ WEBHOOK SIGNATURE VERIFIED SUCCESSFULLY');

    // Parse the raw body to JSON if we're using it
    let parsedBody = req.body;
    if (rawBody) {
      try {
        console.log('🔄 Parsing raw body to JSON');
        parsedBody = JSON.parse(rawBody);
        console.log('✅ Raw body parsed successfully');
      } catch (parseError) {
        console.error('❌ Failed to parse raw body:', parseError);
        console.error('Falling back to req.body');
        // Fall back to req.body if parsing fails
        parsedBody = req.body;
      }
    }

    const { event, payload } = parsedBody;
    console.log('📄 WEBHOOK EVENT DETAILS:', {
      event,
      hasPayload: !!payload,
      payloadKeys: payload ? Object.keys(payload) : []
    });
    
    // Extract event ID for idempotency
    const eventId = payload?.payment?.entity?.id || payload?.refund?.entity?.id || 'unknown';
    console.log('🆔 EVENT ID FOR IDEMPOTENCY:', eventId);
    
    // Check if event has already been processed (idempotency)
    if (processedEvents.has(eventId)) {
      console.log(`🔄 DUPLICATE EVENT RECEIVED AND IGNORED: ${eventId}`);
      
      // Save duplicate event to database
      try {
        await RazorpayEvent.create({
          eventId,
          eventType: event,
          payload: parsedBody,
          signature,
          status: 'duplicate',
          errorMessage: 'Duplicate event'
        });
        console.log('💾 Saved duplicate webhook event to database');
      } catch (error) {
        console.error('❌ Failed to save duplicate webhook event:', error);
      }
      
      res.json({ status: 'ok', message: 'Event already processed' });
      return;
    }

    // Log request ID and event ID for debugging (without secrets)
    const requestId = req.headers['x-request-id'] as string || 'unknown';
    console.log(`🔄 PROCESSING WEBHOOK EVENT - Request ID: ${requestId}, Event ID: ${eventId}, Event: ${event}`);

    // Save event to database
    let razorpayEvent: any = null;
    try {
      const eventData: any = {
        eventId,
        eventType: event,
        payload: parsedBody,
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
        console.log('💳 PAYMENT ENTITY DATA:', {
          orderId: payment.order_id,
          paymentId: payment.id,
          amount: payment.amount,
          currency: payment.currency,
          email: payment.email,
          contact: payment.contact,
          method: payment.method
        });
      } else if (payload?.refund?.entity) {
        const refund = payload.refund.entity;
        eventData.refundId = refund.id;
        eventData.paymentId = refund.payment_id;
        eventData.amount = refund.amount;
        eventData.currency = refund.currency;
        console.log('💸 REFUND ENTITY DATA:', {
          refundId: refund.id,
          paymentId: refund.payment_id,
          amount: refund.amount,
          currency: refund.currency
        });
      }
      
      razorpayEvent = await RazorpayEvent.create(eventData);
      console.log('💾 SAVED WEBHOOK EVENT TO DATABASE:', razorpayEvent._id);
    } catch (error) {
      console.error('❌ FAILED TO SAVE WEBHOOK EVENT TO DATABASE:', error);
    }

    switch (event) {
      case 'payment.captured':
        console.log('💰 PROCESSING PAYMENT.CAPTURED EVENT');
        console.log('Payment details:', {
          paymentId: payload.payment.entity.id,
          orderId: payload.payment.entity.order_id,
          amount: payload.payment.entity.amount
        });
        await handlePaymentCaptured(payload.payment.entity, razorpayEvent ? razorpayEvent._id.toString() : undefined);
        break;
      
      case 'payment.failed':
        console.log('❌ PROCESSING PAYMENT.FAILED EVENT');
        console.log('Payment failure details:', {
          paymentId: payload.payment.entity.id,
          orderId: payload.payment.entity.order_id,
          errorCode: payload.payment.entity.error_code,
          errorDescription: payload.payment.entity.error_description
        });
        await handlePaymentFailed(payload.payment.entity, razorpayEvent ? razorpayEvent._id.toString() : undefined);
        break;
      
      case 'refund.created':
        console.log('🚨 PROCESSING REFUND.CREATED EVENT - AUTO REFUND DETECTED');
        console.log('Refund details:', {
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
        console.log('Full event data:', JSON.stringify(parsedBody, null, 2));
        
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
      console.log(`🧹 Cleaned up processed event ${eventId} from memory cache`);
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
    console.log('=== 💳 CRITICAL: HANDLING PAYMENT CAPTURED EVENT 💳 ===');
    console.log('Payment captured details:', {
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

    console.log('🔍 SEARCHING FOR ORDER WITH RAZORPAY ORDER ID:', payment.order_id);
    const order = await Order.findOne({ 
      razorpayOrderId: payment.order_id 
    }).populate('items.product');

    if (!order) {
      console.error('🚨 CRITICAL ERROR: ORDER NOT FOUND FOR PAYMENT');
      console.error('This is causing auto-refunds! Order must exist for payment to be confirmed.');
      console.error('Payment details:', {
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
          console.log('💾 Updated webhook event status to failed: Order not found');
        } catch (error) {
          console.error('❌ Failed to update webhook event status:', error);
        }
      }
      
      return;
    }

    console.log('✅ FOUND ORDER FOR PAYMENT:', {
      orderId: order._id,
      orderNumber: order.orderNumber,
      currentStatus: order.paymentStatus,
      razorpayOrderId: order.razorpayOrderId
    });

    // Check if order is already completed to prevent duplicate processing
    if (order.paymentStatus === 'completed') {
      console.log('⚠️ ORDER ALREADY COMPLETED, SKIPPING PROCESSING');
      if (eventId) {
        try {
          await RazorpayEvent.findByIdAndUpdate(eventId, {
            status: 'processed',
            errorMessage: 'Order already completed'
          });
          console.log('💾 Updated webhook event status to processed: Order already completed');
        } catch (error) {
          console.error('❌ Failed to update webhook event status:', error);
        }
      }
      return;
    }

    // Update order status
    console.log('🔄 UPDATING ORDER STATUS TO COMPLETED');
    order.paymentStatus = 'completed';
    order.razorpayPaymentId = payment.id;
    await order.save();
    console.log('✅ UPDATED ORDER STATUS TO COMPLETED');

    // Update product sales count (both total and real)
    console.log('🔄 UPDATING PRODUCT SALES COUNT FOR', order.items.length, 'ITEMS');
    for (const item of order.items) {
      console.log('Updating product sales count:', {
        productId: item.product,
        quantity: item.quantity
      });
      
      try {
        await Product.findByIdAndUpdate(item.product, {
          $inc: { 
            salesCount: item.quantity,
            realSalesCount: item.quantity // Increment real sales for actual orders
          }
        });
        console.log('✅ Updated product sales count for product:', item.product);
      } catch (error) {
        console.error('❌ Failed to update product sales count:', error);
      }
    }

    // Send confirmation email
    try {
      console.log('📧 SENDING ORDER CONFIRMATION EMAIL');
      const products = order.items.map((item: any) => ({
        name: item.name,
        price: item.price
      }));

      const firstProduct = await Product.findById(order.items[0].product);
      if (firstProduct) {
        
        const customerEmail = payment.email || order.guestEmail;
        const customerName = order.guestName || 'Customer';

        console.log('Email details:', {
          to: customerEmail,
          orderNumber: order.orderNumber,
          productCount: order.items.length
        });

        if (customerEmail) {
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
          
          console.log('📧 ORDER CONFIRMATION EMAIL SENT SUCCESSFULLY');
        } else {
          console.warn('⚠️ NO CUSTOMER EMAIL FOUND, SKIPPING EMAIL SEND');
        }
      } else {
        console.warn('⚠️ NO PRODUCT FOUND FOR ORDER ITEM, SKIPPING EMAIL SEND');
      }
    } catch (error) {
      console.error('❌ FAILED TO SEND CONFIRMATION EMAIL:', error);
    }
    
    // Update event status if it exists
    if (eventId) {
      try {
        await RazorpayEvent.findByIdAndUpdate(eventId, {
          status: 'processed'
        });
        console.log('💾 UPDATED WEBHOOK EVENT STATUS TO PROCESSED');
      } catch (error) {
        console.error('❌ Failed to update webhook event status:', error);
      }
    }
    
    console.log('=== 🎉 PAYMENT CAPTURED HANDLING COMPLETE ===');
  } catch (error) {
    console.error('🚨 CRITICAL ERROR: FAILED TO HANDLE PAYMENT CAPTURED EVENT', error);
    
    // Update event status if it exists
    if (eventId) {
      try {
        await RazorpayEvent.findByIdAndUpdate(eventId, {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Unknown error'
        });
        console.log('💾 Updated webhook event status to failed due to error');
      } catch (updateError) {
        console.error('❌ Failed to update webhook event status:', updateError);
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