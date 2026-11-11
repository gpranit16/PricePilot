const express = require('express');
const Product = require('../models/Product');
const {
  getAIStatus,
  evaluateCompetitorMatchWithAI,
  generatePricingInsights,
  chatWithCopilot
} = require('../services/aiService');

const router = express.Router();

/**
 * GET /api/ai/status
 * Returns operational status, model, and daily usage without revealing API keys.
 */
router.get('/status', (req, res) => {
  const status = getAIStatus();
  return res.status(200).json({
    success: true,
    ...status
  });
});

/**
 * POST /api/ai/match
 * Evaluates whether a competitor product listing matches a merchant product.
 */
router.post('/match', async (req, res, next) => {
  try {
    const { productId, candidate } = req.body;
    if (!productId || !candidate) {
      return res.status(400).json({
        success: false,
        error: 'Missing Parameters',
        message: 'productId and candidate object are required.'
      });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product Not Found',
        message: `Product with ID '${productId}' was not found.`
      });
    }

    const matchResult = await evaluateCompetitorMatchWithAI(product, candidate);
    return res.status(200).json({
      success: true,
      match: matchResult
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/ai/insights
 * Returns synthesized business pricing insights based on live verified MongoDB data.
 */
router.get('/insights', async (req, res, next) => {
  try {
    const insights = await generatePricingInsights(false);
    return res.status(200).json({
      success: true,
      data: insights
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/ai/insights/refresh
 * Forces recalculation and regeneration of pricing insights.
 */
router.post('/insights/refresh', async (req, res, next) => {
  try {
    const insights = await generatePricingInsights(true);
    return res.status(200).json({
      success: true,
      message: 'Pricing insights recalculated.',
      data: insights
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/ai/copilot/chat
 * Multi-turn conversational pricing copilot.
 */
router.post('/copilot/chat', async (req, res, next) => {
  try {
    const { message, history } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Invalid Request',
        message: 'Message cannot be empty.'
      });
    }

    const result = await chatWithCopilot(message, Array.isArray(history) ? history : []);
    return res.status(200).json({
      success: true,
      ...result
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

