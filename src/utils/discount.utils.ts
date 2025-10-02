import { User } from '../models/User.model';
import { Order } from '../models/Order.model';

export const FIRST_TIME_DISCOUNT_PERCENTAGE = 10;

export const calculateDiscount = (originalPrice: number, discountPercentage: number): number => {
  return originalPrice * (discountPercentage / 100);
};

export const applyDiscount = (originalPrice: number, discountPercentage: number): number => {
  const discountAmount = calculateDiscount(originalPrice, discountPercentage);
  return originalPrice - discountAmount;
};

export const checkFirstTimeDiscount = async (userId?: string, guestEmail?: string) => {
  if (!userId && !guestEmail) {
    return { eligible: false, reason: 'No user identification' };
  }

  // For registered users
  if (userId) {
    const user = await User.findById(userId);
    if (!user) {
      return { eligible: false, reason: 'User not found' };
    }

    // Check if user has already used first-time discount
    if (user.hasUsedFirstTimeDiscount) {
      return { eligible: false, reason: 'First-time discount already used' };
    }

    // Check if user has any completed orders
    const orderCount = await Order.countDocuments({ 
      user: userId, 
      paymentStatus: 'completed' 
    });

    if (orderCount > 0) {
      return { eligible: false, reason: 'User has previous orders' };
    }

    return { 
      eligible: true, 
      discountPercentage: FIRST_TIME_DISCOUNT_PERCENTAGE,
      message: `Get ${FIRST_TIME_DISCOUNT_PERCENTAGE}% off on your first order!`
    };
  }

  // For guest users
  if (guestEmail) {
    // Check if guest has any completed orders
    const orderCount = await Order.countDocuments({ 
      guestEmail, 
      paymentStatus: 'completed' 
    });

    if (orderCount > 0) {
      return { eligible: false, reason: 'Guest has previous orders' };
    }

    return { 
      eligible: true, 
      discountPercentage: FIRST_TIME_DISCOUNT_PERCENTAGE,
      message: `Sign up and get ${FIRST_TIME_DISCOUNT_PERCENTAGE}% off on your first order!`
    };
  }

  return { eligible: false, reason: 'Unknown error' };
};

export const applyFirstTimeDiscount = (subtotal: number, discountPercentage: number = FIRST_TIME_DISCOUNT_PERCENTAGE) => {
  const discountAmount = calculateDiscount(subtotal, discountPercentage);
  const finalAmount = subtotal - discountAmount;
  
  return {
    originalAmount: subtotal,
    discountPercentage,
    discountAmount: Math.round(discountAmount * 100) / 100,
    finalAmount: Math.round(finalAmount * 100) / 100
  };
};

export const markFirstTimeDiscountUsed = async (userId: string) => {
  await User.findByIdAndUpdate(userId, { 
    hasUsedFirstTimeDiscount: true,
    $inc: { totalOrders: 1 }
  });
};
