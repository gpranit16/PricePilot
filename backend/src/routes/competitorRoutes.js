const express = require('express');
const Product = require('../models/Product');
const Competitor = require('../models/Competitor');
const PriceObservation = require('../models/PriceObservation');
const { discoverCompetitors } = require('../services/serpApiService');
const { validateSafeUrl, scrapeCompetitorPage } = require('../services/scraperService');

const router = express.Router();

/**
 * POST /api/products/:productId/competitor-search
 * Searches for competitor product candidates via SerpApi (Google Shopping & Search).
 */
router.post('/products/:productId/competitor-search', async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: `Product with ID '${req.params.productId}' was not found.`
      });
    }

    const candidates = await discoverCompetitors(product);

    // Get list of existing linked competitor URLs for this product to flag already-tracked items
    const existingCompetitors = await Competitor.find({ productId: product._id }).select('url');
    const trackedUrls = new Set(existingCompetitors.map((c) => c.url));

    const enrichedCandidates = candidates.map((item) => ({
      ...item,
      isAlreadyTracked: trackedUrls.has(item.url)
    }));

    return res.status(200).json({
      success: true,
      productId: product._id,
      productName: product.name,
      count: enrichedCandidates.length,
      candidates: enrichedCandidates
    });
  } catch (error) {
    console.error('Competitor discovery error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Discovery Error',
      message: error.message || 'Failed to search for competitor products.'
    });
  }
});

/**
 * GET /api/products/:productId/competitors
 * Returns all competitor links tracked for a given product.
 */
