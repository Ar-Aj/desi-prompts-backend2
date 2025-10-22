import { Router, Request, Response } from 'express';
import { Product } from '../models/Product.model';
import { Demo } from '../models/Demo.model';
import { asyncHandler } from '../middleware/error.middleware';
import { authenticate, authorizeAdmin } from '../middleware/auth.middleware';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { s3Client } from '../utils/storage.utils';
import { env } from '../config/environment.config';

const router: Router = Router();

// Get signed URL for S3 object (public endpoint)
router.get('/get-signed-url', asyncHandler(async (req: Request, res: Response) => {
  const { key } = req.query;
  
  if (!key || typeof key !== 'string') {
    res.status(400).json({
      success: false,
      error: 'Missing or invalid key parameter'
    });
    return;
  }

  try {
    // Import S3 utilities
    const { getSignedDownloadUrl } = require('../utils/storage.utils');
    
    // Generate signed URL
    const signedUrl = await getSignedDownloadUrl(key);
    
    res.json({
      success: true,
      signedUrl
    });
  } catch (error) {
    console.error('Error generating signed URL:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate signed URL'
    });
  }
}));

// Proxy endpoint to serve S3 files directly (to avoid CORS issues)
router.get('/proxy-s3/:key*', asyncHandler(async (req: Request, res: Response) => {
  const fullKey = req.params.key + (req.params[0] || '');
  
  console.log('S3 Proxy Request:', { fullKey, params: req.params, url: req.url });
  
  if (!fullKey) {
    console.log('Missing key parameter');
    res.status(400).json({
      success: false,
      error: 'Missing key parameter'
    });
    return;
  }

  // Handle files without folder prefixes by adding a default folder
  let processedKey = fullKey;
  if (!fullKey.includes('/') || fullKey.startsWith('/')) {
    // If the key doesn't have a folder prefix, add 'images/' prefix
    processedKey = fullKey.startsWith('/') ? `images${fullKey}` : `images/${fullKey}`;
    console.log('Processed key for file without folder prefix:', { original: fullKey, processed: processedKey });
  }
  
  try {
    // Get the object from S3
    const command = new GetObjectCommand({
      Bucket: env.s3.bucketName!,
      Key: processedKey
    });
    
    console.log('S3 GetObjectCommand:', { 
      bucket: env.s3.bucketName, 
      key: processedKey 
    });
    
    const s3Response = await s3Client.send(command);
    console.log('S3 Response received:', { 
      contentType: s3Response.ContentType,
      contentLength: s3Response.ContentLength,
      statusCode: s3Response.$metadata?.httpStatusCode
    });
    
    // Check if the file actually exists and has content
    if (!s3Response.Body || s3Response.ContentLength === 0) {
      console.log('S3 file not found or empty:', processedKey);
      res.status(404).json({
        success: false,
        error: 'File not found or is empty',
        key: processedKey
      });
      return;
    }
    
    // Set the appropriate headers
    if (s3Response.ContentType) {
      res.set('Content-Type', s3Response.ContentType);
    }
    if (s3Response.ContentLength) {
      res.set('Content-Length', s3Response.ContentLength.toString());
    }
    if (s3Response.CacheControl) {
      res.set('Cache-Control', s3Response.CacheControl);
    }
    if (s3Response.ETag) {
      res.set('ETag', s3Response.ETag);
    }
    
    // Handle the response body properly
    if (s3Response.Body) {
      // @ts-ignore - Handle S3 stream response
      s3Response.Body.pipe(res);
    } else {
      console.log('S3 file not found:', processedKey);
      res.status(404).json({
        success: false,
        error: 'File not found',
        key: processedKey
      });
    }
  } catch (error: any) {
    console.error('Error proxying S3 file:', error);
    // Handle specific S3 errors
    if (error.name === 'NoSuchKey') {
      res.status(404).json({
        success: false,
        error: 'File not found in S3 bucket',
        details: error.message,
        key: processedKey,
        bucket: env.s3.bucketName
      });
    } else if (error.name === 'Forbidden') {
      res.status(403).json({
        success: false,
        error: 'Access denied to S3 file - check bucket permissions',
        details: error.message,
        key: processedKey,
        bucket: env.s3.bucketName
      });
    } else if (error.name === 'NoSuchBucket') {
      res.status(404).json({
        success: false,
        error: 'S3 bucket not found - check bucket name and region',
        details: error.message,
        bucket: env.s3.bucketName,
        region: env.s3.region
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to proxy S3 file - internal server error',
        details: error.message,
        key: processedKey,
        bucket: env.s3.bucketName
      });
    }
  }
}));

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

  // Convert to plain objects for response
  const processedProducts = products.map(product => product.toObject());

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

  // Convert to plain object for response
  const processedProduct = product.toObject();

  res.json({
    success: true,
    product: processedProduct
  });
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