#!/usr/bin/env node

/**
 * Image Diagnosis Script
 * 
 * This script diagnoses image issues by checking what images exist in the database
 * vs. what actually exists in S3.
 */

import mongoose from 'mongoose';
import { Product } from '../models/Product.model';
import { Demo } from '../models/Demo.model';
import { env } from '../config/environment.config';
import { S3Client, ListObjectsV2Command, HeadObjectCommand } from '@aws-sdk/client-s3';

// Configure mongoose promises
mongoose.Promise = global.Promise;

// Configure S3 client
const s3Client = new S3Client({
  region: env.s3.region,
  credentials: {
    accessKeyId: env.s3.accessKeyId,
    secretAccessKey: env.s3.secretAccessKey,
  },
  endpoint: env.s3.endpoint,
});

async function checkS3FileExists(key: string): Promise<boolean> {
  try {
    const command = new HeadObjectCommand({
      Bucket: env.s3.bucketName,
      Key: key,
    });
    
    await s3Client.send(command);
    return true;
  } catch (error: any) {
    if (error.name === 'NotFound' || error.name === 'NoSuchKey') {
      return false;
    }
    console.log(`❌ S3 Error checking ${key}:`, error.name);
    return false;
  }
}

async function listS3Files(): Promise<string[]> {
  try {
    const command = new ListObjectsV2Command({
      Bucket: env.s3.bucketName,
    });
    
    const response = await s3Client.send(command);
    return response.Contents?.map(obj => obj.Key || '') || [];
  } catch (error) {
    console.log('❌ Error listing S3 files:', error);
    return [];
  }
}

async function diagnoseProductImages() {
  console.log('🔍 Diagnosing Product Images...');
  
  try {
    const products = await Product.find({ isActive: true }).select('images name');
    console.log(`Found ${products.length} active products`);
    
    const allImageKeys = new Set<string>();
    let missingImages = 0;
    let totalImages = 0;
    
    for (const product of products) {
      console.log(`\n📦 Product: ${product.name}`);
      
      for (const image of product.images) {
        totalImages++;
        allImageKeys.add(image);
        
        // Check if it's a direct S3 URL or a key
        if (image.includes('/') && !image.startsWith('http')) {
          // It's an S3 key
          const exists = await checkS3FileExists(image);
          if (!exists) {
            console.log(`  ❌ Missing: ${image}`);
            missingImages++;
          } else {
            console.log(`  ✅ Found: ${image}`);
          }
        } else if (image.startsWith('http')) {
          // It's a full URL, skip S3 check
          console.log(`  ⏭️  External URL: ${image}`);
        } else {
          // It's a local image
          console.log(`  📍 Local image: ${image}`);
        }
      }
    }
    
    console.log(`\n📊 Product Images Summary:`);
    console.log(`  Total images in DB: ${totalImages}`);
    console.log(`  Missing images: ${missingImages}`);
    console.log(`  Unique image keys: ${allImageKeys.size}`);
    
    return Array.from(allImageKeys);
  } catch (error) {
    console.error('❌ Error diagnosing product images:', error);
    return [];
  }
}

