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
    console.log('Verifying Razorpay signature for payment verification:', {
      hasKeyId: !!env.razorpay?.keyId,
      hasKeySecret: !!env.razorpay?.keySecret,
      orderIdLength: orderId?.length || 0,
      paymentIdLength: paymentId?.length || 0,
      signatureLength: signature?.length || 0
    });
    
    // Check if required environment variables are present
    if (!env.razorpay?.keySecret) {
      console.error('Razorpay key secret not configured');
      return false;
    }
    
    if (!orderId || !paymentId || !signature) {
      console.error('Missing required parameters for signature verification');
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
    console.log('Verifying webhook signature:', {
      hasWebhookSecret: !!env.razorpay?.webhookSecret,
      webhookSecretLength: env.razorpay?.webhookSecret?.length || 0,
      hasBody: !!body,
      bodyLength: body?.length || 0,
      hasSignature: !!signature,
      signatureLength: signature?.length || 0
    });
    
    // Check if required environment variables are present
    if (!env.razorpay?.webhookSecret) {
      console.error('Razorpay webhook secret not configured');
      return false;
    }
    
    if (!body || !signature) {
      console.error('Missing body or signature for webhook verification');
      return false;
    }
    
    const expectedSignature = crypto
      .createHmac('sha256', env.razorpay.webhookSecret)
      .update(body)
      .digest('hex');

    const isValid = expectedSignature === signature;
    
    console.log('Webhook signature verification result:', {
      expectedSignature: expectedSignature.substring(0, 10) + '...',
      receivedSignature: signature.substring(0, 10) + '...',
      isValid
    });

    return isValid;
  } catch (error) {
    console.error('Webhook signature verification error:', error);
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