router.get('/products/:productId/competitors', async (req, res, next) => {
  try {
    const { productId } = req.params;
    const competitors = await Competitor.find({ productId })
      .sort({ createdAt: -1 })
      .lean();

    // Attach total price observation counts
    const competitorIds = competitors.map((c) => c._id);
    const observationCounts = await PriceObservation.aggregate([
      { $match: { competitorId: { $in: competitorIds } } },
      { $group: { _id: '$competitorId', count: { $sum: 1 } } }
    ]);

    const countMap = {};
    observationCounts.forEach((oc) => {
      countMap[oc._id.toString()] = oc.count;
    });

    const enriched = competitors.map((c) => ({
      ...c,
      observationCount: countMap[c._id.toString()] || 0
    }));

    return res.status(200).json({
      success: true,
      count: enriched.length,
      competitors: enriched
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/products/:productId/competitors
 * Saves a confirmed competitor and records initial price observation.
 */
router.post('/products/:productId/competitors', async (req, res, next) => {
  try {
    const { productId } = req.params;
    const {
      merchantName,
      externalTitle,
      url,
      imageUrl,
      currentPrice,
      currency,
      sourceType,
      matchQuality
    } = req.body;

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Product not found.'
      });
    }

    if (!merchantName || !merchantName.trim()) {
      return res.status(400).json({ success: false, message: 'Merchant name is required.' });
    }
    if (!externalTitle || !externalTitle.trim()) {
      return res.status(400).json({ success: false, message: 'Competitor title is required.' });
    }
    if (!url || !url.trim()) {
      return res.status(400).json({ success: false, message: 'Competitor URL is required.' });
    }

    // SSRF Safe URL validation
    let safeUrl;
    try {
      safeUrl = validateSafeUrl(url.trim());
    } catch (urlErr) {
      return res.status(400).json({ success: false, error: 'Invalid URL', message: urlErr.message });
    }

    // Check for duplicate URL on this product
    const existing = await Competitor.findOne({ productId, url: safeUrl });
    if (existing) {
      return res.status(409).json({
        success: false,
        error: 'Duplicate Competitor',
        message: 'This competitor URL is already tracked for this product.'
      });
    }

    const priceNum =
      currentPrice !== undefined && currentPrice !== null && !isNaN(parseFloat(currentPrice))
        ? parseFloat(currentPrice)
        : null;

    const source = sourceType || (priceNum ? 'search_result' : 'manual');

    const competitor = new Competitor({
      productId: product._id,
      merchantName: merchantName.trim(),
      externalTitle: externalTitle.trim(),
      url: safeUrl,
      imageUrl: imageUrl ? imageUrl.trim() : '',
      currentPrice: priceNum,
      currency: currency || 'INR',
      sourceType: source,
      trackingStatus: 'active',
      matchConfirmed: true,
      matchQuality: matchQuality || 'high',
      lastCheckedAt: new Date()
    });

    await competitor.save();

    // If initial price is known, record the first historical observation
    if (priceNum !== null && priceNum > 0) {
      await PriceObservation.create({
        competitorId: competitor._id,
        productId: product._id,
        price: priceNum,
        currency: competitor.currency,
        sourceUrl: safeUrl,
        sourceType: source,
        status: 'success',
        notes: `Initial observation saved via ${source === 'search_result' ? 'Google Shopping / SerpApi' : 'manual entry'}.`
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Competitor link added and tracking activated.',
      competitor
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        error: 'Duplicate Competitor',
        message: 'This competitor URL is already tracked for this product.'
      });
    }
    next(error);
  }
});

/**
 * PUT /api/competitors/:competitorId
 * Updates competitor link details or toggles tracking status (active/paused).
 */
router.put('/competitors/:competitorId', async (req, res, next) => {
  try {
    const competitor = await Competitor.findById(req.params.competitorId);
    if (!competitor) {
      return res.status(404).json({ success: false, message: 'Competitor not found.' });
    }

    const { merchantName, externalTitle, url, trackingStatus } = req.body;

    if (url && url.trim() !== competitor.url) {
      const safeUrl = validateSafeUrl(url.trim());
      // Check duplicate
      const duplicate = await Competitor.findOne({
        productId: competitor.productId,
        url: safeUrl,
        _id: { $ne: competitor._id }
      });
      if (duplicate) {
        return res.status(409).json({
          success: false,
          message: 'Another competitor entry already uses this URL for this product.'
        });
      }
      competitor.url = safeUrl;
    }

    if (merchantName) competitor.merchantName = merchantName.trim();
    if (externalTitle) competitor.externalTitle = externalTitle.trim();
    if (trackingStatus && ['active', 'paused'].includes(trackingStatus)) {
      competitor.trackingStatus = trackingStatus;
    }

    await competitor.save();

    return res.status(200).json({
      success: true,
      message: 'Competitor updated successfully.',
      competitor
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/competitors/:competitorId
 * Removes a competitor link and its associated price observations.
 */
router.delete('/competitors/:competitorId', async (req, res, next) => {
  try {
    const competitor = await Competitor.findByIdAndDelete(req.params.competitorId);
    if (!competitor) {
      return res.status(404).json({ success: false, message: 'Competitor not found.' });
    }

    // Clean up associated historical price observations
    await PriceObservation.deleteMany({ competitorId: competitor._id });

    return res.status(200).json({
      success: true,
      message: `Competitor '${competitor.merchantName}' link was removed.`,
      deletedId: competitor._id
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/competitors/:competitorId/scrape
 * Direct price scrape of the competitor's retailer page.
 */
router.post('/competitors/:competitorId/scrape', async (req, res, next) => {
  try {
    const competitor = await Competitor.findById(req.params.competitorId);
    if (!competitor) {
      return res.status(404).json({ success: false, message: 'Competitor not found.' });
    }

    const scrapeResult = await scrapeCompetitorPage(competitor.url);

    if (scrapeResult.success) {
      const oldPrice = competitor.currentPrice;
      const newPrice = scrapeResult.price;

      // 1. Record new successful historical observation
      const observation = await PriceObservation.create({
        competitorId: competitor._id,
        productId: competitor.productId,
        price: newPrice,
        currency: scrapeResult.currency || competitor.currency || 'INR',
        sourceUrl: competitor.url,
        sourceType: 'direct_scrape',
        status: 'success',
        notes: `Extracted via ${scrapeResult.extractionMethod}`
      });

      // 2. Update competitor record
      competitor.currentPrice = newPrice;
      competitor.currency = scrapeResult.currency || competitor.currency;
      competitor.sourceType = 'direct_scrape';
      competitor.trackingStatus = 'active';
      competitor.lastCheckedAt = new Date();
      competitor.lastError = null;
      await competitor.save();

      return res.status(200).json({
        success: true,
        message: `Price successfully extracted: ₹${newPrice.toLocaleString('en-IN')}`,
        price: newPrice,
        oldPrice: oldPrice,
        currency: competitor.currency,
        sourceType: 'direct_scrape',
        extractionMethod: scrapeResult.extractionMethod,
        observation
      });
    } else {
      // Scrape failed: PRESERVE previous currentPrice and all existing history!
      competitor.lastCheckedAt = new Date();
      competitor.lastError = scrapeResult.error;
      competitor.trackingStatus = 'error';
      await competitor.save();

      return res.status(200).json({
        success: false,
        error: scrapeResult.error,
        message: scrapeResult.error,
        preservedPrice: competitor.currentPrice,
        competitor
      });
    }
  } catch (error) {
    console.error('Scrape execution error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Scrape Error',
      message: error.message || 'An unexpected error occurred during direct page scraping.'
    });
  }
});

/**
 * GET /api/competitors/:competitorId/history
 * Returns historical price observations for this competitor.
 */
router.get('/competitors/:competitorId/history', async (req, res, next) => {
  try {
    const { competitorId } = req.params;
    const observations = await PriceObservation.find({ competitorId })
      .sort({ observedAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      count: observations.length,
      history: observations
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
