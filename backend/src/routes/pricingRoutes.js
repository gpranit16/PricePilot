const express = require('express');
const Product = require('../models/Product');
const Competitor = require('../models/Competitor');
const PricingRule = require('../models/PricingRule');
const PriceRecommendation = require('../models/PriceRecommendation');
const {
  calculateRecommendation,
  normalizeMargin,
  normalizeUndercut
} = require('../services/pricingService');

const router = express.Router();

/**
 * GET /api/pricing/rules/:productId
 * Retrieves the pricing rule for a specific product, or defaults if not configured yet.
 */
router.get('/rules/:productId', async (req, res, next) => {
  try {
    const { productId } = req.params;
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ success: false, error: 'Product Not Found' });
    }

    let rule = await PricingRule.findOne({ productId });
    if (!rule) {
      // Default rule representation
      rule = {
        productId,
        minGrossMargin: product.minMargin || 0.25,
        undercutPercentage: 5,
        strategy: 'lowest_competitor',
        roundingRule: 'nearest_rupee',
        isActive: true,
        isDefault: true
      };
    }

    return res.status(200).json({ success: true, rule });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/pricing/rules/:productId
 * Saves or updates pricing parameters for a specific product.
 */
router.put('/rules/:productId', async (req, res, next) => {
  try {
    const { productId } = req.params;
    const { minGrossMargin, undercutPercentage, strategy, roundingRule, isActive } = req.body;

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ success: false, error: 'Product Not Found' });
    }

    let normalizedMargin;
    let normalizedUndercut;

    try {
      normalizedMargin = normalizeMargin(minGrossMargin !== undefined ? minGrossMargin : 0.25);
      normalizedUndercut =
        (undercutPercentage !== undefined ? normalizeUndercut(undercutPercentage) : 0.05) * 100;
    } catch (valErr) {
      return res.status(400).json({ success: false, error: 'Validation Error', message: valErr.message });
    }

    const rule = await PricingRule.findOneAndUpdate(
      { productId },
      {
        productId,
        minGrossMargin: normalizedMargin,
        undercutPercentage: normalizedUndercut,
        strategy: strategy || 'lowest_competitor',
        roundingRule: roundingRule || 'nearest_rupee',
        isActive: isActive !== undefined ? Boolean(isActive) : true
      },
      { upsert: true, new: true, runValidators: true }
    );

    // Keep product minMargin in sync
    product.minMargin = normalizedMargin;
    await product.save();

    return res.status(200).json({ success: true, rule, message: 'Pricing rule saved successfully.' });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/pricing/recommendations/:productId
 * Generates and saves a dynamic pricing recommendation for a specific product.
 */
