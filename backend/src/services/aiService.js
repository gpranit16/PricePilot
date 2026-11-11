const { GoogleGenAI } = require('@google/genai');
const Product = require('../models/Product');
const Competitor = require('../models/Competitor');
const PriceObservation = require('../models/PriceObservation');
const PricingRule = require('../models/PricingRule');
const PriceRecommendation = require('../models/PriceRecommendation');
const { evaluateMatchQuality } = require('./serpApiService');

// Configuration
const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || '').trim();
const GEMINI_MODEL = (process.env.GEMINI_MODEL || '').trim() || 'gemini-3.8-flash';
const AI_ENABLED = process.env.AI_ENABLED !== 'false' && Boolean(GEMINI_API_KEY);
const AI_MAX_MATCH_CANDIDATES = parseInt(process.env.AI_MAX_MATCH_CANDIDATES, 10) || 5;
const AI_REQUEST_TIMEOUT_MS = parseInt(process.env.AI_REQUEST_TIMEOUT_MS, 10) || 15000;
const AI_DAILY_REQUEST_LIMIT = parseInt(process.env.AI_DAILY_REQUEST_LIMIT, 10) || 100;

// In-Memory Caches
const matchCache = new Map(); // key -> { result, timestamp }
const MATCH_CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

let insightsCache = null; // { data, timestamp }
const INSIGHTS_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

// Daily Quota Tracking (reset at UTC midnight)
let dailyCounter = {
  date: new Date().toISOString().split('T')[0],
  count: 0
};

function checkAndIncrementQuota() {
  const today = new Date().toISOString().split('T')[0];
  if (dailyCounter.date !== today) {
    dailyCounter = { date: today, count: 0 };
  }
  if (dailyCounter.count >= AI_DAILY_REQUEST_LIMIT) {
    console.warn(`⚠️ [AI Service] Daily quota limit (${AI_DAILY_REQUEST_LIMIT}) reached.`);
    return false;
  }
  dailyCounter.count += 1;
  return true;
}

// Singleton AI Client
let aiClient = null;

function getClient() {
  if (!AI_ENABLED || !GEMINI_API_KEY) return null;
  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  }
  return aiClient;
}

/**
 * Executes a promise with an enforced timeout.
 */
function withTimeout(promise, timeoutMs = AI_REQUEST_TIMEOUT_MS) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`AI Request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
}

/**
 * Returns current AI operational status without exposing secrets.
 */
function getAIStatus() {
  const today = new Date().toISOString().split('T')[0];
  if (dailyCounter.date !== today) {
    dailyCounter = { date: today, count: 0 };
  }

  return {
    enabled: AI_ENABLED && Boolean(GEMINI_API_KEY),
    model: GEMINI_MODEL,
    dailyUsage: dailyCounter.count,
    dailyLimit: AI_DAILY_REQUEST_LIMIT,
    quotaRemaining: Math.max(0, AI_DAILY_REQUEST_LIMIT - dailyCounter.count),
    maxCandidatesPerRequest: AI_MAX_MATCH_CANDIDATES
  };
}

// ============================================================================
// 1. AI COMPETITOR MATCHING
// ============================================================================

/**
 * Evaluates whether a competitor product listing matches the merchant product.
 * Compares brand, model numbers, variants (Pro, Plus, Lite, Ultra), storage/capacity,
 * colour, pack size, and product vs accessory.
 *
 * Falls back safely to rule-based evaluation if AI is disabled or fails.
 */
async function evaluateCompetitorMatchWithAI(merchantProduct, candidate) {
  const pName = merchantProduct?.name || '';
  const pBrand = merchantProduct?.brand || '';
  const pSku = merchantProduct?.sku || '';
  const cTitle = candidate?.title || '';
  const cMerchant = candidate?.merchantName || '';

  // 1. Deterministic Fast Check
  const ruleMatch = evaluateMatchQuality(cTitle, merchantProduct);

  // Exact SKU match is unambiguous: no LLM needed
  if (ruleMatch.level === 'exact' && ruleMatch.label.includes('SKU')) {
    return {
      decision: 'exact_match',
      confidence: 100,
      reason: 'Exact SKU match detected between catalogue and retailer listing.',
      matchedAttributes: ['SKU', 'Brand'],
      mismatchedAttributes: [],
      source: 'deterministic'
    };
  }

  // Obvious mismatch (completely different model number or unrelated brand)
  if (ruleMatch.level === 'mismatch' && ruleMatch.label.includes('Different Model')) {
    return {
      decision: 'mismatch',
      confidence: 95,
      reason: ruleMatch.label,
      matchedAttributes: [],
      mismatchedAttributes: ['Model Number'],
      source: 'deterministic'
    };
  }

  // 2. Check Cache (shorter TTL for fallback so transient 429/503 recovers promptly)
  const cacheKey = `${pSku}:${cTitle.toLowerCase().trim()}:${cMerchant.toLowerCase().trim()}`;
  const cached = matchCache.get(cacheKey);
  const matchTtl = cached?.result?.source === 'gemini' ? MATCH_CACHE_TTL_MS : 2 * 60 * 1000;
  if (cached && Date.now() - cached.timestamp < matchTtl) {
    return { ...cached.result, source: 'cache' };
  }

  // 3. Fallback if AI disabled, no client, or quota exhausted
  const client = getClient();
  if (!client || !checkAndIncrementQuota()) {
    return fallbackMatchFromRule(ruleMatch);
  }

  // 4. Gemini Match Evaluation
  try {
    const prompt = `You are an expert e-commerce catalog matching system.
