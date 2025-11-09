const mongoose = require('mongoose');

// Load environment variables
require('dotenv').config();

// Connect to database
const mongoUri = process.env.MONGODB_URI_PROD || process.env.MONGODB_URI || 'mongodb+srv://abbajumma50_db_user:W3jgc8tUBVb7sChF@cluster0.yu7ejsh.mongodb.net/desiprompts-prod?retryWrites=true&w=majority&appName=Cluster0';

console.log('Connecting to:', mongoUri);

mongoose.connect(mongoUri).then(async () => {
  console.log('Connected to database');
  
  // Get the Product model
  const productSchema = new mongoose.Schema({
    name: String,
    images: [String]
  }, { collection: 'products' });
  
  const Product = mongoose.model('Product', productSchema);
  
  const products = await Product.find({ isActive: true }).select('name images');
  console.log('Products and their image URLs:');
  products.forEach(p => {
    console.log(p.name + ':');
    p.images.forEach(img => console.log('  ' + img));
  });
  
  mongoose.connection.close();
}).catch(err => {
  console.error('Database connection error:', err);
});