const mongoose = require('mongoose');

/**
 * Notification Schema for PricePilot.
 * Stores price change and stock transition alerts triggered during automated monitoring or direct scrapes.
 */
const notificationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['price_drop', 'price_increase', 'out_of_stock', 'back_in_stock', 'system'],
      required: [true, 'Notification type is required']
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: [true, 'Linked Product ID is required'],
      index: true
    },
    competitorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Competitor',
      required: [true, 'Linked Competitor ID is required'],
      index: true
    },
    previousPrice: {
      type: Number,
      default: null,
      min: [0, 'Previous price cannot be negative']
    },
    newPrice: {
      type: Number,
      default: null,
      min: [0, 'New price cannot be negative']
    },
    changeAmount: {
      type: Number,
      default: null
    },
    changePercent: {
      type: Number,
      default: null
    },
    message: {
      type: String,
      required: [true, 'Notification message is required'],
      trim: true
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true
    },
    readAt: {
      type: Date,
      default: null
    },
    eventId: {
      type: String,
      required: [true, 'Unique event ID is required to prevent duplicate alerts'],
      unique: true,
      index: true
    }
  },
  {
    timestamps: true
  }
);

// Compound index for querying unread alerts by recency
notificationSchema.index({ isRead: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);