router.post('/recommendations/:productId', async (req, res, next) => {
  try {
    const { productId } = req.params;
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ success: false, error: 'Product Not Found' });
    }

    const rule = (await PricingRule.findOne({ productId })) || {
      minGrossMargin: product.minMargin || 0.25,
      undercutPercentage: 5,
      strategy: 'lowest_competitor',
      roundingRule: 'nearest_rupee'
    };

    const competitors = await Competitor.find({ productId, trackingStatus: 'active' });

    let recData;
    try {
      recData = calculateRecommendation(product, competitors, rule);
    } catch (calcErr) {
      return res.status(400).json({
        success: false,
        error: 'Calculation Error',
        message: calcErr.message
      });
    }

    // Persist recommendation record
    const recommendation = await PriceRecommendation.create({
      productId,
      pricingRuleId: rule._id || null,
      currentSellingPrice: recData.currentSellingPrice,
      productCostPrice: recData.productCostPrice,
      minimumSafePrice: recData.minimumSafePrice,
      competitorPrice: recData.competitorPrice,
      competitorId: recData.competitorId,
      competitorName: recData.competitorName,
      competitorSourceType: recData.competitorSourceType,
      calculatedTargetPrice: recData.calculatedTargetPrice,
      recommendedPrice: recData.recommendedPrice,
      expectedMargin: recData.expectedMargin,
      floorApplied: recData.floorApplied,
      status: recData.status,
      explanation: recData.explanation
    });

    return res.status(201).json({
      success: true,
      recommendation,
      productInfo: {
        name: product.name,
        sku: product.sku,
        brand: product.brand,
        costPrice: product.costPrice,
        sellingPrice: product.sellingPrice
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/pricing/recommendations/:productId
 * Retrieves the latest generated recommendation for a specific product.
 */
router.get('/recommendations/:productId', async (req, res, next) => {
  try {
    const { productId } = req.params;
    const recommendation = await PriceRecommendation.findOne({ productId }).sort({
      createdAt: -1
    });

    if (!recommendation) {
      return res.status(404).json({
        success: false,
        message: 'No recommendation generated yet for this product.'
      });
    }

    return res.status(200).json({ success: true, recommendation });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/pricing/recommendations
 * Lists all latest recommendations across all active products.
 */
router.get('/recommendations', async (req, res, next) => {
  try {
    const products = await Product.find({ status: 'active' }).sort({ name: 1 });

    const results = [];

    for (const prod of products) {
      // Find latest recommendation
      let rec = await PriceRecommendation.findOne({ productId: prod._id }).sort({
        createdAt: -1
      });

      // If no recommendation generated yet, generate one on-the-fly
      if (!rec) {
        const rule = (await PricingRule.findOne({ productId: prod._id })) || {
          minGrossMargin: prod.minMargin || 0.25,
          undercutPercentage: 5,
          strategy: 'lowest_competitor',
          roundingRule: 'nearest_rupee'
        };
        const competitors = await Competitor.find({ productId: prod._id, trackingStatus: 'active' });

        try {
          const recData = calculateRecommendation(prod, competitors, rule);
          rec = await PriceRecommendation.create({
            productId: prod._id,
            pricingRuleId: rule._id || null,
            currentSellingPrice: recData.currentSellingPrice,
            productCostPrice: recData.productCostPrice,
            minimumSafePrice: recData.minimumSafePrice,
            competitorPrice: recData.competitorPrice,
            competitorId: recData.competitorId,
            competitorName: recData.competitorName,
            competitorSourceType: recData.competitorSourceType,
            calculatedTargetPrice: recData.calculatedTargetPrice,
            recommendedPrice: recData.recommendedPrice,
            expectedMargin: recData.expectedMargin,
            floorApplied: recData.floorApplied,
            status: recData.status,
            explanation: recData.explanation
          });
        } catch (e) {
          // Skip if product has incomplete cost
          continue;
        }
      }

      results.push({
        product: prod,
        recommendation: rec
      });
    }

    return res.status(200).json({
      success: true,
      count: results.length,
      recommendations: results
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/pricing/recommendations/:productId/approve
 * Approves a recommendation and applies the recommended price to the product's sellingPrice.
 */
router.post('/recommendations/:productId/approve', async (req, res, next) => {
  try {
    const { productId } = req.params;
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ success: false, error: 'Product Not Found' });
    }

    const recommendation = await PriceRecommendation.findOne({ productId }).sort({
      createdAt: -1
    });

    if (!recommendation) {
      return res.status(404).json({
        success: false,
        error: 'No Recommendation Found',
        message: 'Please generate a recommendation before approving.'
      });
    }

    // Safety verification: Ensure recommended price never falls below minimum safe price
    const minSafePrice = product.costPrice / (1 - (product.minMargin || 0.25));
    if (recommendation.recommendedPrice < minSafePrice - 0.01) {
      return res.status(400).json({
        success: false,
        error: 'Margin Floor Violation',
        message: `Recommended price (₹${recommendation.recommendedPrice}) is below safe floor (₹${minSafePrice.toFixed(2)}). Approval rejected.`
      });
    }

    // Update product selling price
    const previousPrice = product.sellingPrice;
    product.sellingPrice = recommendation.recommendedPrice;
    await product.save();

    // Mark recommendation as approved
    recommendation.status = 'approved';
    recommendation.approvedAt = new Date();
    await recommendation.save();

    return res.status(200).json({
      success: true,
      message: `Price updated from ₹${previousPrice.toLocaleString('en-IN')} to ₹${product.sellingPrice.toLocaleString('en-IN')}.`,
      product,
      recommendation
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
