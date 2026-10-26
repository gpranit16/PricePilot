const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/app');
const Product = require('../src/models/Product');
const { connectDB } = require('../src/config/db');

describe('Product Catalogue API Tests', () => {
  const testSku = 'TEST-SKU-999';

  before(async () => {
    await connectDB();
    // Clean up any test product if left over
    await Product.deleteMany({ sku: { $regex: /^TEST-SKU-/ } });
  });

  after(async () => {
    // Clean up
    await Product.deleteMany({ sku: { $regex: /^TEST-SKU-/ } });
  });

  test('POST /api/products creates a product with valid fields', async () => {
    const res = await request(app)
      .post('/api/products')
      .send({
        sku: testSku,
        name: 'Wireless Noise Cancelling Headphones',
        brand: 'SoundMaster',
        category: 'Electronics',
        costPrice: 1500,
        sellingPrice: 2200,
        imageUrl: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=100'
      })
      .expect(201);

    assert.equal(res.body.success, true);
    assert.equal(res.body.product.sku, testSku);
    assert.equal(res.body.product.costPrice, 1500);
    assert.equal(res.body.product.sellingPrice, 2200);
  });

  test('POST /api/products rejects duplicate SKU with 409', async () => {
    const res = await request(app)
      .post('/api/products')
      .send({
        sku: testSku,
        name: 'Another duplicate product',
        costPrice: 500,
        sellingPrice: 800
      })
      .expect(409);

    assert.equal(res.body.success, false);
    assert.equal(res.body.error, 'Duplicate SKU');
  });

  test('POST /api/products validates required fields and positive cost', async () => {
    const res = await request(app)
      .post('/api/products')
      .send({
        sku: 'TEST-SKU-INVALID',
        name: 'Invalid Price Item',
        costPrice: -10,
        sellingPrice: 100
      })
      .expect(400);

    assert.equal(res.body.success, false);
    assert.ok(res.body.message.includes('Cost price'));
  });

  test('GET /api/products returns products list and supports search', async () => {
    const res = await request(app)
      .get(`/api/products?search=${testSku}`)
      .expect(200);

    assert.equal(res.body.success, true);
    assert.ok(res.body.products.length >= 1);
    assert.equal(res.body.products[0].sku, testSku);
  });

  test('POST /api/products/import validates CSV and imports valid products', async () => {
    const csvContent = `sku,name,costPrice,sellingPrice,brand,category
TEST-SKU-CSV1,Minimalist Leather Wallet,450,899,UrbanCraft,Accessories
TEST-SKU-CSV2,Organic Cotton T-Shirt,250,599,EarthWear,Apparel
,Invalid Item Missing SKU,100,200,Brand,Gen
TEST-SKU-CSV3,Negative Cost Item,-50,200,Brand,Gen`;

    const res = await request(app)
      .post('/api/products/import')
      .send({ csvData: csvContent })
      .expect(200);

    assert.equal(res.body.success, true);
    assert.equal(res.body.createdCount, 2);
    assert.equal(res.body.failedCount, 2); // 2 invalid rows
    assert.ok(res.body.errors.length >= 2);
  });
});
