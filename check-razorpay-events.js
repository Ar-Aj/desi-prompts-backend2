const mongoose = require('mongoose');

// Simple connection without environment config
const mongoUri = process.env.MONGODB_URI || 'mongodb+srv://abbajumma50_db_user:W3jgc8tUBVb7sChF@cluster0.yu7ejsh.mongodb.net/indian-promptpack?retryWrites=true&w=majority&appName=Cluster0';

mongoose.connect(mongoUri).then(async () => {
  // Define a simple schema for RazorpayEvent
  const razorpayEventSchema = new mongoose.Schema({
    eventId: String,
    eventType: String,
    status: String,
    createdAt: Date
  }, { collection: 'razorpayevents' });
  
  const RazorpayEvent = mongoose.model('RazorpayEvent', razorpayEventSchema);
  
  const count = await RazorpayEvent.countDocuments();
  console.log('Total Razorpay events in database:', count);
  
  const recent = await RazorpayEvent.find().sort({ createdAt: -1 }).limit(5);
  console.log('Most recent events:');
  recent.forEach(event => {
    console.log(`- ${event.eventType} (${event.status}) at ${event.createdAt}`);
  });
  
  mongoose.connection.close();
}).catch(err => {
  console.error('Database connection error:', err);
});