import mongoose, { Document, Schema } from 'mongoose';
import * as bcrypt from 'bcryptjs';

export interface IUser extends Document {
  customerId?: string; // Unique customer ID for ML/data processing
  googleId?: string; // Google OAuth ID
  name: string;
  email: string;
  password: string;
  role: 'customer' | 'admin';
  isVerified: boolean;
  hasUsedFirstTimeDiscount: boolean;
  totalOrders: number;
  totalSpent: number; // Total amount spent by customer
  firstPurchaseDate?: Date; // Date of first purchase
  lastPurchaseDate?: Date; // Date of last purchase
  averageOrderValue: number; // Average order value
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
}

const userSchema = new Schema<IUser>(
  {
    customerId: {
      type: String,
      unique: true,
      required: true
    },
    googleId: {
      type: String,
      unique: true,
      sparse: true // Allows multiple null values
    },
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 100
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email']
    },
    password: {
      type: String,
      required: true,
      minlength: 6
    },
    role: {
      type: String,
      enum: ['customer', 'admin'],
      default: 'customer'
    },
    isVerified: {
      type: Boolean,
      default: false
    },
    hasUsedFirstTimeDiscount: {
      type: Boolean,
      default: false
    },
    totalOrders: {
      type: Number,
      default: 0
    },
    totalSpent: {
      type: Number,
      default: 0
    },
    firstPurchaseDate: {
      type: Date
    },
    lastPurchaseDate: {
      type: Date
    },
    averageOrderValue: {
      type: Number,
      default: 0
    }
  },
  {
    timestamps: true
  }
);

// Generate unique customer ID before validation
userSchema.pre('validate', function(next) {
  // Generate customer ID for new users
  if (this.isNew && !this.customerId) {
    const timestamp = Date.now().toString(36);
    const randomStr = Math.random().toString(36).substring(2, 8);
    this.customerId = `CUST_${timestamp}_${randomStr}`.toUpperCase();
  }
  next();
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  try {
    // Hash password if modified
    if (this.isModified('password')) {
      const salt = await bcrypt.genSalt(10);
      this.password = await bcrypt.hash(this.password, salt);
    }
    
    next();
  } catch (error: any) {
    next(error);
  }
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword: string): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};

// Remove password from JSON response
userSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

export const User = mongoose.model<IUser>('User', userSchema);
