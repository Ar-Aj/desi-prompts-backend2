import { s3Client } from '../utils/storage.utils';
import { env } from '../config/environment.config';
import { ListObjectsCommand } from '@aws-sdk/client-s3';

async function testS3Access() {
  try {
    console.log('Testing S3 access...');
    console.log('Bucket:', env.s3.bucketName);
    console.log('Region:', env.s3.region);
    
    // List objects in the bucket
    const command = new ListObjectsCommand({
      Bucket: env.s3.bucketName!,
      MaxKeys: 5
    });
    
    const response = await s3Client.send(command);
    console.log('S3 access successful');
    console.log('Found objects:', response.Contents?.length || 0);
    
    if (response.Contents && response.Contents.length > 0) {
      console.log('First few objects:');
      response.Contents.slice(0, 3).forEach(obj => {
        console.log(`  - ${obj.Key} (${obj.Size} bytes)`);
      });
    }
  } catch (error) {
    console.error('S3 access failed:', error);
  }
}

testS3Access();