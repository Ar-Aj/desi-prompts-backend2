import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as crypto from 'crypto';
import { env } from '../config/environment.config';

// Configure S3 client with forcePathStyle for better compatibility
export const s3Client = new S3Client({
  region: env.s3.region,
  credentials: {
    accessKeyId: env.s3.accessKeyId!,
    secretAccessKey: env.s3.secretAccessKey!
  },
  endpoint: env.s3.endpoint,
  forcePathStyle: true // Use path-style URLs for better compatibility
});

export const uploadFile = async (
  file: Buffer,
  key: string,
  contentType: string
): Promise<string> => {
  try {
    // Validate file parameter
    if (!file) {
      throw new Error('File buffer is undefined or null');
    }
    
    if (!key) {
      throw new Error('File key is required');
    }
    
    if (!contentType) {
      throw new Error('Content type is required');
    }
    
    const command = new PutObjectCommand({
      Bucket: env.s3.bucketName!,
      Key: key,
      Body: file,
      ContentType: contentType,
      // Add CORS headers to allow access from frontend domains
      Metadata: {
        'x-amz-meta-allow-origin': env.frontendUrl || '*'
      }
    });

    await s3Client.send(command);
    
    // Return the key for later retrieval
    return key;
  } catch (error) {
    console.error('File upload error:', error);
    throw new Error('Failed to upload file');
  }
};

export const getSignedDownloadUrl = async (
  keyOrUrl: string,
  expiresIn: number = 1296000 // 15 days default (60 * 60 * 24 * 15)
): Promise<string> => {
  try {
    // If it's already a full URL, check if it's an S3 URL or a local URL
    if (keyOrUrl.startsWith('http')) {
      // If it's an S3 URL with query parameters (signed URL), extract the key
      if (keyOrUrl.includes('amazonaws.com') && keyOrUrl.includes('?')) {
        // Extract the key from the URL path
        const urlObj = new URL(keyOrUrl);
        const pathParts = urlObj.pathname.split('/');
        // Remove the bucket name from the path (first part after splitting)
        // The path starts with '/', so pathParts[0] is empty, pathParts[1] is the bucket name
        const key = pathParts.slice(2).join('/'); // Skip empty string and bucket name
        console.log('Extracted S3 key from signed URL:', key);
        
        // Generate a new signed URL with the extracted key
        const command = new GetObjectCommand({
          Bucket: env.s3.bucketName!,
          Key: key
        });
        
        const url = await getSignedUrl(s3Client, command, { expiresIn });
        console.log('Successfully generated new signed URL for key:', key);
        return url;
      }
      
      // For other URLs (local files, external links), return as is
      return keyOrUrl;
    }
    
    // Validate that we have a key
    if (!keyOrUrl || keyOrUrl.trim() === '') {
      throw new Error('Invalid S3 key provided');
    }
    
    // Validate that we have S3 configuration
    if (!env.s3.bucketName) {
      throw new Error('S3 bucket name not configured');
    }
    
    // Otherwise, treat it as a key and generate a signed URL
    const command = new GetObjectCommand({
      Bucket: env.s3.bucketName!,
      Key: keyOrUrl
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn });
    console.log('Successfully generated signed URL for key:', keyOrUrl);
    return url;
  } catch (error) {
    console.error('Error generating signed URL for key:', keyOrUrl, error);
    // Provide a more detailed error message
    if (error instanceof Error) {
      throw new Error(`Failed to generate download link: ${error.message}`);
    }
    throw new Error('Failed to generate download link due to unknown error');
  }
};

// Add a function to check if a file exists in S3
export const checkFileExists = async (key: string): Promise<boolean> => {
  try {
    const command = new HeadObjectCommand({
      Bucket: env.s3.bucketName!,
      Key: key
    });
    
    await s3Client.send(command);
    return true;
  } catch (error) {
    return false;
  }
};

export const generateFileKey = (
  folder: string,
  filename: string
): string => {
  const timestamp = Date.now();
  const random = crypto.randomBytes(8).toString('hex');
  const extension = filename.split('.').pop();
  return `${folder}/${timestamp}-${random}.${extension}`;
};

export const generatePDFPassword = (): string => {
  // Generate a secure but readable password
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let password = '';
  
  for (let i = 0; i < 8; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
    if (i === 3) password += '-'; // Add hyphen for readability
  }
  
  return password;
};