const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/app');
const Product = require('../src/models/Product');
const Competitor = require('../src/models/Competitor');
const PricingRule = require('../src/models/PricingRule');
const PriceRecommendation = require('../src/models/PriceRecommendation');
const { connectDB } = require('../src/config/db');
const {
  calculateMinimumSafePrice,
  calculateRecommendation,
  applyRounding,
  normalizeMargin,
  normalizeUndercut
} = require('../src/services/pricingService');

describe('Dynamic Pricing Engine Tests', () => {
  let testProduct;
  let testCompetitor;

  before(async () => {
    await connectDB();
    // Create dedicated test product (Cost: 600, Margin: 25% -> Safe floor: 800)
    testProduct = await Product.create({
      sku: 'TEST-PRICING-SKU-1',
      name: 'Noise Cancelling Studio Buds',
      brand: 'AcousticLab',
      costPrice: 600,
      sellingPrice: 999,
      minMargin: 0.25
    });

    // Create a linked competitor with price 850
    testCompetitor = await Competitor.create({
      productId: testProduct._id,
      merchantName: 'Flipkart',
      externalTitle: 'AcousticLab Studio Buds',
      url: 'https://www.flipkart.com/test-buds/p/test123',
      currentPrice: 850,
      trackingStatus: 'active',
      sourceType: 'search_result'
    });
  });

  after(async () => {
    if (testProduct) {
      await Competitor.deleteMany({ productId: testProduct._id });
      await PricingRule.deleteMany({ productId: testProduct._id });
      await PriceRecommendation.deleteMany({ productId: testProduct._id });
      await Product.findByIdAndDelete(testProduct._id);
    }
  });

  // 1. Minimum Safe Price & Margin Tests
  test('calculateMinimumSafePrice enforces formula Pmin = C / (1 - m)', () => {
    // PRD & user prompt example: Cost 600, Margin 25% (0.25) -> Minimum safe price 800
    const pMin = calculateMinimumSafePrice(600, 0.25);
    assert.equal(pMin, 800);

    // Margin as percentage: 25 -> 800
    assert.equal(calculateMinimumSafePrice(600, 25), 800);

    // Cost 1200, Margin 20% -> 1200 / 0.8 = 1500
    assert.equal(calculateMinimumSafePrice(1200, 0.2), 1500);
  });

  test('calculateMinimumSafePrice rejects invalid margins and costs', () => {
    assert.throws(() => calculateMinimumSafePrice(0, 0.25), /cost price must be a valid positive number/);
    assert.throws(() => calculateMinimumSafePrice(-100, 0.25), /cost price must be a valid positive number/);
    assert.throws(() => calculateMinimumSafePrice(600, -0.1), /cannot be negative/);
    assert.throws(() => calculateMinimumSafePrice(600, 1.0), /cannot be 100% or greater/);
    assert.throws(() => calculateMinimumSafePrice(600, 100), /cannot be 100% or greater/);
  });

  // 2. Competitor Undercut & Margin Floor Safeguard Tests
  test('calculateRecommendation enforces margin floor when undercut violates floor', () => {
    // Competitor: 850, Undercut: 10% -> Target: 765. Floor: 800.
    // Result MUST be 800 with floorApplied: true and explanatory text.
    const result = calculateRecommendation(
      testProduct,
      [testCompetitor],
      { minGrossMargin: 0.25, undercutPercentage: 10, roundingRule: 'nearest_rupee' }
    );

    assert.equal(result.floorApplied, true);
    assert.equal(result.calculatedTargetPrice, 765);
    assert.equal(result.recommendedPrice, 800);
    assert.equal(result.status, 'floor_limited');
    assert.ok(result.explanation.includes('margin floor'));
    assert.ok(result.explanation.includes('800'));
  });

  test('calculateRecommendation recommends profitable undercut when above floor', () => {
    // If competitor price is 999 with 10% undercut -> target is 899.10
    const highCompetitor = {
      _id: new mongoose.Types.ObjectId(),
      merchantName: 'Amazon',
      currentPrice: 999,
      trackingStatus: 'active'
    };

    const result = calculateRecommendation(
      testProduct,
      [highCompetitor],
      { minGrossMargin: 0.25, undercutPercentage: 10, roundingRule: 'nearest_rupee' }
    );

    assert.equal(result.floorApplied, false);
    assert.equal(result.calculatedTargetPrice, 899.1);
    assert.equal(result.recommendedPrice, 899); // Rounded to nearest rupee
    assert.equal(result.status, 'pending');
    assert.ok(result.expectedMargin >= 25);
  });

  test('calculateRecommendation handles missing or unreliable competitor prices', () => {
    // Product with no active competitors
    const result = calculateRecommendation(testProduct, [], { minGrossMargin: 0.25 });

    assert.equal(result.competitorPrice, null);
    assert.equal(result.status, 'no_competitor');
    assert.equal(result.recommendedPrice, testProduct.sellingPrice);
    assert.ok(result.explanation.includes('No active competitor'));
  });

  test('applyRounding respects rounding rules and protects safe floor', () => {
    // nearest_rupee
    assert.equal(applyRounding(899.1, 'nearest_rupee', 800), 899);
    assert.equal(applyRounding(899.6, 'nearest_rupee', 800), 900);

    // exact_cents
    assert.equal(applyRounding(899.1, 'exact_cents', 800), 899.1);

    // Floor protection: Even if rounding rounds down, it never goes below minimum safe price
    assert.equal(applyRounding(800.4, 'nearest_rupee', 801), 801);
  });

  // 3. API Endpoints Tests
  test('PUT /api/pricing/rules/:productId configures pricing rules', async () => {
    const res = await request(app)
      .put(`/api/pricing/rules/${testProduct._id}`)
      .send({
        minGrossMargin: 0.25,
        undercutPercentage: 10,
        strategy: 'lowest_competitor',
        roundingRule: 'nearest_rupee'
      })
      .expect(200);

    assert.equal(res.body.success, true);
    assert.equal(res.body.rule.minGrossMargin, 0.25);
    assert.equal(res.body.rule.undercutPercentage, 10);
  });

  test('POST /api/pricing/recommendations/:productId generates and saves recommendation in DB', async () => {
    const res = await request(app)
      .post(`/api/pricing/recommendations/${testProduct._id}`)
      .expect(201);

    assert.equal(res.body.success, true);
    const rec = res.body.recommendation;
    assert.equal(rec.recommendedPrice, 800);
    assert.equal(rec.floorApplied, true);
    assert.ok(rec.explanation.length > 20);

    // Verify persisted in DB
    const stored = await PriceRecommendation.findById(rec._id);
    assert.ok(stored);
    assert.equal(stored.recommendedPrice, 800);
  });

  test('POST /api/pricing/recommendations/:productId/approve updates product price safely', async () => {
    // Approve recommendation: Should update product.sellingPrice to 800
    const res = await request(app)
      .post(`/api/pricing/recommendations/${testProduct._id}/approve`)
      .expect(200);

    assert.equal(res.body.success, true);
    assert.equal(res.body.product.sellingPrice, 800);

    // Verify Product in MongoDB
    const updated = await Product.findById(testProduct._id);
    assert.equal(updated.sellingPrice, 800);
  });
});
