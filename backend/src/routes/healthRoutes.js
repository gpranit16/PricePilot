const express = require('express');
const { getDBStatus } = require('../config/db');

const router = express.Router();

/**
 * GET /api/health
 * Returns application health status, server uptime, environment, and MongoDB connection status.
 */
router.get('/health', (req, res) => {
  const dbStatus = getDBStatus();
  const isHealthy = dbStatus.status === 'connected';

  const healthPayload = {
    service: 'PricePilot Backend API',
    status: isHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    environment: process.env.NODE_ENV || 'development',
    database: {
      type: 'MongoDB Atlas',
      status: dbStatus.status,
      readyState: dbStatus.readyState,
      databaseName: dbStatus.databaseName,
      host: dbStatus.host
    },
    version: '1.0.0'
  };

  // Return HTTP 200 if server is running, even if DB is connecting or degraded,
  // but clearly indicate degraded state in payload.
  return res.status(200).json(healthPayload);
});

module.exports = router;