Compare the Merchant Store Product with the Competitor Retailer Listing.

Merchant Product:
- Name: "${pName}"
- Brand: "${pBrand}"
- Category: "${merchantProduct?.category || 'General'}"
- SKU: "${pSku}"

Competitor Listing:
- Title: "${cTitle}"
- Retailer: "${cMerchant}"
- Price Listed: "₹${candidate?.sellingPrice || candidate?.price || 'N/A'}"

Compare carefully:
1. Brand and core product type
2. Exact model numbers (e.g., 311 vs 311 Pro vs 411)
3. Pro, Plus, Ultra, Max, Lite, ANC modifiers
4. Storage, capacity, size, or color variants
5. Product vs Accessory (e.g. silicone case or charging cable vs actual earphones/device)
6. Pack quantity (1 unit vs pack of 2)

Respond ONLY with valid JSON following this exact structure:
{
  "decision": "exact_match",
  "confidence": 90,
  "reason": "Clear explanation of why it matches or differs",
  "matchedAttributes": ["Brand", "Model"],
  "mismatchedAttributes": ["Color"]
}

Allowed values for "decision":
- "exact_match": Identical product and identical variant.
- "variant_match": Same base product but different color, size, storage, or pack size.
- "accessory": The competitor item is a protective case, strap, cable, pouch, or add-on, NOT the actual product.
- "mismatch": Completely different product, brand, or incompatible model.
- "needs_review": Ambiguous or insufficient information to verify.`;

    const response = await withTimeout(
      client.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          temperature: 0.1,
          maxOutputTokens: 2048,
          thinkingConfig: { thinkingBudget: 0 }
        }
      })
    );

    const text = response.text?.trim() || '';
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch (parseErr) {
      const cleanJson = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
      try {
        parsed = JSON.parse(cleanJson);
      } catch (e2) {
        const jsonMatch = cleanJson.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        }
      }
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Invalid JSON structure returned by model');
    }

    const validDecisions = ['exact_match', 'variant_match', 'mismatch', 'accessory', 'needs_review'];
    const decision = validDecisions.includes(parsed.decision) ? parsed.decision : 'needs_review';
    const confidence = Math.min(100, Math.max(0, parseInt(parsed.confidence, 10) || 70));

    const result = {
      decision,
      confidence,
      reason: parsed.reason || 'AI verified comparison.',
      matchedAttributes: Array.isArray(parsed.matchedAttributes) ? parsed.matchedAttributes : [],
      mismatchedAttributes: Array.isArray(parsed.mismatchedAttributes) ? parsed.mismatchedAttributes : [],
      source: 'gemini'
    };

    // Cache valid result
    matchCache.set(cacheKey, { result, timestamp: Date.now() });
    return result;
  } catch (err) {
    console.warn('⚠️ [AI Matcher] Gemini call failed, falling back to rule-based match:', err.message);
    const fallback = fallbackMatchFromRule(ruleMatch);
    matchCache.set(cacheKey, { result: fallback, timestamp: Date.now() });
    return fallback;
  }
}

function fallbackMatchFromRule(ruleMatch) {
  let decision = 'needs_review';
  let confidence = 70;

  if (ruleMatch.level === 'exact') {
    decision = 'exact_match';
    confidence = 90;
  } else if (ruleMatch.level === 'high') {
    decision = 'variant_match';
    confidence = 80;
  } else if (ruleMatch.level === 'mismatch' || ruleMatch.level === 'low') {
    decision = 'mismatch';
    confidence = 85;
  }

  return {
    decision,
    confidence,
    reason: ruleMatch.label || 'Evaluated via deterministic product matching rules.',
    matchedAttributes: ruleMatch.isExact ? ['Title', 'Keywords'] : ['Brand'],
    mismatchedAttributes: ruleMatch.level === 'mismatch' ? ['Model/Brand'] : [],
    source: 'rule_fallback'
  };
}

// ============================================================================
// 2. AI PRICING INSIGHTS
// ============================================================================

/**
 * Computes factual business pricing insights using verified MongoDB data.
 * The backend calculates all numerical metrics, margin gaps, and movements.
 * Gemini provides business implications and strategic recommendations.
 */
async function generatePricingInsights(forceRefresh = false) {
  // Check cache
  const insightsTtl = insightsCache?.data?.source === 'gemini' ? INSIGHTS_CACHE_TTL_MS : 60 * 1000;
  if (!forceRefresh && insightsCache && Date.now() - insightsCache.timestamp < insightsTtl) {
    return insightsCache.data;
  }

  // 1. Gather live MongoDB records
  const products = await Product.find({ status: 'active' }).lean();
  const competitors = await Competitor.find({ trackingStatus: 'active' }).lean();
  const recommendations = await PriceRecommendation.find().sort({ createdAt: -1 }).lean();

  // Map products
  const productMap = new Map();
  for (const p of products) {
    productMap.set(p._id.toString(), p);
  }

  // Map competitors per product
  const compByProduct = new Map();
  for (const c of competitors) {
    const pid = c.productId.toString();
    if (!compByProduct.has(pid)) compByProduct.set(pid, []);
    compByProduct.get(pid).push(c);
  }

  // 2. Calculate factual metrics deterministically on the backend
  const factualFacts = {
    totalProducts: products.length,
    totalCompetitors: competitors.length,
    underpricedByCompetitors: [],
    verifiedPriceDrops: [],
    dataGaps: [],
    pendingRecommendations: [],
    floorProtectedCount: 0
  };

  // Inspect verified competitor price advantages
  for (const p of products) {
    const pid = p._id.toString();
    const comps = compByProduct.get(pid) || [];
    const verifiedComps = comps.filter(
      (c) => c.priceVerificationStatus === 'verified' && (c.sellingPrice || c.currentPrice) > 0
    );

    if (verifiedComps.length === 0) {
      factualFacts.dataGaps.push({
        productId: p._id,
        sku: p.sku,
        name: p.name,
        sellingPrice: p.sellingPrice,
        unverifiedCount: comps.length
      });
      continue;
    }

    // Find lowest verified competitor price
    verifiedComps.sort(
      (a, b) => (a.sellingPrice || a.currentPrice) - (b.sellingPrice || b.currentPrice)
    );
    const lowest = verifiedComps[0];
    const lowestPrice = lowest.sellingPrice || lowest.currentPrice;

    if (lowestPrice < p.sellingPrice) {
      const diff = p.sellingPrice - lowestPrice;
      const diffPercent = Math.round((diff / p.sellingPrice) * 100);
      factualFacts.underpricedByCompetitors.push({
        productId: p._id,
        sku: p.sku,
        name: p.name,
        currentPrice: p.sellingPrice,
        competitorPrice: lowestPrice,
        competitorName: lowest.merchantName,
        diff,
        diffPercent
      });
    }
  }

  // Inspect recent verified observations for significant price drops
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentObservations = await PriceObservation.find({
    priceVerificationStatus: 'verified',
    status: 'success',
    observedAt: { $gte: sevenDaysAgo }
  })
    .sort({ observedAt: -1 })
    .limit(50)
    .lean();

  const seenDropComp = new Set();
  for (const obs of recentObservations) {
    const comp = competitors.find((c) => c._id.toString() === obs.competitorId.toString());
    if (!comp) continue;
    const prod = productMap.get(comp.productId.toString());
    if (!prod) continue;

    // Check discount from original price or price drop
    if (obs.originalPrice && obs.sellingPrice && obs.originalPrice > obs.sellingPrice) {
      const key = `${comp._id}:${obs.sellingPrice}`;
      if (!seenDropComp.has(key)) {
        seenDropComp.add(key);
        const dropAmount = obs.originalPrice - obs.sellingPrice;
        factualFacts.verifiedPriceDrops.push({
          productId: prod._id,
          productName: prod.name,
          competitorName: comp.merchantName,
          sellingPrice: obs.sellingPrice,
          originalPrice: obs.originalPrice,
          dropAmount,
          discountPercent: obs.discountPercent || Math.round((dropAmount / obs.originalPrice) * 100)
        });
      }
    }
  }

  // Pending recommendations needing review
  for (const rec of recommendations.slice(0, 30)) {
    if (rec.status === 'pending') {
      const prod = productMap.get(rec.productId?.toString());
      if (prod) {
        factualFacts.pendingRecommendations.push({
          productId: prod._id,
          productName: prod.name,
          currentPrice: rec.currentSellingPrice,
          recommendedPrice: rec.recommendedPrice,
          priceDifference: rec.priceDifference,
          riskLevel: rec.riskLevel,
          floorApplied: rec.floorApplied
        });
      }
    }
    if (rec.floorApplied) {
      factualFacts.floorProtectedCount += 1;
    }
  }

  // 3. Synthesize with Gemini if available; otherwise use deterministic insights
  const client = getClient();
  let insightsData = null;

  if (client && checkAndIncrementQuota()) {
    try {
      const prompt = `You are the Lead E-Commerce Pricing Strategist for PricePilot.
