const axios = require('axios');
const cheerio = require('cheerio');

/**
 * SerpApi Integration Service for PricePilot.
 * Discovers competitor product listings via Google Shopping with Google Search fallback.
 * Configured for India (gl=in) and English (hl=en).
 */

const SERPAPI_BASE_URL = 'https://serpapi.com/search.json';

/**
 * Normalizes price string or number into a clean float.
 * Rejects ambiguous ranges (e.g. '₹1,499 - ₹2,999') and cleans parenthetical metadata.
 */
function parsePrice(rawPrice) {
  if (typeof rawPrice === 'number') {
    return !isNaN(rawPrice) && rawPrice > 0 ? rawPrice : null;
  }
  if (!rawPrice || typeof rawPrice !== 'string') return null;

  const trimmed = rawPrice.trim();
  if (!trimmed) return null;

  // Reject ambiguous price ranges (e.g., '1499 - 2999', '₹899 to ₹1,499')
  const rangePattern = /(?:₹|Rs\.?|INR)?\s*[0-9,]+(?:\.[0-9]+)?\s*(?:-|–|—|\bto\b)\s*(?:₹|Rs\.?|INR)?\s*[0-9,]+(?:\.[0-9]+)?/i;
  if (rangePattern.test(trimmed)) {
    return null;
  }

  // Look for currency-tagged price first (e.g., '₹899', 'Rs. 1,499.00', 'INR 899')
  const currencyMatch = trimmed.match(/(?:₹|Rs\.?|INR)\s*([0-9]{1,3}(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/i);
  if (currencyMatch && currencyMatch[1]) {
    const val = parseFloat(currencyMatch[1].replace(/,/g, ''));
    return !isNaN(val) && val > 0 ? val : null;
  }

  // Match standalone number without unwanted alphanumeric words (e.g. '5 mins', '10%')
  const standaloneMatch = trimmed.match(/^\s*([0-9]{1,3}(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)\s*$/);
  if (standaloneMatch && standaloneMatch[1]) {
    const val = parseFloat(standaloneMatch[1].replace(/,/g, ''));
    return !isNaN(val) && val > 0 ? val : null;
  }

  return null;
}

/**
 * Extracts verified selling price and original MRP from a text snippet.
 * Excludes EMI, accessory, discount/cashback, and delivery prices. Rejects ambiguous ranges.
 * Never treats MRP as selling price.
 */
function extractSnippetPrices(snippet = '') {
  if (!snippet || typeof snippet !== 'string') {
    return { sellingPrice: null, originalPrice: null };
  }

  const matches = [...snippet.matchAll(/(?:₹|Rs\.?|INR)\s*([0-9]{1,3}(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/gi)];
  if (matches.length === 0) {
    return { sellingPrice: null, originalPrice: null };
  }

  const candidates = [];

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const matchedStr = m[0];
    const numStr = m[1];
    const numeric = parseFloat(numStr.replace(/,/g, ''));
    if (isNaN(numeric) || numeric <= 0) continue;

    const startIdx = m.index;
    const endIdx = startIdx + matchedStr.length;

    // Isolate the immediate clause / sentence to avoid cross-sentence false positives
    const prevMatchEnd = i > 0 ? matches[i - 1].index + matches[i - 1][0].length : 0;
    const lastPunctuation = Math.max(
      snippet.lastIndexOf('.', startIdx - 1),
      snippet.lastIndexOf('!', startIdx - 1),
      snippet.lastIndexOf('?', startIdx - 1),
      snippet.lastIndexOf(';', startIdx - 1),
      snippet.lastIndexOf('\n', startIdx - 1)
    );
    const clauseStart = Math.max(0, prevMatchEnd, lastPunctuation + 1, startIdx - 35);
    const clauseBefore = snippet.slice(clauseStart, startIdx).toLowerCase();

    const nextDelim = snippet.slice(endIdx).search(/[.!?;,\n]/);
    const clauseEnd = nextDelim !== -1 ? endIdx + nextDelim : Math.min(snippet.length, endIdx + 35);
    const clauseAfter = snippet.slice(endIdx, clauseEnd).toLowerCase();

    // 1. Reject EMI / installment prices
    const isEmi =
      /\b(?:emi|per\s*month|\/mo|\/month|monthly|down\s*payment|starting\s*emi)\b/.test(clauseBefore) ||
      /\b(?:emi|per\s*month|\/mo|\/month|monthly|down\s*payment)\b/.test(clauseAfter);
    if (isEmi) continue;

    // 2. Reject Cashback, savings, and discount amounts (e.g. 'save ₹500', 'flat ₹200 off', 'cashback ₹150')
    // BUT NOT percentage discount preceding a price (e.g. '77% off ₹1,099' where ₹1,099 is the selling price!)
    const isPercentageOff = /[0-9]+%\s*off\s*$/i.test(clauseBefore.trim());
    const isDiscount =
      !isPercentageOff &&
      (/\b(?:cashback|coupon|flat\s*rs|save\s*rs|save|savings?|discount)\b/.test(clauseBefore) ||
       /\b(?:cashback|coupon|flat\s*rs|save\s*rs|savings?|discount)\b/.test(clauseAfter) ||
       /\boff\b/.test(clauseAfter));
    if (isDiscount) continue;

    // 3. Reject Delivery and shipping charges (ignore 'free shipping' / 'free delivery' qualifiers)
    const hasFreeDelivery =
      /\bfree\s+(?:delivery|shipping)\b/.test(clauseBefore) ||
      /\bfree\s+(?:delivery|shipping)\b/.test(clauseAfter);

    const isDelivery =
      !hasFreeDelivery &&
      (/\b(?:delivery|shipping|freight|courier)\s*(?:charges?|fee|costs?|is|of|:)?\b/.test(clauseBefore) ||
       /\b(?:delivery|shipping)\s*(?:charges?|fee|costs?)\b/.test(clauseAfter));
    if (isDelivery) continue;

    // 4. Reject Accessories and add-ons (e.g. 'cases from ₹99')
    const isAccessory =
      /\b(?:cases?|covers?|straps?|cables?|chargers?|adapters?|pouches?|accessories)\s+(?:from|at|for|starting)?\b/.test(clauseBefore);
    if (isAccessory) continue;

    // 5. Reject ambiguous price range markers (both lower and upper bounds)
    const isRange =
      /\b(?:between|range|from)\b/.test(clauseBefore) ||
      /^\s*(?:[-–—]|\bto\b)/i.test(clauseAfter) ||
      /(?:[-–—]|\bto)\s*$/i.test(clauseBefore.trim());
    if (isRange) continue;

    const isMrp = /\b(?:mrp|list\s*price|was|original)\b/.test(clauseBefore);
    const isSelling =
      isPercentageOff ||
      /\b(?:price|now|deal\s*price|our\s*price|selling\s*price|pay|special\s*price)\b/.test(clauseBefore);

    candidates.push({ numeric, isMrp, isSelling });
  }

  if (candidates.length === 0) {
    return { sellingPrice: null, originalPrice: null };
  }

  // Find explicit MRP
  const mrpCandidate = candidates.find((c) => c.isMrp);
  let originalPrice = mrpCandidate ? mrpCandidate.numeric : null;

  // Selling candidates MUST NOT be marked as MRP
  const sellingCandidates = candidates.filter((c) => !c.isMrp);

  if (sellingCandidates.length === 0) {
    // Only MRP was found: NEVER treat MRP as the selling price!
    return { sellingPrice: null, originalPrice };
  }

  const explicitSelling = sellingCandidates.find((c) => c.isSelling);
  const sellingPrice = explicitSelling
    ? explicitSelling.numeric
    : Math.min(...sellingCandidates.map((c) => c.numeric));

  // If both exist and originalPrice is somehow lower, swap them
  if (sellingPrice && originalPrice && originalPrice < sellingPrice) {
    const temp = originalPrice;
    originalPrice = sellingPrice;
    return { sellingPrice: temp, originalPrice: temp };
  }

  return { sellingPrice, originalPrice };
}

/**
 * Extracts verified selling price from a text snippet.
 * Excludes EMI, accessory, discount/cashback, and delivery prices. Rejects ambiguous ranges.
 */
function extractLowestSnippetPrice(snippet = '') {
  const { sellingPrice } = extractSnippetPrices(snippet);
  return sellingPrice;
}

/**
 * Calculates a match indicator based on brand, model numbers, tier modifiers, and variants.
 * @returns {Object} { level: 'exact'|'high'|'partial'|'moderate'|'mismatch', label: string, isExact: boolean }
 */
function evaluateMatchQuality(candidateTitle = '', merchantProduct = {}) {
  const cTitle = (candidateTitle || '').toLowerCase();
  const pName = (merchantProduct.name || '').toLowerCase();
  const pBrand = (merchantProduct.brand || '').toLowerCase();
  const pSku = (merchantProduct.sku || '').toLowerCase();

  // If exact SKU is found in candidate title and long enough
  if (pSku && pSku.length > 4 && cTitle.includes(pSku)) {
    return { level: 'exact', label: 'Exact SKU Match', isExact: true };
  }

  // Extract model numbers (e.g. '311' in 'Airdopes 311 PRO')
  const pNumbers = pName.match(/\b\d+[a-z]?\b/g) || [];
  const cNumbers = cTitle.match(/\b\d+[a-z]?\b/g) || [];

  if (pNumbers.length > 0 && cNumbers.length > 0) {
    const hasMatchingNumber = pNumbers.some((num) => cNumbers.includes(num));
    if (!hasMatchingNumber) {
      const diffNum = cNumbers[0];
      return { level: 'mismatch', label: `Different Model (${diffNum})`, isExact: false };
    }
  }

  // Brand check
  const brandMatch = pBrand && pBrand !== 'general' ? cTitle.includes(pBrand) : true;
  if (!brandMatch && pBrand && pBrand !== 'general') {
    return { level: 'low', label: 'Different Brand', isExact: false };
  }

  // Tier modifier checks (pro, plus, max, ultra, mini, lite, anc)
  const tiers = ['pro', 'plus', 'max', 'ultra', 'mini', 'lite', 'anc'];
  const pTiers = tiers.filter((t) => new RegExp(`\\b${t}\\b`, 'i').test(pName));
  const cTiers = tiers.filter((t) => new RegExp(`\\b${t}\\b`, 'i').test(cTitle));

  const tierMismatch =
    pTiers.some((t) => !cTiers.includes(t)) || cTiers.some((t) => !pTiers.includes(t));

  if (tierMismatch && (pTiers.length > 0 || cTiers.length > 0)) {
    const candidateTier = cTiers.join('/') || 'Standard';
    return { level: 'partial', label: `Variant Tier (${candidateTier})`, isExact: false };
  }

  // Color variant checks
  const colors = [
    'pink',
    'blue',
    'green',
    'red',
    'purple',
    'yellow',
    'gold',
    'silver',
    'white',
    'black',
    'lavender',
    'grey',
    'gray'
  ];
  const pColors = colors.filter((c) => new RegExp(`\\b${c}\\b`, 'i').test(pName));
  const cColors = colors.filter((c) => new RegExp(`\\b${c}\\b`, 'i').test(cTitle));

  if (cColors.length > 0 && pColors.length > 0 && !cColors.some((c) => pColors.includes(c))) {
    return { level: 'high', label: `Color: ${cColors[0]}`, isExact: false };
  }
  if (cColors.length > 0 && pColors.length === 0) {
    return { level: 'high', label: `High Match (${cColors[0]})`, isExact: false };
  }

  // Token matching for core product words
  const cleanTokens = pName
    .replace(/[^a-z0-9\s]/gi, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !tiers.includes(t));

  let matchedTokens = 0;
  for (const token of cleanTokens) {
    if (cTitle.includes(token)) matchedTokens++;
  }

  const ratio = cleanTokens.length > 0 ? matchedTokens / cleanTokens.length : 0;

  if (ratio >= 0.75 && brandMatch && !tierMismatch) {
    return { level: 'exact', label: 'Exact Match', isExact: true };
  }
  if (ratio >= 0.45) {
    return { level: 'high', label: 'High Match', isExact: false };
  }
  return { level: 'moderate', label: 'Partial Match', isExact: false };
}

/**
 * Validates candidate URLs in parallel and checks for dead links (404 / Page Not Found).
 */
async function validateAndEnrichCandidate(candidate, product) {
  // If no URL or not HTTP/HTTPS
  if (!candidate.url || !candidate.url.startsWith('http')) {
    return {
      ...candidate,
      isBroken: true,
      urlStatus: 'broken',
      statusNote: 'Invalid candidate URL'
    };
  }

  // Google Shopping aggregator URLs don't need direct HTTP GET testing
  if (candidate.isGoogleShoppingLink) {
    return {
      ...candidate,
      isBroken: false,
      urlStatus: 'accessible',
      statusNote: 'Google Shopping offer page'
    };
  }

  try {
    const res = await axios.get(candidate.url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      timeout: 6000,
      maxRedirects: 4,
      validateStatus: () => true
    });

    const isHttp404 = res.status === 404 || res.status === 410;
    const html = typeof res.data === 'string' ? res.data : '';
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const pageTitle = titleMatch ? titleMatch[1].trim() : '';

    const isPageNotFound =
      isHttp404 ||
      /page not found|item not found|product not found|404 error|we're sorry/i.test(pageTitle);

    if (isPageNotFound) {
      return {
        ...candidate,
        isBroken: true,
        urlStatus: 'broken',
        statusNote: 'Page Not Found (404 on retailer website)'
      };
    }

    // Try extracting OpenGraph image if candidate has no image
    let imageUrl = candidate.imageUrl;
    if (!imageUrl && html) {
      const ogImageMatch =
        html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i) ||
        html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:image["']/i);
      if (ogImageMatch && ogImageMatch[1].startsWith('http')) {
        imageUrl = ogImageMatch[1];
      }
    }

    if (res.status === 200) {
      // Live-extract direct selling price from retailer HTML if available
      let livePriceInfo = null;
      if (html) {
        try {
          const { extractPriceFromHtml } = require('./scraperService');
          livePriceInfo = extractPriceFromHtml(html);
        } catch (e) {}
      }

      const finalSelling = livePriceInfo?.sellingPrice || candidate.sellingPrice;
      const finalOriginal = livePriceInfo?.originalPrice || candidate.originalPrice;
      const isVerified = Boolean(livePriceInfo?.sellingPrice);

      return {
        ...candidate,
        imageUrl: imageUrl || candidate.imageUrl,
        price: finalSelling,
        sellingPrice: finalSelling,
        originalPrice: finalOriginal,
        discountPercent: livePriceInfo?.discountPercent || candidate.discountPercent,
        priceVerificationStatus: isVerified ? 'verified' : candidate.priceVerificationStatus,
        isBroken: false,
        urlStatus: 'accessible',
        statusNote: isVerified ? `Direct price verified: ₹${finalSelling}` : 'Direct retailer page accessible'
      };
    }

    if (res.status === 403 || res.status === 429) {
      return {
        ...candidate,
        imageUrl: imageUrl || candidate.imageUrl,
        isBroken: false,
        urlStatus: 'protected',
        statusNote: 'Protected retailer page (requires manual review)'
      };
    }

    return {
      ...candidate,
      imageUrl: imageUrl || candidate.imageUrl,
      isBroken: false,
      urlStatus: 'accessible',
      statusNote: `HTTP status ${res.status}`
    };
  } catch (err) {
    // Connection timed out or DNS error
    return {
      ...candidate,
      isBroken: false,
      urlStatus: 'unverified',
      statusNote: 'URL verification timed out'
    };
  }
}

/**
 * Discovers competitor listings for a product.
 * @param {Object} product - Merchant product document from MongoDB.
 * @returns {Promise<Array>} List of competitor candidate objects.
 */
async function discoverCompetitors(product) {
  const apiKey = process.env.SERPAPI_API_KEY;

  if (!apiKey || apiKey.trim() === '' || apiKey === 'your_serpapi_api_key_here') {
    throw new Error(
      'SERPAPI_API_KEY is not configured in backend/.env. Please configure a valid SerpApi key.'
    );
  }

  // Construct a targeted search query using brand and product name
  const queryParts = [];
  if (product.brand && product.brand.trim() && product.brand.toLowerCase() !== 'general') {
    queryParts.push(product.brand.trim());
  }
  queryParts.push(product.name.trim());
  const query = queryParts.join(' ');

  console.log(`🔍 [SerpApi] Discovering competitors for: "${query}" (gl=in, hl=en)`);

  let rawCandidates = [];

  // 1. Try Google Shopping API
  try {
    const shoppingRes = await axios.get(SERPAPI_BASE_URL, {
      params: {
        engine: 'google_shopping',
        q: query,
        gl: 'in',
        hl: 'en',
        api_key: apiKey
      },
      timeout: 12000
    });

    const results = shoppingRes.data.shopping_results || [];
    console.log(`✓ [SerpApi] Found ${results.length} Google Shopping results`);

    for (const item of results.slice(0, 10)) {
      // Determine link: direct_link > link > product_link
      const hasDirect = Boolean(item.direct_link && item.direct_link.startsWith('http'));
      const fallbackUrl = item.link || item.product_link || '';
      const finalUrl = hasDirect ? item.direct_link : fallbackUrl;

      if (!finalUrl || !finalUrl.startsWith('http')) continue;

      const isGoogleShopping =
        !hasDirect && (item.product_link || (item.link && item.link.includes('google.com')));

      const rawSelling = item.extracted_price || parsePrice(item.price);
      const rawOriginal = parsePrice(item.old_price);

      let sellingPrice = typeof rawSelling === 'number' && rawSelling > 0 ? rawSelling : null;
      let originalPrice = typeof rawOriginal === 'number' && rawOriginal > 0 ? rawOriginal : null;

      // If original price is smaller than selling price, swap them
      if (sellingPrice && originalPrice && originalPrice < sellingPrice) {
        const temp = originalPrice;
        originalPrice = sellingPrice;
        sellingPrice = temp;
      }

      const discountPercent =
        sellingPrice && originalPrice && originalPrice > sellingPrice
          ? Math.round(((originalPrice - sellingPrice) / originalPrice) * 100)
          : null;

      const match = evaluateMatchQuality(item.title, product);

      rawCandidates.push({
        title: item.title || 'Product listing',
        merchantName: item.source || item.seller || 'Online Merchant',
        url: finalUrl,
        isDirectRetailerLink: !isGoogleShopping,
        isGoogleShoppingLink: Boolean(isGoogleShopping),
        imageUrl: item.thumbnail || '',
        price: sellingPrice,
        sellingPrice: sellingPrice,
        originalPrice: originalPrice,
        discountPercent: discountPercent,
        currency: 'INR',
        priceVerificationStatus: 'unverified',
        rating: item.rating || null,
        reviewsCount: item.reviews || null,
        matchQuality: match.level,
        matchLabel: match.label,
        isExactMatch: match.isExact,
        sourceType: 'search_result'
      });
    }
  } catch (error) {
    console.warn(`⚠️ [SerpApi] Google Shopping search notice: ${error.message}`);
    if (error.response?.status === 429) {
      throw new Error('SerpApi rate limit reached. Please wait a moment before searching again.');
    }
    if (error.response?.status === 401 || error.response?.status === 403) {
      throw new Error('Invalid SerpApi key. Please check your SERPAPI_API_KEY.');
    }
  }

  // 2. Supplement or Fallback with Google Search (Organic results)
  try {
    const searchRes = await axios.get(SERPAPI_BASE_URL, {
      params: {
        engine: 'google',
        q: `${query} buy online price in india`,
        gl: 'in',
        hl: 'en',
        api_key: apiKey
      },
      timeout: 12000
    });

    const organic = searchRes.data.organic_results || [];
    console.log(`✓ [SerpApi] Found ${organic.length} organic search results`);

    for (const item of organic.slice(0, 8)) {
      if (!item.link || !item.link.startsWith('http')) continue;

      // Avoid adding duplicate URLs already in rawCandidates
      if (rawCandidates.some((c) => c.url === item.link)) continue;

      // Extract best price: prioritize detected extensions over raw snippet to avoid MRP strike-through prices
      let sellingPrice = null;
      let originalPrice = null;
      const detectedPrice =
        item.rich_snippet?.top?.detected_extensions?.price ||
        item.rich_snippet?.top?.detected_extensions?.price_from;

      if (detectedPrice) {
        sellingPrice = parsePrice(detectedPrice);
      } else {
        const snippetPrices = extractSnippetPrices(item.snippet);
        sellingPrice = snippetPrices.sellingPrice;
        originalPrice = snippetPrices.originalPrice;
      }

      // Extract merchant domain
      let merchant = item.displayed_link || '';
      try {
        const parsedUrl = new URL(item.link);
        merchant = parsedUrl.hostname.replace(/^www\./, '');
      } catch (e) {}

      const match = evaluateMatchQuality(item.title, product);

      rawCandidates.push({
        title: item.title || 'Product result',
        merchantName: merchant || 'Web Retailer',
        url: item.link,
        isDirectRetailerLink: true,
        isGoogleShoppingLink: false,
        imageUrl: item.thumbnail || '',
        price: sellingPrice,
        sellingPrice: sellingPrice,
        originalPrice: originalPrice,
        discountPercent: null,
        currency: 'INR',
        priceVerificationStatus: 'unverified',
        rating: null,
        reviewsCount: null,
        matchQuality: match.level,
        matchLabel: match.label,
        isExactMatch: match.isExact,
        sourceType: 'search_result'
      });
    }
  } catch (searchError) {
    console.warn(`⚠️ [SerpApi] Google Search fallback notice: ${searchError.message}`);
  }

  if (rawCandidates.length === 0) {
    return [];
  }

  // Prioritize direct retailer website links over Google Shopping aggregator search pages
  rawCandidates.sort((a, b) => {
    if (a.isDirectRetailerLink && !b.isDirectRetailerLink) return -1;
    if (!a.isDirectRetailerLink && b.isDirectRetailerLink) return 1;
    return 0;
  });

  // 3. Validate candidate URLs and detect broken links (in parallel)
  console.log(`⚡ [SerpApi] Validating ${rawCandidates.length} candidate URLs for dead links...`);
  const validatedCandidates = await Promise.all(
    rawCandidates.map((c) => validateAndEnrichCandidate(c, product))
  );

  return validatedCandidates;
}

module.exports = {
  discoverCompetitors,
  parsePrice,
  evaluateMatchQuality,
  extractLowestSnippetPrice,
  extractSnippetPrices
};
