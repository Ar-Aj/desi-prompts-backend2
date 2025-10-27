import { Router, Request, Response } from 'express';
import { Product } from '../models/Product.model';
import { Order } from '../models/Order.model';
import { Demo } from '../models/Demo.model';
import { AccessLog } from '../models/AccessManager.model';
import { asyncHandler } from '../middleware/error.middleware';
import { authenticate, authorizeAdmin } from '../middleware/auth.middleware';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { s3Client } from '../utils/storage.utils';
import { getSignedDownloadUrl } from '../utils/storage.utils';
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

// Verify PDF access endpoint
router.post('/verify-access', asyncHandler(async (req: Request, res: Response) => {
  try {
    const { orderId, accessToken } = req.body;
    const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
    const userAgent = req.get('User-Agent') || 'unknown';

    console.log('PDF Access Verification Request:', { orderId, hasAccessToken: !!accessToken });

    // Validate parameters
    if (!orderId) {
      // Log failed access attempt
      await AccessLog.create({
        orderId: null,
        productId: null,
        accessToken: accessToken || 'none',
        ipAddress,
        userAgent,
        accessGranted: false,
        failureReason: 'Order ID is required',
        expiryTime: new Date(Date.now() + 30 * 60 * 1000) // 30 minutes from now
      });

      return res.status(400).json({
        success: false,
        error: 'Order ID is required'
      });
    }

    if (!accessToken) {
      // Log failed access attempt
      await AccessLog.create({
        orderId,
        productId: null,
        accessToken: 'none',
        ipAddress,
        userAgent,
        accessGranted: false,
        failureReason: 'Access Token is required',
        expiryTime: new Date(Date.now() + 30 * 60 * 1000) // 30 minutes from now
      });

      return res.status(400).json({
        success: false,
        error: 'Access Token is required'
      });
    }

    // Find order by ID
    const order = await Order.findById(orderId);
    if (!order) {
      // Log failed access attempt
      await AccessLog.create({
        orderId,
        productId: null,
        accessToken,
        ipAddress,
        userAgent,
        accessGranted: false,
        failureReason: 'Order not found',
        expiryTime: new Date(Date.now() + 30 * 60 * 1000) // 30 minutes from now
      });

      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }

    // Check if order is completed
    if (order.paymentStatus !== 'completed') {
      // Log failed access attempt
      await AccessLog.create({
        orderId,
        productId: null,
        accessToken,
        ipAddress,
        userAgent,
        accessGranted: false,
        failureReason: 'Order not completed',
        expiryTime: new Date(Date.now() + 30 * 60 * 1000) // 30 minutes from now
      });

      return res.status(400).json({
        success: false,
        error: 'Order not completed'
      });
    }

    // Verify access token
    if (!order.accessToken || order.accessToken !== accessToken) {
      // Log failed access attempt
      await AccessLog.create({
        orderId,
        productId: null,
        accessToken,
        ipAddress,
        userAgent,
        accessGranted: false,
        failureReason: 'Invalid Access Token',
        expiryTime: new Date(Date.now() + 30 * 60 * 1000) // 30 minutes from now
      });

      return res.status(401).json({
        success: false,
        error: 'Invalid Access Token'
      });
    }

    // Get the first product (for now, handle single product orders)
    const firstItem = order.items[0];
    const product = await Product.findById(firstItem.product);
    
    if (!product) {
      // Log failed access attempt
      await AccessLog.create({
        orderId,
        productId: firstItem.product,
        accessToken,
        ipAddress,
        userAgent,
        accessGranted: false,
        failureReason: 'Product not found',
        expiryTime: new Date(Date.now() + 30 * 60 * 1000) // 30 minutes from now
      });

      return res.status(404).json({
        success: false,
        error: 'Product not found'
      });
    }

    // Generate signed URL for PDF (30 minutes expiry)
    const pdfUrl = await getSignedDownloadUrl(product.pdfUrl);
    const expiryTime = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes from now

    // Log successful access attempt
    await AccessLog.create({
      orderId,
      productId: product._id,
      userId: order.user,
      guestEmail: order.guestEmail,
      accessToken,
      ipAddress,
      userAgent,
      accessGranted: true,
      pdfUrl,
      expiryTime
    });

    // Log access
    console.log('PDF access granted for:', {
      orderId,
      productId: product._id,
      productName: product.name
    });

    return res.json({
      success: true,
      pdfUrl,
      pdfPassword: product.pdfPassword,
      message: 'Access granted'
    });
  } catch (error) {
    console.error('PDF Access Verification Error:', error);
    
    // Log failed access attempt due to system error
    try {
      const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
      const userAgent = req.get('User-Agent') || 'unknown';
      
      await AccessLog.create({
        orderId: req.body?.orderId,
        productId: null,
        accessToken: req.body?.accessToken,
        ipAddress,
        userAgent,
        accessGranted: false,
        failureReason: 'System error: ' + (error instanceof Error ? error.message : 'Unknown error'),
        expiryTime: new Date(Date.now() + 30 * 60 * 1000) // 30 minutes from now
      });
    } catch (logError) {
      console.error('Failed to log access attempt:', logError);
    }
    
    return res.status(500).json({
      success: false,
      error: 'Failed to verify access'
    });
  }
}));

// PDF Viewer Route - Secure PDF access with purchase verification
router.get('/view-pdf/:purchaseId', asyncHandler(async (req: Request, res: Response) => {
  try {
    const { purchaseId } = req.params;
    const { password } = req.query;

    console.log('PDF Viewer Request:', { purchaseId, hasPassword: !!password });

    // Validate parameters
    if (!purchaseId) {
      return res.status(400).json({
        success: false,
        error: 'Purchase ID is required'
      });
    }

    if (!password || typeof password !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'PDF password is required'
      });
    }

    // Find order by purchaseId
    const order = await Order.findOne({ purchaseId });
    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }

    // Check if order is completed
    if (order.paymentStatus !== 'completed') {
      return res.status(400).json({
        success: false,
        error: 'Order not completed'
      });
    }

    // Get the first product (for now, handle single product orders)
    const firstItem = order.items[0];
    const product = await Product.findById(firstItem.product);
    
    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found'
      });
    }

    // Verify PDF password
    if (product.pdfPassword !== password) {
      return res.status(401).json({
        success: false,
        error: 'Invalid PDF password'
      });
    }

    // Log access
    console.log('PDF access granted for:', {
      purchaseId,
      productId: product._id,
      productName: product.name
    });

    // Redirect to the PDF proxy endpoint with proper authentication
    const proxyUrl = `/api/products/proxy-s3/${product.pdfUrl}`;
    return res.redirect(302, proxyUrl);
  } catch (error) {
    console.error('PDF Viewer Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to access PDF'
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