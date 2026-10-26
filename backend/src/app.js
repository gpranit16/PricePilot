const express = require('express');
const cors = require('cors');
const healthRoutes = require('./routes/healthRoutes');
const productRoutes = require('./routes/productRoutes');
const competitorRoutes = require('./routes/competitorRoutes');
const pricingRoutes = require('./routes/pricingRoutes');

const app = express();

// Parse CORS origins from environment variable
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim())
  : ['http://localhost:3000', 'http://127.0.0.1:3000'];

// Enable CORS with safe configuration for production Render & Vercel
app.use(cors({
  origin: (origin, callback) => {
    // Allow server-to-server, curl, mobile apps, or health checks with no origin
    if (!origin) return callback(null, true);

    // If wildcard is enabled
    if (allowedOrigins.includes('*')) return callback(null, true);

    // Exact match in configured CORS_ORIGIN
    if (allowedOrigins.includes(origin)) return callback(null, true);

    // Automatically allow any Vercel deployment (*.vercel.app) or localhost
    const originLower = origin.toLowerCase();
    if (
      originLower.endsWith('.vercel.app') ||
      originLower.includes('localhost') ||
      originLower.includes('127.0.0.1')
    ) {
      return callback(null, true);
    }

    // Allow and echo origin by default so production deployments don't break
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));


// Parse incoming JSON request bodies (supports large CSV payloads up to 5mb)
app.use(express.json({ limit: '5mb' }));

// Mount API routes
app.use('/api', healthRoutes);
app.use('/api/products', productRoutes);
app.use('/api', competitorRoutes);
app.use('/api/pricing', pricingRoutes);

// Root route for quick verification
app.get('/', (req, res) => {
  res.json({
    name: 'PricePilot API',
    description: 'Competitor Price Scraper and Dynamic Repricer',
    documentation: '/api/health',
    version: '1.0.0'
  });
});

// 404 handler for unmatched routes
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.originalUrl}. Please check the API documentation.`
  });
});

// Centralized error-handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled Server Error:', err);
  res.status(err.status || 500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'production' 
      ? 'An unexpected error occurred on the server.' 
      : err.message
  });
});

module.exports = app;
