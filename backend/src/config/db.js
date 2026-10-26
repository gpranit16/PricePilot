const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

/**
 * Maps Mongoose numeric readyState codes to human-readable strings.
 * 0 = Disconnected
 * 1 = Connected
 * 2 = Connecting
 * 3 = Disconnecting
 */
function getMongooseStateLabel(stateNumber) {
  switch (stateNumber) {
    case 1:
      return 'connected';
    case 2:
      return 'connecting';
    case 3:
      return 'disconnecting';
    case 0:
    default:
      return 'disconnected';
  }
}

/**
 * Returns the current database status object for health checks and diagnostics.
 */
function getDBStatus() {
  const readyState = mongoose.connection.readyState;
  return {
    status: getMongooseStateLabel(readyState),
    readyState: readyState,
    databaseName: mongoose.connection.name || null,
    host: mongoose.connection.host || null
  };
}

/**
 * Connects to MongoDB Atlas using Mongoose.
 * If MONGODB_URI is missing, it logs a clear warning without silently crashing.
 */
async function connectDB() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    console.error('⚠️ [Database Error]: MONGODB_URI is not set in backend/.env!');
    console.error('Please configure your MongoDB Atlas connection string in backend/.env');
    return { success: false, error: 'MONGODB_URI environment variable is missing' };
  }

  try {
    console.log('🔄 Connecting to MongoDB Atlas...');
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 8000 // Timeout after 8s if network or auth fails
    });

    console.log(`✅ MongoDB Connected successfully: ${conn.connection.host} (DB: ${conn.connection.name})`);
    return { success: true, host: conn.connection.host, database: conn.connection.name };
  } catch (error) {
    console.error(`❌ MongoDB Connection Failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

module.exports = {
  connectDB,
  getDBStatus
};
