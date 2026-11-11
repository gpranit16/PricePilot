const Competitor = require('../models/Competitor');
const Product = require('../models/Product');
const PriceObservation = require('../models/PriceObservation');
const { checkCompetitorPrice } = require('./scraperService');
const { evaluatePriceChangeAndNotify } = require('./alertService');

// In-memory state tracking
let isMonitoringRunning = false;
let schedulerTimer = null;
let lastMonitoringStats = {
  lastRunStartedAt: null,
  lastRunCompletedAt: null,
  totalCompetitors: 0,
  processedCompetitors: 0,
  successfulChecks: 0,
  failedChecks: 0,
  alertsGenerated: 0,
  isRunning: false,
  intervalMinutes: parseInt(process.env.PRICE_MONITOR_INTERVAL_MINUTES, 10) || 360
};

/**
 * Executes an automated monitoring run across all active competitors.
 * Uses controlled concurrency to prevent rate limits and overlapping execution.
 * 
 * @param {Object} options - { trigger: 'scheduled'|'manual' }
 * @returns {Promise<Object>} Run statistics
 */
async function runPriceMonitoring(options = {}) {
  const trigger = options.trigger || 'scheduled';

  // Mutual exclusion: Prevent overlapping runs
  if (isMonitoringRunning) {
    console.log(`⏱️ [PriceMonitor] Monitoring run already in progress (triggered by ${trigger}). Skipping duplicate run.`);
    return {
      skipped: true,
      reason: 'Monitoring run already in progress',
      stats: { ...lastMonitoringStats }
    };
  }

  isMonitoringRunning = true;
  const startedAt = new Date();
  lastMonitoringStats.lastRunStartedAt = startedAt;
  lastMonitoringStats.isRunning = true;

  console.log(`🚀 [PriceMonitor] Starting automated price check run (${trigger}) at ${startedAt.toISOString()}...`);

  let processed = 0;
  let successful = 0;
  let failed = 0;
  let alertsCount = 0;

  try {
    // 1. Fetch only active competitors (skip paused, unsupported, or deleted)
    const activeCompetitors = await Competitor.find({
      trackingStatus: 'active'
    }).populate('productId');

    console.log(`📋 [PriceMonitor] Found ${activeCompetitors.length} active competitors to monitor.`);
    lastMonitoringStats.totalCompetitors = activeCompetitors.length;

    // Process in controlled batches of 2 with brief pause to respect external rate limits
    const BATCH_SIZE = 2;
    for (let i = 0; i < activeCompetitors.length; i += BATCH_SIZE) {
      const batch = activeCompetitors.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map(async (competitor) => {
          processed++;
          const product = competitor.productId;

          try {
            const checkResult = await checkCompetitorPrice(competitor, product);

            // If a direct URL was discovered to replace a Google Search link, update competitor URL
            if (checkResult.directUrl && competitor.url.includes('google.com')) {
              competitor.url = checkResult.directUrl;
            }

            if (checkResult.success) {
              const newSellingPrice = checkResult.sellingPrice || checkResult.price || competitor.currentPrice;
              const newOriginalPrice = checkResult.originalPrice || competitor.originalPrice || null;
              const isAvailable = checkResult.isAvailable !== false && checkResult.priceVerificationStatus !== 'unavailable';
              const verificationStatus = checkResult.priceVerificationStatus || (checkResult.sourceType === 'direct_scrape' ? 'verified' : 'unverified');

              // Create price observation
              const observation = await PriceObservation.create({
                competitorId: competitor._id,
                productId: competitor.productId?._id || competitor.productId,
                price: newSellingPrice,
                sellingPrice: newSellingPrice,
                originalPrice: newOriginalPrice,
                discountPercent: checkResult.discountPercent || competitor.discountPercent || null,
                currency: checkResult.currency || competitor.currency || 'INR',
                sourceUrl: competitor.url,
                sourceType: checkResult.sourceType || competitor.sourceType || 'direct_scrape',
                priceVerificationStatus: isAvailable ? verificationStatus : 'unavailable',
                status: 'success',
                extractionMethod: checkResult.extractionMethod || 'Automated Monitor',
                notes: checkResult.message || `Automated monitor: ₹${newSellingPrice}`
              });

              // Check for price changes and trigger notifications
              try {
                const notification = await evaluatePriceChangeAndNotify(competitor, checkResult, observation);
                if (notification) {
                  alertsCount++;
                  console.log(`🔔 [PriceMonitor] Generated alert: ${notification.message}`);
                }
              } catch (alertErr) {
                console.warn(`⚠️ [PriceMonitor] Error evaluating price alert: ${alertErr.message}`);
              }

              // Update competitor document
              competitor.currentPrice = newSellingPrice;
              competitor.sellingPrice = newSellingPrice;
              if (newOriginalPrice) competitor.originalPrice = newOriginalPrice;
              if (checkResult.discountPercent) competitor.discountPercent = checkResult.discountPercent;
              competitor.isAvailable = isAvailable;
              competitor.priceVerificationStatus = isAvailable ? verificationStatus : 'unavailable';
              if (checkResult.sourceType) competitor.sourceType = checkResult.sourceType;
              competitor.lastCheckedAt = new Date();
              competitor.lastError = null;
              await competitor.save();

              successful++;
            } else {
              // Scrape failed: PRESERVE previous price and record failed attempt
              failed++;
              competitor.lastCheckedAt = new Date();
              competitor.lastError = checkResult.error || 'Monitoring check failed';
              await competitor.save();

              await PriceObservation.create({
                competitorId: competitor._id,
                productId: competitor.productId?._id || competitor.productId,
                price: competitor.currentPrice || competitor.sellingPrice || 0,
                sellingPrice: competitor.sellingPrice || competitor.currentPrice || null,
                originalPrice: competitor.originalPrice || null,
                currency: competitor.currency || 'INR',
                sourceUrl: competitor.url,
                sourceType: competitor.sourceType || 'direct_scrape',
                priceVerificationStatus: competitor.priceVerificationStatus || 'unverified',
                status: 'failed',
                notes: `Automated check failed: ${checkResult.error || 'Unknown error'}`
              });
            }
          } catch (compErr) {
            failed++;
            console.error(`❌ [PriceMonitor] Competitor check error (${competitor.merchantName}):`, compErr.message);

            // Preserve last valid price on unexpected failure
            try {
              competitor.lastCheckedAt = new Date();
              competitor.lastError = compErr.message;
              await competitor.save();

              await PriceObservation.create({
                competitorId: competitor._id,
                productId: competitor.productId?._id || competitor.productId,
                price: competitor.currentPrice || competitor.sellingPrice || 0,
                sellingPrice: competitor.sellingPrice || competitor.currentPrice || null,
                originalPrice: competitor.originalPrice || null,
                currency: competitor.currency || 'INR',
                sourceUrl: competitor.url,
                sourceType: competitor.sourceType || 'direct_scrape',
                priceVerificationStatus: competitor.priceVerificationStatus || 'unverified',
                status: 'failed',
                notes: `Monitoring error: ${compErr.message}`
              });
            } catch (innerErr) {
              console.warn('Failed to record failure observation:', innerErr.message);
            }
          }
        })
      );

      // Short delay between batches
      if (i + BATCH_SIZE < activeCompetitors.length) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
  } catch (err) {
    console.error('❌ [PriceMonitor] Fatal error during monitoring run:', err.message);
  } finally {
    const completedAt = new Date();
    isMonitoringRunning = false;
    lastMonitoringStats = {
      lastRunStartedAt: startedAt,
      lastRunCompletedAt: completedAt,
      totalCompetitors: lastMonitoringStats.totalCompetitors,
      processedCompetitors: processed,
      successfulChecks: successful,
      failedChecks: failed,
      alertsGenerated: alertsCount,
      isRunning: false,
      intervalMinutes: parseInt(process.env.PRICE_MONITOR_INTERVAL_MINUTES, 10) || 360,
      durationMs: completedAt.getTime() - startedAt.getTime()
    };

    console.log(`✅ [PriceMonitor] Completed run: ${processed} checked (${successful} ok, ${failed} failed), ${alertsCount} alerts in ${lastMonitoringStats.durationMs}ms`);
  }

  return {
    success: true,
    stats: { ...lastMonitoringStats }
  };
}

