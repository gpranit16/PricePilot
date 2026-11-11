'use client';

import React, { useState, useEffect } from 'react';
import styles from './PricingRuleModal.module.css';
import { CloseIcon, ShieldIcon, CheckCircleIcon, AlertCircleIcon } from './Icons';
import { getApiBase } from '../utils/api';

export default function PricingRuleModal({ product, onClose, onRuleSaved }) {
  const [minGrossMargin, setMinGrossMargin] = useState('25');
  const [strategy, setStrategy] = useState('lowest_competitor');
  const [undercutType, setUndercutType] = useState('percentage');
  const [undercutValue, setUndercutValue] = useState('5');
  const [targetMargin, setTargetMargin] = useState('30');
  const [premiumType, setPremiumType] = useState('percentage');
  const [premiumValue, setPremiumValue] = useState('5');
  const [minSellingPrice, setMinSellingPrice] = useState('');
  const [maxSellingPrice, setMaxSellingPrice] = useState('');
  const [roundingRule, setRoundingRule] = useState('nearest_rupee');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  const apiBase = getApiBase();

  // Load existing pricing rule for this product
  useEffect(() => {
    async function fetchRule() {
      if (!product?._id) return;
      setIsLoading(true);
      try {
        const res = await fetch(`${apiBase}/pricing/rules/${product._id}`);
        const data = await res.json();
        if (data.rule) {
          const rule = data.rule;
          const margin = rule.minGrossMargin;
          setMinGrossMargin(margin <= 1 ? (margin * 100).toString() : margin.toString());
          setStrategy(rule.strategy || 'lowest_competitor');
          setUndercutType(rule.undercutType || 'percentage');
          setUndercutValue((rule.undercutValue !== undefined ? rule.undercutValue : rule.undercutPercentage || 5).toString());
          if (rule.targetMargin !== undefined) {
            setTargetMargin(rule.targetMargin <= 1 ? (rule.targetMargin * 100).toString() : rule.targetMargin.toString());
          }
          setPremiumType(rule.premiumType || 'percentage');
          if (rule.premiumValue !== undefined) {
            setPremiumValue(rule.premiumValue.toString());
          }
          if (rule.minSellingPrice) setMinSellingPrice(rule.minSellingPrice.toString());
          if (rule.maxSellingPrice) setMaxSellingPrice(rule.maxSellingPrice.toString());
          setRoundingRule(rule.roundingRule || 'nearest_rupee');
        }
      } catch (err) {
        console.error('Failed to fetch pricing rule:', err);
      } finally {
        setIsLoading(false);
      }
    }
    fetchRule();
  }, [product, apiBase]);

  // Live calculation of Minimum Safe Price preview
  const cost = parseFloat(product?.costPrice) || 0;
  const parsedMargin = parseFloat(minGrossMargin) || 0;
  let previewFloor = 0;
  if (cost > 0 && parsedMargin >= 0 && parsedMargin < 100) {
    previewFloor = Math.round((cost / (1 - parsedMargin / 100)) * 100) / 100;
  }

  const handleSave = async (e) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const marginNum = parseFloat(minGrossMargin);
    if (isNaN(marginNum) || marginNum < 0 || marginNum >= 95) {
      setErrorMessage('Minimum gross margin must be between 0% and 94%.');
      return;
    }

    const payload = {
      minGrossMargin: marginNum / 100,
      strategy,
      roundingRule
    };

    if (strategy === 'lowest_competitor') {
      const uVal = parseFloat(undercutValue);
      if (isNaN(uVal) || uVal < 0) {
        setErrorMessage('Undercut value must be a valid positive number.');
        return;
      }
      payload.undercutType = undercutType;
      payload.undercutValue = uVal;
      payload.undercutPercentage = undercutType === 'percentage' ? uVal : 0;
    } else if (strategy === 'maintain_margin') {
      const tVal = parseFloat(targetMargin);
      if (isNaN(tVal) || tVal < marginNum || tVal >= 95) {
        setErrorMessage(`Target margin must be between minimum floor (${marginNum}%) and 95%.`);
        return;
      }
      payload.targetMargin = tVal / 100;
    } else if (strategy === 'premium_pricing') {
      const pVal = parseFloat(premiumValue);
      if (isNaN(pVal) || pVal < 0) {
        setErrorMessage('Premium value must be a positive number.');
        return;
      }
      payload.premiumType = premiumType;
      payload.premiumValue = pVal;
    }

    if (minSellingPrice) {
      const mFloor = parseFloat(minSellingPrice);
      if (!isNaN(mFloor) && mFloor > 0) payload.minSellingPrice = mFloor;
    } else {
      payload.minSellingPrice = null;
    }

    if (maxSellingPrice) {
      const mCeil = parseFloat(maxSellingPrice);
      if (!isNaN(mCeil) && mCeil > 0) payload.maxSellingPrice = mCeil;
    } else {
      payload.maxSellingPrice = null;
    }

    setIsSaving(true);
    try {
      const res = await fetch(`${apiBase}/pricing/rules/${product._id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to update pricing rule');
      }

      setSuccessMessage('Pricing rule saved successfully!');
      if (onRuleSaved) onRuleSaved();
      setTimeout(() => {
        onClose();
      }, 700);
    } catch (err) {
      setErrorMessage(err.message || 'Failed to save pricing rule');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.modalHeader}>
          <div className={styles.modalTitleGroup}>
            <h2 className={styles.modalTitle}>Configure Pricing Rule</h2>
            <span className={styles.modalSubtitle}>
              Safeguards and dynamic repricing targets for this product
            </span>
          </div>
          <button
            type="button"
            className={styles.modalCloseButton}
            onClick={onClose}
            aria-label="Close dialog"
          >
            <CloseIcon size={18} />
          </button>
        </div>

        {/* Product Strip */}
        <div className={styles.productStrip}>
          <div className={styles.productInfo}>
            <span className={styles.skuBadge}>{product.sku}</span>
            <span className={styles.productTitle}>
              {product.brand ? `${product.brand} ` : ''}
              {product.name}
            </span>
          </div>
          <div className={styles.priceRow}>
            Cost: <strong>₹{cost.toLocaleString('en-IN')}</strong> • Current Selling:{' '}
            <strong>₹{(product.sellingPrice || 0).toLocaleString('en-IN')}</strong>
          </div>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className={styles.modalBody}>
          {errorMessage && (
            <div className={styles.errorBanner}>
              <AlertCircleIcon size={16} />
              <span>{errorMessage}</span>
            </div>
          )}
          {successMessage && (
            <div className={styles.successBanner}>
              <CheckCircleIcon size={16} />
              <span>{successMessage}</span>
            </div>
          )}

          {/* Strategy Selection */}
          <div className={styles.formGroup}>
            <label className={styles.label}>
              <span>Repricing Strategy</span>
              <span className={styles.helperText}>Algorithmic rule to determine selling price</span>
            </label>
            <select
              className={styles.select}
              value={strategy}
              onChange={(e) => setStrategy(e.target.value)}
            >
              <option value="lowest_competitor">Undercut Lowest Competitor</option>
              <option value="match_competitor">Match Lowest Competitor</option>
              <option value="maintain_margin">Maintain Target Profit Margin</option>
              <option value="premium_pricing">Premium Pricing (Above Competitor)</option>
            </select>
          </div>

          {/* Dynamic Strategy Fields */}
          {strategy === 'lowest_competitor' && (
            <div className={styles.formGrid}>
              <div className={styles.formGroup}>
                <label className={styles.label}>Undercut Type</label>
                <select
                  className={styles.select}
                  value={undercutType}
                  onChange={(e) => setUndercutType(e.target.value)}
                >
                  <option value="percentage">Percentage Discount (%)</option>
                  <option value="fixed_amount">Fixed Amount (₹)</option>
                </select>
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label}>
                  Undercut Value ({undercutType === 'percentage' ? '%' : '₹'})
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  className={styles.input}
                  value={undercutValue}
                  onChange={(e) => setUndercutValue(e.target.value)}
                  required
                />
              </div>
            </div>
          )}

          {strategy === 'maintain_margin' && (
            <div className={styles.formGroup}>
              <label className={styles.label}>
                <span>Target Gross Margin (%)</span>
                <span className={styles.helperText}>Desired margin for calculating selling price</span>
              </label>
              <div className={styles.inputWithSuffix}>
                <input
                  type="number"
                  step="0.5"
                  min={parsedMargin}
                  max="94"
                  className={styles.input}
                  value={targetMargin}
                  onChange={(e) => setTargetMargin(e.target.value)}
                  required
                />
                <span className={styles.suffix}>%</span>
              </div>
            </div>
          )}

          {strategy === 'premium_pricing' && (
            <div className={styles.formGrid}>
              <div className={styles.formGroup}>
                <label className={styles.label}>Premium Markup Type</label>
                <select
                  className={styles.select}
                  value={premiumType}
                  onChange={(e) => setPremiumType(e.target.value)}
                >
                  <option value="percentage">Percentage Markup (%)</option>
                  <option value="fixed_amount">Fixed Amount Markup (₹)</option>
                </select>
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label}>
                  Premium Value ({premiumType === 'percentage' ? '%' : '₹'})
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  className={styles.input}
                  value={premiumValue}
                  onChange={(e) => setPremiumValue(e.target.value)}
                  required
                />
              </div>
            </div>
          )}

          {/* Margin Floor Input */}
          <div className={styles.formGroup}>
            <label className={styles.label}>
              <span>Minimum Gross Margin Floor (%)</span>
              <span className={styles.helperText}>Hard safeguard: price is NEVER allowed below this</span>
            </label>
            <div className={styles.inputWithSuffix}>
              <input
                type="number"
                step="0.5"
                min="0"
                max="94"
                className={styles.input}
                value={minGrossMargin}
                onChange={(e) => setMinGrossMargin(e.target.value)}
                required
              />
              <span className={styles.suffix}>%</span>
            </div>
          </div>

          {/* Floor Preview Box */}
          <div className={styles.previewBox}>
            <div className={styles.previewIcon}>
              <ShieldIcon size={18} color="var(--accent-primary)" />
            </div>
            <div className={styles.previewText}>
              <div className={styles.previewHeading}>
                Minimum Safe Price: <strong>₹{previewFloor.toLocaleString('en-IN')}</strong>
              </div>
              <div className={styles.previewFormula}>
                Formula: Cost (₹{cost}) ÷ (1 - {parsedMargin}%) = ₹{previewFloor}
              </div>
              <div className={styles.previewNote}>
                PricePilot automatically clamps any recommendation to protect profitability.
              </div>
            </div>
          </div>

          {/* Optional Bounds & Rounding */}
          <div className={styles.formGrid}>
            <div className={styles.formGroup}>
              <label className={styles.label}>
                <span>Max Selling Price (₹)</span>
                <span className={styles.helperText}>Optional ceiling</span>
              </label>
              <input
                type="number"
                step="1"
                min="0"
                placeholder="No ceiling"
                className={styles.input}
                value={maxSellingPrice}
                onChange={(e) => setMaxSellingPrice(e.target.value)}
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>Rounding Rule</label>
              <select
                className={styles.select}
                value={roundingRule}
                onChange={(e) => setRoundingRule(e.target.value)}
              >
                <option value="nearest_rupee">Nearest Rupee (e.g. ₹899)</option>
                <option value="ending_99">Ending in .99 (e.g. ₹899.99)</option>
                <option value="exact_cents">Exact Decimals (e.g. ₹899.25)</option>
              </select>
            </div>
          </div>

          {/* Footer Actions */}
          <div className={styles.modalFooter}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={onClose}
              disabled={isSaving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={styles.primaryButton}
              disabled={isSaving}
            >
              <span>{isSaving ? 'Saving Rule...' : 'Save Pricing Rule'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
