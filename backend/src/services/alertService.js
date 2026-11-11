const Notification = require('../models/Notification');
const PriceObservation = require('../models/PriceObservation');

/**
 * Evaluates price change and stock availability transitions for a competitor.
 * Strictly adheres to P1 alerting rules:
 * - Only verified prices generate alerts.
 * - First scrape establishes a baseline without an alert.
 * - Changes to MRP alone do not trigger selling-price alerts.
 * - Zero duplicate alerts via unique eventId.
 * - Failed scrapes do not trigger alerts.
 * 
 * @param {Object} competitor - Competitor Mongoose document
 * @param {Object} currentScrape - Latest extraction result { sellingPrice, originalPrice, priceVerificationStatus, isAvailable, ... }
 * @param {Object} observation - The newly created PriceObservation document
 * @returns {Promise<Object|null>} Created notification document or null if no alert triggered
 */
async function evaluatePriceChangeAndNotify(competitor, currentScrape, observation) {
  if (!competitor || !currentScrape || !observation) {
    return null;
  }

  // Rule: Failed scrapes never trigger price-change alerts
  if (observation.status === 'failed') {
    return null;
  }

  // Rule: Never generate alerts from unverified SerpApi or Google Shopping estimates
  // Alerts are ONLY generated for verified direct extraction or verified stock changes
  const isVerifiedScrape = currentScrape.priceVerificationStatus === 'verified';
  const isUnavailableTransition =
    currentScrape.priceVerificationStatus === 'unavailable' || currentScrape.isAvailable === false;

  if (!isVerifiedScrape && !isUnavailableTransition) {
    return null;
  }

  const competitorId = competitor._id;
  const productId = competitor.productId;

  // Retrieve previous successful verified observations for this competitor (excluding the current observation)
  const previousObservations = await PriceObservation.find({
    competitorId,
    status: 'success',
    _id: { $ne: observation._id },
    priceVerificationStatus: { $in: ['verified', 'unavailable'] }
  })
    .sort({ observedAt: -1, createdAt: -1 })
    .limit(5)
    .lean();

  // Rule: Never generate a price alert for the first successful scrape. It establishes the baseline.
  if (previousObservations.length === 0) {
    return null;
  }

  const prevObs = previousObservations[0];
  const prevPrice = typeof prevObs.sellingPrice === 'number' && prevObs.sellingPrice > 0
    ? prevObs.sellingPrice
    : prevObs.price;

  const newPrice = typeof currentScrape.sellingPrice === 'number' && currentScrape.sellingPrice > 0
    ? currentScrape.sellingPrice
    : currentScrape.price;

  let alertType = null;
  let changeAmount = null;
  let changePercent = null;
  let message = '';

  const prevWasAvailable = prevObs.priceVerificationStatus !== 'unavailable';
  const currentIsAvailable = currentScrape.isAvailable !== false && currentScrape.priceVerificationStatus !== 'unavailable';

  // 1. Stock Availability Transitions
  if (prevWasAvailable && !currentIsAvailable) {
    // Transition: In-Stock -> Out of Stock
    alertType = 'out_of_stock';
    message = `Stock Alert: Product is now Out of Stock at ${competitor.merchantName} (${competitor.externalTitle}).`;
  } else if (!prevWasAvailable && currentIsAvailable && newPrice) {
    // Transition: Out of Stock -> Back in Stock
    alertType = 'back_in_stock';
    message = `Restock Alert: Product is Back in Stock at ${competitor.merchantName} at ₹${newPrice.toLocaleString('en-IN')}.`;
  } else if (currentIsAvailable && prevPrice && newPrice) {
    // 2. Selling Price Changes (Changes to MRP alone must NOT trigger alerts)
    if (newPrice < prevPrice) {
      alertType = 'price_drop';
      changeAmount = Math.round((newPrice - prevPrice) * 100) / 100;
      changePercent = Math.round(((newPrice - prevPrice) / prevPrice) * 1000) / 10;
      message = `Price Drop Alert: ${competitor.merchantName} reduced price by ₹${Math.abs(changeAmount).toLocaleString('en-IN')} (${Math.abs(changePercent)}%) from ₹${prevPrice.toLocaleString('en-IN')} to ₹${newPrice.toLocaleString('en-IN')}.`;
    } else if (newPrice > prevPrice) {
      alertType = 'price_increase';
      changeAmount = Math.round((newPrice - prevPrice) * 100) / 100;
      changePercent = Math.round(((newPrice - prevPrice) / prevPrice) * 1000) / 10;
      message = `Price Increase Alert: ${competitor.merchantName} raised price by ₹${changeAmount.toLocaleString('en-IN')} (+${changePercent}%) from ₹${prevPrice.toLocaleString('en-IN')} to ₹${newPrice.toLocaleString('en-IN')}.`;
    }
  }

  // If no qualifying price or stock change occurred, do not generate alert
  if (!alertType) {
    return null;
  }

  // Deduplication: construct deterministic eventId
  const eventId = `${competitorId}_${observation._id}_${alertType}`;

  // Check if notification with this eventId already exists
  const existing = await Notification.findOne({ eventId });
  if (existing) {
    return existing;
  }

  try {
    const notification = await Notification.create({
      type: alertType,
      productId,
      competitorId,
      previousPrice: prevPrice || null,
      newPrice: newPrice || null,
      changeAmount,
      changePercent,
      message,
      eventId,
      isRead: false
    });

    return notification;
  } catch (err) {
    // Handle duplicate key race condition gracefully
    if (err.code === 11000) {
      return await Notification.findOne({ eventId });
    }
    throw err;
  }
}

module.exports = {
  evaluatePriceChangeAndNotify
};

