const mongoose = require('mongoose');

/**
 * PriceRecommendation Schema for PricePilot.
 * Stores generated repricing recommendations, margin projections, and full approval/rejection audit logs.
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
    strategy: {
      type: String,
      default: 'lowest_competitor'
    },
    currentSellingPrice: {
      type: Number,
      required: true
    },
    previousPrice: {
      type: Number,
      default: function () {
        return this.currentSellingPrice;
      }
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
    expectedProfit: {
      type: Number,
      default: function () {
        return Math.round((this.recommendedPrice - this.productCostPrice) * 100) / 100;
      }
    },
    priceDifference: {
      type: Number,
      default: function () {
        return Math.round((this.recommendedPrice - this.currentSellingPrice) * 100) / 100;
      }
    },
    riskLevel: {
      type: String,
      enum: ['profitable', 'risky', 'blocked'],
      default: 'profitable'
    },
    floorApplied: {
      type: Boolean,
      default: false
    },
    boundApplied: {
      type: String,
      enum: ['min_bound', 'max_bound', 'none'],
      default: 'none'
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'floor_limited', 'no_competitor', 'blocked'],
      default: 'pending'
    },
    explanation: {
      type: String,
      required: true
    },
    rejectionReason: {
      type: String,
      default: null
    },
    approvedPrice: {
      type: Number,
      default: null
    },
    approvedAt: {
      type: Date,
      default: null
    },
    rejectedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

// Compound index for querying latest recommendation or history by product
priceRecommendationSchema.index({ productId: 1, createdAt: -1 });
priceRecommendationSchema.index({ status: 1, createdAt: -1 });

const PriceRecommendation =
  mongoose.models.PriceRecommendation ||
  mongoose.model('PriceRecommendation', priceRecommendationSchema);

module.exports = PriceRecommendation;
