const mongoose = require('mongoose');

/**
 * PriceObservation Schema for PricePilot.
 * Preserves the full chronological history of price checks (both search results and direct scrapes).
 */
const priceObservationSchema = new mongoose.Schema(
  {
    competitorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Competitor',
      required: [true, 'Competitor ID is required'],
      index: true
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: [true, 'Product ID is required'],
      index: true
    },
    price: {
      type: Number,
      required: [true, 'Observed price is required'],
      min: [0, 'Price cannot be negative']
    },
    currency: {
      type: String,
      default: 'INR',
      trim: true,
      uppercase: true
    },
    sourceUrl: {
      type: String,
      required: [true, 'Source URL is required'],
      trim: true
    },
    sourceType: {
      type: String,
      enum: ['search_result', 'direct_scrape', 'manual'],
      required: true
    },
    status: {
      type: String,
      enum: ['success', 'failed'],
      default: 'success'
    },
    notes: {
      type: String,
      default: ''
    },
    observedAt: {
      type: Date,
      default: Date.now,
      index: true
    }
  },
  {
    timestamps: true
  }
);

const PriceObservation =
  mongoose.models.PriceObservation ||
  mongoose.model('PriceObservation', priceObservationSchema);

module.exports = PriceObservation;
