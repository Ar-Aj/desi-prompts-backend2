# Desi Prompts Backend

AI Prompt Pack E-commerce Backend API

## Quick Start

```bash
npm install
npm run dev
```

## Environment Variables

Create a `.env` file:

```env
NODE_ENV=development
PORT=3000
MONGODB_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret
RAZORPAY_KEY_ID=your_razorpay_key_id
RAZORPAY_KEY_SECRET=your_razorpay_key_secret
RAZORPAY_WEBHOOK_SECRET=your_razorpay_webhook_secret
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_access_key
AWS_REGION=ap-south-1
AWS_S3_BUCKET=your_s3_bucket_name
RESEND_API_KEY=your_resend_api_key
FRONTEND_URL=http://localhost:5173
ADMIN_URL=http://localhost:5174
```

## Deployment on Render

1. Push this repository to GitHub
2. Connect to Render
3. The `render.yaml` file will automatically configure:
   - **Build Command**: `npm run build`
   - **Start Command**: `npm start`
   - **Environment**: Node.js

## API Endpoints

- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login  
- `GET /api/products` - Get all products
- `POST /api/orders` - Create order
- `POST /api/payments/verify` - Verify Razorpay payment
- `GET /api/download/:fileId` - Download purchased files

## Tech Stack

- Node.js + Express
- MongoDB with Mongoose
- JWT Authentication
- Razorpay Payments
- AWS S3 for file storage
- Resend for emails