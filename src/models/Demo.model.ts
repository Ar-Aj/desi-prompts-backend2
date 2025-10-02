import mongoose, { Document, Schema } from 'mongoose';

export interface IDemo extends Document {
  title: string;
  description: string;
  product: mongoose.Types.ObjectId;
  beforeImage: string;
  afterImages: {
    image: string;
    promptName: string;
    promptDescription: string;
  }[]; // Array of objects with image and prompt info
  isActive: boolean;
  order: number; // For sorting demos
  createdAt: Date;
  updatedAt: Date;
}

const demoSchema = new Schema<IDemo>(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500
    },
    product: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      required: true
    },
    beforeImage: {
      type: String,
      required: true
    },
    afterImages: {
      type: [{
        image: {
          type: String,
          required: true
        },
        promptName: {
          type: String,
          required: true,
          trim: true
        },
        promptDescription: {
          type: String,
          required: true,
          trim: true
        }
      }],
      required: true,
      validate: {
        validator: function(v: any[]) {
          return v && v.length > 0;
        },
        message: 'At least one after image with prompt info is required'
      }
    },
    isActive: {
      type: Boolean,
      default: true
    },
    order: {
      type: Number,
      default: 0
    }
  },
  {
    timestamps: true
  }
);

// Index for efficient queries
demoSchema.index({ isActive: 1, order: 1 });
demoSchema.index({ product: 1 });

export const Demo = mongoose.model<IDemo>('Demo', demoSchema);
