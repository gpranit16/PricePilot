const express = require('express');
const Notification = require('../models/Notification');
const {
  runPriceMonitoring,
  getMonitoringStatus
} = require('../services/priceMonitorService');

const router = express.Router();

/**
 * GET /api/notifications
 * Retrieves paginated notifications with optional unread filter.
 */
router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const unreadOnly = req.query.unreadOnly === 'true';

    const filter = {};
    if (unreadOnly) {
      filter.isRead = false;
    }

    const total = await Notification.countDocuments(filter);
    const unreadCount = await Notification.countDocuments({ isRead: false });

    const notifications = await Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('productId', 'name sku brand currentPrice cost')
      .populate('competitorId', 'merchantName externalTitle url imageUrl currentPrice priceVerificationStatus')
      .lean();

    return res.status(200).json({
      success: true,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
      unreadCount,
      notifications
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/notifications/unread-count
 * Returns the total count of unread notifications.
 */
router.get('/unread-count', async (req, res, next) => {
  try {
    const unreadCount = await Notification.countDocuments({ isRead: false });
    return res.status(200).json({
      success: true,
      unreadCount
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/notifications/read-all
 * Marks all unread notifications as read.
 */
router.patch('/read-all', async (req, res, next) => {
  try {
    const result = await Notification.updateMany(
      { isRead: false },
      { $set: { isRead: true, readAt: new Date() } }
    );

    return res.status(200).json({
      success: true,
      message: 'All notifications marked as read.',
      updatedCount: result.modifiedCount || 0
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/notifications/:id/read
 * Marks a specific notification as read.
 */
router.patch('/:id/read', async (req, res, next) => {
  try {
    const notification = await Notification.findByIdAndUpdate(
      req.params.id,
      { $set: { isRead: true, readAt: new Date() } },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found.'
      });
    }

    return res.status(200).json({
      success: true,
      notification
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/monitoring/status
 * Returns automated price monitoring telemetry and status.
 */
router.get('/monitoring/status', (req, res) => {
  const status = getMonitoringStatus();
  return res.status(200).json({
    success: true,
    monitoring: status
  });
});

/**
 * POST /api/monitoring/run
 * Manually triggers an immediate price monitoring check.
 */
router.post('/monitoring/run', async (req, res, next) => {
  try {
    const result = await runPriceMonitoring({ trigger: 'manual' });
    return res.status(200).json({
      success: true,
      message: result.skipped ? result.reason : 'Automated price monitoring completed.',
      result
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

