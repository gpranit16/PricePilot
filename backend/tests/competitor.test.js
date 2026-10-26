const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/app');
const Product = require('../src/models/Product');
const Competitor = require('../src/models/Competitor');
const PriceObservation = require('../src/models/PriceObservation');
const { connectDB } = require('../src/config/db');
const { validateSafeUrl, extractPriceFromHtml } = require('../src/services/scraperService');

describe('Competitor Tracking & Scraping API Tests', () => {
  let sampleProduct;

  before(async () => {
    await connectDB();
    // Create a dedicated test product
    sampleProduct = await Product.create({
      sku: 'TEST-COMP-SKU-1',
      name: 'Wireless Bluetooth Noise Cancelling Headphones',
      brand: 'Sony',
      costPrice: 8000,
      sellingPrice: 12990
    });
  });

  after(async () => {
    if (sampleProduct) {
      await Competitor.deleteMany({ productId: sampleProduct._id });
      await PriceObservation.deleteMany({ productId: sampleProduct._id });
      await Product.findByIdAndDelete(sampleProduct._id);
    }
  });

  test('validateSafeUrl blocks SSRF, private IPs, and localhost', () => {
    assert.throws(() => validateSafeUrl('http://localhost:5000/secret'), /strictly blocked/);
    assert.throws(() => validateSafeUrl('http://127.0.0.1/admin'), /strictly blocked/);
    assert.throws(() => validateSafeUrl('http://169.254.169.254/latest/meta-data'), /strictly blocked/);
    assert.throws(() => validateSafeUrl('http://192.168.1.1/router'), /prohibited/);
    assert.throws(() => validateSafeUrl('ftp://example.com/file'), /protocol/);

    // Permitted safe external URLs
    const safe = validateSafeUrl('https://www.croma.com/p/12345');
    assert.equal(safe, 'https://www.croma.com/p/12345');
  });

  test('extractPriceFromHtml extracts prices from JSON-LD schema', () => {
    const htmlWithJsonLd = `
      <html>
        <head>
          <script type="application/ld+json">
          {
            "@context": "https://schema.org/",
            "@type": "Product",
            "name": "Wireless Noise Cancelling Headphones",
            "offers": {
              "@type": "Offer",
              "priceCurrency": "INR",
              "price": "11499.00"
            }
          }
          </script>
        </head>
        <body><h1>Product Page</h1></body>
      </html>
    `;

    const result = extractPriceFromHtml(htmlWithJsonLd);
    assert.ok(result);
    assert.equal(result.price, 11499);
    assert.equal(result.currency, 'INR');
    assert.equal(result.extractionMethod, 'JSON-LD Structured Data');
  });

  test('extractPriceFromHtml extracts prices from OpenGraph meta tags', () => {
    const htmlWithOg = `
      <html>
        <head>
          <meta property="og:price:amount" content="9,990" />
          <meta property="og:price:currency" content="INR" />
        </head>
        <body><div>Some content</div></body>
      </html>
    `;

    const result = extractPriceFromHtml(htmlWithOg);
    assert.ok(result);
    assert.equal(result.price, 9990);
    assert.equal(result.extractionMethod, 'OpenGraph Meta Tag');
  });

  test('POST /api/products/:productId/competitors saves competitor and records price history', async () => {
    const res = await request(app)
      .post(`/api/products/${sampleProduct._id}/competitors`)
      .send({
        merchantName: 'Croma Retail',
        externalTitle: 'Sony WH-1000XM4 Wireless Over Ear Headphones',
        url: 'https://www.croma.com/sony-wh-1000xm4/p/228198',
        currentPrice: 11990,
        currency: 'INR',
        sourceType: 'search_result'
      })
      .expect(201);

    assert.equal(res.body.success, true);
    assert.equal(res.body.competitor.merchantName, 'Croma Retail');
    assert.equal(res.body.competitor.currentPrice, 11990);

    // Verify price history was automatically recorded
    const historyRes = await request(app)
      .get(`/api/competitors/${res.body.competitor._id}/history`)
      .expect(200);

    assert.equal(historyRes.body.success, true);
    assert.equal(historyRes.body.count, 1);
    assert.equal(historyRes.body.history[0].price, 11990);
    assert.equal(historyRes.body.history[0].sourceType, 'search_result');
  });

  test('POST /api/products/:productId/competitors rejects duplicate URL for same product', async () => {
    const res = await request(app)
      .post(`/api/products/${sampleProduct._id}/competitors`)
      .send({
        merchantName: 'Duplicate Test',
        externalTitle: 'Duplicate Sony Headphones',
        url: 'https://www.croma.com/sony-wh-1000xm4/p/228198', // Same URL
        currentPrice: 11500
      })
      .expect(409);

    assert.equal(res.body.success, false);
    assert.equal(res.body.error, 'Duplicate Competitor');
  });

  test('POST /api/products/:productId/competitor-search handles discovery', async () => {
    // SerpApi search with configured key
    const res = await request(app)
      .post(`/api/products/${sampleProduct._id}/competitor-search`)
      .expect(200);

    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.candidates));
    console.log(`SerpApi returned ${res.body.candidates.length} candidates for test product`);
  });
});
