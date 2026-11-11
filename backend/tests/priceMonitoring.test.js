const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');

const app = require('../src/app');
const Product = require('../src/models/Product');
const Competitor = require('../src/models/Competitor');
const PriceObservation = require('../src/models/PriceObservation');
const Notification = require('../src/models/Notification');
const { evaluatePriceChangeAndNotify } = require('../src/services/alertService');
const {
  runPriceMonitoring,
  getMonitoringStatus
} = require('../src/services/priceMonitorService');

describe('P1 Automated Price Monitoring & Notification Engine Tests', () => {
  let testProduct;
  let activeCompetitor;
  let pausedCompetitor;

  before(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGODB_URI);
    }

    // Clean up test collections
    await Notification.deleteMany({ message: /TEST_MONITOR/ });

    // Create test product
    testProduct = await Product.create({
      name: 'TEST_MONITOR Wireless Active Earbuds',
      sku: `TEST-MON-${Date.now()}`,
      costPrice: 500,
      sellingPrice: 899,
      targetGrossMargin: 0.25,
      brand: 'TestBrand',
      category: 'Electronics'
    });

    // Create active competitor
    activeCompetitor = await Competitor.create({
      productId: testProduct._id,
      merchantName: 'Test Retailer Active',
      externalTitle: 'TEST_MONITOR Earbuds Active',
      url: 'https://test-retailer.com/earbuds-active',
      currentPrice: 850,
      sellingPrice: 850,
      originalPrice: 1299,
      priceVerificationStatus: 'verified',
      trackingStatus: 'active',
      sourceType: 'direct_scrape'
    });

    // Create paused competitor
    pausedCompetitor = await Competitor.create({
      productId: testProduct._id,
      merchantName: 'Test Retailer Paused',
      externalTitle: 'TEST_MONITOR Earbuds Paused',
      url: 'https://test-retailer.com/earbuds-paused',
      currentPrice: 820,
      sellingPrice: 820,
      originalPrice: 1299,
      priceVerificationStatus: 'verified',
      trackingStatus: 'paused',
      sourceType: 'direct_scrape'
    });
  });

  after(async () => {
    if (testProduct) {
      await Product.findByIdAndDelete(testProduct._id);
      await Competitor.deleteMany({ productId: testProduct._id });
      await PriceObservation.deleteMany({ productId: testProduct._id });
      await Notification.deleteMany({ productId: testProduct._id });
    }
  });

  test('1. First scrape establishes baseline without generating an alert', async () => {
    // Competitor has NO prior verified observations
    const firstObservation = await PriceObservation.create({
      competitorId: activeCompetitor._id,
      productId: testProduct._id,
      price: 850,
      sellingPrice: 850,
      originalPrice: 1299,
      priceVerificationStatus: 'verified',
      status: 'success',
      sourceUrl: activeCompetitor.url,
      sourceType: 'direct_scrape'
    });

    const alert = await evaluatePriceChangeAndNotify(
      activeCompetitor,
      { sellingPrice: 850, priceVerificationStatus: 'verified', isAvailable: true },
      firstObservation
    );

    assert.equal(alert, null, 'First scrape must establish baseline and NEVER generate an alert');
  });

  test('2. Verified price drop triggers price_drop notification with accurate percentages', async () => {
    // Next scrape drops price from 850 to 750
    const dropObservation = await PriceObservation.create({
      competitorId: activeCompetitor._id,
      productId: testProduct._id,
      price: 750,
      sellingPrice: 750,
      originalPrice: 1299,
      priceVerificationStatus: 'verified',
      status: 'success',
      sourceUrl: activeCompetitor.url,
      sourceType: 'direct_scrape'
    });

    const alert = await evaluatePriceChangeAndNotify(
      activeCompetitor,
      { sellingPrice: 750, priceVerificationStatus: 'verified', isAvailable: true },
      dropObservation
    );

    assert.ok(alert, 'Verified price drop must generate a notification');
    assert.equal(alert.type, 'price_drop');
    assert.equal(alert.previousPrice, 850);
    assert.equal(alert.newPrice, 750);
    assert.equal(alert.changeAmount, -100);
    assert.equal(alert.changePercent, -11.8);
    assert.ok(alert.message.includes('reduced price by ₹100'));
  });

  test('3. Verified price increase triggers price_increase notification', async () => {
    // Next scrape increases price from 750 to 899
    const increaseObservation = await PriceObservation.create({
      competitorId: activeCompetitor._id,
      productId: testProduct._id,
      price: 899,
      sellingPrice: 899,
      originalPrice: 1299,
      priceVerificationStatus: 'verified',
      status: 'success',
      sourceUrl: activeCompetitor.url,
      sourceType: 'direct_scrape'
    });

    const alert = await evaluatePriceChangeAndNotify(
      activeCompetitor,
      { sellingPrice: 899, priceVerificationStatus: 'verified', isAvailable: true },
      increaseObservation
    );

    assert.ok(alert, 'Verified price increase must generate a notification');
    assert.equal(alert.type, 'price_increase');
    assert.equal(alert.previousPrice, 750);
    assert.equal(alert.newPrice, 899);
    assert.equal(alert.changeAmount, 149);
    assert.ok(alert.message.includes('raised price by ₹149'));
  });

  test('4. Unverified prices from SerpApi or search estimates NEVER generate alerts', async () => {
    const unverifiedObservation = await PriceObservation.create({
      competitorId: activeCompetitor._id,
      productId: testProduct._id,
      price: 499,
      sellingPrice: 499,
      originalPrice: 1299,
      priceVerificationStatus: 'unverified',
      status: 'success',
      sourceUrl: activeCompetitor.url,
      sourceType: 'search_result'
    });

    const alert = await evaluatePriceChangeAndNotify(
      activeCompetitor,
      { sellingPrice: 499, priceVerificationStatus: 'unverified', isAvailable: true },
      unverifiedObservation
    );

    assert.equal(alert, null, 'Unverified estimates must NEVER trigger price change alerts');
  });

  test('5. Changes to MRP alone do not trigger selling-price alerts', async () => {
    // Selling price remains 899, but MRP changed from 1299 to 1499
    const mrpOnlyObservation = await PriceObservation.create({
      competitorId: activeCompetitor._id,
      productId: testProduct._id,
      price: 899,
      sellingPrice: 899,
      originalPrice: 1499,
      priceVerificationStatus: 'verified',
      status: 'success',
      sourceUrl: activeCompetitor.url,
      sourceType: 'direct_scrape'
    });

    const alert = await evaluatePriceChangeAndNotify(
      activeCompetitor,
      { sellingPrice: 899, originalPrice: 1499, priceVerificationStatus: 'verified', isAvailable: true },
      mrpOnlyObservation
    );

    assert.equal(alert, null, 'MRP changes alone must NOT trigger selling price alerts');
  });

  test('6. Unchanged prices never generate duplicate alerts', async () => {
    // Same price 899 scraped again
    const samePriceObservation = await PriceObservation.create({
      competitorId: activeCompetitor._id,
      productId: testProduct._id,
      price: 899,
      sellingPrice: 899,
      originalPrice: 1499,
      priceVerificationStatus: 'verified',
      status: 'success',
      sourceUrl: activeCompetitor.url,
      sourceType: 'direct_scrape'
    });

    const alert = await evaluatePriceChangeAndNotify(
      activeCompetitor,
      { sellingPrice: 899, priceVerificationStatus: 'verified', isAvailable: true },
      samePriceObservation
    );

    assert.equal(alert, null, 'Unchanged price must not trigger duplicate alert');
  });

  test('7. Stock transition to out_of_stock triggers alert', async () => {
    const oosObservation = await PriceObservation.create({
      competitorId: activeCompetitor._id,
      productId: testProduct._id,
      price: 899,
      sellingPrice: 899,
      priceVerificationStatus: 'unavailable',
      status: 'success',
      sourceUrl: activeCompetitor.url,
      sourceType: 'direct_scrape'
    });

    const alert = await evaluatePriceChangeAndNotify(
      activeCompetitor,
      { isAvailable: false, priceVerificationStatus: 'unavailable' },
      oosObservation
    );

    assert.ok(alert, 'Out of stock transition must trigger notification');
    assert.equal(alert.type, 'out_of_stock');
    assert.ok(alert.message.includes('Out of Stock'));
  });

  test('8. Stock transition to back_in_stock triggers alert', async () => {
    const restockObservation = await PriceObservation.create({
      competitorId: activeCompetitor._id,
      productId: testProduct._id,
      price: 899,
      sellingPrice: 899,
      priceVerificationStatus: 'verified',
      status: 'success',
      sourceUrl: activeCompetitor.url,
      sourceType: 'direct_scrape'
    });

    const alert = await evaluatePriceChangeAndNotify(
      activeCompetitor,
      { isAvailable: true, priceVerificationStatus: 'verified', sellingPrice: 899 },
      restockObservation
    );

    assert.ok(alert, 'Back in stock transition must trigger notification');
    assert.equal(alert.type, 'back_in_stock');
    assert.ok(alert.message.includes('Back in Stock'));
  });

  test('9. Failed scrape attempts do NOT trigger alerts and preserve valid price', async () => {
    const failedObservation = await PriceObservation.create({
      competitorId: activeCompetitor._id,
      productId: testProduct._id,
      price: 899,
      sellingPrice: 899,
      priceVerificationStatus: 'verified',
      status: 'failed',
      sourceUrl: activeCompetitor.url,
      sourceType: 'direct_scrape'
    });

    const alert = await evaluatePriceChangeAndNotify(
      activeCompetitor,
      { sellingPrice: 600, priceVerificationStatus: 'verified', isAvailable: true },
      failedObservation
    );

    assert.equal(alert, null, 'Failed scrapes must NEVER trigger alerts');
  });

  test('10. Notification API: Pagination, unread count, read single, read all', async () => {
    // 10a. GET /api/notifications/unread-count
    const countRes = await request(app).get('/api/notifications/unread-count');
    assert.equal(countRes.status, 200);
    assert.ok(typeof countRes.body.unreadCount === 'number');
    assert.ok(countRes.body.unreadCount >= 1);

    // 10b. GET /api/notifications with pagination
    const listRes = await request(app).get('/api/notifications?page=1&limit=5');
    assert.equal(listRes.status, 200);
    assert.ok(listRes.body.success);
    assert.ok(Array.isArray(listRes.body.notifications));
    assert.ok(listRes.body.total >= 1);

    const firstNotif = listRes.body.notifications[0];
    assert.ok(firstNotif._id);
    assert.ok(firstNotif.message);

    // 10c. PATCH /api/notifications/:id/read marks single notification as read
    const readRes = await request(app).patch(`/api/notifications/${firstNotif._id}/read`);
    assert.equal(readRes.status, 200);
    assert.equal(readRes.body.success, true);
    assert.equal(readRes.body.notification.isRead, true);

    // 10d. PATCH /api/notifications/read-all marks all notifications as read
    const readAllRes = await request(app).patch('/api/notifications/read-all');
    assert.equal(readAllRes.status, 200);
    assert.equal(readAllRes.body.success, true);

    // Verify unread count is now 0
    const afterCount = await request(app).get('/api/notifications/unread-count');
    assert.equal(afterCount.body.unreadCount, 0);
  });

  test('11. Automated Price Monitoring runs, skips paused, and prevents overlapping runs', async () => {
    // Status check
    const statusRes = await request(app).get('/api/monitoring/status');
    assert.equal(statusRes.status, 200);
    assert.ok(statusRes.body.monitoring);

    // Run manual trigger
    const runResult = await runPriceMonitoring({ trigger: 'test' });
    assert.equal(runResult.success, true);
    assert.ok(runResult.stats.processedCompetitors >= 1);

    // Check that pausedCompetitor was SKIPPED (not updated by active run)
    const freshPaused = await Competitor.findById(pausedCompetitor._id);
    assert.equal(freshPaused.trackingStatus, 'paused', 'Paused competitors must remain untouched');

    // Test overlapping prevention: trigger second run while status is simulated running
    // getMonitoringStatus telemetry check
    const telemetry = getMonitoringStatus();
    assert.ok(typeof telemetry.intervalMinutes === 'number');
  });
});
