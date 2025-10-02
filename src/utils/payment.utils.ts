import Razorpay from 'razorpay';
import crypto from 'crypto';
import { env } from '../config/environment.config';

// Initialize Razorpay only if keys are provided
let razorpay: Razorpay | null = null;

if (env.razorpay?.keyId && env.razorpay?.keySecret) {
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
    const body = orderId + '|' + paymentId;
    const expectedSignature = crypto
      .createHmac('sha256', env.razorpay?.keySecret!)
      .update(body.toString())
      .digest('hex');

    return expectedSignature === signature;
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
    const expectedSignature = crypto
      .createHmac('sha256', env.razorpay?.webhookSecret!)
      .update(body)
      .digest('hex');

    return expectedSignature === signature;
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
    const payment = await razorpay.payments.fetch(paymentId);
    return payment;
  } catch (error) {
    console.error('Error fetching payment details:', error);
    throw new Error('Failed to fetch payment details');
  }
};