Analyze these PRE-CALCULATED factual pricing metrics for the merchant store.

FACTS:
- Total Monitored Products: ${factualFacts.totalProducts}
- Active Tracked Competitors: ${factualFacts.totalCompetitors}
- Products where a verified competitor is cheaper than merchant: ${factualFacts.underpricedByCompetitors.length}
${factualFacts.underpricedByCompetitors.slice(0, 5).map((u) => `  * ${u.name}: Store price ₹${u.currentPrice} vs ${u.competitorName} ₹${u.competitorPrice} (${u.diffPercent}% cheaper)`).join('\n')}

- Significant Competitor Verified Discounts/Drops (Last 7 Days): ${factualFacts.verifiedPriceDrops.length}
${factualFacts.verifiedPriceDrops.slice(0, 4).map((d) => `  * ${d.competitorName} discounted ${d.productName} to ₹${d.sellingPrice} (${d.discountPercent}% off)`).join('\n')}

- Products lacking verified competitor data: ${factualFacts.dataGaps.length}
${factualFacts.dataGaps.slice(0, 3).map((g) => `  * ${g.name} (SKU: ${g.sku})`).join('\n')}

- Pending Price Recommendations: ${factualFacts.pendingRecommendations.length}
${factualFacts.pendingRecommendations.slice(0, 4).map((r) => `  * ${r.productName}: Rec ₹${r.recommendedPrice} (Risk: ${r.riskLevel || 'normal'})`).join('\n')}

