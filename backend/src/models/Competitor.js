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
      enum: ['exact', 'high', 'moderate', 'manual'],
      default: 'high'
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

const Competitor = mongoose.models.Competitor || mongoose.model('Competitor', competitorSchema);

module.exports = Competitor;
