const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/app');
const Product = require('../src/models/Product');
const Competitor = require('../src/models/Competitor');
const PriceObservation = require('../src/models/PriceObservation');
const PricingRule = require('../src/models/PricingRule');
const PriceRecommendation = require('../src/models/PriceRecommendation');
const { connectDB } = require('../src/config/db');
const {
  getAIStatus,
  evaluateCompetitorMatchWithAI,
  generatePricingInsights,
  chatWithCopilot,
  executeCopilotTool,
  _clearCaches
} = require('../src/services/aiService');

describe('AI Integration & Intelligence Engine Tests', () => {
  let testProduct;
  let testCompetitorVerified;
  let testCompetitorUnverified;

  before(async () => {
    await connectDB();

    testProduct = await Product.create({
      sku: 'AI-TEST-SKU-99',
      name: 'SonicPulse Horizon 500 Headphones',
      brand: 'SonicPulse',
      category: 'Audio',
      costPrice: 1200,
      sellingPrice: 1999,
      minMargin: 0.25
    });

    testCompetitorVerified = await Competitor.create({
      productId: testProduct._id,
      merchantName: 'Flipkart',
      externalTitle: 'SonicPulse Horizon 500 Wireless ANC (Black)',
      url: 'https://www.flipkart.com/sonicpulse-horizon-500-test',
      currentPrice: 1699,
      sellingPrice: 1699,
      originalPrice: 2499,
      trackingStatus: 'active',
      priceVerificationStatus: 'verified',
      sourceType: 'direct_scrape'
    });

    testCompetitorUnverified = await Competitor.create({
      productId: testProduct._id,
      merchantName: 'SampleStore',
      externalTitle: 'SonicPulse Horizon 500 Deal',
      url: 'https://www.google.com/search?q=sonicpulse-test',
      currentPrice: 1399,
      sellingPrice: 1399,
      trackingStatus: 'active',
      priceVerificationStatus: 'unverified',
      sourceType: 'search_result'
    });

    await PriceObservation.create({
      competitorId: testCompetitorVerified._id,
      productId: testProduct._id,
      price: 1699,
      sellingPrice: 1699,
      originalPrice: 2499,
      sourceUrl: testCompetitorVerified.url,
      sourceType: 'direct_scrape',
      priceVerificationStatus: 'verified',
      status: 'success'
    });
  });

  after(async () => {
    if (testProduct) {
      await Competitor.deleteMany({ productId: testProduct._id });
      await PriceObservation.deleteMany({ productId: testProduct._id });
      await PricingRule.deleteMany({ productId: testProduct._id });
      await PriceRecommendation.deleteMany({ productId: testProduct._id });
      await Product.findByIdAndDelete(testProduct._id);
    }
  });

  beforeEach(() => {
    _clearCaches();
  });

  // 1. Status endpoint
  test('GET /api/ai/status returns configuration and quota status', async () => {
    const res = await request(app).get('/api/ai/status');
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(typeof res.body.enabled === 'boolean');
    assert.ok(res.body.model);
    assert.ok(typeof res.body.dailyUsage === 'number');
    assert.ok(typeof res.body.dailyLimit === 'number');
  });

  // 2. Deterministic exact SKU match
  test('evaluateCompetitorMatchWithAI: exact SKU match returns exact_match deterministically', async () => {
    const candidate = {
      title: 'SonicPulse Horizon 500 AI-TEST-SKU-99 Edition',
      merchantName: 'Retailer A'
    };
    const result = await evaluateCompetitorMatchWithAI(testProduct, candidate);
    assert.equal(result.decision, 'exact_match');
    assert.equal(result.confidence, 100);
    assert.equal(result.source, 'deterministic');
  });

  // 3. Deterministic model mismatch
  test('evaluateCompetitorMatchWithAI: different model returns mismatch deterministically', async () => {
    const candidate = {
      title: 'SonicPulse Horizon 200 Budget Earphones',
      merchantName: 'Retailer B'
    };
    const result = await evaluateCompetitorMatchWithAI(testProduct, candidate);
    assert.equal(result.decision, 'mismatch');
    assert.ok(result.confidence >= 80);
  });

  // 4. Repeated matching requests hit cache
  test('evaluateCompetitorMatchWithAI: repeated queries return cached result', async () => {
    const candidate = {
      title: 'SonicPulse Horizon 500 Wireless ANC (Black)',
      merchantName: 'Flipkart'
    };
    const first = await evaluateCompetitorMatchWithAI(testProduct, candidate);
    const second = await evaluateCompetitorMatchWithAI(testProduct, candidate);
    assert.equal(second.decision, first.decision);
    assert.equal(second.source, 'cache');
  });

  // 5. POST /api/products/:productId/competitors rejects tracking mismatches and accessories
  test('POST /api/products/:productId/competitors blocks tracking mismatches and accessories', async () => {
    const resMismatch = await request(app)
      .post(`/api/products/${testProduct._id}/competitors`)
      .send({
        merchantName: 'MismatchStore',
        externalTitle: 'Unrelated Wireless Mouse',
        url: 'https://www.example.com/mouse-123',
        sellingPrice: 500,
        aiMatch: { decision: 'mismatch' }
      });

    assert.equal(resMismatch.status, 400);
    assert.equal(resMismatch.body.error, 'Tracking Blocked');

    const resAccessory = await request(app)
      .post(`/api/products/${testProduct._id}/competitors`)
      .send({
        merchantName: 'CaseStore',
        externalTitle: 'Silicone Case Cover for Headphones',
        url: 'https://www.example.com/case-123',
        sellingPrice: 199,
        aiMatch: { decision: 'accessory' }
      });

    assert.equal(resAccessory.status, 400);
    assert.equal(resAccessory.body.error, 'Tracking Blocked');
  });

  // 6. Pricing Insights based on verified data only
  test('generatePricingInsights: detects verified cheaper competitors and ignores unverified ones for drops', async () => {
    const insightsData = await generatePricingInsights(true);
    assert.ok(insightsData.success);
    assert.ok(Array.isArray(insightsData.insights));
    assert.ok(insightsData.summary);

    // Flipkart verified price is 1699 vs store 1999 (should trigger pricing opportunity)
    const hasUnderpriced = insightsData.insights.some(
      (i) => i.type === 'pricing_opportunity' || i.title.toLowerCase().includes('cheaper')
    );
    assert.ok(hasUnderpriced, 'Should flag verified competitor price advantage');
  });

  // 7. GET /api/ai/insights returns structured insights
  test('GET /api/ai/insights returns cached or fresh insights data', async () => {
    const res = await request(app).get('/api/ai/insights');
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.data.summary);
    assert.ok(res.body.data.metrics);
  });

  // 8. Copilot Read-Only Tool Execution: searchProducts
  test('executeCopilotTool: searchProducts finds product by SKU and name', async () => {
    const result = await executeCopilotTool('searchProducts', { query: 'SonicPulse' });
    assert.ok(result.count >= 1);
    const found = result.products.find((p) => p.sku === 'AI-TEST-SKU-99');
    assert.ok(found);
    assert.equal(found.name, 'SonicPulse Horizon 500 Headphones');
  });

  // 9. Copilot Read-Only Tool Execution: getProductPricingSnapshot protects confidential cost
  test('executeCopilotTool: getProductPricingSnapshot returns snapshot without exposing costPrice', async () => {
    const result = await executeCopilotTool('getProductPricingSnapshot', {
      productId: testProduct._id.toString()
    });
    assert.ok(result.product);
    assert.equal(result.product.currentSellingPrice, 1999);
    // Confidential costPrice must NOT be present in tool output
    assert.equal(result.product.costPrice, undefined);
  });

  // 10. Copilot Read-Only Tool Execution: getCompetitorComparisons returns competitor prices
  test('executeCopilotTool: getCompetitorComparisons lists tracked competitors', async () => {
    const result = await executeCopilotTool('getCompetitorComparisons', {
      productId: testProduct._id.toString()
    });
    assert.ok(Array.isArray(result.competitors));
    assert.ok(result.competitors.length >= 2);
  });

  // 11. Copilot Read-Only Tool Execution: getBusinessSummary returns high-level metrics
  test('executeCopilotTool: getBusinessSummary returns valid totals', async () => {
    const result = await executeCopilotTool('getBusinessSummary', {});
    assert.ok(result.totalProducts >= 1);
    assert.ok(result.activeCompetitors >= 2);
    assert.equal(result.currency, 'INR');
  });

  // 12. Copilot rejects unrecognized tools safely
  test('executeCopilotTool: rejects non-allowlisted tool calls', async () => {
    const result = await executeCopilotTool('deleteProduct', { id: '123' });
    assert.ok(result.error);
    assert.ok(result.error.includes('not recognized'));
  });

  // 13. POST /api/ai/copilot/chat validates message presence
  test('POST /api/ai/copilot/chat returns 400 for empty query', async () => {
    const res = await request(app).post('/api/ai/copilot/chat').send({ message: '' });
    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
  });
});
