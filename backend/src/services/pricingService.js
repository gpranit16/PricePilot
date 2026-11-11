/**
 * Margin-Protected Intelligent Dynamic Repricing Engine Service for PricePilot.
 * Implements deterministic dynamic repricing calculations, 4 core pricing strategies,
 * gross margin floor safeguards, stale competitor filtering, and visual risk indicators.
 */

/**
 * Normalizes margin percentage into a decimal between 0 and 0.99.
 * Handles both decimal input (0.25) and percentage input (25).
 */
function normalizeMargin(inputMargin, defaultVal = 0.25) {
  if (inputMargin === undefined || inputMargin === null) return defaultVal;
  const num = typeof inputMargin === 'number' ? inputMargin : parseFloat(inputMargin);
  if (isNaN(num)) {
    throw new Error('Margin must be a valid number.');
  }
  if (num < 0) {
    throw new Error('Margin percentage cannot be negative.');
  }
  if (num === 1 || num >= 100 || (num >= 0.99 && num < 1)) {
    throw new Error('Margin cannot be 100% or greater.');
  }
  // If provided as percentage like 25 (25%) or 30 (30%)
  if (num > 1 && num < 100) {
    return num / 100;
  }
  return num;
}

/**
 * Normalizes undercut percentage into a decimal between 0 and 0.90.
 * Handles both decimal input (0.05) and percentage input (5).
 */
function normalizeUndercut(inputUndercut, defaultVal = 0.05) {
  if (inputUndercut === undefined || inputUndercut === null) return defaultVal;
  const num = typeof inputUndercut === 'number' ? inputUndercut : parseFloat(inputUndercut);
  if (isNaN(num)) {
    throw new Error('Undercut must be a valid number.');
  }
  if (num < 0) {
    throw new Error('Undercut percentage cannot be negative.');
  }
  if (num >= 1 && num <= 90) {
    return num / 100;
  }
  if (num > 90) {
    throw new Error('Undercut percentage cannot exceed 90%.');
  }
  return num;
}

/**
 * Calculates the Minimum Safe Price based on product cost and minimum gross margin floor.
 * Formula: Minimum price = Cost Price / (1 - Minimum gross margin / 100)
 *
 * Example: Cost ₹600, Margin 25% (0.25) => 600 / (1 - 0.25) = ₹800.
 *
 * @param {number} costPrice - Product purchase/manufacture cost.
 * @param {number} minGrossMargin - Target minimum gross margin (0 to 0.99).
 * @returns {number} Minimum safe selling price rounded to 2 decimals.
 */
function calculateMinimumSafePrice(costPrice, minGrossMargin) {
  if (costPrice === undefined || costPrice === null || typeof costPrice !== 'number' || costPrice <= 0) {
    throw new Error('Product cost price must be a valid positive number.');
  }

  const marginDecimal = normalizeMargin(minGrossMargin);
  const floor = costPrice / (1 - marginDecimal);
  return Math.round(floor * 100) / 100;
}

/**
 * Applies rounding rules while strictly ensuring the rounded price never falls below the minimum safe floor.
 *
 * @param {number} price - Calculated price before rounding.
 * @param {string} rule - 'nearest_rupee', 'exact_cents', or 'none'.
 * @param {number} minimumSafeFloor - Minimum safe floor price.
 * @returns {number} Rounded price.
 */
function applyRounding(price, rule = 'nearest_rupee', minimumSafeFloor = 0) {
  let rounded;
  switch (rule) {
    case 'nearest_rupee':
      rounded = Math.round(price);
      break;
    case 'exact_cents':
      rounded = Math.round(price * 100) / 100;
      break;
    case 'none':
    default:
      rounded = Math.round(price * 100) / 100;
      break;
  }

  // Strict safeguard: never round below minimum safe price
  if (rounded < minimumSafeFloor) {
    return Math.round(minimumSafeFloor * 100) / 100;
  }

  return rounded;
}

/**
 * Calculates dynamic pricing recommendation for a product using active verified competitor records and pricing rules.
 * Supports 4 distinct pricing strategies:
 * 1. match_competitor: Match lowest verified competitor price.
 * 2. undercut_competitor / lowest_competitor: Undercut by percentage or fixed amount.
 * 3. maintain_margin: Set price to guarantee target gross margin.
 * 4. premium_pricing: Set price above lowest competitor by percentage or fixed amount.
 *
 * @param {Object} product - Product document from MongoDB.
 * @param {Array} competitors - Array of Competitor documents linked to the product.
 * @param {Object} rule - Pricing rule configuration.
 * @returns {Object} Comprehensive recommendation calculation result.
 */
