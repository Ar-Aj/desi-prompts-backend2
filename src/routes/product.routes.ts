import { Router, Request, Response } from 'express';
import { Product } from '../models/Product.model';
import { Demo } from '../models/Demo.model';
import { asyncHandler } from '../middleware/error.middleware';
import { authenticate, authorizeAdmin } from '../middleware/auth.middleware';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { s3Client } from '../utils/storage.utils';
import { env } from '../config/environment.config';
import sharp from 'sharp';

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

// Test endpoint - ALWAYS returns JSON
router.get('/test-json', (_req: Request, res: Response) => {
  console.log('Test endpoint called');
  res.setHeader('Content-Type', 'application/json');
  return res.json({
    success: true,
    message: 'Test endpoint working',
    timestamp: new Date().toISOString()
  });
});

// Proxy endpoint to serve S3 files directly (to avoid CORS issues) with optimization
router.get('/proxy-s3/:key*', asyncHandler(async (req: Request, res: Response) => {
  try {
    const fullKey = req.params.key + (req.params[0] || '');
    
    console.log('S3 Proxy Request:', { fullKey, params: req.params, url: req.url });
    
    if (!fullKey) {
      console.log('Missing key parameter');
      return res.status(400).json({
        success: false,
        error: 'Missing key parameter'
      });
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
        return res.status(404).json({
          success: false,
          error: 'File not found or is empty',
          key: processedKey
        });
      }
      
      // Check if it's an image and optimize if needed
      const contentType = s3Response.ContentType || '';
      const isImage = contentType.startsWith('image/');
      
      // Get image dimensions from query parameters or use defaults
      const width = req.query.width ? parseInt(req.query.width as string) : null;
      const height = req.query.height ? parseInt(req.query.height as string) : null;
      const quality = req.query.quality ? parseInt(req.query.quality as string) : 80;
      
      // Set cache headers for better performance
      if (isImage) {
        // Cache images for 1 year with immutable flag for better caching
        res.set('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        // Cache other files for 1 day
        res.set('Cache-Control', 'public, max-age=86400');
      }
      res.set('ETag', s3Response.ETag || '');
      
      if (isImage && (width || height)) {
        // Optimize image
        try {
          const imageBuffer = await streamToBuffer(s3Response.Body as NodeJS.ReadableStream);
          
          let sharpInstance = sharp(imageBuffer);
          
          // Resize if dimensions are provided
          if (width || height) {
            sharpInstance = sharpInstance.resize(width, height, {
              fit: 'inside',
              withoutEnlargement: true
            });
          }
          
          // Convert to WebP for better compression
          sharpInstance = sharpInstance.webp({ quality });
          
          const optimizedBuffer = await sharpInstance.toBuffer();
          
          // Set appropriate headers
          res.set('Content-Type', 'image/webp');
          res.set('Content-Length', optimizedBuffer.length.toString());
          
          return res.send(optimizedBuffer);
        } catch (optimizeError) {
          console.error('Error optimizing image:', optimizeError);
          // Fall back to original image
        }
      }
      
      // Set the appropriate headers for original file
      if (s3Response.ContentType) {
        res.set('Content-Type', s3Response.ContentType);
      }
      if (s3Response.ContentLength) {
        res.set('Content-Length', s3Response.ContentLength.toString());
      }
      if (s3Response.CacheControl) {
        // Use the cache control from S3 if it exists, otherwise set our own
        res.set('Cache-Control', s3Response.CacheControl || 'public, max-age=31536000');
      } else {
        // Default cache control if none exists
        res.set('Cache-Control', 'public, max-age=31536000');
      }
      if (s3Response.ETag) {
        res.set('ETag', s3Response.ETag);
      }
      
      // Handle the response body properly
      if (s3Response.Body) {
        // @ts-ignore - Handle S3 stream response
        s3Response.Body.pipe(res);
        return; // Return early since we're streaming the response
      } else {
        console.log('S3 file not found:', processedKey);
        return res.status(404).json({
          success: false,
          error: 'File not found',
          key: processedKey
        });
      }
    } catch (error: any) {
      console.error('Error proxying S3 file:', error);
      // Handle specific S3 errors
      if (error.name === 'NoSuchKey') {
        return res.status(404).json({
          success: false,
          error: 'File not found in S3 bucket',
          details: error.message,
          key: processedKey,
          bucket: env.s3.bucketName
        });
      } else if (error.name === 'Forbidden') {
        return res.status(403).json({
          success: false,
          error: 'Access denied to S3 file - check bucket permissions',
          details: error.message,
          key: processedKey,
          bucket: env.s3.bucketName
        });
      } else if (error.name === 'NoSuchBucket') {
        return res.status(404).json({
          success: false,
          error: 'S3 bucket not found - check bucket name and region',
          details: error.message,
          bucket: env.s3.bucketName,
          region: env.s3.region
        });
      } else {
        return res.status(500).json({
          success: false,
          error: 'Failed to proxy S3 file - internal server error',
          details: error.message,
          key: processedKey,
          bucket: env.s3.bucketName
        });
      }
    }
  } catch (error) {
    console.error('S3 Proxy Error:', error);
    // Ensure we always return a valid JSON response for the proxy endpoint as well
    return res.status(500).json({
      success: false,
      error: 'Failed to proxy S3 file',
      message: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : 'Unknown error') : undefined
    });
  }
}));

