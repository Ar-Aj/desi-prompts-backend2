import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import crypto from 'crypto';
import { env } from '../config/environment.config';

const s3Client = new S3Client({
  region: env.s3.region,
  credentials: {
    accessKeyId: env.s3.accessKeyId!,
    secretAccessKey: env.s3.secretAccessKey!
  },
  endpoint: env.s3.endpoint
});

export const uploadFile = async (
  file: Buffer,
  key: string,
  contentType: string
): Promise<string> => {
  try {
    const command = new PutObjectCommand({
      Bucket: env.s3.bucketName!,
      Key: key,
      Body: file,
      ContentType: contentType
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
  expiresIn: number = 1800 // 30 minutes default
): Promise<string> => {
  try {
    // If it's already a full URL, return as is
    if (keyOrUrl.startsWith('http')) {
      return keyOrUrl;
    }
    
    // Otherwise, treat it as a key and generate a signed URL
    const command = new GetObjectCommand({
      Bucket: env.s3.bucketName!,
      Key: keyOrUrl
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn });
    return url;
  } catch (error) {
    console.error('Error generating signed URL:', error);
    throw new Error('Failed to generate download link');
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