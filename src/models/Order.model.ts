import mongoose, { Document, Schema } from 'mongoose';

export interface IOrderItem {
  product: mongoose.Types.ObjectId;
  name: string;
  price: number;
  quantity: number;
}

export interface IOrder extends Document {
  orderNumber: string;
  purchaseId: string; // Easy-to-remember ID for customer reference
  user?: mongoose.Types.ObjectId;
  guestEmail?: string;
  guestName?: string;
  items: IOrderItem[];
  totalAmount: number;
  paymentStatus: 'pending' | 'processing' | 'completed' | 'failed' | 'refunded';
  paymentMethod: string;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  razorpaySignature?: string;
  pdfDelivered: boolean;
  pdfDeliveredAt?: Date;
  emailSent: boolean;
  emailSentAt?: Date;
  isFakeOrder: boolean; // New field to mark fake orders
  fakeCustomerName?: string; // Name for fake customer
  createdAt: Date;
  updatedAt: Date;
}

const orderItemSchema = new Schema<IOrderItem>({
  product: {
    type: Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  name: {
    type: String,
    required: true
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  quantity: {
    type: Number,
    required: true,
    min: 1,
    default: 1
  }
});

const orderSchema = new Schema<IOrder>(
  {
    orderNumber: {
      type: String
    },
    purchaseId: {
      type: String
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    guestEmail: {
      type: String,
      lowercase: true,
      trim: true
    },
    guestName: {
      type: String,
      trim: true
    },
    items: [orderItemSchema],
    totalAmount: {
      type: Number,
      required: true,
      min: 0
    },
    paymentStatus: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed', 'refunded'],
      default: 'pending'
    },
    paymentMethod: {
      type: String,
      default: 'razorpay'
    },
    razorpayOrderId: String,
    razorpayPaymentId: String,
    razorpaySignature: String,
    pdfDelivered: {
      type: Boolean,
      default: false
    },
    pdfDeliveredAt: Date,
    emailSent: {
      type: Boolean,
      default: false
    },
    emailSentAt: Date,
    isFakeOrder: {
      type: Boolean,
      default: false
    },
    fakeCustomerName: {
      type: String,
      trim: true
    }
  },
  {
    timestamps: true
  }
);

// Generate order number and purchase ID
orderSchema.pre('validate', function(next) {
  if (!this.orderNumber) {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    this.orderNumber = `ORD-${timestamp}-${random}`;
  }
  
  if (!this.purchaseId) {
    // Generate easy-to-remember purchase ID (8 characters)
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let purchaseId = '';
    for (let i = 0; i < 8; i++) {
      purchaseId += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    // Format as XXXX-XXXX for easier reading
    this.purchaseId = `${purchaseId.substring(0, 4)}-${purchaseId.substring(4, 8)}`;
  }
  
  next();
});

// Validate that required fields are present
orderSchema.pre('validate', function(next) {
  if (!this.orderNumber) {
    next(new Error('Order number is required'));
    return;
  }
  
  if (!this.purchaseId) {
    next(new Error('Purchase ID is required'));
    return;
  }
  
  if (!this.user && (!this.guestEmail || !this.guestName)) {
    next(new Error('Either user or guest details must be provided'));
    return;
  }
  
  next();
});

// Indexes
orderSchema.index({ orderNumber: 1 }, { unique: true });
orderSchema.index({ purchaseId: 1 }, { unique: true });
orderSchema.index({ user: 1 });
orderSchema.index({ guestEmail: 1 });
orderSchema.index({ paymentStatus: 1 });
orderSchema.index({ createdAt: -1 });

export const Order = mongoose.model<IOrder>('Order', orderSchema);
