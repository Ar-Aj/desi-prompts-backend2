// @ts-ignore
import Razorpay from 'razorpay';
import * as crypto from 'crypto';
import { env } from '../config/environment.config';

// Initialize Razorpay only if keys are provided
// @ts-ignore
let razorpay: any = null;

if (env.razorpay?.keyId && env.razorpay?.keySecret) {
  // @ts-ignore
  razorpay = new Razorpay({
    key_id: env.razorpay.keyId,
    key_secret: env.razorpay.keySecret
  });
} else {
  console.warn('Razorpay keys not configured. Payment functionality will be disabled.');
}

export const createRazorpayOrder = async (
  amount: number,
  currency: string = 'INR',
  receipt: string
) => {
  if (!razorpay) {
    throw new Error('Razorpay not configured. Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET');
  }

  try {
    const options = {
      amount: Math.round(amount * 100), // Amount in paise
      currency,
      receipt,
      payment_capture: 1 // Auto capture payment
    };

    // @ts-ignore
    const order = await razorpay.orders.create(options);
    return order;
  } catch (error) {
    console.error('Razorpay order creation error:', error);
    throw new Error('Failed to create payment order');
  }
};

export const verifyRazorpaySignature = (
  orderId: string,
  paymentId: string,
  signature: string
): boolean => {
  try {
    console.log('🔐 PAYMENT SIGNATURE VERIFICATION STARTED');
    console.log('Verification parameters:', {
      hasKeyId: !!env.razorpay?.keyId,
      hasKeySecret: !!env.razorpay?.keySecret,
      orderIdLength: orderId?.length || 0,
      paymentIdLength: paymentId?.length || 0,
      signatureLength: signature?.length || 0
    });
    
    // Check if required environment variables are present
    if (!env.razorpay?.keySecret) {
      console.error('❌ CRITICAL: Razorpay key secret not configured');
      return false;
    }
    
    if (!orderId || !paymentId || !signature) {
      console.error('❌ Missing required parameters for signature verification');
      return false;
    }
    
    const body = orderId + '|' + paymentId;
    const expectedSignature = crypto
      .createHmac('sha256', env.razorpay.keySecret)
      .update(body.toString())
      .digest('hex');

    const isValid = expectedSignature === signature;
    
    console.log('Payment signature verification result:', {
      expectedSignature: expectedSignature.substring(0, 10) + '...',
      receivedSignature: signature.substring(0, 10) + '...',
      isValid
    });

    if (!isValid) {
      console.error('❌ PAYMENT SIGNATURE VERIFICATION FAILED');
      console.error('Body used for verification:', body);
    } else {
      console.log('✅ PAYMENT SIGNATURE VERIFICATION SUCCESSFUL');
    }

    return isValid;
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
};

export const verifyWebhookSignature = (
  body: string,
  signature: string
): boolean => {
  try {
    console.log('🔐 WEBHOOK SIGNATURE VERIFICATION STARTED');
    console.log('Verification parameters:', {
      hasWebhookSecret: !!env.razorpay?.webhookSecret,
      webhookSecretConfigured: !!process.env.RAZORPAY_WEBHOOK_SECRET,
      envWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ? `${process.env.RAZORPAY_WEBHOOK_SECRET.substring(0, 10)}...` : 'NOT SET',
      configWebhookSecret: env.razorpay?.webhookSecret ? `${env.razorpay?.webhookSecret.substring(0, 10)}...` : 'NOT SET',
      webhookSecretLength: env.razorpay?.webhookSecret?.length || 0,
      hasBody: !!body,
      bodyLength: body?.length || 0,
      hasSignature: !!signature,
      signatureLength: signature?.length || 0
    });
    
    // Check if required environment variables are present
    if (!env.razorpay?.webhookSecret) {
      console.error('❌ CRITICAL: Razorpay webhook secret not configured - This will cause all webhooks to fail and trigger auto-refunds!');
      console.error('Please set RAZORPAY_WEBHOOK_SECRET in your environment variables');
      console.error('Current env values:', {
        RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET,
        envRazorpayWebhookSecret: env.razorpay?.webhookSecret
      });
      return false;
    }
    
    if (!body || !signature) {
      console.error('❌ Missing body or signature for webhook verification');
      return false;
    }
    
    // Ensure body is a string
    const bodyString = typeof body === 'string' ? body : JSON.stringify(body);
    console.log('Body for signature verification:', {
      originalType: typeof body,
      finalType: typeof bodyString,
      length: bodyString.length
    });
    
    console.log('Generating expected signature using webhook secret');
    const expectedSignature = crypto
      .createHmac('sha256', env.razorpay.webhookSecret)
      .update(bodyString)
      .digest('hex');

    const isValid = expectedSignature === signature;
    
    console.log('Webhook signature verification result:', {
      expectedSignature: expectedSignature.substring(0, 10) + '...',
      receivedSignature: signature.substring(0, 10) + '...',
      isValid
    });

    if (!isValid) {
      console.error('❌ WEBHOOK SIGNATURE VERIFICATION FAILED - This will cause auto-refunds!');
      console.error('Possible causes:');
      console.error('1. Webhook secret mismatch between your app and Razorpay dashboard');
      console.error('2. Body content mismatch (incorrect raw body parsing)');
      console.error('3. Network issues causing data corruption');
      console.error('Body length comparison:', {
        receivedBodyLength: bodyString.length,
        first100Chars: bodyString.substring(0, 100)
      });
      console.error('Secret comparison:', {
        expectedLength: expectedSignature.length,
        receivedLength: signature.length,
        expectedStart: expectedSignature.substring(0, 20),
        receivedStart: signature.substring(0, 20)
      });
      
      // Log detailed debugging information
      console.error('DETAILED DEBUGGING INFO:', {
        bodyString: bodyString.substring(0, Math.min(200, bodyString.length)) + (bodyString.length > 200 ? '...' : ''),
        bodyLength: bodyString.length,
        signature: signature,
        expectedSignature: expectedSignature
      });
    } else {
      console.log('✅ WEBHOOK SIGNATURE VERIFICATION SUCCESSFUL');
    }

    return isValid;
  } catch (error) {
    console.error('❌ WEBHOOK SIGNATURE VERIFICATION ERROR:', error);
    return false;
  }
};

export const fetchPaymentDetails = async (paymentId: string) => {
  if (!razorpay) {
    throw new Error('Razorpay not configured. Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET');
  }

  try {
    // @ts-ignore
    const payment = await razorpay.payments.fetch(paymentId);
    return payment;
  } catch (error) {
    console.error('Error fetching payment details:', error);
    throw new Error('Failed to fetch payment details');
  }
};