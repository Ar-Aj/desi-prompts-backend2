import { Router, Request, Response } from 'express';
import { Order } from '../models/Order.model';
import { Product } from '../models/Product.model';
import { asyncHandler } from '../middleware/error.middleware';
import { verifyWebhookSignature } from '../utils/payment.utils';
import { sendEmail, getOrderConfirmationEmail } from '../utils/email.utils';
import { getSignedDownloadUrl } from '../utils/storage.utils';

const router: Router = Router();

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
        const downloadLink = await getSignedDownloadUrl(firstProduct.pdfUrl);
        
        const customerEmail = payment.email || order.guestEmail;
        const customerName = order.guestName || 'Customer';

        await sendEmail({
          to: customerEmail,
          subject: `Order Confirmation - ${order.orderNumber}`,
          html: getOrderConfirmationEmail(
            customerName,
            order.orderNumber,
            (order._id as any).toString(),
            products,
            order.totalAmount,
            firstProduct.pdfPassword,
            downloadLink
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