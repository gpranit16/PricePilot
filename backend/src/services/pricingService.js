/**
 * Pricing Engine Service for PricePilot.
 * Implements deterministic dynamic repricing calculations, margin floor safeguards, and explanation generation.
 */

/**
 * Normalizes margin percentage into a decimal between 0 and 0.99.
 * Handles both decimal input (0.25) and percentage input (25).
 */
function normalizeMargin(inputMargin) {
  if (inputMargin === undefined || inputMargin === null) return 0.25;
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
function normalizeUndercut(inputUndercut) {
  if (inputUndercut === undefined || inputUndercut === null) return 0.05;
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
 * Formula: Minimum price = Product cost / (1 - Minimum gross margin)
 *
 * Example: Cost ₹600, Margin 25% (0.25) => 600 / (1 - 0.25) = ₹800.
 *
 * @param {number} costPrice - Product purchase/manufacture cost.
 * @param {number} minGrossMargin - Target minimum gross margin (0 to 0.99).
 * @returns {number} Minimum safe selling price.
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
 * Applies rounding rules while strictly ensuring the rounded price never falls below the minimum safe price.
 *
 * @param {number} price - Calculated price before rounding.
 * @param {string} rule - 'nearest_rupee', 'exact_cents', or 'none'.
 * @param {number} minimumSafePrice - Minimum safe floor price.
 * @returns {number} Rounded price.
 */
function applyRounding(price, rule = 'nearest_rupee', minimumSafePrice = 0) {
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
  if (rounded < minimumSafePrice) {
    return Math.round(minimumSafePrice * 100) / 100;
  }

  return rounded;
}

/**
 * Calculates dynamic pricing recommendation for a product using active competitor records and pricing rules.
 *
 * @param {Object} product - Product document from MongoDB.
 * @param {Array} competitors - Array of Competitor documents linked to the product.
 * @param {Object} rule - Pricing rule configuration.
 * @returns {Object} Recommendation calculation result.
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
    rule.minGrossMargin !== undefined ? rule.minGrossMargin : product.minMargin
  );
  const undercutDecimal = normalizeUndercut(
    rule.undercutPercentage !== undefined ? rule.undercutPercentage : 5
  );
  const roundingRule = rule.roundingRule || 'nearest_rupee';

  const minimumSafePrice = calculateMinimumSafePrice(cost, marginDecimal);

  // Filter valid, active competitor price observations
  const validCompetitors = (competitors || []).filter(
    (c) =>
      c.trackingStatus === 'active' &&
      typeof c.currentPrice === 'number' &&
      c.currentPrice > 0 &&
      !c.isBroken
  );

  // Case 1: No valid competitor prices available
  if (validCompetitors.length === 0) {
    const recommendedPrice = currentSelling >= minimumSafePrice ? currentSelling : minimumSafePrice;
    const expectedMargin = Math.round(((recommendedPrice - cost) / recommendedPrice) * 1000) / 10;
    const floorApplied = currentSelling < minimumSafePrice;

    return {
      productId: product._id,
      currentSellingPrice: currentSelling,
      productCostPrice: cost,
      minimumSafePrice,
      competitorPrice: null,
      competitorId: null,
      competitorName: '',
      competitorSourceType: '',
      calculatedTargetPrice: null,
      recommendedPrice,
      expectedMargin,
      floorApplied,
      status: 'no_competitor',
      explanation: floorApplied
        ? `No active competitor prices found. Current selling price (₹${currentSelling.toLocaleString('en-IN')}) is below your ${(marginDecimal * 100).toFixed(0)}% margin floor; raised to safe minimum price of ₹${minimumSafePrice.toLocaleString('en-IN')}.`
        : `No active competitor price observations found for this product. Retaining current selling price of ₹${currentSelling.toLocaleString('en-IN')}.`
    };
  }

  // Case 2: Select reference competitor price
  let referenceCompetitor;
  if (rule.strategy === 'match_competitor') {
    // Match the lowest competitor without undercut
    referenceCompetitor = validCompetitors.reduce((prev, curr) =>
      curr.currentPrice < prev.currentPrice ? curr : prev
    );
  } else {
    // Default: 'lowest_competitor' - find lowest active competitor
    referenceCompetitor = validCompetitors.reduce((prev, curr) =>
      curr.currentPrice < prev.currentPrice ? curr : prev
    );
  }

  const compPrice = referenceCompetitor.currentPrice;
  const effectiveUndercut = rule.strategy === 'match_competitor' ? 0 : undercutDecimal;
  const calculatedTarget = compPrice * (1 - effectiveUndercut);

  let recommendedPrice;
  let floorApplied = false;
  let explanation;
  let status = 'pending';

  // Case 3: Check if target price violates minimum safe price (Margin Floor Enforcement)
  if (calculatedTarget < minimumSafePrice) {
    recommendedPrice = minimumSafePrice;
    floorApplied = true;
    status = 'floor_limited';

    const undercutPercentDisplay = (effectiveUndercut * 100).toFixed(0);
    const marginPercentDisplay = (marginDecimal * 100).toFixed(0);

    explanation = `Competitor price is ₹${compPrice.toLocaleString('en-IN')} (${referenceCompetitor.merchantName}). A ${undercutPercentDisplay}% undercut would be ₹${calculatedTarget.toFixed(2)}, which violates your ${marginPercentDisplay}% gross margin floor. Enforced minimum safe price of ₹${minimumSafePrice.toLocaleString('en-IN')} to safeguard profitability.`;
  } else {
    // Target price is safe and profitable
    recommendedPrice = applyRounding(calculatedTarget, roundingRule, minimumSafePrice);
    floorApplied = false;
    status = 'pending';

    const undercutPercentDisplay = (effectiveUndercut * 100).toFixed(0);
    const marginPercentDisplay = (marginDecimal * 100).toFixed(0);

    explanation = `Competitor price is ₹${compPrice.toLocaleString('en-IN')} (${referenceCompetitor.merchantName}). Recommended a ${undercutPercentDisplay}% undercut to ₹${recommendedPrice.toLocaleString('en-IN')}, maintaining a safe ${marginPercentDisplay}%+ gross margin.`;
  }

  const expectedMargin = Math.round(((recommendedPrice - cost) / recommendedPrice) * 1000) / 10;

  return {
    productId: product._id,
    currentSellingPrice: currentSelling,
    productCostPrice: cost,
    minimumSafePrice,
    competitorPrice: compPrice,
    competitorId: referenceCompetitor._id,
    competitorName: referenceCompetitor.merchantName,
    competitorSourceType: referenceCompetitor.sourceType || 'search_result',
    calculatedTargetPrice: Math.round(calculatedTarget * 100) / 100,
    recommendedPrice,
    expectedMargin,
    floorApplied,
    status,
    explanation
  };
}

module.exports = {
  calculateMinimumSafePrice,
  calculateRecommendation,
  applyRounding,
  normalizeMargin,
  normalizeUndercut
};
