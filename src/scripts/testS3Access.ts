import { s3Client } from '../utils/storage.utils';
import { env } from '../config/environment.config';
import { ListObjectsCommand, GetObjectCommand } from '@aws-sdk/client-s3';

async function testS3Access() {
  try {
    console.log('Testing S3 access...');
    console.log('Bucket:', env.s3.bucketName);
    console.log('Region:', env.s3.region);
    
    // List objects in the bucket
    const listCommand = new ListObjectsCommand({
      Bucket: env.s3.bucketName!,
      MaxKeys: 10
    });
    
    const listResponse = await s3Client.send(listCommand);
    console.log('List response:', {
      statusCode: listResponse.$metadata?.httpStatusCode,
      contents: listResponse.Contents?.map(item => ({
        key: item.Key,
        size: item.Size,
        lastModified: item.LastModified
      }))
    });
    
    // Try to access the first image if available
    if (listResponse.Contents && listResponse.Contents.length > 0) {
      const firstImage = listResponse.Contents.find(item => 
        item.Key?.includes('images/') && 
        (item.Key?.endsWith('.png') || item.Key?.endsWith('.jpg') || item.Key?.endsWith('.jpeg'))
      );
      
      if (firstImage) {
        console.log('Testing access to image:', firstImage.Key);
        
        const getCommand = new GetObjectCommand({
          Bucket: env.s3.bucketName!,
          Key: firstImage.Key
        });
        
        const getResponse = await s3Client.send(getCommand);
        console.log('Get response:', {
          statusCode: getResponse.$metadata?.httpStatusCode,
          contentType: getResponse.ContentType,
          contentLength: getResponse.ContentLength
        });
        
        console.log('✅ S3 access test successful');
      } else {
        console.log('No images found in bucket');
      }
    } else {
      console.log('No objects found in bucket');
    }
  } catch (error) {
    console.error('❌ S3 access test failed:', error);
  }
}

testS3Access();