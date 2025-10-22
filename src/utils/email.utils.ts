import { Resend } from 'resend';
import * as nodemailer from 'nodemailer';
import { env } from '../config/environment.config';

const resend = env.email.resendApiKey ? new Resend(env.email.resendApiKey) : null;

// Fallback to nodemailer for development
const transporter = nodemailer.createTransport({
  host: 'localhost',
  port: 1025,
  ignoreTLS: true
});

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  attachments?: Array<{
    filename: string;
    content: Buffer;
  }>;
}

export const sendEmail = async (options: EmailOptions) => {
  try {
    console.log('Email sending attempt:', {
      to: options.to,
      subject: options.subject,
      hasResend: !!resend,
      nodeEnv: process.env.NODE_ENV,
      emailFrom: env.email.from,
      isProduction: process.env.NODE_ENV === 'production'
    });
    
    if (resend && process.env.NODE_ENV === 'production') {
      // Use Resend in production
      console.log('Sending email via Resend...');
      try {
        const result = await resend.emails.send({
          from: env.email.from!,
          to: options.to,
          subject: options.subject,
          html: options.html
        });
        console.log('Resend email sent successfully:', result);
        console.log('Check Resend dashboard for delivery status: https://resend.com/emails');
        return true;
      } catch (resendError: any) {
        console.error('Resend API error:', resendError);
        // Handle specific Resend errors
        if (resendError?.statusCode === 403 && resendError?.message?.includes('domain is not verified')) {
          console.error('DOMAIN VERIFICATION ERROR: Please verify your domain in the Resend dashboard');
          console.error('Visit: https://resend.com/domains to verify desiprompts.in');
        }
        throw resendError;
      }
    } else {
      // Use nodemailer in development
      console.log('Sending email via nodemailer (development fallback)...');
      const result = await transporter.sendMail({
        from: env.email.from || 'noreply@indianpromptpack.com',
        to: options.to,
        subject: options.subject,
        html: options.html,
        attachments: options.attachments
      });
      console.log('Nodemailer email sent successfully:', result);
      return true;
    }
  } catch (error) {
    console.error('Email sending failed:', error);
    // Log additional error details
    if (error && typeof error === 'object') {
      console.error('Error details:', JSON.stringify(error, null, 2));
    }
    throw error;
  }
};

export const getOrderConfirmationEmail = (
  customerName: string,
  orderNumber: string,
  purchaseId: string,
  products: Array<{ name: string; price: number }>,
  totalAmount: number,
  pdfPassword: string,
  downloadLink: string
) => {
  const productsList = products
    .map(p => `<li>${p.name} - ₹${p.price.toLocaleString('en-IN')}</li>`)
    .join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Arial', sans-serif; background-color: #f5f5f5; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; background-color: #191A1D; color: #ffffff; }
        .header { background: linear-gradient(135deg, #D4AF37 0%, #B8941F 100%); padding: 30px; text-align: center; }
        .header h1 { margin: 0; color: #191A1D; font-size: 28px; }
        .content { padding: 40px 30px; }
        .order-box { background-color: #1F2023; border: 1px solid #D4AF37; border-radius: 8px; padding: 20px; margin: 20px 0; }
        .password-box { background-color: #244c37; border: 2px solid #D4AF37; border-radius: 8px; padding: 20px; margin: 30px 0; text-align: center; }
        .password { font-size: 24px; font-weight: bold; color: #D4AF37; letter-spacing: 2px; margin: 10px 0; }
        .download-btn { display: inline-block; background-color: #D4AF37; color: #191A1D; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0; }
        .footer { background-color: #18181B; padding: 20px; text-align: center; color: #888; font-size: 12px; }
        ul { list-style: none; padding: 0; }
        li { padding: 8px 0; border-bottom: 1px solid #2A2B2E; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🎉 Order Confirmed!</h1>
        </div>
        <div class="content">
          <p>Dear ${customerName},</p>
          <p>Thank you for your purchase! Your order has been successfully processed.</p>
          
          <div class="order-box">
            <h2 style="color: #D4AF37;">Order Details</h2>
            <p><strong>Order Number:</strong> ${orderNumber}</p>
            <p><strong>Purchase ID:</strong> <span style="color: #D4AF37; font-size: 18px; font-weight: bold;">${purchaseId}</span></p>
            <p style="font-size: 14px; color: #aaa;">💡 Save this Purchase ID for easy reference when contacting support</p>
            <p><strong>Products:</strong></p>
            <ul>${productsList}</ul>
            <p style="font-size: 18px; color: #D4AF37;"><strong>Total Amount: ₹${totalAmount.toLocaleString('en-IN')}</strong></p>
          </div>
          
          <div class="password-box">
            <h3 style="color: #ffffff;">Your PDF Password</h3>
            <p style="color: #cccccc;">Use this password to unlock your prompt pack:</p>
            <div class="password">${pdfPassword}</div>
            <p style="color: #cccccc; font-size: 12px;">Please save this password securely</p>
          </div>
          
          <div style="text-align: center;">
            <a href="${downloadLink}" class="download-btn">Download Your Prompt Pack</a>
            <p style="font-size: 12px; color: #888;">This link will expire in 30 minutes</p>
          </div>
          
          <p style="margin-top: 30px;">If you have any questions or issues regarding your purchase, please contact our support team and provide your <strong>Purchase ID: ${purchaseId}</strong> for faster assistance.</p>
          <p>Best regards,<br>The Desi Prompts Team</p>
        </div>
        <div class="footer">
          <p>© 2024 Desi Prompts. All rights reserved.</p>
          <p>This is an automated email. Please do not reply to this message.</p>
        </div>
      </div>
    </body>
    </html>
  `;
};

export const getWelcomeEmail = (userName: string) => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Arial', sans-serif; background-color: #f5f5f5; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; background-color: #191A1D; color: #ffffff; }
        .header { background: linear-gradient(135deg, #D4AF37 0%, #B8941F 100%); padding: 30px; text-align: center; }
        .content { padding: 40px 30px; }
        .cta-btn { display: inline-block; background-color: #D4AF37; color: #191A1D; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0; }
        .footer { background-color: #18181B; padding: 20px; text-align: center; color: #888; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1 style="color: #191A1D;">Welcome to Desi Prompts!</h1>
        </div>
        <div class="content">
          <p>Dear ${userName},</p>
          <p>Welcome to the premium destination for high-quality prompt packs!</p>
          <p>As a registered member, you'll enjoy:</p>
          <ul>
            <li>✨ Exclusive discounts on all products</li>
            <li>📧 Early access to new prompt packs</li>
            <li>💾 Order history and easy re-downloads</li>
            <li>⭐ Ability to leave reviews and help others</li>
          </ul>
          <div style="text-align: center;">
            <a href="${env.frontendUrl}" class="cta-btn">Start Shopping</a>
          </div>
          <p>Thank you for joining us!</p>
          <p>Best regards,<br>The Desi Prompts Team</p>
        </div>
        <div class="footer">
          <p>© 2024 Desi Prompts. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;
};
