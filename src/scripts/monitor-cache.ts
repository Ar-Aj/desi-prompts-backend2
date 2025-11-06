#!/usr/bin/env node

/**
 * Cache Monitoring Script
 * 
 * This script monitors the effectiveness of the cache pre-warming system.
 * It tracks hit rates and identifies images that are still causing issues.
 * 
 * Usage:
 *   npm run monitor-cache
 * 
 * Or directly:
 *   node dist/scripts/monitor-cache.js
 */

import mongoose from 'mongoose';
import { Product } from '../models/Product.model';
import { Demo } from '../models/Demo.model';
import { env } from '../config/environment.config';
import https from 'https';
import http from 'http';

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

// Function to check if an image is accessible
async function checkImageAccessibility(url: string): Promise<{ accessible: boolean; statusCode?: number; error?: string }> {
  return new Promise((resolve) => {
    const parsedUrl = new URL(url);
    const agent = parsedUrl.protocol === 'https:' ? httpsAgent : httpAgent;
    
    const request = (parsedUrl.protocol === 'https:' ? https : http).get(url, { 
      agent,
      method: 'HEAD', // Use HEAD request to check accessibility without downloading content
      timeout: 5000
    }, (res) => {
      resolve({
        accessible: res.statusCode === 200,
        statusCode: res.statusCode
      });
      
      // Consume response data to free up memory
      res.resume();
    });
    
    request.on('error', (err) => {
      resolve({
        accessible: false,
        error: err.message
      });
    });
    
    // Set a timeout
    request.setTimeout(5000, () => {
      request.destroy();
      resolve({
        accessible: false,
        error: 'Timeout'
      });
    });
  });
}

