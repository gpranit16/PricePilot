'use client';

import React, { useState, useEffect } from 'react';
import styles from './PricingRuleModal.module.css';
import { CloseIcon, ShieldIcon, CheckCircleIcon, AlertCircleIcon } from './Icons';
import { getApiBase } from '../utils/api';

export default function PricingRuleModal({ product, onClose, onRuleSaved }) {
  const [minGrossMargin, setMinGrossMargin] = useState('25');
  const [undercutPercentage, setUndercutPercentage] = useState('5');
  const [strategy, setStrategy] = useState('lowest_competitor');
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
          const margin = data.rule.minGrossMargin;
          setMinGrossMargin(margin <= 1 ? (margin * 100).toString() : margin.toString());
          setUndercutPercentage((data.rule.undercutPercentage || 5).toString());
          setStrategy(data.rule.strategy || 'lowest_competitor');
          setRoundingRule(data.rule.roundingRule || 'nearest_rupee');
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

    const undercutNum = parseFloat(undercutPercentage);
    if (isNaN(undercutNum) || undercutNum < 0 || undercutNum > 90) {
      setErrorMessage('Undercut percentage must be between 0% and 90%.');
      return;
    }

    setIsSaving(true);
    try {
      const res = await fetch(`${apiBase}/pricing/rules/${product._id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          minGrossMargin: marginNum / 100,
          undercutPercentage: undercutNum,
          strategy,
          roundingRule
        })
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

          {/* Margin Floor Input */}
          <div className={styles.formGroup}>
            <label className={styles.label}>
              <span>Minimum Gross Margin Floor (%)</span>
              <span className={styles.helperText}>Profitability safeguard threshold</span>
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
                Formula: ₹{cost} ÷ (1 - {parsedMargin}%) = ₹{previewFloor}
              </div>
              <div className={styles.previewNote}>
                PricePilot will never recommend or publish a price below this margin floor.
              </div>
            </div>
          </div>

          {/* Undercut Input */}
          <div className={styles.formGroup}>
            <label className={styles.label}>
              <span>Competitor Undercut (%)</span>
              <span className={styles.helperText}>Target discount below lowest competitor</span>
            </label>
            <div className={styles.inputWithSuffix}>
              <input
                type="number"
                step="0.5"
                min="0"
                max="90"
                className={styles.input}
                value={undercutPercentage}
                onChange={(e) => setUndercutPercentage(e.target.value)}
                required
              />
              <span className={styles.suffix}>%</span>
            </div>
          </div>

          {/* Strategy Selection */}
          <div className={styles.formGrid}>
            <div className={styles.formGroup}>
              <label className={styles.label}>Repricing Strategy</label>
              <select
                className={styles.select}
                value={strategy}
                onChange={(e) => setStrategy(e.target.value)}
              >
                <option value="lowest_competitor">Undercut Lowest Competitor</option>
                <option value="match_competitor">Match Lowest Competitor (0% Undercut)</option>
              </select>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.label}>Rounding Rule</label>
              <select
                className={styles.select}
                value={roundingRule}
                onChange={(e) => setRoundingRule(e.target.value)}
              >
                <option value="nearest_rupee">Nearest Rupee (e.g. ₹899)</option>
                <option value="exact_cents">Exact Decimals (e.g. ₹899.10)</option>
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
