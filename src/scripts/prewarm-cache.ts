#!/usr/bin/env node

/**
 * Cache Pre-warming Script
 * 
 * This script pre-warms the S3 proxy cache by hitting all product and demo images.
 * Run this script periodically to ensure images are cached and load quickly.
 * 
 * Usage:
 *   npm run prewarm-cache
 * 
 * Or directly:
 *   node dist/scripts/prewarm-cache.js
 */

import mongoose from 'mongoose';
import { Product } from '../models/Product.model';
import { Demo } from '../models/Demo.model';
import { env } from '../config/environment.config';
import https from 'https';
import http from 'http';
import { getSignedDownloadUrl } from '../utils/storage.utils';

// Configure mongoose promises
mongoose.Promise = global.Promise;

// Create an agent with keep-alive connections
const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });

// Construct API URL from frontend URL
const getApiUrl = () => {
  return env.frontendUrl.includes('localhost') 
    ? 'http://localhost:5000/api' 
    : `${env.frontendUrl}/api`;
};

// Enhanced function to prewarm images with fallback to direct S3 access
async function prewarmImageWithFallback(imageKey: string, proxyUrl: string): Promise<boolean> {
  // First try the proxy endpoint
  const proxySuccess = await prewarmImage(proxyUrl);
  
  if (proxySuccess) {
    return true;
  }
  
  // If proxy fails, try direct S3 access to ensure the file exists
  try {
    const signedUrl = await getSignedDownloadUrl(imageKey);
    if (signedUrl) {
      // Log that we're using direct S3 access as fallback
      if (Math.random() < 0.1) { // Log 10% of fallback attempts
        console.log(`🔄 Using direct S3 access as fallback for: ${imageKey}`);
      }
      return true;
    }
  } catch (error) {
    // Only log errors occasionally
    if (Math.random() < 0.05) {
      console.log(`❌ Error with S3 fallback for ${imageKey}:`, error instanceof Error ? error.message : 'Unknown error');
    }
  }
  
  return false;
}

// Optimized function to prewarm images with better error handling
async function prewarmImage(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const parsedUrl = new URL(url);
    const agent = parsedUrl.protocol === 'https:' ? httpsAgent : httpAgent;
    
    const request = (parsedUrl.protocol === 'https:' ? https : http).get(url, { 
      agent,
      timeout: 5000 // 5 second timeout for faster execution
    }, (res) => {
      // We only care about successful responses
      if (res.statusCode === 200) {
        // Only log successful pre-warms occasionally to reduce log volume
        if (Math.random() < 0.1) { // Log 10% of successful requests
          console.log(`✅ Successfully warmed cache for: ${url}`);
        }
        resolve(true);
      } else {
        console.log(`⚠️  Non-200 response for ${url}: ${res.statusCode}`);
        resolve(false);
      }
      
      // Consume response data to free up memory
      res.resume();
    });
    
    request.on('error', (err) => {
      // Only log errors for debugging
      if (err.message !== 'socket hang up' && err.message !== 'ETIMEDOUT') {
        console.log(`❌ Error warming cache for ${url}:`, err.message);
      }
      resolve(false);
    });
    
    // Set a timeout
    request.setTimeout(5000, () => {
      request.destroy();
      // Only log timeouts occasionally
      if (Math.random() < 0.05) { // Log 5% of timeouts
        console.log(`⏰ Timeout warming cache for: ${url}`);
      }
      resolve(false);
    });
  });
}

// Optimized product image prewarming with fallback
async function prewarmProductImages() {
  console.log('🚀 Pre-warming product images...');
  
  try {
    const products = await Product.find({ isActive: true }).select('images name');
    console.log(`Found ${products.length} active products`);
    
    let successCount = 0;
    let totalCount = 0;
    
    for (const product of products) {
      // Log product processing occasionally to reduce log volume
      if (Math.random() < 0.2) { // Log 20% of products
        console.log(`\n📦 Processing product: ${product.name}`);
      }
      
      for (const image of product.images) {
        totalCount++;
        try {
          // If it's an S3 key, use the proxy endpoint with fallback
          if (image.includes('/') && !image.startsWith('http')) {
            // S3 key - use proxy with fallback
            const proxyUrl = `${getApiUrl()}/products/proxy-s3/${image}`;
            const success = await prewarmImageWithFallback(image, proxyUrl);
            if (success) successCount++;
          } else if (image.startsWith('http')) {
            // Full URL - use as is
            const success = await prewarmImage(image);
            if (success) successCount++;
          }
          // Add minimal delay to avoid overwhelming the server
          await new Promise(resolve => setTimeout(resolve, 50)); // Reduced from 100ms to 50ms
        } catch (error) {
          // Only log errors occasionally
          if (Math.random() < 0.1) {
            console.log(`❌ Error processing image ${image}:`, error instanceof Error ? error.message : 'Unknown error');
          }
        }
      }
    }
    
    console.log(`\n📊 Product images summary: ${successCount}/${totalCount} images successfully warmed`);
    return successCount;
  } catch (error) {
    console.error('❌ Error pre-warming product images:', error instanceof Error ? error.message : 'Unknown error');
    return 0;
  }
}

