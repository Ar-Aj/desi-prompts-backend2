import { sendEmail } from '../utils/email.utils';

async function testEmail() {
  try {
    console.log('Testing email sending...');
    
    const result = await sendEmail({
      to: 'test@example.com',
      subject: 'Test Email',
      html: '<h1>Test Email</h1><p>This is a test email.</p>'
    });
    
    console.log('Email sent successfully:', result);
  } catch (error) {
    console.error('Email sending failed:', error);
  }
}

testEmail();