IMPORTANT RULES:
- Never invent statistics, names or numbers. Use the exact numbers provided above.
- Never discuss raw wholesale costs or internal margin percentages (protect merchant confidentiality).
- Focus strictly on market position, competitiveness, and actionable recommendations.

Output valid JSON only with this structure:
{
  "summary": "Executive summary of store pricing competitiveness",
  "insights": [
    {
      "type": "pricing_opportunity",
      "severity": "high",
      "title": "Concise punchy title",
      "description": "Factual explanation with exact numbers",
      "businessImplication": "Why this matters for store sales or profitability",
      "recommendedAction": "Specific actionable advice for the merchant",
      "productName": "Related product name if applicable",
      "productId": "Related product ID string if applicable"
    }
  ]
}

Allowed values for "type":
- "pricing_opportunity": Whenever a verified competitor is cheaper than our store price (underpricedByCompetitors)
- "competitor_price_drop": When a verified competitor has an active discount/price drop
- "data_gap": Products lacking verified competitor data
- "margin_risk": Margin pressure or floor protection warnings
- "pending_approval": Pending price recommendations awaiting seller review

Allowed values for "severity": "high", "medium", or "low"
Rule: If verified competitors are cheaper than our store price, ALWAYS include at least one "pricing_opportunity" insight.`;

      const response = await withTimeout(
        client.models.generateContent({
          model: GEMINI_MODEL,
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            temperature: 0.2,
            maxOutputTokens: 2048,
            thinkingConfig: { thinkingBudget: 0 }
          }
        })
      );

      const text = response.text?.trim() || '';
      const cleanJson = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleanJson);

      insightsData = {
        success: true,
        source: 'gemini',
        generatedAt: new Date().toISOString(),
        summary: parsed.summary,
        insights: Array.isArray(parsed.insights) ? parsed.insights : [],
        metrics: {
          totalProducts: factualFacts.totalProducts,
          underpricedCount: factualFacts.underpricedByCompetitors.length,
          dataGapsCount: factualFacts.dataGaps.length,
          pendingRecommendationsCount: factualFacts.pendingRecommendations.length,
          floorProtectedCount: factualFacts.floorProtectedCount
        }
      };
    } catch (err) {
      console.warn('⚠️ [AI Insights] Gemini call failed, building deterministic insights:', err.message);
    }
  }

  // 4. Deterministic fallback if Gemini was unavailable or failed
  if (!insightsData) {
    insightsData = generateDeterministicInsights(factualFacts);
  }

  // Save in cache
  insightsCache = { data: insightsData, timestamp: Date.now() };
  return insightsData;
}

function generateDeterministicInsights(facts) {
  const insights = [];

  // Insight 1: Cheaper Competitor Alert
  if (facts.underpricedByCompetitors.length > 0) {
    const top = facts.underpricedByCompetitors[0];
    insights.push({
      type: 'pricing_opportunity',
      severity: 'high',
      title: `${facts.underpricedByCompetitors.length} Products Face Cheaper Verified Competitors`,
      description: `${top.name} is listed at ₹${top.currentPrice}, while ${top.competitorName} is currently verified at ₹${top.competitorPrice} (${top.diffPercent}% lower).`,
      businessImplication: 'Shoppers comparing prices are likely to purchase from the competitor, reducing sales velocity.',
      recommendedAction: 'Review the Dynamic Repricing recommendation to evaluate matching or undercutting safely within your gross margin floor.',
      productName: top.name,
      productId: top.productId
    });
  }

  // Insight 2: Recent Competitor Drops
  if (facts.verifiedPriceDrops.length > 0) {
    const topDrop = facts.verifiedPriceDrops[0];
    insights.push({
      type: 'competitor_price_drop',
      severity: 'medium',
      title: `Competitor Price Reduction Observed`,
      description: `${topDrop.competitorName} slashed pricing on ${topDrop.productName} to ₹${topDrop.sellingPrice} (${topDrop.discountPercent}% discount).`,
      businessImplication: 'Aggressive competitor discounting may indicate seasonal promotions or inventory clearance.',
      recommendedAction: 'Monitor conversion rate and consider whether matching is viable without violating minimum safe margins.',
      productName: topDrop.productName,
      productId: topDrop.productId
    });
  }

  // Insight 3: Pending Approvals
  if (facts.pendingRecommendations.length > 0) {
    const pending = facts.pendingRecommendations[0];
    insights.push({
      type: 'pending_approval',
      severity: 'medium',
      title: `${facts.pendingRecommendations.length} Repricing Recommendations Awaiting Review`,
      description: `${pending.productName} has a recommended price of ₹${pending.recommendedPrice} awaiting merchant approval.`,
      businessImplication: 'Algorithmic adjustments remain paused until you explicitly review and approve them.',
      recommendedAction: 'Visit Dynamic Repricing to preview and approve recommended pricing adjustments.',
      productName: pending.productName,
      productId: pending.productId
    });
  }

  // Insight 4: Data Gaps
  if (facts.dataGaps.length > 0) {
    const gap = facts.dataGaps[0];
    insights.push({
      type: 'data_gap',
      severity: 'low',
      title: `${facts.dataGaps.length} Products Lack Verified Competitor Benchmarks`,
      description: `${gap.name} does not have any active verified retailer URLs linked yet.`,
      businessImplication: 'Without verified competitor benchmarks, dynamic repricing cannot benchmark against live market competition.',
      recommendedAction: 'Use Competitor Discovery to search and track direct retailer links (Amazon, Flipkart, boAt, Croma).',
      productName: gap.name,
      productId: gap.productId
    });
  }

  return {
    success: true,
    source: 'deterministic_engine',
    generatedAt: new Date().toISOString(),
    summary: `PricePilot is tracking ${facts.totalProducts} catalogue products across ${facts.totalCompetitors} competitor channels. ${facts.underpricedByCompetitors.length} products have cheaper verified alternatives, and ${facts.pendingRecommendations.length} recommendations are ready for review.`,
    insights,
    metrics: {
      totalProducts: facts.totalProducts,
      underpricedCount: facts.underpricedByCompetitors.length,
      dataGapsCount: facts.dataGaps.length,
      pendingRecommendationsCount: facts.pendingRecommendations.length,
      floorProtectedCount: facts.floorProtectedCount
    }
  };
}

// ============================================================================
// 3. AI PRICING COPILOT (CONVERSATIONAL WITH READ-ONLY TOOL CALLING)
// ============================================================================

// Allowlist of 6 read-only tools
const COPILOT_TOOLS = [
  {
    name: 'searchProducts',
    description: 'Search catalogue products by name, brand, SKU or category',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'Search keywords, SKU, or product name' }
      },
      required: ['query']
    }
  },
  {
    name: 'getProductPricingSnapshot',
    description: 'Get comprehensive pricing details, active rule, and recommendation for a product',
    parameters: {
      type: 'OBJECT',
      properties: {
        productId: { type: 'STRING', description: 'MongoDB Product ID or SKU' }
      },
      required: ['productId']
    }
  },
  {
    name: 'getCompetitorComparisons',
    description: 'Retrieve verified and unverified competitor prices for a specific product',
    parameters: {
      type: 'OBJECT',
      properties: {
        productId: { type: 'STRING', description: 'MongoDB Product ID' }
      },
      required: ['productId']
    }
  },
  {
    name: 'getPriceHistory',
    description: 'Get recent historical price change observations for a product or competitor',
    parameters: {
      type: 'OBJECT',
      properties: {
        productId: { type: 'STRING', description: 'MongoDB Product ID' },
        limit: { type: 'INTEGER', description: 'Max observations to return (default 10)' }
      },
      required: ['productId']
    }
  },
  {
    name: 'getPricingRecommendations',
    description: 'List current pricing recommendations across products with floor protection and risk status',
    parameters: {
      type: 'OBJECT',
      properties: {
        status: { type: 'STRING', description: 'Filter by status: "pending", "approved", "rejected", or "all"' }
      }
    }
  },
  {
    name: 'getBusinessSummary',
    description: 'Get overall high-level business metrics across the entire store catalogue',
    parameters: {
      type: 'OBJECT',
      properties: {}
    }
  }
];

/**
 * Executes a tool function against MongoDB in a strictly read-only manner.
 * Never allows arbitrary queries or database mutations.
 * Excludes raw wholesale costs and internal margin thresholds from LLM response context.
 */
async function executeCopilotTool(name, args) {
  try {
    switch (name) {
      case 'searchProducts': {
        const q = String(args?.query || '').trim();
        if (!q) return { error: 'Search query is required' };
        const regex = new RegExp(q, 'i');
        const results = await Product.find({
          status: 'active',
          $or: [{ name: regex }, { sku: regex }, { brand: regex }, { category: regex }]
        })
          .select('name sku brand category sellingPrice minMargin')
          .limit(6)
          .lean();

        return {
          count: results.length,
          products: results.map((p) => ({
            id: p._id.toString(),
            name: p.name,
            sku: p.sku,
            brand: p.brand,
            category: p.category,
            sellingPrice: p.sellingPrice
          }))
        };
      }

      case 'getProductPricingSnapshot': {
        const idOrSku = String(args?.productId || '').trim();
        let product = null;
        if (idOrSku.match(/^[0-9a-fA-F]{24}$/)) {
          product = await Product.findById(idOrSku).lean();
        }
        if (!product) {
          product = await Product.findOne({ sku: new RegExp(`^${idOrSku}$`, 'i') }).lean();
        }
        if (!product) {
          return { error: `Product '${idOrSku}' was not found in the catalogue.` };
        }

        const rule = await PricingRule.findOne({ productId: product._id }).lean();
        const recommendation = await PriceRecommendation.findOne({ productId: product._id })
          .sort({ createdAt: -1 })
          .lean();
        const competitors = await Competitor.find({ productId: product._id, trackingStatus: 'active' }).lean();

        const verifiedComps = competitors.filter((c) => c.priceVerificationStatus === 'verified');
        const lowestVerified = verifiedComps.reduce(
          (min, c) => Math.min(min, c.sellingPrice || c.currentPrice || Infinity),
          Infinity
        );

        return {
          product: {
            id: product._id.toString(),
            name: product.name,
            sku: product.sku,
            brand: product.brand,
            currentSellingPrice: product.sellingPrice
          },
          strategy: rule?.strategy || 'lowest_competitor',
          competitorBenchmark: lowestVerified === Infinity ? 'None verified' : lowestVerified,
          competitorCount: competitors.length,
          verifiedCompetitorCount: verifiedComps.length,
          recommendation: recommendation
            ? {
                recommendedPrice: recommendation.recommendedPrice,
                priceDifference: recommendation.priceDifference,
                riskLevel: recommendation.riskLevel || 'normal',
                floorApplied: recommendation.floorApplied,
                status: recommendation.status,
                explanation: recommendation.explanation
              }
            : 'No recommendation generated yet'
        };
      }

      case 'getCompetitorComparisons': {
        const pid = args?.productId;
        if (!pid) return { error: 'productId is required' };
        const competitors = await Competitor.find({ productId: pid, trackingStatus: 'active' }).lean();

        return {
          productId: pid,
          competitors: competitors.map((c) => ({
            id: c._id.toString(),
            merchantName: c.merchantName,
            externalTitle: c.externalTitle,
            price: c.sellingPrice || c.currentPrice,
            originalPrice: c.originalPrice,
            isAvailable: c.isAvailable,
            verificationStatus: c.priceVerificationStatus,
            sourceType: c.sourceType,
            lastCheckedAt: c.lastCheckedAt
          }))
        };
      }

      case 'getPriceHistory': {
        const pid = args?.productId;
        if (!pid) return { error: 'productId is required' };
        const limit = Math.min(Math.max(parseInt(args?.limit, 10) || 10, 1), 30);
        const observations = await PriceObservation.find({ productId: pid })
          .sort({ observedAt: -1 })
          .limit(limit)
          .lean();

        return {
          count: observations.length,
          observations: observations.map((o) => ({
            date: o.observedAt,
            price: o.sellingPrice || o.price,
            originalPrice: o.originalPrice,
            verificationStatus: o.priceVerificationStatus,
            extractionMethod: o.extractionMethod,
            notes: o.notes
          }))
        };
      }

      case 'getPricingRecommendations': {
        const statusFilter = args?.status && args.status !== 'all' ? { status: args.status } : {};
        const recs = await PriceRecommendation.find(statusFilter)
          .sort({ createdAt: -1 })
          .limit(10)
          .populate('productId', 'name sku brand sellingPrice')
          .lean();

        return {
          count: recs.length,
          recommendations: recs.map((r) => ({
            productName: r.productId?.name || 'Unknown',
            sku: r.productId?.sku,
            currentPrice: r.currentSellingPrice,
            recommendedPrice: r.recommendedPrice,
            priceDifference: r.priceDifference,
            strategy: r.strategy,
            riskLevel: r.riskLevel || 'normal',
            floorApplied: r.floorApplied,
            status: r.status,
            explanation: r.explanation
          }))
        };
      }

      case 'getBusinessSummary': {
        const totalProducts = await Product.countDocuments({ status: 'active' });
        const totalCompetitors = await Competitor.countDocuments({ trackingStatus: 'active' });
        const pendingRecs = await PriceRecommendation.countDocuments({ status: 'pending' });
        const floorProtected = await PriceRecommendation.countDocuments({ floorApplied: true });

        return {
          totalProducts,
          activeCompetitors: totalCompetitors,
          pendingRecommendations: pendingRecs,
          floorProtectedProducts: floorProtected,
          currency: 'INR'
        };
      }

      default:
        return { error: `Tool '${name}' is not recognized.` };
    }
  } catch (err) {
    console.error(`Error executing tool '${name}':`, err.message);
    return { error: `Tool execution failed: ${err.message}` };
  }
}

/**
 * Multi-turn conversational copilot with safe tool calling.
 */
async function chatWithCopilot(userMessage, conversationHistory = []) {
  if (!userMessage || typeof userMessage !== 'string' || !userMessage.trim()) {
    throw new Error('Message cannot be empty.');
  }

  const client = getClient();
  if (!client) {
    return {
      reply: 'PricePilot AI Copilot is currently offline. Please configure GEMINI_API_KEY in backend/.env to activate live conversational intelligence.',
      toolCalls: [],
      sources: []
    };
  }

  if (!checkAndIncrementQuota()) {
    return {
      reply: 'The AI daily request quota has been reached. Please try again tomorrow or upgrade your quota limit in backend/.env.',
      toolCalls: [],
      sources: []
    };
  }

  const systemInstruction = `You are PricePilot Copilot, an intelligent, analytical pricing assistant for e-commerce sellers.