// Helper function to convert stream to buffer
async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on('error', (err) => reject(err));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

// Test endpoint to check PDF content
router.get('/test-pdf-content', asyncHandler(async (req: Request, res: Response) => {
  try {
    const { url } = req.query;
    
    if (!url || typeof url !== 'string') {
      res.status(400).json({
        error: 'Missing or invalid URL parameter'
      });
      return;
    }

    console.log('Testing PDF content for URL:', url);
    
    // Fetch the PDF
    const response = await fetch(url);
    
    if (!response.ok) {
      res.status(response.status).json({
        error: `Failed to fetch: ${response.status} ${response.statusText}`
      });
      return;
    }
    
    const contentType = response.headers.get('content-type');
    const contentLength = response.headers.get('content-length');
    
    // Get first 20 bytes to check header
    const buffer = await response.clone().arrayBuffer();
    const bytes = new Uint8Array(buffer, 0, Math.min(20, buffer.byteLength));
    const header = String.fromCharCode.apply(null, Array.from(bytes));
    
    res.json({
      contentType,
      contentLength,
      header: header.substring(0, 20),
      isPdf: header.startsWith('%PDF'),
      byteLength: buffer.byteLength
    });
  } catch (error) {
    console.error('Test error:', error);
    res.status(500).json({
      error: 'Test failed'
    });
  }
}));

