const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/app');

describe('PricePilot Health Endpoint Tests', () => {
  test('GET /api/health returns 200 and valid JSON schema', async () => {
    const response = await request(app)
      .get('/api/health')
      .expect(200)
      .expect('Content-Type', /json/);

    assert.equal(response.body.service, 'PricePilot Backend API');
    assert.ok(response.body.timestamp);
    assert.ok(typeof response.body.uptimeSeconds === 'number');
    assert.ok(response.body.database);
    assert.equal(response.body.database.type, 'MongoDB Atlas');
    assert.ok(['connected', 'disconnected', 'connecting', 'disconnecting'].includes(response.body.database.status));
  });

  test('GET / returns root API overview', async () => {
    const response = await request(app)
      .get('/')
      .expect(200)
      .expect('Content-Type', /json/);

    assert.equal(response.body.name, 'PricePilot API');
    assert.equal(response.body.documentation, '/api/health');
  });

  test('GET /api/nonexistent returns 404 with structured error', async () => {
    const response = await request(app)
      .get('/api/nonexistent')
      .expect(404)
      .expect('Content-Type', /json/);

    assert.equal(response.body.error, 'Not Found');
    assert.ok(response.body.message.includes('Cannot GET /api/nonexistent'));
  });
});
