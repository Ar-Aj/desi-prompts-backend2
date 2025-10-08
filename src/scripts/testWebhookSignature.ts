import { verifyWebhookSignature } from '../utils/payment.utils';
import crypto from 'crypto';
import { env } from '../config/environment.config';

// Test data
const testBody = JSON.stringify({
  event: "payment.captured",
  payload: {
    payment: {
      entity: {
        id: "pay_test_id_12345",
        order_id: "order_test_id_67890",
        status: "captured",
        amount: 10000,
        currency: "INR"
      }
    }
  }
});

const testSecret = env.razorpay?.webhookSecret || "test_webhook_secret_12345";
const validSignature = crypto
  .createHmac('sha256', testSecret)
  .update(testBody)
  .digest('hex');

console.log("Testing Webhook Signature Verification");
console.log("=====================================");

console.log("Test Body:", testBody);
console.log("Test Secret:", testSecret);
console.log("Expected Signature:", validSignature);

// Test valid signature
console.log("\n1. Testing valid signature:");
const isValid = verifyWebhookSignature(testBody, validSignature);
console.log("Result:", isValid ? "PASS" : "FAIL");

// Test invalid signature
console.log("\n2. Testing invalid signature:");
const isInvalid = verifyWebhookSignature(testBody, "invalid_signature");
console.log("Result:", !isInvalid ? "PASS" : "FAIL");

// Test empty signature
console.log("\n3. Testing empty signature:");
const isEmpty = verifyWebhookSignature(testBody, "");
console.log("Result:", !isEmpty ? "PASS" : "FAIL");

// Test empty body
console.log("\n4. Testing empty body:");
const isEmptyBody = verifyWebhookSignature("", validSignature);
console.log("Result:", !isEmptyBody ? "PASS" : "FAIL");

console.log("\nWebhook signature verification tests completed.");