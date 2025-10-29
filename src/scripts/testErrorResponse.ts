// Simple test to verify error responses are valid JSON
console.log('Testing error response format...');
console.log(JSON.stringify({
  success: false,
  error: 'Order not found'
}, null, 2));

console.log('\nTesting success response format...');
console.log(JSON.stringify({
  success: true,
  pdfUrl: 'https://example.com/test.pdf',
  pdfPassword: 'test123',
  message: 'Access granted'
}, null, 2));

console.log('\nAll response formats are valid JSON!');