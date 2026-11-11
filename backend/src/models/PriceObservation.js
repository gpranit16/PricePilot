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
    priceVerificationStatus: {
      type: String,
      enum: ['verified', 'unverified', 'unavailable'],
      default: 'unverified'
    },
    extractionMethod: {
      type: String,
      default: ''
    },
    rawSnippet: {
      type: String,
      default: ''
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

priceObservationSchema.pre('save', function (next) {
  if (this.sellingPrice !== null && this.sellingPrice !== undefined && !isNaN(this.sellingPrice)) {
    this.price = this.sellingPrice;
  } else if (this.price !== null && this.price !== undefined && !isNaN(this.price)) {
    this.sellingPrice = this.price;
  }

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
      this.price = temp;
    }
    this.discountPercent = Math.round(
      ((this.originalPrice - this.sellingPrice) / this.originalPrice) * 100
    );
  }

  next();
});

const PriceObservation =
  mongoose.models.PriceObservation ||
  mongoose.model('PriceObservation', priceObservationSchema);

module.exports = PriceObservation;
