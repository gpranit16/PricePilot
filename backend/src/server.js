// Load environment variables before any other imports
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const app = require('./app');
const { connectDB } = require('./config/db');

const PORT = process.env.PORT || 5000;

async function startServer() {
  // Connect to MongoDB Atlas
  await connectDB();

  // Start Express server
  const server = app.listen(PORT, () => {
    console.log(`🚀 PricePilot Backend running on http://localhost:${PORT}`);
    console.log(`🩺 Health check available at: http://localhost:${PORT}/api/health`);
  });

  // Graceful shutdown handling
  const shutdown = async (signal) => {
    console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);
    server.close(async () => {
      console.log('HTTP server closed.');
      try {
        const mongoose = require('mongoose');
        await mongoose.connection.close(false);
        console.log('MongoDB connection closed.');
      } catch (err) {
        console.error('Error closing MongoDB connection:', err);
      }
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

startServer();
