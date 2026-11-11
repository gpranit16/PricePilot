const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { parsePrice, extractLowestSnippetPrice, extractSnippetPrices } = require('../src/services/serpApiService');
const { extractPriceFromHtml } = require('../src/services/scraperService');

describe('P0 Competitor Price Extraction & Accuracy Tests', () => {
  // 1. Price String Parser Tests
  describe('parsePrice Edge Cases', () => {
    test('parses clean rupee and numeric strings', () => {
      assert.equal(parsePrice('₹899'), 899);
      assert.equal(parsePrice('₹4,999.00'), 4999);
      assert.equal(parsePrice('Rs. 1,299'), 1299);
      assert.equal(parsePrice('INR 25,490'), 25490);
      assert.equal(parsePrice(899), 899);
      assert.equal(parsePrice('899'), 899);
    });

    test('extracts selling price when parenthetical notes are present without digit merging', () => {
      // Previously, '₹899 (MRP ₹1,799)' was merged into 8991799
      assert.equal(parsePrice('₹899 (MRP ₹1,799)'), 899);
      assert.equal(parsePrice('₹899 (50% off)'), 899);
    });

    test('rejects ambiguous price ranges', () => {
      // Must return null instead of corrupting or guessing
      assert.equal(parsePrice('₹1,499 - ₹2,999'), null);
      assert.equal(parsePrice('1499 to 2999'), null);
      assert.equal(parsePrice('₹499 – ₹999'), null);
    });

    test('rejects non-price strings', () => {
      assert.equal(parsePrice('5 min read'), null);
      assert.equal(parsePrice('10% off'), null);
      assert.equal(parsePrice('Free delivery'), null);
      assert.equal(parsePrice(''), null);
      assert.equal(parsePrice(null), null);
    });
  });

  // 2. SerpApi Snippet Price Extraction Tests
  describe('extractLowestSnippetPrice Rejections & Accuracy', () => {
    test('never selects EMI or monthly installment prices', () => {
      const snippetWithEmi = 'Buy Sony WH-1000XM4 Wireless Headphones at ₹1,299/mo EMI. Total selling price is ₹24,990 on Amazon India.';
      const price = extractLowestSnippetPrice(snippetWithEmi);
      assert.equal(price, 24990);
    });

    test('never selects accessories or case prices', () => {
      const snippetWithAcc = 'Silicone protective cases from ₹99. High-performance gaming earbuds priced at ₹2,499.';
      const price = extractLowestSnippetPrice(snippetWithAcc);
      assert.equal(price, 24990 === price ? price : 2499);
      assert.notEqual(price, 99);
    });

    test('never selects cashback or savings discounts', () => {
      const snippetWithCashback = 'Get flat ₹500 cashback with HDFC cards. Selling price: ₹3,999 with free shipping.';
      const price = extractLowestSnippetPrice(snippetWithCashback);
      assert.equal(price, 3999);
    });

    test('never selects delivery or shipping charges', () => {
      const snippetWithDelivery = 'Standard delivery charges ₹40. Authentic Boat Rockerz 450 priced at ₹1,299.';
      const price = extractLowestSnippetPrice(snippetWithDelivery);
      assert.equal(price, 1299);
    });

    test('distinguishes MRP from selling price in snippets', () => {
      const snippetWithBoth = 'MRP: ₹4,999. Special deal price: ₹899 today on Flipkart.';
      const price = extractLowestSnippetPrice(snippetWithBoth);
      assert.equal(price, 899);
    });

    test('extractSnippetPrices correctly separates percentage discount selling price from MRP', () => {
      const blinkitSnippet = 'Buy boAt Airdopes 311 Pro TWS Earbuds (Space Grey) online in India at lowest price. Black) 23,090 17 mins 77% OFF ₹1,099 MRP ₹4,990';
      const prices = extractSnippetPrices(blinkitSnippet);
      assert.equal(prices.sellingPrice, 1099);
      assert.equal(prices.originalPrice, 4990);
    });

    test('extractSnippetPrices never treats standalone MRP as selling price', () => {
      const onlyMrpSnippet = 'boAt Airdopes 311 PRO available at MRP ₹4,990 across retail outlets.';
      const prices = extractSnippetPrices(onlyMrpSnippet);
      assert.equal(prices.sellingPrice, null);
      assert.equal(prices.originalPrice, 4990);
    });

    test('rejects ambiguous price ranges in snippets', () => {
      const snippetRange = 'Available in multiple colors between ₹499 - ₹1,999 across top stores.';
      const price = extractLowestSnippetPrice(snippetRange);
      assert.equal(price, null);
    });
  });

  // 3. Direct HTML Scraping & Strike-through Exclusions
  describe('Direct Retailer HTML Price Extraction', () => {
    test('Flipkart: extracts ₹899 selling price and excludes ₹4,999 strike-through MRP', () => {
      const flipkartHtml = `
        <div class="product-details">
          <div class="_30jeq3 _16Jk6d">₹899</div>
          <div class="_3I9_wc _2p6cR8"><del>₹4,999</del></div>
          <div class="_3Ay6Sb"><span>82% off</span></div>
        </div>
      `;
      const result = extractPriceFromHtml(flipkartHtml);
      assert.ok(result);
      assert.equal(result.sellingPrice, 899);
      assert.equal(result.originalPrice, 4999);
      assert.equal(result.discountPercent, 82);
      assert.equal(result.priceVerificationStatus, 'verified');
      assert.equal(result.isAvailable, true);
    });

    test('Amazon: extracts actual selling price and excludes strike-through list price', () => {
      const amazonHtml = `
        <div id="corePriceDisplay_desktop_feature_div">
          <span class="a-price aok-align-center reinventPricePriceToPayMargin priceToPay apexPriceToPay">
            <span class="a-offscreen">₹1,299.00</span>
          </span>
          <span class="a-price a-text-price basisPrice" data-a-strike="true">
            <span class="a-offscreen">₹2,499.00</span>
          </span>
        </div>
      `;
      const result = extractPriceFromHtml(amazonHtml);
      assert.ok(result);
      assert.equal(result.sellingPrice, 1299);
      assert.equal(result.originalPrice, 2499);
      assert.equal(result.priceVerificationStatus, 'verified');
    });

    test('Shopify: strictly prioritizes price-item--sale over price-item--regular', () => {
      const shopifyHtml = `
        <div class="price price--on-sale">
          <div class="price__sale">
            <span class="price-item price-item--sale">₹699.00</span>
            <s class="price-item price-item--regular">₹1,499.00</s>
          </div>
        </div>
      `;
      const result = extractPriceFromHtml(shopifyHtml);
      assert.ok(result);
      assert.equal(result.sellingPrice, 699);
      assert.equal(result.originalPrice, 1499);
      assert.equal(result.priceVerificationStatus, 'verified');
    });

    test('JSON-LD: parses ListPrice vs SalePrice and validates InStock', () => {
      const jsonLdHtml = `
        <script type="application/ld+json">
        {
          "@context": "https://schema.org/",
          "@type": "Product",
          "name": "Wireless Pro Headphones",
          "offers": {
            "@type": "Offer",
            "priceCurrency": "INR",
            "price": "1999",
            "availability": "https://schema.org/InStock",
            "priceSpecification": [
              {
                "@type": "UnitPriceSpecification",
                "priceType": "https://schema.org/ListPrice",
                "price": "3999"
              },
              {
                "@type": "UnitPriceSpecification",
                "priceType": "https://schema.org/SalePrice",
                "price": "1999"
              }
            ]
          }
        }
        </script>
      `;
      const result = extractPriceFromHtml(jsonLdHtml);
      assert.ok(result);
      assert.equal(result.sellingPrice, 1999);
      assert.equal(result.originalPrice, 3999);
      assert.equal(result.isAvailable, true);
      assert.equal(result.priceVerificationStatus, 'verified');
    });

    test('JSON-LD: flags OutOfStock items as unavailable', () => {
      const outOfStockHtml = `
        <script type="application/ld+json">
        {
          "@context": "https://schema.org/",
          "@type": "Product",
          "name": "Discontinued Keyboard",
          "offers": {
            "@type": "Offer",
            "price": "899",
            "availability": "https://schema.org/OutOfStock"
          }
        }
        </script>
      `;
      const result = extractPriceFromHtml(outOfStockHtml);
      assert.ok(result);
      assert.equal(result.isAvailable, false);
      assert.equal(result.priceVerificationStatus, 'unavailable');
    });

    test('OpenGraph / Twitter: rejects non-price twitter:data1 metadata', () => {
      const blogCardHtml = `
        <html>
          <head>
            <meta name="twitter:label1" content="Reading time">
            <meta name="twitter:data1" content="5 mins">
          </head>
          <body><div>Article content without prices</div></body>
        </html>
      `;
      const result = extractPriceFromHtml(blogCardHtml);
      assert.equal(result, null);
    });

    test('OpenGraph: extracts sale price and original price meta tags', () => {
      const ogHtml = `
        <html>
          <head>
            <meta property="product:sale_price:amount" content="1,249" />
            <meta property="product:original_price:amount" content="2,499" />
            <meta property="product:price:currency" content="INR" />
          </head>
          <body>Product page</body>
        </html>
      `;
      const result = extractPriceFromHtml(ogHtml);
      assert.ok(result);
      assert.equal(result.sellingPrice, 1249);
      assert.equal(result.originalPrice, 2499);
      assert.equal(result.priceVerificationStatus, 'verified');
    });
  });
});

