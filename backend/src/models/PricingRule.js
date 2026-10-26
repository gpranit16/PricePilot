const mongoose = require('mongoose');

/**
 * PricingRule Schema for PricePilot.
 * Defines automated repricing parameters (gross margin floor, competitor undercut %, rounding).
 */
const pricingRuleSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: [true, 'Product ID is required'],
      unique: true,
      index: true
    },
    minGrossMargin: {
      type: Number,
      required: [true, 'Minimum gross margin is required'],
      default: 0.25, // 25% default margin floor
      min: [0, 'Minimum gross margin cannot be negative'],
      max: [0.95, 'Minimum gross margin must be less than 95%']
    },
    undercutPercentage: {
      type: Number,
      required: [true, 'Undercut percentage is required'],
      default: 5, // 5% default undercut
      min: [0, 'Undercut percentage cannot be negative'],
      max: [90, 'Undercut percentage cannot exceed 90%']
    },
    strategy: {
      type: String,
      enum: ['lowest_competitor', 'match_competitor', 'average_competitor'],
      default: 'lowest_competitor'
    },
    roundingRule: {
      type: String,
      enum: ['exact_cents', 'nearest_rupee', 'none'],
      default: 'nearest_rupee'
    },
    isActive: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true
  }
);

const PricingRule =
  mongoose.models.PricingRule || mongoose.model('PricingRule', pricingRuleSchema);

module.exports = PricingRule;
