import mongoose, { Document, Schema } from 'mongoose';

export interface IRazorpayEvent extends Document {
  eventId: string;
  eventType: string;
  payload: any;
  processedAt: Date;
  signature: string;
  status: 'processed' | 'failed' | 'duplicate';
  errorMessage?: string;
  orderId?: string;
  paymentId?: string;
  refundId?: string;
  amount?: number;
  currency?: string;
  email?: string;
  contact?: string;
  method?: string;
  createdAt: Date;
  updatedAt: Date;
}

const razorpayEventSchema: Schema = new Schema({
  eventId: { type: String, required: true, unique: true },
  eventType: { type: String, required: true },
  payload: { type: Schema.Types.Mixed, required: true },
  processedAt: { type: Date, default: Date.now },
  signature: { type: String, required: true },
  status: { 
    type: String, 
    enum: ['processed', 'failed', 'duplicate'],
    default: 'processed'
  },
  errorMessage: { type: String },
  orderId: { type: String },
  paymentId: { type: String },
  refundId: { type: String },
  amount: { type: Number },
  currency: { type: String },
  email: { type: String },
  contact: { type: String },
  method: { type: String },
}, {
  timestamps: true
});

// Index for faster queries
razorpayEventSchema.index({ eventId: 1 });
razorpayEventSchema.index({ eventType: 1 });
razorpayEventSchema.index({ processedAt: -1 });
razorpayEventSchema.index({ paymentId: 1 });
razorpayEventSchema.index({ orderId: 1 });

export const RazorpayEvent = mongoose.model<IRazorpayEvent>('RazorpayEvent', razorpayEventSchema);