function calculateRecommendation(product, competitors = [], rule = {}) {
  if (!product) {
    throw new Error('Product is required for pricing calculation.');
  }

  const cost = parseFloat(product.costPrice);
  const currentSelling = parseFloat(product.sellingPrice) || 0;

  if (isNaN(cost) || cost <= 0) {
    throw new Error('Product cost price is missing or invalid.');
  }

  // Determine margin floor: rule margin > product margin > 25% default
  const marginDecimal = normalizeMargin(
    rule.minGrossMargin !== undefined ? rule.minGrossMargin : product.minMargin,
    0.25
  );

  const strategy = rule.strategy || 'lowest_competitor';
  const roundingRule = rule.roundingRule || 'nearest_rupee';
  const minBound = typeof rule.minSellingPrice === 'number' && rule.minSellingPrice > 0 ? rule.minSellingPrice : null;
  const maxBound = typeof rule.maxSellingPrice === 'number' && rule.maxSellingPrice > 0 ? rule.maxSellingPrice : null;

  // Minimum Safe Price based strictly on gross margin floor formula: Pmin = C / (1 - m)
  const baseMarginFloor = calculateMinimumSafePrice(cost, marginDecimal);

  // Effective Floor considers both margin floor and configured minimum selling price
  const effectiveFloor = minBound ? Math.max(baseMarginFloor, minBound) : baseMarginFloor;

  // Helper to safely extract price
  const getCompPrice = (comp) =>
    typeof comp.sellingPrice === 'number' && comp.sellingPrice > 0
      ? comp.sellingPrice
      : typeof comp.currentPrice === 'number' && comp.currentPrice > 0
      ? comp.currentPrice
      : null;

  // Stale price threshold: default 7 days (convert to ms)
  const maxAgeDays = typeof rule.maxPriceAgeDays === 'number' && rule.maxPriceAgeDays > 0 ? rule.maxPriceAgeDays : 7;
  const staleThresholdTime = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

  // Filter valid, VERIFIED active competitor price observations
  const validCompetitors = [];
  const staleCompetitors = [];
  const unverifiedCompetitors = [];

  for (const c of competitors || []) {
    if (c.trackingStatus !== 'active' || c.isBroken || c.isAvailable === false) {
      continue;
    }

    const price = getCompPrice(c);
    if (typeof price !== 'number' || price <= 0) {
      continue;
    }

    const isVerified =
      c.priceVerificationStatus === 'verified' ||
      c.sourceType === 'direct_scrape' ||
      (c.priceVerificationStatus === undefined && c.sourceType === undefined); // legacy test support

    if (!isVerified) {
      unverifiedCompetitors.push(c);
      continue;
    }

    // Check if competitor price is stale
    const checkTime = c.lastCheckedAt ? new Date(c.lastCheckedAt).getTime() : 0;
    if (checkTime > 0 && checkTime < staleThresholdTime) {
      staleCompetitors.push(c);
      continue;
    }

    validCompetitors.push(c);
  }

  // Strategy 3: Maintain Minimum Profit Margin (Does not depend on competitor prices)
  if (strategy === 'maintain_margin') {
    const targetMarginDecimal = normalizeMargin(
      rule.targetMargin !== undefined ? rule.targetMargin : marginDecimal,
      marginDecimal
    );
    const targetMarginPrice = cost / (1 - targetMarginDecimal);
    let target = Math.max(targetMarginPrice, effectiveFloor);

    let boundApplied = 'none';
    if (maxBound && target > maxBound) {
      target = Math.max(maxBound, effectiveFloor);
      boundApplied = 'max_bound';
    }

    const recommendedPrice = applyRounding(target, roundingRule, effectiveFloor);
    const expectedMargin = Math.round(((recommendedPrice - cost) / recommendedPrice) * 1000) / 10;
    const expectedProfit = Math.round((recommendedPrice - cost) * 100) / 100;
    const priceDiff = Math.round((recommendedPrice - currentSelling) * 100) / 100;
    const floorApplied = recommendedPrice <= effectiveFloor;

    const riskLevel = floorApplied ? 'risky' : 'profitable';
    const explanation = `Strategy: Maintain Margin. Target ${(targetMarginDecimal * 100).toFixed(0)}% profit margin yields ₹${recommendedPrice.toLocaleString('en-IN')}, generating ₹${expectedProfit.toLocaleString('en-IN')} expected profit per unit. Minimum ${(marginDecimal * 100).toFixed(0)}% margin floor protected.`;

    return {
      productId: product._id,
      currentSellingPrice: currentSelling,
      productCostPrice: cost,
      minimumSafePrice: effectiveFloor,
      competitorPrice: null,
      competitorId: null,
      competitorName: '',
      competitorSourceType: '',
      calculatedTargetPrice: Math.round(target * 100) / 100,
      recommendedPrice,
      expectedMargin,
      expectedProfit,
      priceDifference: priceDiff,
      riskLevel,
      floorApplied,
      boundApplied,
      status: 'pending',
      explanation,
      strategy
    };
  }

  // Case: No valid verified competitor prices available
  if (validCompetitors.length === 0) {
    const recommendedPrice = currentSelling >= effectiveFloor ? currentSelling : effectiveFloor;
    const expectedMargin = Math.round(((recommendedPrice - cost) / recommendedPrice) * 1000) / 10;
    const expectedProfit = Math.round((recommendedPrice - cost) * 100) / 100;
    const priceDiff = Math.round((recommendedPrice - currentSelling) * 100) / 100;
    const floorApplied = currentSelling < effectiveFloor;

    let explanation;
    let riskLevel = 'blocked';

    if (floorApplied) {
      explanation = `No verified competitor prices found. Current price (₹${currentSelling.toLocaleString('en-IN')}) is below your ${(marginDecimal * 100).toFixed(0)}% gross margin floor; clamped to safe minimum of ₹${effectiveFloor.toLocaleString('en-IN')}.`;
    } else if (staleCompetitors.length > 0) {
      explanation = `Found ${staleCompetitors.length} competitor listing(s), but observations are older than ${maxAgeDays} days. Stale prices are ignored to prevent outdated repricing. Retaining current price of ₹${currentSelling.toLocaleString('en-IN')}. Please click 'Scrape Now' to refresh.`;
    } else if (unverifiedCompetitors.length > 0) {
      explanation = `Found ${unverifiedCompetitors.length} unverified competitor price(s). To protect pricing accuracy and prevent repricing against catalog MRPs or search estimates, direct verification is required. Retaining current selling price of ₹${currentSelling.toLocaleString('en-IN')}. Please click 'Scrape Now' on competitor listings.`;
    } else {
      explanation = `No active competitor price observations found for this product. Retaining current selling price of ₹${currentSelling.toLocaleString('en-IN')}.`;
      riskLevel = 'profitable';
    }

    return {
      productId: product._id,
      currentSellingPrice: currentSelling,
      productCostPrice: cost,
      minimumSafePrice: effectiveFloor,
      competitorPrice: null,
      competitorId: null,
      competitorName: '',
      competitorSourceType: '',
      calculatedTargetPrice: null,
      recommendedPrice,
      expectedMargin,
      expectedProfit,
      priceDifference: priceDiff,
      riskLevel,
      floorApplied,
      boundApplied: 'none',
      status: 'no_competitor',
      explanation,
      strategy
    };
  }

  // Find lowest verified active competitor
  const referenceCompetitor = validCompetitors.reduce((prev, curr) =>
    getCompPrice(curr) < getCompPrice(prev) ? curr : prev
  );

  const compPrice = getCompPrice(referenceCompetitor);
  let calculatedTarget;
  let strategyDescription;

  // Calculate target based on strategy
  if (strategy === 'match_competitor') {
    calculatedTarget = compPrice;
    strategyDescription = `Match Lowest Competitor (₹${compPrice.toLocaleString('en-IN')})`;
  } else if (strategy === 'premium_pricing') {
    const isFixed = rule.premiumType === 'fixed_amount';
    const premVal = typeof rule.premiumValue === 'number' && rule.premiumValue > 0 ? rule.premiumValue : 5;
    if (isFixed) {
      calculatedTarget = compPrice + premVal;
      strategyDescription = `Premium Pricing (+₹${premVal} above lowest competitor ₹${compPrice.toLocaleString('en-IN')})`;
    } else {
      calculatedTarget = compPrice * (1 + premVal / 100);
      strategyDescription = `Premium Pricing (+${premVal}% above lowest competitor ₹${compPrice.toLocaleString('en-IN')})`;
    }
  } else {
    // Default: 'undercut_competitor' or 'lowest_competitor'
    const isFixed = rule.undercutType === 'fixed_amount';
    if (isFixed) {
      const cutVal = typeof rule.undercutValue === 'number' && rule.undercutValue > 0 ? rule.undercutValue : 10;
      calculatedTarget = compPrice - cutVal;
      strategyDescription = `₹${cutVal} undercut below lowest competitor (₹${compPrice.toLocaleString('en-IN')})`;
    } else {
      const cutPercent =
        typeof rule.undercutValue === 'number' && rule.undercutValue > 0
          ? rule.undercutValue / 100
          : normalizeUndercut(rule.undercutPercentage, 0.05);
      calculatedTarget = compPrice * (1 - cutPercent);
      strategyDescription = `${(cutPercent * 100).toFixed(0)}% undercut below lowest competitor (₹${compPrice.toLocaleString('en-IN')})`;
    }
  }

  let recommendedPrice;
  let floorApplied = false;
  let boundApplied = 'none';
  let explanation;
  let status = 'pending';
  let riskLevel = 'profitable';

  // Apply maximum selling price ceiling if configured
  if (maxBound && calculatedTarget > maxBound) {
    calculatedTarget = maxBound;
    boundApplied = 'max_bound';
  }

  // Margin Floor Safeguard Enforcement
  if (calculatedTarget < effectiveFloor) {
    recommendedPrice = effectiveFloor;
    floorApplied = true;
    status = 'floor_limited';
    riskLevel = 'blocked';

    const marginPercentDisplay = (marginDecimal * 100).toFixed(0);
    explanation = `Verified competitor price is ₹${compPrice.toLocaleString('en-IN')} (${referenceCompetitor.merchantName}). Target calculation (${strategyDescription}) would be ₹${calculatedTarget.toFixed(2)}, which violates your ${marginPercentDisplay}% gross margin floor (₹${baseMarginFloor.toLocaleString('en-IN')}). Clamped to safe minimum price of ₹${effectiveFloor.toLocaleString('en-IN')} to protect profitability.`;
  } else {
    recommendedPrice = applyRounding(calculatedTarget, roundingRule, effectiveFloor);
    floorApplied = false;
    status = 'pending';

    const expectedMarginTemp = ((recommendedPrice - cost) / recommendedPrice) * 100;
    const marginBuffer = expectedMarginTemp - marginDecimal * 100;

    // Evaluate visual risk level:
    // If margin buffer is within 2% of the floor -> risky
    // If comfortable buffer -> profitable
    if (marginBuffer < 2) {
      riskLevel = 'risky';
    } else {
      riskLevel = 'profitable';
    }

    explanation = `Verified competitor price is ₹${compPrice.toLocaleString('en-IN')} (${referenceCompetitor.merchantName}). Strategy: ${strategyDescription}. Recommended price: ₹${recommendedPrice.toLocaleString('en-IN')}, maintaining ${(expectedMarginTemp).toFixed(1)}% gross margin (Safeguard: ${(marginDecimal * 100).toFixed(0)}% floor).`;
  }

  const expectedMargin = Math.round(((recommendedPrice - cost) / recommendedPrice) * 1000) / 10;
  const expectedProfit = Math.round((recommendedPrice - cost) * 100) / 100;
  const priceDiff = Math.round((recommendedPrice - currentSelling) * 100) / 100;

  return {
    productId: product._id,
    currentSellingPrice: currentSelling,
    productCostPrice: cost,
    minimumSafePrice: effectiveFloor,
    competitorPrice: compPrice,
    competitorId: referenceCompetitor._id,
    competitorName: referenceCompetitor.merchantName,
    competitorSourceType: referenceCompetitor.sourceType || 'direct_scrape',
    calculatedTargetPrice: Math.round(calculatedTarget * 100) / 100,
    recommendedPrice,
    expectedMargin,
    expectedProfit,
    priceDifference: priceDiff,
    riskLevel,
    floorApplied,
    boundApplied,
    status,
    explanation,
    strategy
  };
}

module.exports = {
  calculateMinimumSafePrice,
  calculateRecommendation,
  applyRounding,
  normalizeMargin,
  normalizeUndercut
};
