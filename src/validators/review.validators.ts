import { z } from 'zod';

export const createReviewSchema = z.object({
  productId: z.string(),
  orderId: z.string(),
  rating: z.number().min(1).max(5),
  title: z.string().min(3).max(100),
  comment: z.string().min(10).max(1000)
});

export const updateReviewSchema = z.object({
  rating: z.number().min(1).max(5).optional(),
  title: z.string().min(3).max(100).optional(),
  comment: z.string().min(10).max(1000).optional()
});
