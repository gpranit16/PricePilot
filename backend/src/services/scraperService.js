const axios = require('axios');
const cheerio = require('cheerio');
const { parsePrice } = require('./serpApiService');

/**
 * Validates that a target URL is safe to scrape.
 * Mitigates Server-Side Request Forgery (SSRF) by blocking private, local, and cloud metadata IPs.
 */
function validateSafeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error('URL is missing or invalid.');
  }

  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch (err) {
    throw new Error(`Invalid URL format: '${rawUrl}'.`);
  }

  // Enforce HTTP / HTTPS protocols only
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unpermitted URL protocol '${parsed.protocol}'. Only http and https are allowed.`);
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block localhost, loopbacks, and common private IP ranges
  const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '::1', '169.254.169.254'];
  if (blockedHosts.includes(hostname)) {
    throw new Error(`Access to local or internal address '${hostname}' is strictly blocked for security.`);
  }

  // Check IPv4 private subnets (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
  const isPrivateIp =
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname);

  if (isPrivateIp) {
    throw new Error(`Access to private network address '${hostname}' is prohibited.`);
  }

  return parsed.href;
}

/**
 * Extracts product price and currency from HTML content.
 * Checks JSON-LD structured data first, then OpenGraph/Twitter meta tags, and microdata/selectors.
 */
function extractPriceFromHtml(html) {
  const $ = cheerio.load(html);

  // 1. Check JSON-LD Structured Data (Schema.org Product & Offer)
  const jsonLdScripts = $('script[type="application/ld+json"]');
  for (let i = 0; i < jsonLdScripts.length; i++) {
    try {
      const scriptContent = $(jsonLdScripts[i]).html();
      if (!scriptContent) continue;
      const json = JSON.parse(scriptContent);

      // JSON-LD could be a single object or an array or @graph
      const items = Array.isArray(json) ? json : json['@graph'] ? json['@graph'] : [json];

      for (const item of items) {
        if (
          item['@type'] === 'Product' ||
          item['@type'] === 'IndividualProduct' ||
          item['@type'] === 'ProductModel'
        ) {
          const offers = item.offers;
          if (offers) {
            // offers can be an array or single object
            const offer = Array.isArray(offers) ? offers[0] : offers;
            const price = parsePrice(offer.price || offer.lowPrice || offer.highPrice);
            if (price && price > 0) {
              return {
                price,
                currency: offer.priceCurrency || 'INR',
                extractionMethod: 'JSON-LD Structured Data',
                rawSnippet: `schema.org/Product price: ${price}`
              };
            }
          }
        }
      }
    } catch (e) {
      // Continue to next script tag if parse fails
    }
  }

  // 2. Check OpenGraph and Twitter Meta Tags
  const ogPrice = $('meta[property="og:price:amount"]').attr('content') ||
                  $('meta[property="product:price:amount"]').attr('content') ||
                  $('meta[name="twitter:data1"]').attr('content');

  const ogCurrency = $('meta[property="og:price:currency"]').attr('content') ||
                     $('meta[property="product:price:currency"]').attr('content') ||
                     'INR';

  if (ogPrice) {
    const price = parsePrice(ogPrice);
    if (price && price > 0) {
      return {
        price,
        currency: ogCurrency.toUpperCase(),
        extractionMethod: 'OpenGraph Meta Tag',
        rawSnippet: `og:price:amount: ${ogPrice}`
      };
    }
  }

  // 3. Check Schema.org Microdata itemprop="price"
  const itempropPrice = $('[itemprop="price"]').attr('content') || $('[itemprop="price"]').text();
  if (itempropPrice) {
    const price = parsePrice(itempropPrice);
    if (price && price > 0) {
      return {
        price,
        currency: $('[itemprop="priceCurrency"]').attr('content') || 'INR',
        extractionMethod: 'Schema Microdata',
        rawSnippet: `itemprop="price": ${itempropPrice.trim()}`
      };
    }
  }

  // 4. Common E-Commerce Price Selectors (Amazon India, Flipkart, Shopify, generic store themes)
  const candidateSelectors = [
    '.a-price .a-offscreen',
    '.a-price-whole',
    '._30jeq3._16Jk6d', // Flipkart selling price
    'span.price-item--regular',
    'span.price-item--sale',
    '.product-price .price',
    '.product-form__price',
    '.current-price',
    '.selling-price',
    '#priceblock_ourprice',
    '#priceblock_dealprice'
  ];

  for (const selector of candidateSelectors) {
    const element = $(selector).first();
    if (element.length > 0) {
      const text = element.text().trim();
      const price = parsePrice(text);
      if (price && price > 0) {
        return {
          price,
          currency: 'INR',
          extractionMethod: `DOM Selector (${selector})`,
          rawSnippet: text
        };
      }
    }
  }

  return null;
}

/**
 * Scrapes a verified competitor product page.
 * @param {string} url - Target product page URL
 * @returns {Promise<Object>} Extracted price and observation details
 */
async function scrapeCompetitorPage(url) {
  const safeUrl = validateSafeUrl(url);

  console.log(`🕷️ [Scraper] Initiating direct scrape for: ${safeUrl}`);

  try {
    const response = await axios.get(safeUrl, {
      timeout: 10000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-IN,en-US;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache'
      },
      maxRedirects: 4
    });

    if (response.status !== 200) {
      throw new Error(`Target website returned HTTP status ${response.status}`);
    }

    const extracted = extractPriceFromHtml(response.data);

    if (!extracted || !extracted.price) {
      return {
        success: false,
        error: 'Price not found on page. The website structure may have changed or price is loaded via dynamic client-side scripts.'
      };
    }

    return {
      success: true,
      price: extracted.price,
      currency: extracted.currency,
      extractionMethod: extracted.extractionMethod,
      rawSnippet: extracted.rawSnippet,
      scrapedAt: new Date()
    };
  } catch (err) {
    if (err.code === 'ECONNABORTED') {
      return { success: false, error: 'Request timed out after 10 seconds. The target website took too long to respond.' };
    }
    if (err.response?.status === 403 || err.response?.status === 401) {
      return { success: false, error: `Access restricted (HTTP ${err.response.status}). The site blocks automated price collection.` };
    }
    return { success: false, error: err.message || 'Failed to fetch competitor product page.' };
  }
}

module.exports = {
  validateSafeUrl,
  extractPriceFromHtml,
  scrapeCompetitorPage
};
