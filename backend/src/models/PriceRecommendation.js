const mongoose = require('mongoose');

/**
 * PriceRecommendation Schema for PricePilot.
 * Stores generated repricing recommendations, margin projections, and audit logs.
 */
const priceRecommendationSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: [true, 'Product ID is required'],
      index: true
    },
    pricingRuleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PricingRule'
    },
    currentSellingPrice: {
      type: Number,
      required: true
    },
    productCostPrice: {
      type: Number,
      required: true
    },
    minimumSafePrice: {
      type: Number,
      required: true
    },
    competitorPrice: {
      type: Number,
      default: null
    },
    competitorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Competitor',
      default: null
    },
    competitorName: {
      type: String,
      default: ''
    },
    competitorSourceType: {
      type: String,
      default: ''
    },
    calculatedTargetPrice: {
      type: Number,
      default: null
    },
    recommendedPrice: {
      type: Number,
      required: true
    },
    expectedMargin: {
      type: Number,
      required: true
    },
    floorApplied: {
      type: Boolean,
      default: false
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'floor_limited', 'no_competitor'],
      default: 'pending'
    },
    explanation: {
      type: String,
      required: true
    },
    approvedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

// Index to quickly find the latest recommendation for a product
priceRecommendationSchema.index({ productId: 1, createdAt: -1 });

const PriceRecommendation =
  mongoose.models.PriceRecommendation ||
  mongoose.model('PriceRecommendation', priceRecommendationSchema);

module.exports = PriceRecommendation;