async function diagnoseDemoImages() {
  console.log('\n🔍 Diagnosing Demo Images...');
  
  try {
    const demos = await Demo.find({ isActive: true }).select('beforeImage afterImages title');
    console.log(`Found ${demos.length} active demos`);
    
    const allImageKeys = new Set<string>();
    let missingImages = 0;
    let totalImages = 0;
    
    for (const demo of demos) {
      console.log(`\n🎭 Demo: ${demo.title}`);
      
      // Check before image
      if (demo.beforeImage) {
        totalImages++;
        allImageKeys.add(demo.beforeImage);
        
        if (demo.beforeImage.includes('/') && !demo.beforeImage.startsWith('http')) {
          const exists = await checkS3FileExists(demo.beforeImage);
          if (!exists) {
            console.log(`  ❌ Missing before image: ${demo.beforeImage}`);
            missingImages++;
          } else {
            console.log(`  ✅ Found before image: ${demo.beforeImage}`);
          }
        } else if (demo.beforeImage.startsWith('http')) {
          console.log(`  ⏭️  External before image: ${demo.beforeImage}`);
        } else {
          console.log(`  📍 Local before image: ${demo.beforeImage}`);
        }
      }
      
      // Check after images
      for (const afterImage of demo.afterImages) {
        totalImages++;
        allImageKeys.add(afterImage.image);
        
        if (afterImage.image.includes('/') && !afterImage.image.startsWith('http')) {
          const exists = await checkS3FileExists(afterImage.image);
          if (!exists) {
            console.log(`  ❌ Missing after image: ${afterImage.image}`);
            missingImages++;
          } else {
            console.log(`  ✅ Found after image: ${afterImage.image}`);
          }
        } else if (afterImage.image.startsWith('http')) {
          console.log(`  ⏭️  External after image: ${afterImage.image}`);
        } else {
          console.log(`  📍 Local after image: ${afterImage.image}`);
        }
      }
    }
    
    console.log(`\n📊 Demo Images Summary:`);
    console.log(`  Total images in DB: ${totalImages}`);
    console.log(`  Missing images: ${missingImages}`);
    console.log(`  Unique image keys: ${allImageKeys.size}`);
    
    return Array.from(allImageKeys);
  } catch (error) {
    console.error('❌ Error diagnosing demo images:', error);
    return [];
  }
}

async function compareWithS3(allImageKeys: string[]) {
  console.log('\n🔍 Comparing with S3 bucket contents...');
  
  try {
    const s3Files = await listS3Files();
    console.log(`Found ${s3Files.length} files in S3 bucket`);
    
    const s3FileSet = new Set(s3Files);
    const dbImageSet = new Set(allImageKeys.filter(key => key.includes('/') && !key.startsWith('http')));
    
    console.log(`DB image keys: ${dbImageSet.size}`);
    console.log(`S3 files: ${s3FileSet.size}`);
    
    // Find images in DB but not in S3
    const missingInS3 = Array.from(dbImageSet).filter(key => !s3FileSet.has(key));
    console.log(`\n❌ Images in DB but missing in S3: ${missingInS3.length}`);
    missingInS3.forEach(key => console.log(`  - ${key}`));
    
    // Find images in S3 but not referenced in DB
    const unreferencedInDB = Array.from(s3FileSet).filter(key => !dbImageSet.has(key) && (key?.includes('images/') || key?.includes('pdfs/')));
    console.log(`\n📁 Images in S3 but not referenced in DB: ${unreferencedInDB.length}`);
    unreferencedInDB.forEach(key => console.log(`  - ${key}`));
    
  } catch (error) {
    console.error('❌ Error comparing with S3:', error);
  }
}

async function main() {
  console.log('🔍 Starting Image Diagnosis');
  console.log(`☁️  Environment: ${env.mode}`);
  console.log(`🗄️  S3 Bucket: ${env.s3.bucketName}`);
  
  try {
    // Connect to database
    console.log('\n🔗 Connecting to database...');
    await mongoose.connect(env.mongoUri);
    console.log('✅ Database connected successfully');
    
    // Diagnose product images
    const productImageKeys = await diagnoseProductImages();
    
    // Diagnose demo images
    const demoImageKeys = await diagnoseDemoImages();
    
    // Combine all image keys
    const allImageKeys = [...productImageKeys, ...demoImageKeys];
    
    // Compare with S3
    await compareWithS3(allImageKeys);
    
    console.log('\n🏁 Diagnosis complete!');
    
    // Close database connection
    await mongoose.connection.close();
    console.log('🔒 Database connection closed');
    
  } catch (error) {
    console.error('💥 Fatal error during diagnosis:', error);
    process.exit(1);
  }
}

// Only run if this script is executed directly
if (require.main === module) {
  main().catch(console.error);
}

export default main;