Your job is to help merchants understand their pricing recommendations, compare competitor movements, detect margin risks, and answer catalog queries using live data.

GUIDELINES:
1. Always use the provided read-only tools to fetch live store data before answering questions about specific products, competitors, recommendations, or statistics.
2. Quote exact numbers (₹, %, product titles) from tool outputs. Never invent or hallucinate products, prices, or competitor names.
3. If data is not available or a product does not exist, state that clearly and offer next steps.
4. Protect merchant confidentiality: never mention wholesale cost prices or internal confidential margin formulas. Keep explanations focused on market position, selling price difference, and safety floors.
5. Keep responses concise, professional, structured, and actionable. Format prices cleanly in Indian Rupees (e.g., ₹899).`;

  // Format bounded history (max 8 turns)
  const boundedHistory = conversationHistory.slice(-8).map((msg) => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: String(msg.content || msg.text || '') }]
  }));

  // Append new user message
  const contents = [
    ...boundedHistory,
    { role: 'user', parts: [{ text: userMessage.trim() }] }
  ];

  const toolsConfig = [{
    functionDeclarations: COPILOT_TOOLS
  }];

  const toolCallsLog = [];
  let finalReply = '';

  try {
    // Turn 1: Send user message and tools
    let response = await withTimeout(
      client.models.generateContent({
        model: GEMINI_MODEL,
        contents,
        config: {
          systemInstruction,
          tools: toolsConfig,
          temperature: 0.2,
          maxOutputTokens: 2048,
          thinkingConfig: { thinkingBudget: 0 }
        }
      })
    );

    // Loop for tool calls (max 3 tool call iterations to avoid loops)
    let iterations = 0;
    while (response.functionCalls && response.functionCalls.length > 0 && iterations < 3) {
      iterations++;

      const responseParts = [];
      for (const fc of response.functionCalls) {
        toolCallsLog.push({ name: fc.name, args: fc.args });
        const toolResult = await executeCopilotTool(fc.name, fc.args);
        responseParts.push({
          functionResponse: {
            name: fc.name,
            response: toolResult
          }
        });
      }

      // Append assistant's function call candidate
      contents.push(response.candidates[0].content);

      // Append all function responses for this turn
      contents.push({
        role: 'user',
        parts: responseParts
      });

      // Turn 2+: Request continuation with tool response
      response = await withTimeout(
        client.models.generateContent({
          model: GEMINI_MODEL,
          contents,
          config: {
            systemInstruction,
            tools: toolsConfig,
            temperature: 0.2,
            maxOutputTokens: 2048,
            thinkingConfig: { thinkingBudget: 0 }
          }
        })
      );
    }

    finalReply = response.text || 'I checked the catalogue records, but could not formulate a complete answer. Please rephrase your question.';
  } catch (err) {
    console.error('⚠️ [Copilot] Conversation error:', err.message);
    finalReply = `I encountered an issue processing your request (${err.message}). Please try asking about a specific product by name or SKU.`;
  }

  return {
    reply: finalReply,
    toolCalls: toolCallsLog,
    sources: toolCallsLog.map((t) => t.name)
  };
}

module.exports = {
  getAIStatus,
  evaluateCompetitorMatchWithAI,
  generatePricingInsights,
  chatWithCopilot,
  executeCopilotTool,
  // Exported for testing/mocking
  _clearCaches: () => {
    matchCache.clear();
    insightsCache = null;
    dailyCounter.count = 0;
  }
};
