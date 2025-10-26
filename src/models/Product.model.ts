import mongoose, { Document, Schema } from 'mongoose';

export interface IProduct extends Document {
  name: string;
  slug: string;
  description: string;
  detailedDescription: string;
  category: string;
  subcategory: 'image' | 'writing'; // New field for subcategories
  price: number;
  originalPrice: number;
  images: string[];
  features: string[];
  tags: string[];
  pdfUrl: string;
  pdfPassword: string;
  isActive: boolean;
  salesCount: number; // Total sales (real + fake)
  realSalesCount: number; // Only real customer sales
  averageRating: number;
  totalReviews: number;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

const productSchema = new Schema<IProduct>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200
    },
    slug: {
      type: String,
      lowercase: true,
      trim: true
    },
    description: {
      type: String,
      required: true,
      maxlength: 500
    },
    detailedDescription: {
      type: String,
      required: true
    },
    price: {
      type: Number,
      required: true,
      min: 0
    },
    originalPrice: {
      type: Number,
      min: 0
    },
    images: [{
      type: String,
      required: true
    }],
    features: [{
      type: String
    }],
    category: {
      type: String,
      required: true
    },
    subcategory: {
      type: String,
      enum: ['image', 'writing'],
      required: true
    },
    tags: [{
      type: String,
      lowercase: true,
      trim: true
    }],
    pdfUrl: {
      type: String,
      required: true
    },
    pdfPassword: {
      type: String,
      required: true
    },
    isActive: {
      type: Boolean,
      default: true
    },
    salesCount: {
      type: Number,
      default: 0
    },
    realSalesCount: {
      type: Number,
      default: 0
    },
    averageRating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5
    },
    totalReviews: {
      type: Number,
      default: 0
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

// Create slug from name if not provided
productSchema.pre('save', function(next) {
  if (!this.slug && this.name) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
  next();
});

// Also handle updates
productSchema.pre(['updateOne', 'findOneAndUpdate'], function(next) {
  const update = this.getUpdate() as any;
  if (update.name && !update.slug) {
    update.slug = update.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
  next();
});

// Index for search and performance
productSchema.index({ slug: 1 }, { unique: true });
productSchema.index({ category: 1 });
productSchema.index({ subcategory: 1 });
productSchema.index({ tags: 1 });
productSchema.index({ isActive: 1, order: 1 });
productSchema.index({ createdAt: -1 });

export const Product = mongoose.model<IProduct>('Product', productSchema);