// Get all products (public)
router.get('/', asyncHandler(async (_req: Request, res: Response) => {
  const {
    category,
    subcategory, // This can now be a comma-separated string
    search,
    minPrice,
    maxPrice,
    page = 1,
    limit = 12
  } = _req.query;

  const query: any = { isActive: true };

  // Filters
  if (category) query.category = category;
  
  // Handle multiple subcategories
  if (subcategory) {
    const subcategories = Array.isArray(subcategory) 
      ? subcategory 
      : typeof subcategory === 'string' 
        ? subcategory.split(',').map(s => s.trim())
        : [subcategory];
    
    if (subcategories.length > 0) {
      query.subcategory = { $in: subcategories };
    }
  }
  
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

  // Aggregate to get real purchase counts
  const productsWithPurchaseData = await Product.aggregate([
    { $match: query },
    {
      $lookup: {
        from: 'orders',
        let: { productId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $in: ['$$productId', '$items.product'] },
                  { $eq: ['$paymentStatus', 'completed'] },
                  { $ne: ['$isFakeOrder', true] } // Exclude fake orders
                ]
              }
            }
          },
          {
            $unwind: '$items'
          },
          {
            $match: {
              $expr: { $eq: ['$items.product', '$$productId'] }
            }
          },
          {
            $group: {
              _id: null,
              count: { $sum: '$items.quantity' }
            }
          }
        ],
        as: 'realPurchaseCount'
      }
    },
    {
      $addFields: {
        realPurchaseCount: { $arrayElemAt: ['$realPurchaseCount.count', 0] }
      }
    },
    {
      $addFields: {
        realPurchaseCount: { $ifNull: ['$realPurchaseCount', 0] }
      }
    },
    {
      $sort: { order: 1, createdAt: -1 }
    },
    {
      $skip: skip
    },
    {
      $limit: Number(limit)
    }
  ]);

  const [products, total] = await Promise.all([
    Product.find(query)
      .sort({ order: 1, createdAt: -1 }) // Sort by order first, then by creation date
      .skip(skip)
      .limit(Number(limit))
      .select('-pdfUrl -pdfPassword'),
    Product.countDocuments(query)
  ]);

  // Merge purchase data with products
  const processedProducts = products.map(product => {
    const productObj = product.toObject();
    const productId = String(product._id);
    const purchaseData = productsWithPurchaseData.find(p => p._id.toString() === productId);
    return {
      ...productObj,
      realPurchaseCount: purchaseData ? purchaseData.realPurchaseCount : 0
    };
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
router.get('/demos', asyncHandler(async (req: Request, res: Response) => {
  const { search, category, product } = req.query;
  
  // Build query for filtering
  const query: any = { isActive: true };
  
  // If we need to filter by search, category, or specific product, we need to join with products
  if (search || category || product) {
    // First get products that match our criteria
    const productQuery: any = { isActive: true };
    
    if (category) {
      productQuery.category = category;
    }
    
    if (search) {
      productQuery.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }
    
    // If filtering by specific product ID
    if (product) {
      productQuery._id = product;
    }
    
    const matchingProducts = await Product.find(productQuery).select('_id');
    const productIds = matchingProducts.map(p => p._id);
    
    // Add product filter to demo query
    query.product = { $in: productIds };
  }
  
  const demos = await Demo.find(query)
    .populate('product', 'name category price slug images description')
    .sort({ order: 1, createdAt: -1 });

  res.json({
    success: true,
    demos
  });
}));

// Get products that have demos (for filtering UI)
router.get('/demos/products', asyncHandler(async (req: Request, res: Response) => {
  const { category } = req.query;
  
  // First get products that match category filter
  const productQuery: any = { isActive: true };
  
  if (category) {
    productQuery.category = category;
  }
  
  // Get products that have demos
  const productsWithDemos = await Product.aggregate([
    {
      $lookup: {
        from: 'demos',
        localField: '_id',
        foreignField: 'product',
        as: 'demos'
      }
    },
    {
      $match: {
        ...productQuery,
        'demos.isActive': true,
        'demos.0': { $exists: true } // Only products that have at least one demo
      }
    },
    {
      $addFields: {
        demoCount: { $size: '$demos' }
      }
    },
    {
      $sort: { name: 1 }
    },
    {
      $project: {
        name: 1,
        category: 1,
        demoCount: 1
      }
    }
  ]);

  res.json({
    success: true,
    products: productsWithDemos
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

  // Get real purchase count
  const purchaseData = await Product.aggregate([
    { $match: { _id: product._id } },
    {
      $lookup: {
        from: 'orders',
        let: { productId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $in: ['$$productId', '$items.product'] },
                  { $eq: ['$paymentStatus', 'completed'] },
                  { $ne: ['$isFakeOrder', true] } // Exclude fake orders
                ]
              }
            }
          },
          {
            $unwind: '$items'
          },
          {
            $match: {
              $expr: { $eq: ['$items.product', '$$productId'] }
            }
          },
          {
            $group: {
              _id: null,
              count: { $sum: '$items.quantity' }
            }
          }
        ],
        as: 'realPurchaseCount'
      }
    },
    {
      $addFields: {
        realPurchaseCount: { $arrayElemAt: ['$realPurchaseCount.count', 0] }
      }
    },
    {
      $addFields: {
        realPurchaseCount: { $ifNull: ['$realPurchaseCount', 0] }
      }
    }
  ]);

  // Check if product has demos
  const demoCount = await Demo.countDocuments({
    product: product._id,
    isActive: true
  });

  // Convert to plain object for response
  const processedProduct = {
    ...product.toObject(),
    realPurchaseCount: purchaseData[0] ? purchaseData[0].realPurchaseCount : 0,
    hasDemos: demoCount > 0
  };

  res.json({
    success: true,
    product: processedProduct
  });
}));

// Check if a product has demos
router.get('/:slug/has-demos', asyncHandler(async (req: Request, res: Response) => {
  const product = await Product.findOne({ 
    slug: req.params.slug,
    isActive: true 
  }).select('_id');

  if (!product) {
    res.status(404).json({ error: 'Product not found' });
    return;
  }

  const demoCount = await Demo.countDocuments({
    product: product._id,
    isActive: true
  });

  res.json({
    success: true,
    hasDemos: demoCount > 0,
    demoCount
  });
}));

// Create product (admin only)
router.post('/', authenticate, authorizeAdmin, asyncHandler(async (req: Request, res: Response) => {
  try {
    console.log('Product creation request body:', req.body);
    
    // Log specific fields
    console.log('Required fields check:', {
      name: req.body.name,
      category: req.body.category,
      subcategory: req.body.subcategory,
      price: req.body.price,
      description: req.body.description,
      detailedDescription: req.body.detailedDescription,
      pdfUrl: req.body.pdfUrl,
      pdfPassword: req.body.pdfPassword
    });
    
    const product = new Product(req.body);
    await product.save();

    res.status(201).json({
      success: true,
      product
    });
  } catch (error: any) {
    console.error('Product creation error:', error);
    
    // Handle validation errors
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map((err: any) => err.message);
      res.status(400).json({
        success: false,
        error: 'Validation error',
        details: messages
      });
      return;
    }
    
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create product'
    });
  }
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
    .select('name description price originalPrice category subcategory isActive salesCount averageRating order createdAt');

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