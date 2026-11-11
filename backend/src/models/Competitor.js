const mongoose = require('mongoose');

/**
 * Competitor Listing Schema for PricePilot.
 * Represents a competitor product link tracked against a merchant's internal Product.
 */
const competitorSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: [true, 'Linked Product ID is required'],
      index: true
    },
    merchantName: {
      type: String,
      required: [true, 'Merchant or retailer name is required'],
      trim: true
    },
    externalTitle: {
      type: String,
      required: [true, 'Competitor product title is required'],
      trim: true
    },
    url: {
      type: String,
      required: [true, 'Competitor product URL is required'],
      trim: true
    },
    imageUrl: {
      type: String,
      trim: true,
      default: ''
    },
    currentPrice: {
      type: Number,
      default: null,
      min: [0, 'Price cannot be negative']
    },
    sellingPrice: {
      type: Number,
      default: null,
      min: [0, 'Selling price cannot be negative']
    },
    originalPrice: {
      type: Number,
      default: null,
      min: [0, 'Original price cannot be negative']
    },
    discountPercent: {
      type: Number,
      default: null
    },
    isAvailable: {
      type: Boolean,
      default: true
    },
    priceVerificationStatus: {
      type: String,
      enum: ['verified', 'unverified', 'unavailable'],
      default: 'unverified'
    },
    currency: {
      type: String,
      default: 'INR',
      trim: true,
      uppercase: true
    },
    sourceType: {
      type: String,
      enum: ['search_result', 'direct_scrape', 'manual'],
      default: 'search_result'
    },
    trackingStatus: {
      type: String,
      enum: ['active', 'paused', 'error', 'unsupported'],
      default: 'active'
    },
    matchConfirmed: {
      type: Boolean,
      default: true
    },
    matchQuality: {
      type: String,
      enum: ['exact', 'high', 'moderate', 'manual', 'exact_match', 'variant_match', 'mismatch', 'accessory', 'needs_review'],
      default: 'high'
    },
    aiMatch: {
      decision: { type: String, default: null },
      confidence: { type: Number, default: null },
      reason: { type: String, default: null },
      matchedAttributes: [{ type: String }],
      mismatchedAttributes: [{ type: String }]
    },
    lastCheckedAt: {
      type: Date,
      default: Date.now
    },
    lastError: {
      type: String,
      default: null
    }
  },
  {
    timestamps: true
  }
);

// Compound unique index: Prevent duplicate competitor links for the same product
competitorSchema.index({ productId: 1, url: 1 }, { unique: true });

competitorSchema.pre('save', function (next) {
  // Synchronize sellingPrice and currentPrice
  if (this.sellingPrice !== null && this.sellingPrice !== undefined && !isNaN(this.sellingPrice)) {
    this.currentPrice = this.sellingPrice;
  } else if (this.currentPrice !== null && this.currentPrice !== undefined && !isNaN(this.currentPrice)) {
    this.sellingPrice = this.currentPrice;
  }

  // Ensure sellingPrice <= originalPrice if both exist
  if (
    typeof this.sellingPrice === 'number' &&
    typeof this.originalPrice === 'number' &&
    this.originalPrice > 0 &&
    this.sellingPrice > 0
  ) {
    if (this.originalPrice < this.sellingPrice) {
      const temp = this.originalPrice;
      this.originalPrice = this.sellingPrice;
      this.sellingPrice = temp;
      this.currentPrice = temp;
    }
    this.discountPercent = Math.round(
      ((this.originalPrice - this.sellingPrice) / this.originalPrice) * 100
    );
  }

  next();
});

const Competitor = mongoose.models.Competitor || mongoose.model('Competitor', competitorSchema);

module.exports = Competitor;
