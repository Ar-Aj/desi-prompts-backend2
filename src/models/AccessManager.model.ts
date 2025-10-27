import mongoose, { Document, Schema } from 'mongoose';

export interface IAccessLog extends Document {
  orderId: mongoose.Types.ObjectId;
  productId: mongoose.Types.ObjectId;
  userId?: mongoose.Types.ObjectId;
  guestEmail?: string;
  accessToken: string;
  ipAddress: string;
  userAgent: string;
  accessGranted: boolean;
  failureReason?: string;
  pdfUrl?: string;
  accessTime: Date;
  expiryTime: Date;
}

const accessLogSchema = new Schema<IAccessLog>(
  {
    orderId: {
      type: Schema.Types.ObjectId,
      ref: 'Order',
      required: true
    },
    productId: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      required: true
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    guestEmail: {
      type: String,
      lowercase: true,
      trim: true
    },
    accessToken: {
      type: String,
      required: true
    },
    ipAddress: {
      type: String,
      required: true
    },
    userAgent: {
      type: String,
      required: true
    },
    accessGranted: {
      type: Boolean,
      required: true,
      default: false
    },
    failureReason: {
      type: String
    },
    pdfUrl: {
      type: String
    },
    accessTime: {
      type: Date,
      default: Date.now
    },
    expiryTime: {
      type: Date,
      required: true
    }
  },
  {
    timestamps: true
  }
);

// Indexes for better query performance
accessLogSchema.index({ orderId: 1 });
accessLogSchema.index({ productId: 1 });
accessLogSchema.index({ userId: 1 });
accessLogSchema.index({ accessToken: 1 });
accessLogSchema.index({ accessTime: -1 });
accessLogSchema.index({ accessGranted: 1 });

export const AccessLog = mongoose.model<IAccessLog>('AccessLog', accessLogSchema);