async function monitorProductImages() {
  console.log('🔍 Monitoring product images...');
  
  try {
    const products = await Product.find({ isActive: true }).select('images name');
    console.log(`Found ${products.length} active products`);
    
    let accessibleCount = 0;
    let totalCount = 0;
    const inaccessibleImages: { product: string; image: string; error: string }[] = [];
    
    for (const product of products) {
      console.log(`\n📦 Checking product: ${product.name}`);
      
      for (const image of product.images) {
        totalCount++;
        try {
          // If it's an S3 key, use the proxy endpoint
          let imageUrl: string;
          if (image.includes('/') && !image.startsWith('http')) {
            // S3 key - use proxy
            imageUrl = `${getApiUrl()}/products/proxy-s3/${image}`;
          } else {
            // Full URL - use as is
            imageUrl = image;
          }
          
          const result = await checkImageAccessibility(imageUrl);
          if (result.accessible) {
            accessibleCount++;
            if (Math.random() < 0.1) { // Log 10% of successful checks
              console.log(`✅ Accessible: ${image}`);
            }
          } else {
            inaccessibleImages.push({
              product: product.name,
              image,
              error: result.error || `Status ${result.statusCode}`
            });
            console.log(`❌ Inaccessible: ${image} - ${result.error || `Status ${result.statusCode}`}`);
          }
          
          // Add a small delay to avoid overwhelming the server
          await new Promise(resolve => setTimeout(resolve, 50));
        } catch (error) {
          inaccessibleImages.push({
            product: product.name,
            image,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
          console.log(`❌ Error checking image ${image}:`, error instanceof Error ? error.message : 'Unknown error');
        }
      }
    }
    
    console.log(`\n📊 Product images accessibility: ${accessibleCount}/${totalCount} (${(accessibleCount/totalCount*100).toFixed(2)}%)`);
    
    if (inaccessibleImages.length > 0) {
      console.log('\n🚨 Inaccessible images found:');
      inaccessibleImages.forEach(({ product, image, error }) => {
        console.log(`  - ${product}: ${image} (${error})`);
      });
    }
    
    return { accessibleCount, totalCount, inaccessibleImages };
  } catch (error) {
    console.error('❌ Error monitoring product images:', error instanceof Error ? error.message : 'Unknown error');
    return { accessibleCount: 0, totalCount: 0, inaccessibleImages: [] };
  }
}

async function monitorDemoImages() {
  console.log('\n🔍 Monitoring demo images...');
  
  try {
    const demos = await Demo.find({ isActive: true }).select('beforeImage afterImages title');
    console.log(`Found ${demos.length} active demos`);
    
    let accessibleCount = 0;
    let totalCount = 0;
    const inaccessibleImages: { demo: string; image: string; error: string }[] = [];
    
    for (const demo of demos) {
      console.log(`\n🎭 Checking demo: ${demo.title}`);
      
      // Check before image
      if (demo.beforeImage) {
        totalCount++;
        try {
          let imageUrl: string;
          if (demo.beforeImage.includes('/') && !demo.beforeImage.startsWith('http')) {
            // S3 key - use proxy
            imageUrl = `${getApiUrl()}/products/proxy-s3/${demo.beforeImage}`;
          } else {
            // Full URL or local image
            imageUrl = demo.beforeImage;
          }
          
          const result = await checkImageAccessibility(imageUrl);
          if (result.accessible) {
            accessibleCount++;
          } else {
            inaccessibleImages.push({
              demo: demo.title,
              image: demo.beforeImage,
              error: result.error || `Status ${result.statusCode}`
            });
            console.log(`❌ Inaccessible before image: ${demo.beforeImage} - ${result.error || `Status ${result.statusCode}`}`);
          }
          
          // Add a small delay to avoid overwhelming the server
          await new Promise(resolve => setTimeout(resolve, 50));
        } catch (error) {
          inaccessibleImages.push({
            demo: demo.title,
            image: demo.beforeImage,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
          console.log(`❌ Error checking before image:`, error instanceof Error ? error.message : 'Unknown error');
        }
      }
      
      // Check after images
      for (const afterImage of demo.afterImages) {
        totalCount++;
        try {
          const imageStr = afterImage.image;  // Changed variable name to avoid conflict
          let imageUrl: string;
          if (imageStr.includes('/') && !imageStr.startsWith('http')) {
            // S3 key - use proxy
            imageUrl = `${getApiUrl()}/products/proxy-s3/${imageStr}`;
          } else {
            // Full URL or local image
            imageUrl = imageStr;
          }
          
          const result = await checkImageAccessibility(imageUrl);
          if (result.accessible) {
            accessibleCount++;
          } else {
            inaccessibleImages.push({
              demo: demo.title,
              image: imageStr,  // Use the renamed variable
              error: result.error || `Status ${result.statusCode}`
            });
            console.log(`❌ Inaccessible after image: ${imageStr} - ${result.error || `Status ${result.statusCode}`}`);
          }
          
          // Add a small delay to avoid overwhelming the server
          await new Promise(resolve => setTimeout(resolve, 50));
        } catch (error) {
          inaccessibleImages.push({
            demo: demo.title,
            image: afterImage.image,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
          console.log(`❌ Error checking after image ${afterImage.image}:`, error instanceof Error ? error.message : 'Unknown error');
        }
      }
    }
    
    console.log(`\n📊 Demo images accessibility: ${accessibleCount}/${totalCount} (${(accessibleCount/totalCount*100).toFixed(2)}%)`);
    
    if (inaccessibleImages.length > 0) {
      console.log('\n🚨 Inaccessible demo images found:');
      inaccessibleImages.forEach(({ demo, image, error }) => {
        console.log(`  - ${demo}: ${image} (${error})`);
      });
    }
    
    return { accessibleCount, totalCount, inaccessibleImages };
  } catch (error) {
    console.error('❌ Error monitoring demo images:', error instanceof Error ? error.message : 'Unknown error');
    return { accessibleCount: 0, totalCount: 0, inaccessibleImages: [] };
  }
}

async function main() {
  console.log('🔍 Starting Cache Monitoring Process');
  console.log(`📡 API URL: ${getApiUrl()}`);
  console.log(`☁️  Environment: ${env.mode}`);
  console.log(`🕐 Monitoring time: ${new Date().toISOString()}`);
  
  const startTime = Date.now();
  
  try {
    // Connect to database
    console.log('\n🔗 Connecting to database...');
    await mongoose.connect(env.mongoUri, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 10000,
    });
    console.log('✅ Database connected successfully');
    
    // Monitor product images
    const productResults = await monitorProductImages();
    
    // Monitor demo images
    const demoResults = await monitorDemoImages();
    
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    
    console.log('\n🏁 Monitoring complete!');
    console.log(`📈 Overall accessibility: ${(productResults.accessibleCount + demoResults.accessibleCount)}/${(productResults.totalCount + demoResults.totalCount)} (${((productResults.accessibleCount + demoResults.accessibleCount)/(productResults.totalCount + demoResults.totalCount)*100).toFixed(2)}%)`);
    console.log(`⏱️  Execution time: ${duration} seconds`);
    
    // Close database connection
    await mongoose.connection.close();
    console.log('🔒 Database connection closed');
    
  } catch (error) {
    console.error('💥 Fatal error during monitoring:', error instanceof Error ? error.message : 'Unknown error');
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