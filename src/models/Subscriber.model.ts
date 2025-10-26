import mongoose, { Document, Schema } from 'mongoose';

export interface ISubscriber extends Document {
  email: string;
  source: 'blog' | 'newsletter' | 'landing_page' | 'other';
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
  updatedAt: Date;
}

const subscriberSchema = new Schema<ISubscriber>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email']
    },
    source: {
      type: String,
      enum: ['blog', 'newsletter', 'landing_page', 'other'],
      default: 'other'
    },
    ipAddress: {
      type: String
    },
    userAgent: {
      type: String
    }
  },
  {
    timestamps: true
  }
);

// Add indexes for better query performance (email index is automatically created by unique: true)
subscriberSchema.index({ source: 1 });
subscriberSchema.index({ createdAt: -1 });

export const Subscriber = mongoose.model<ISubscriber>('Subscriber', subscriberSchema);