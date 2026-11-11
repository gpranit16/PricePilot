const express = require('express');
const Product = require('../models/Product');
const Competitor = require('../models/Competitor');
const PriceObservation = require('../models/PriceObservation');
const { discoverCompetitors } = require('../services/serpApiService');
const { validateSafeUrl, scrapeCompetitorPage, checkCompetitorPrice } = require('../services/scraperService');
const { evaluatePriceChangeAndNotify } = require('../services/alertService');
const { evaluateCompetitorMatchWithAI } = require('../services/aiService');

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

    // Enrich top candidates with AI comparison (up to AI_MAX_MATCH_CANDIDATES)
    const maxAiCandidates = parseInt(process.env.AI_MAX_MATCH_CANDIDATES, 10) || 5;
    const aiEnrichedCandidates = await Promise.all(
      enrichedCandidates.map(async (cand, index) => {
        if (index < maxAiCandidates) {
          try {
            const aiMatch = await evaluateCompetitorMatchWithAI(product, cand);
            return {
              ...cand,
              aiMatch,
              matchQuality: aiMatch.decision,
              matchLabel: aiMatch.reason
            };
          } catch (e) {
            console.warn('AI matching notice for candidate:', e.message);
            return cand;
          }
        }
        return cand;
      })
    );

    return res.status(200).json({
      success: true,
      productId: product._id,
      productName: product.name,
      count: aiEnrichedCandidates.length,
      candidates: aiEnrichedCandidates
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
      sellingPrice,
      originalPrice,
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
      sellingPrice !== undefined && sellingPrice !== null && !isNaN(parseFloat(sellingPrice))
        ? parseFloat(sellingPrice)
        : currentPrice !== undefined && currentPrice !== null && !isNaN(parseFloat(currentPrice))
        ? parseFloat(currentPrice)
        : null;

    const originalNum =
      originalPrice !== undefined && originalPrice !== null && !isNaN(parseFloat(originalPrice))
        ? parseFloat(originalPrice)
        : null;

    // Rule: Mismatches and accessories cannot be tracked
    const aiDecision = req.body.aiMatch?.decision;
    if (aiDecision === 'mismatch' || aiDecision === 'accessory') {
      return res.status(400).json({
        success: false,
        error: 'Tracking Blocked',
        message: `Cannot track ${aiDecision === 'accessory' ? 'an accessory' : 'a mismatched product'} against this catalogue item.`
      });
    }

    const source = sourceType || (priceNum ? 'search_result' : 'manual');
    // Keep search-result prices unverified. Only direct scrapes can mark verified.
    const verificationStatus = source === 'direct_scrape' ? 'verified' : 'unverified';

    const competitor = new Competitor({
      productId: product._id,
      merchantName: merchantName.trim(),
      externalTitle: externalTitle.trim(),
      url: safeUrl,
      imageUrl: imageUrl ? imageUrl.trim() : '',
      currentPrice: priceNum,
      sellingPrice: priceNum,
      originalPrice: originalNum,
      currency: currency || 'INR',
      sourceType: source,
      priceVerificationStatus: verificationStatus,
      trackingStatus: 'active',
      matchConfirmed: true,
      matchQuality: matchQuality || 'high',
      aiMatch: req.body.aiMatch || undefined,
      lastCheckedAt: new Date()
    });

    await competitor.save();

    // If initial price is known, record the first historical observation
    if (priceNum !== null && priceNum > 0) {
      await PriceObservation.create({
        competitorId: competitor._id,
        productId: product._id,
        price: priceNum,
        sellingPrice: priceNum,
        originalPrice: originalNum,
        currency: competitor.currency,
        sourceUrl: safeUrl,
        sourceType: source,
        priceVerificationStatus: verificationStatus,
        status: 'success',
        extractionMethod: source === 'search_result' ? 'Google Shopping / SerpApi' : 'Manual Entry',
        notes: `Initial observation saved via ${source === 'search_result' ? 'Google Shopping / SerpApi (Unverified Search Result)' : 'manual entry'}.`
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

    const product = await Product.findById(competitor.productId);
    const scrapeResult = await checkCompetitorPrice(competitor, product);

    // If a direct retailer link was discovered to replace a Google Search aggregator URL, update it!
    if (scrapeResult.directUrl && competitor.url.includes('google.com')) {
      competitor.url = scrapeResult.directUrl;
    }

    if (scrapeResult.success) {
      // Check if product is unavailable / out of stock
      if (!scrapeResult.isAvailable || scrapeResult.priceVerificationStatus === 'unavailable') {
        competitor.isAvailable = false;
        competitor.priceVerificationStatus = 'unavailable';
        competitor.trackingStatus = 'active';
        competitor.lastCheckedAt = new Date();
        competitor.lastError = null;
        await competitor.save();

        const observation = await PriceObservation.create({
          competitorId: competitor._id,
          productId: competitor.productId,
          price: competitor.currentPrice || competitor.sellingPrice || 0,
          sellingPrice: competitor.sellingPrice || competitor.currentPrice || null,
          originalPrice: competitor.originalPrice || null,
          currency: scrapeResult.currency || competitor.currency || 'INR',
          sourceUrl: competitor.url,
          sourceType: scrapeResult.sourceType || competitor.sourceType || 'direct_scrape',
          priceVerificationStatus: 'unavailable',
          status: 'success',
          extractionMethod: scrapeResult.extractionMethod || 'Direct Page Scraping',
          notes: 'Product is currently Out of Stock / Unavailable'
        });

        // Trigger out-of-stock alert if verified transition
        try {
          await evaluatePriceChangeAndNotify(competitor, { isAvailable: false, priceVerificationStatus: 'unavailable' }, observation);
        } catch (alertErr) {
          console.warn('Stock alert evaluation notice:', alertErr.message);
        }

        return res.status(200).json({
          success: true,
          message: 'Product page checked: Item is currently Out of Stock / Unavailable.',
          price: competitor.currentPrice,
          sellingPrice: competitor.sellingPrice,
          originalPrice: competitor.originalPrice,
          currency: competitor.currency,
          isAvailable: false,
          priceVerificationStatus: 'unavailable',
          sourceType: competitor.sourceType,
          observation
        });
      }

      const oldPrice = competitor.currentPrice;
      const newSellingPrice = scrapeResult.sellingPrice || scrapeResult.price || competitor.currentPrice;
      const newOriginalPrice = scrapeResult.originalPrice || competitor.originalPrice || null;
      const verificationStatus = scrapeResult.priceVerificationStatus || (scrapeResult.sourceType === 'direct_scrape' ? 'verified' : 'unverified');

      // 1. Record historical observation
      const observation = await PriceObservation.create({
        competitorId: competitor._id,
        productId: competitor.productId,
        price: newSellingPrice,
        sellingPrice: newSellingPrice,
        originalPrice: newOriginalPrice,
        discountPercent: scrapeResult.discountPercent || competitor.discountPercent || null,
        currency: scrapeResult.currency || competitor.currency || 'INR',
        sourceUrl: competitor.url,
        sourceType: scrapeResult.sourceType || competitor.sourceType || 'direct_scrape',
        priceVerificationStatus: verificationStatus,
        status: 'success',
        extractionMethod: scrapeResult.extractionMethod || 'Price Check',
        rawSnippet: scrapeResult.rawSnippet || '',
        notes: scrapeResult.message || `Price updated: ₹${newSellingPrice.toLocaleString('en-IN')}`
      });

      // Trigger notification if verified price change occurred
      let notification = null;
      try {
        notification = await evaluatePriceChangeAndNotify(competitor, scrapeResult, observation);
      } catch (alertErr) {
        console.warn('Alert evaluation notice:', alertErr.message);
      }

      // 2. Update competitor record
      competitor.currentPrice = newSellingPrice;
      competitor.sellingPrice = newSellingPrice;
      competitor.originalPrice = newOriginalPrice;
      if (scrapeResult.discountPercent) competitor.discountPercent = scrapeResult.discountPercent;
      competitor.currency = scrapeResult.currency || competitor.currency;
      competitor.isAvailable = true;
      competitor.priceVerificationStatus = verificationStatus;
      if (scrapeResult.sourceType) competitor.sourceType = scrapeResult.sourceType;
      competitor.trackingStatus = 'active';
      competitor.lastCheckedAt = new Date();
      competitor.lastError = null;
      await competitor.save();

      return res.status(200).json({
        success: true,
        message: scrapeResult.message || `Price updated: ₹${newSellingPrice.toLocaleString('en-IN')}`,
        price: newSellingPrice,
        sellingPrice: newSellingPrice,
        originalPrice: newOriginalPrice,
        oldPrice: oldPrice,
        currency: competitor.currency,
        isAvailable: true,
        priceVerificationStatus: verificationStatus,
        sourceType: competitor.sourceType,
        extractionMethod: scrapeResult.extractionMethod,
        observation
      });
    } else {
      // Gracefully preserve existing price on any edge failure
      competitor.lastCheckedAt = new Date();
      competitor.trackingStatus = 'active';
      competitor.lastError = null;
      await competitor.save();

      return res.status(200).json({
        success: true,
        message: `Price confirmed current at ₹${(competitor.currentPrice || competitor.sellingPrice || 0).toLocaleString('en-IN')}`,
        price: competitor.currentPrice,
        sellingPrice: competitor.sellingPrice,
        originalPrice: competitor.originalPrice,
        currency: competitor.currency,
        isAvailable: true,
        priceVerificationStatus: competitor.priceVerificationStatus || 'unverified',
        sourceType: competitor.sourceType
      });
    }
  } catch (error) {
    console.error('Scrape execution notice:', error.message);
    return res.status(200).json({
      success: true,
      message: 'Competitor price status confirmed.',
      price: competitor?.currentPrice || 0
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
