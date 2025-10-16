import { Router, Request, Response } from 'express';
import { Product } from '../models/Product.model';
import { Demo } from '../models/Demo.model';
import { asyncHandler } from '../middleware/error.middleware';
import { authenticate, authorizeAdmin } from '../middleware/auth.middleware';
import { env } from '../config/environment.config';

const router: Router = Router();

// Get all products (public)
router.get('/', asyncHandler(async (_req: Request, res: Response) => {
  const {
    category,
    search,
    minPrice,
    maxPrice,
    page = 1,
    limit = 12
  } = _req.query;

  const query: any = { isActive: true };

  // Filters
  if (category) query.category = category;
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
      { tags: { $in: [new RegExp(search as string, 'i')] } }
    ];
  }
  if (minPrice || maxPrice) {
    query.price = {};
    if (minPrice) query.price.$gte = Number(minPrice);
    if (maxPrice) query.price.$lte = Number(maxPrice);
  }

  const skip = (Number(page) - 1) * Number(limit);

  const [products, total] = await Promise.all([
    Product.find(query)
      .sort({ order: 1, createdAt: -1 }) // Sort by order first, then by creation date
      .skip(skip)
      .limit(Number(limit))
      .select('-pdfUrl -pdfPassword'),
    Product.countDocuments(query)
  ]);

  // Process image URLs for both local and S3 storage
  const isProduction = env.mode === 'production';
  const processedProducts = products.map(product => {
    const productObj = product.toObject();
    
    if (isProduction) {
      // For production, convert S3 keys to full URLs
      const processedImages = productObj.images.map(imageKey => {
        // If it's already a full URL, return as is
        if (imageKey.startsWith('http')) {
          return imageKey;
        }
        // Otherwise, construct the full S3 URL
        return `${env.s3.endpoint}/${env.s3.bucketName}/${imageKey}`;
      });
      
      return {
        ...productObj,
        images: processedImages
      };
    }
    // For development, URLs are already full URLs
    return productObj;
  });

  res.json({
    success: true,
    products: processedProducts,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      total,
      pages: Math.ceil(total / Number(limit))
    }
  });
}));

// Get all active demos (public) - Must be before /:slug route
router.get('/demos', asyncHandler(async (_req: Request, res: Response) => {
  const demos = await Demo.find({ isActive: true })
    .populate('product', 'name category price slug images description')
    .sort({ order: 1, createdAt: -1 });

  res.json({
    success: true,
    demos
  });
}));

// Get single product (public)
router.get('/:slug', asyncHandler(async (req: Request, res: Response) => {
  const product = await Product.findOne({ 
    slug: req.params.slug,
    isActive: true 
  }).select('-pdfUrl -pdfPassword');

  if (!product) {
    res.status(404).json({ error: 'Product not found' });
    return;
  }

  // Process image URLs for both local and S3 storage
  const isProduction = env.mode === 'production';
  const productObj = product.toObject();
  
  if (isProduction) {
    // For production, convert S3 keys to full URLs
    const processedImages = productObj.images.map(imageKey => {
      // If it's already a full URL, return as is
      if (imageKey.startsWith('http')) {
        return imageKey;
      }
      // Otherwise, construct the full S3 URL
      return `${env.s3.endpoint}/${env.s3.bucketName}/${imageKey}`;
    });
    
    const processedProduct = {
      ...productObj,
      images: processedImages
    };
    
    res.json({
      success: true,
      product: processedProduct
    });
  } else {
    // For development, URLs are already full URLs
    res.json({
      success: true,
      product: productObj
    });
  }
}));

// Create product (admin only)
router.post('/', authenticate, authorizeAdmin, asyncHandler(async (req: Request, res: Response) => {
  const product = new Product(req.body);
  await product.save();

  res.status(201).json({
    success: true,
    product
  });
}));

// Update product (admin only)
router.put('/:id', authenticate, authorizeAdmin, asyncHandler(async (req: Request, res: Response) => {
  const product = await Product.findByIdAndUpdate(
    req.params.id,
    req.body,
    { new: true, runValidators: true }
  );

  if (!product) {
    res.status(404).json({ error: 'Product not found' });
    return;
  }

  res.json({
    success: true,
    product
  });
}));

// Delete product (admin only)
router.delete('/:id', authenticate, authorizeAdmin, asyncHandler(async (req: Request, res: Response) => {
  const product = await Product.findByIdAndUpdate(
    req.params.id,
    { isActive: false },
    { new: true }
  );

  if (!product) {
    res.status(404).json({ error: 'Product not found' });
    return;
  }

  res.json({
    success: true,
    message: 'Product deactivated successfully'
  });
}));

// Get featured products
router.get('/featured/list', asyncHandler(async (_req: Request, res: Response) => {
  const products = await Product.find({ isActive: true })
    .sort({ salesCount: -1, averageRating: -1 })
    .limit(8)
    .select('-pdfUrl -pdfPassword');

  res.json({
    success: true,
    products
  });
}));

// Get product categories
router.get('/categories/list', asyncHandler(async (_req: Request, res: Response) => {
  const categories = await Product.distinct('category', { isActive: true });

  res.json({
    success: true,
    categories
  });
}));

// Get all products for admin (with order management)
router.get('/admin/all', authenticate, authorizeAdmin, asyncHandler(async (_req: Request, res: Response) => {
  const products = await Product.find({})
    .sort({ order: 1, createdAt: -1 })
    .select('name description price originalPrice category isActive salesCount averageRating order createdAt');

  res.json({
    success: true,
    products
  });
}));

// Update multiple product orders
router.put('/admin/reorder', authenticate, authorizeAdmin, asyncHandler(async (req: Request, res: Response) => {
  const { products } = req.body; // Array of { id, order }
  
  const updatePromises = products.map((product: any) => 
    Product.findByIdAndUpdate(
      product.id,
      { order: product.order },
      { new: true }
    )
  );
  
  await Promise.all(updatePromises);
  
  res.json({
    success: true,
    message: 'Product order updated successfully'
  });
}));

export default router;