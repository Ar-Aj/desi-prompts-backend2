import mongoose, { Document, Schema } from 'mongoose';

export interface IReview extends Document {
  product: mongoose.Types.ObjectId;
  user?: mongoose.Types.ObjectId;
  order?: mongoose.Types.ObjectId;
  guestName?: string;
  guestEmail?: string;
  rating: number;
  title: string;
  comment: string;
  isVerifiedPurchase: boolean;
  helpful: number; // Total helpful count (fake + real)
  notHelpful: number; // Total not helpful count (fake + real)
  fakeHelpful: number; // Admin-controlled fake helpful count
  fakeNotHelpful: number; // Admin-controlled fake not helpful count
  realHelpful: number; // Real user helpful count
  realNotHelpful: number; // Real user not helpful count
  helpfulVotes: mongoose.Types.ObjectId[]; // Track who voted helpful
  notHelpfulVotes: mongoose.Types.ObjectId[]; // Track who voted not helpful
  isActive: boolean;
  isFakeReview: boolean;
  fakeReviewerName?: string;
  createdAt: Date;
  updatedAt: Date;
}

const reviewSchema = new Schema<IReview>(
  {
    product: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      required: true
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    order: {
      type: Schema.Types.ObjectId,
      ref: 'Order'
    },
    guestName: {
      type: String,
      trim: true
    },
    guestEmail: {
      type: String,
      lowercase: true,
      trim: true
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100
    },
    comment: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000
    },
    isVerifiedPurchase: {
      type: Boolean,
      default: true
    },
    helpful: {
      type: Number,
      default: 0
    },
    notHelpful: {
      type: Number,
      default: 0
    },
    fakeHelpful: {
      type: Number,
      default: 0
    },
    fakeNotHelpful: {
      type: Number,
      default: 0
    },
    realHelpful: {
      type: Number,
      default: 0
    },
    realNotHelpful: {
      type: Number,
      default: 0
    },
    helpfulVotes: [{
      type: Schema.Types.ObjectId,
      ref: 'User'
    }],
    notHelpfulVotes: [{
      type: Schema.Types.ObjectId,
      ref: 'User'
    }],
    isActive: {
      type: Boolean,
      default: true
    },
    isFakeReview: {
      type: Boolean,
      default: false
    },
    fakeReviewerName: {
      type: String,
      trim: true
    }
  },
  {
    timestamps: true
  }
);

// Pre-save middleware to calculate total helpful counts
reviewSchema.pre('save', function(next) {
  // Calculate total helpful = fake + real
  this.helpful = this.fakeHelpful + this.realHelpful;
  this.notHelpful = this.fakeNotHelpful + this.realNotHelpful;
  next();
});

// Ensure one review per product per order (only for real reviews)
reviewSchema.index({ product: 1, order: 1 }, { 
  unique: true, 
  partialFilterExpression: { isFakeReview: false, order: { $exists: true } }
});
reviewSchema.index({ product: 1, rating: -1 });
reviewSchema.index({ product: 1, createdAt: -1 });
reviewSchema.index({ user: 1 });
reviewSchema.index({ guestEmail: 1 });

// Update product rating after saving review
reviewSchema.post('save', async function() {
  const Review = this.constructor as mongoose.Model<IReview>;
  const Product = mongoose.model('Product');
  
  const stats = await Review.aggregate([
    { $match: { product: this.product, isActive: true } },
    {
      $group: {
        _id: null,
        avgRating: { $avg: '$rating' },
        totalReviews: { $sum: 1 }
      }
    }
  ]);

  if (stats.length > 0) {
    await Product.findByIdAndUpdate(this.product, {
      averageRating: Math.round(stats[0].avgRating * 10) / 10,
      totalReviews: stats[0].totalReviews
    });
  }
});

export const Review = mongoose.model<IReview>('Review', reviewSchema);