/**
 * Starts the recurring price monitoring scheduler.
 * Called only after database connection is ready.
 */
function startPriceMonitorScheduler() {
  const intervalMinutes = parseInt(process.env.PRICE_MONITOR_INTERVAL_MINUTES, 10) || 360;
  const intervalMs = Math.max(intervalMinutes * 60 * 1000, 60000); // Minimum 1 minute safeguard

  if (schedulerTimer) {
    clearInterval(schedulerTimer);
  }

  console.log(`⏰ [PriceMonitor] Initializing automated scheduler (Interval: ${intervalMinutes} minutes / ${intervalMinutes / 60} hours)...`);

  schedulerTimer = setInterval(() => {
    runPriceMonitoring({ trigger: 'scheduled' }).catch((err) => {
      console.error('Scheduled monitoring error:', err.message);
    });
  }, intervalMs);

  if (schedulerTimer.unref) {
    schedulerTimer.unref();
  }

  lastMonitoringStats.intervalMinutes = intervalMinutes;
  lastMonitoringStats.schedulerActive = true;
}

/**
 * Gracefully stops the scheduler timer during server shutdown.
 */
function stopPriceMonitorScheduler() {
  if (schedulerTimer) {
    console.log('🛑 [PriceMonitor] Stopping automated price monitoring scheduler...');
    clearInterval(schedulerTimer);
    schedulerTimer = null;
    lastMonitoringStats.schedulerActive = false;
  }
}

/**
 * Returns current monitoring status and telemetry.
 */
function getMonitoringStatus() {
  return {
    ...lastMonitoringStats,
    isRunning: isMonitoringRunning,
    schedulerActive: Boolean(schedulerTimer)
  };
}

module.exports = {
  runPriceMonitoring,
  startPriceMonitorScheduler,
  stopPriceMonitorScheduler,
  getMonitoringStatus
};