// Optimized demo image prewarming
async function prewarmDemoImages() {
  console.log('\n🚀 Pre-warming demo images...');
  
  try {
    const demos = await Demo.find({ isActive: true }).select('beforeImage afterImages title');
    console.log(`Found ${demos.length} active demos`);
    
    let successCount = 0;
    let totalCount = 0;
    
    for (const demo of demos) {
      // Log demo processing occasionally to reduce log volume
      if (Math.random() < 0.2) { // Log 20% of demos
        console.log(`\n🎭 Processing demo: ${demo.title}`);
      }
      
      // Process before image
      if (demo.beforeImage) {
        totalCount++;
        try {
          let imageUrl: string;
          // Check if it's a signed URL (demo images are stored as full URLs)
          if (demo.beforeImage.startsWith('http') && demo.beforeImage.includes('amazonaws.com')) {
            // Skip warming demo images that are full signed URLs as they expire
            continue;
          } else if (demo.beforeImage.includes('/') && !demo.beforeImage.startsWith('http')) {
            // S3 key - use proxy
            imageUrl = `${getApiUrl()}/products/proxy-s3/${demo.beforeImage}`;
            const success = await prewarmImage(imageUrl);
            if (success) successCount++;
          } else {
            // Local image or full URL - use as is
            const success = await prewarmImage(demo.beforeImage);
            if (success) successCount++;
          }
          
          // Minimal delay to avoid overwhelming the server
          await new Promise(resolve => setTimeout(resolve, 50)); // Reduced from 100ms to 50ms
        } catch (error) {
          // Only log errors occasionally
          if (Math.random() < 0.1) {
            console.log(`❌ Error processing before image:`, error instanceof Error ? error.message : 'Unknown error');
          }
        }
      }
      
      // Process after images
      for (const afterImage of demo.afterImages) {
        totalCount++;
        try {
          const image = afterImage.image;
          // Check if it's a signed URL (demo images are stored as full URLs)
          if (image.startsWith('http') && image.includes('amazonaws.com')) {
            // Skip warming demo images that are full signed URLs as they expire
            continue;
          } else if (image.includes('/') && !image.startsWith('http')) {
            // S3 key - use proxy
            const imageUrl = `${getApiUrl()}/products/proxy-s3/${image}`;
            const success = await prewarmImage(imageUrl);
            if (success) successCount++;
          } else {
            // Local image or full URL - use as is
            const success = await prewarmImage(image);
            if (success) successCount++;
          }
          
          // Minimal delay to avoid overwhelming the server
          await new Promise(resolve => setTimeout(resolve, 50)); // Reduced from 100ms to 50ms
        } catch (error) {
          // Only log errors occasionally
          if (Math.random() < 0.1) {
            console.log(`❌ Error processing after image:`, error instanceof Error ? error.message : 'Unknown error');
          }
        }
      }
    }
    
    console.log(`\n📊 Demo images summary: ${successCount}/${totalCount} images successfully warmed`);
    return successCount;
  } catch (error) {
    console.error('❌ Error pre-warming demo images:', error instanceof Error ? error.message : 'Unknown error');
    return 0;
  }
}

// Enhanced main function with better error handling and logging
async function main() {
  console.log('🔥 Starting Cache Pre-warming Process');
  console.log(`📡 API URL: ${getApiUrl()}`);
  console.log(`☁️  Environment: ${env.mode}`);
  console.log(`🕐 Execution time: ${new Date().toISOString()}`);
  
  const startTime = Date.now();
  
  try {
    // Connect to database
    console.log('\n🔗 Connecting to database...');
    await mongoose.connect(env.mongoUri, {
      serverSelectionTimeoutMS: 5000, // 5 second timeout
      socketTimeoutMS: 10000, // 10 second timeout
    });
    console.log('✅ Database connected successfully');
    
    // Pre-warm product images
    const productSuccessCount = await prewarmProductImages();
    
    // Pre-warm demo images
    const demoSuccessCount = await prewarmDemoImages();
    
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    
    console.log('\n🏁 Pre-warming complete!');
    console.log(`📈 Total successful pre-warms: ${productSuccessCount + demoSuccessCount}`);
    console.log(`⏱️  Execution time: ${duration} seconds`);
    
    // Close database connection
    await mongoose.connection.close();
    console.log('🔒 Database connection closed');
    
  } catch (error) {
    console.error('💥 Fatal error during pre-warming:', error instanceof Error ? error.message : 'Unknown error');
    // Try to close database connection even if there's an error
    try {
      await mongoose.connection.close();
      console.log('🔒 Database connection closed (after error)');
    } catch (closeError) {
      console.error('❌ Error closing database connection:', closeError instanceof Error ? closeError.message : 'Unknown error');
    }
    process.exit(1);
  }
}

// Only run if this script is executed directly
if (require.main === module) {
  main().catch(console.error);
}

export default main;