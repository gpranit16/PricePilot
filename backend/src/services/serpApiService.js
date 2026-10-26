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
 */
function parsePrice(rawPrice) {
  if (typeof rawPrice === 'number') return rawPrice;
  if (!rawPrice || typeof rawPrice !== 'string') return null;

  const cleaned = rawPrice.replace(/[^0-9.,]/g, '');
  if (!cleaned) return null;

  const numeric = parseFloat(cleaned.replace(/,/g, ''));
  return isNaN(numeric) ? null : numeric;
}

/**
 * Extracts lowest rupee price from a text snippet to prefer selling price over MRP.
 */
function extractLowestSnippetPrice(snippet = '') {
  if (!snippet) return null;
  const matches = [...snippet.matchAll(/(?:₹|Rs\.?|INR)\s*([0-9,]+(?:\.[0-9]{2})?)/gi)];
  if (matches.length === 0) return null;

  const numbers = matches
    .map((m) => parseFloat(m[1].replace(/,/g, '')))
    .filter((p) => !isNaN(p) && p > 0);

  if (numbers.length === 0) return null;
  return Math.min(...numbers);
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
      timeout: 3200,
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
      return {
        ...candidate,
        imageUrl: imageUrl || candidate.imageUrl,
        isBroken: false,
        urlStatus: 'accessible',
        statusNote: 'Direct retailer page accessible'
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

      const price = item.extracted_price || parsePrice(item.price);
      const match = evaluateMatchQuality(item.title, product);

      rawCandidates.push({
        title: item.title || 'Product listing',
        merchantName: item.source || item.seller || 'Online Merchant',
        url: finalUrl,
        isDirectRetailerLink: !isGoogleShopping,
        isGoogleShoppingLink: Boolean(isGoogleShopping),
        imageUrl: item.thumbnail || '',
        price: price,
        currency: 'INR',
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
      let price = null;
      const detectedPrice =
        item.rich_snippet?.top?.detected_extensions?.price ||
        item.rich_snippet?.top?.detected_extensions?.price_from;

      if (detectedPrice) {
        price = parsePrice(detectedPrice);
      } else {
        price = extractLowestSnippetPrice(item.snippet);
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
        price: price,
        currency: 'INR',
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
  extractLowestSnippetPrice
};
