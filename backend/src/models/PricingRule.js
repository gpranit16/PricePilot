const mongoose = require('mongoose');

/**
 * PricingRule Schema for PricePilot.
 * Defines automated repricing parameters (gross margin floor, strategy, undercut/premium, min/max bounds, rounding).
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
    targetMargin: {
      type: Number,
      default: 0.30, // 30% default target margin for maintain_margin strategy
      min: [0, 'Target gross margin cannot be negative'],
      max: [0.95, 'Target gross margin must be less than 95%']
    },
    strategy: {
      type: String,
      enum: [
        'lowest_competitor',
        'undercut_competitor',
        'match_competitor',
        'maintain_margin',
        'premium_pricing'
      ],
      default: 'lowest_competitor'
    },
    undercutType: {
      type: String,
      enum: ['percentage', 'fixed_amount'],
      default: 'percentage'
    },
    undercutValue: {
      type: Number,
      default: 5,
      min: [0, 'Undercut value cannot be negative']
    },
    undercutPercentage: {
      type: Number,
      default: 5,
      min: [0, 'Undercut percentage cannot be negative'],
      max: [90, 'Undercut percentage cannot exceed 90%']
    },
    premiumType: {
      type: String,
      enum: ['percentage', 'fixed_amount'],
      default: 'percentage'
    },
    premiumValue: {
      type: Number,
      default: 5,
      min: [0, 'Premium value cannot be negative']
    },
    minSellingPrice: {
      type: Number,
      default: null,
      min: [0, 'Minimum selling price cannot be negative']
    },
    maxSellingPrice: {
      type: Number,
      default: null,
      min: [0, 'Maximum selling price cannot be negative']
    },
    maxPriceAgeDays: {
      type: Number,
      default: 7, // Stale price threshold in days
      min: [1, 'Price age must be at least 1 day']
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
