const mongoose = require('mongoose');

/**
 * Product Schema for PricePilot Competitor Price Scraper and Dynamic Repricer.
 * Represents merchant catalog items with cost basis, current selling price, and target margin.
 */
const productSchema = new mongoose.Schema(
  {
    sku: {
      type: String,
      required: [true, 'SKU is required'],
      unique: true,
      trim: true,
      uppercase: true,
      index: true
    },
    name: {
      type: String,
      required: [true, 'Product name is required'],
      trim: true
    },
    brand: {
      type: String,
      trim: true,
      default: ''
    },
    category: {
      type: String,
      trim: true,
      default: 'General'
    },
    costPrice: {
      type: Number,
      required: [true, 'Cost price is required'],
      min: [0.01, 'Cost price must be greater than zero']
    },
    sellingPrice: {
      type: Number,
      required: [true, 'Selling price is required'],
      min: [0, 'Selling price cannot be negative']
    },
    currency: {
      type: String,
      default: 'INR',
      trim: true,
      uppercase: true
    },
    imageUrl: {
      type: String,
      trim: true,
      default: ''
    },
    minMargin: {
      type: Number,
      default: 0.25, // 25% default gross margin floor
      min: [0, 'Minimum margin cannot be negative'],
      max: [0.99, 'Minimum margin must be less than 100%']
    },
    status: {
      type: String,
      enum: ['active', 'draft', 'archived'],
      default: 'active'
    }
  },
  {
    timestamps: true
  }
);

// Virtual property to calculate gross margin percentage based on current prices
productSchema.virtual('grossMarginPercentage').get(function () {
  if (!this.sellingPrice || this.sellingPrice <= 0) return 0;
  const margin = ((this.sellingPrice - this.costPrice) / this.sellingPrice) * 100;
  return Math.round(margin * 10) / 10;
});

// Virtual property to calculate minimum safe floor price based on PRD formula: Pmin = C / (1 - m)
productSchema.virtual('minimumSafePrice').get(function () {
  if (!this.costPrice || this.costPrice <= 0) return 0;
  const targetMargin = this.minMargin || 0.25;
  const floor = this.costPrice / (1 - targetMargin);
  return Math.round(floor * 100) / 100;
});

productSchema.set('toJSON', { virtuals: true });
productSchema.set('toObject', { virtuals: true });

const Product = mongoose.models.Product || mongoose.model('Product', productSchema);

module.exports = Product;
