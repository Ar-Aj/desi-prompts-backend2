import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import crypto from 'crypto';

const s3Client = new S3Client({
  region: process.env.S3_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!
  },
  ...(process.env.S3_ENDPOINT && { endpoint: process.env.S3_ENDPOINT })
});

export const uploadFile = async (
  file: Buffer,
  key: string,
  contentType: string
): Promise<string> => {
  try {
    const command = new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME!,
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
  key: string,
  expiresIn: number = 1800 // 30 minutes default
): Promise<string> => {
  try {
    const command = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME!,
      Key: key
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
