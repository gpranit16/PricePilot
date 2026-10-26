'use client';

import React, { useState, useEffect, useCallback } from 'react';
import styles from './DynamicRepricingView.module.css';
import {
  RefreshIcon,
  SearchIcon,
  ShieldIcon,
  CheckCircleIcon,
  AlertCircleIcon,
  SlidersIcon,
  ImageIcon
} from './Icons';
import PricingRuleModal from './PricingRuleModal';
import { getApiBase } from '../utils/api';

/**
 * De-duplicates doubled SKU strings (e.g. "ABC-001ABC-001" -> "ABC-001")
 */
function formatSku(sku = '') {
  if (!sku) return '';
  const trimmed = sku.trim();
  const len = trimmed.length;
  if (len >= 6 && len % 2 === 0) {
    const half1 = trimmed.slice(0, len / 2);
    const half2 = trimmed.slice(len / 2);
    if (half1 === half2) return half1;
  }
  return trimmed;
}

export default function DynamicRepricingView() {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [recalculatingId, setRecalculatingId] = useState(null);
  const [approvingId, setApprovingId] = useState(null);
  const [feedbackMessage, setFeedbackMessage] = useState(null);
  const [configuringProduct, setConfiguringProduct] = useState(null);

  const apiBase = getApiBase();

  // Fetch all recommendations
  const fetchRecommendations = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${apiBase}/pricing/recommendations`, { cache: 'no-store' });
      const data = await res.json();
      setItems(data.recommendations || []);
    } catch (err) {
      console.error('Failed to fetch recommendations:', err);
    } finally {
      setIsLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    fetchRecommendations();
  }, [fetchRecommendations]);

  // Recalculate recommendation for a specific product
  const handleRecalculate = async (productId) => {
    setRecalculatingId(productId);
    setFeedbackMessage(null);

    try {
      const res = await fetch(`${apiBase}/pricing/recommendations/${productId}`, {
        method: 'POST',
        headers: { Accept: 'application/json' }
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || 'Recalculation failed');
      }

      setFeedbackMessage({
        type: 'success',
        text: 'Recommendation recalculated from latest MongoDB observations.'
      });
      await fetchRecommendations();
    } catch (err) {
      setFeedbackMessage({
        type: 'error',
        text: err.message || 'Failed to recalculate'
      });
    } finally {
      setRecalculatingId(null);
    }
  };

  // Approve and apply recommendation to product's selling price
  const handleApprove = async (productId) => {
    setApprovingId(productId);
    setFeedbackMessage(null);

    try {
      const res = await fetch(`${apiBase}/pricing/recommendations/${productId}/approve`, {
        method: 'POST',
        headers: { Accept: 'application/json' }
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || 'Approval failed');
      }

      setFeedbackMessage({
        type: 'success',
        text: data.message || 'Price approved and updated successfully.'
      });
      await fetchRecommendations();
    } catch (err) {
      setFeedbackMessage({
        type: 'error',
        text: err.message || 'Failed to approve recommendation'
      });
    } finally {
      setApprovingId(null);
    }
  };

  // Filter items by search
  const filteredItems = items.filter((item) => {
    const prod = item.product || {};
    const q = search.toLowerCase().trim();
    if (!q) return true;
    return (
      (prod.name || '').toLowerCase().includes(q) ||
      (prod.sku || '').toLowerCase().includes(q) ||
      (prod.brand || '').toLowerCase().includes(q)
    );
  });

  // Calculate high-level summary counts
  const totalCount = items.length;
  const floorLimitedCount = items.filter((i) => i.recommendation?.floorApplied).length;
  const pendingCount = items.filter((i) => i.recommendation?.status === 'pending').length;

  return (
    <div className={styles.container}>
      {/* Header Row */}
      <div className={styles.headerRow}>
        <div>
          <h1 className={styles.heading}>Dynamic Repricing Engine</h1>
          <p className={styles.subheading}>
            Calculate explainable price recommendations with guaranteed gross margin floor protection.
          </p>
        </div>

        <button
          type="button"
          className={styles.refreshButton}
          onClick={fetchRecommendations}
          disabled={isLoading}
          title="Refresh recommendations"
        >
          <RefreshIcon size={15} />
          <span>{isLoading ? 'Refreshing...' : 'Refresh All'}</span>
        </button>
      </div>

      {/* Summary KPI Strip */}
      <div className={styles.kpiStrip}>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Monitored Products</span>
          <span className={styles.kpiValue}>{totalCount}</span>
        </div>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Pending Review</span>
          <span className={styles.kpiValue} style={{ color: 'var(--accent-primary)' }}>
            {pendingCount}
          </span>
        </div>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Floor Protected</span>
          <span className={styles.kpiValue} style={{ color: '#D97706' }}>
            {floorLimitedCount}
          </span>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedbackMessage && (
        <div
          className={
            feedbackMessage.type === 'success' ? styles.successBanner : styles.errorBanner
          }
        >
          {feedbackMessage.type === 'success' ? (
            <CheckCircleIcon size={16} />
          ) : (
            <AlertCircleIcon size={16} />
          )}
          <span>{feedbackMessage.text}</span>
        </div>
      )}

      {/* Search Bar */}
      <div className={styles.searchBar}>
        <SearchIcon size={16} className={styles.searchIcon} />
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search products by name, SKU or brand..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Recommendations Cards List */}
      <div className={styles.cardsList}>
        {isLoading && items.length === 0 ? (
          <div className={styles.emptyState}>Loading price recommendations...</div>
        ) : filteredItems.length === 0 ? (
          <div className={styles.emptyState}>
            No products match your search. Add products and competitor links to generate recommendations.
          </div>
        ) : (
          filteredItems.map(({ product, recommendation }) => {
            const isRecalculating = recalculatingId === product._id;
            const isApproving = approvingId === product._id;
            const rec = recommendation || {};
            const cleanSku = formatSku(product.sku);

            const isFloorApplied = Boolean(rec.floorApplied);
            const isApproved = rec.status === 'approved';
            const isNoCompetitor = rec.status === 'no_competitor';

            const priceDiff =
              rec.recommendedPrice && product.sellingPrice
                ? rec.recommendedPrice - product.sellingPrice
                : 0;

            return (
              <div
                key={product._id}
                className={`${styles.itemCard} ${isFloorApplied ? styles.itemCardFloor : ''}`}
              >
                {/* Main Product Info & Status */}
                <div className={styles.cardHeader}>
                  <div className={styles.productCell}>
                    <div className={styles.thumbWrapper}>
                      {product.imageUrl ? (
                        <>
                          <img
                            src={product.imageUrl}
                            alt={product.name}
                            className={styles.thumbImg}
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                              if (e.currentTarget.nextSibling) {
                                e.currentTarget.nextSibling.style.display = 'flex';
                              }
                            }}
                          />
                          <div className={styles.thumbPlaceholder} style={{ display: 'none' }}>
                            <ImageIcon size={18} />
                          </div>
                        </>
                      ) : (
                        <div className={styles.thumbPlaceholder}>
                          <ImageIcon size={18} />
                        </div>
                      )}
                    </div>

                    <div className={styles.titleGroup}>
                      <div className={styles.productName}>{product.name}</div>
                      <div className={styles.productMeta}>
                        <span className={styles.skuTag}>{cleanSku}</span>
                        {product.brand && <span>{product.brand}</span>}
                        <span>Cost: ₹{(product.costPrice || 0).toLocaleString('en-IN')}</span>
                      </div>
                    </div>
                  </div>

                  {/* Status Badge */}
                  <div className={styles.statusGroup}>
                    {isFloorApplied ? (
                      <span className={styles.floorBadge}>
                        <ShieldIcon size={13} />
                        <span>Margin Floor Enforced</span>
                      </span>
                    ) : isApproved ? (
                      <span className={styles.approvedBadge}>
                        <CheckCircleIcon size={13} />
                        <span>Approved Price</span>
                      </span>
                    ) : isNoCompetitor ? (
                      <span className={styles.noCompBadge}>No Competitor Data</span>
                    ) : (
                      <span className={styles.pendingBadge}>Recommendation Ready</span>
                    )}
                  </div>
                </div>

                {/* Metrics Comparison Grid */}
                <div className={styles.metricsGrid}>
                  {/* Current Selling Price */}
                  <div className={styles.metricBlock}>
                    <span className={styles.metricLabel}>Current Price</span>
                    <span className={styles.metricValue}>
                      ₹{(product.sellingPrice || 0).toLocaleString('en-IN')}
                    </span>
                    <span className={styles.metricSub}>
                      Margin:{' '}
                      {product.sellingPrice > 0
                        ? Math.round(
                            ((product.sellingPrice - product.costPrice) / product.sellingPrice) *
                              1000
                          ) / 10
                        : 0}
                      %
                    </span>
                  </div>

                  {/* Competitor Benchmark Price */}
                  <div className={styles.metricBlock}>
                    <span className={styles.metricLabel}>Competitor Price</span>
                    <span className={styles.metricValue}>
                      {rec.competitorPrice
                        ? `₹${rec.competitorPrice.toLocaleString('en-IN')}`
                        : '—'}
                    </span>
                    <span className={styles.metricSub}>
                      {rec.competitorName ? `${rec.competitorName}` : 'No active competitor'}
                    </span>
                  </div>

                  {/* Minimum Safe Floor */}
                  <div className={styles.metricBlock}>
                    <span className={styles.metricLabel}>Minimum Safe Floor</span>
                    <span className={styles.metricValueFloor}>
                      ₹{(rec.minimumSafePrice || 0).toLocaleString('en-IN')}
                    </span>
                    <span className={styles.metricSub}>
                      {((product.minMargin || 0.25) * 100).toFixed(0)}% Min Margin
                    </span>
                  </div>

                  {/* Recommended Price */}
                  <div className={styles.metricBlockHighlight}>
                    <span className={styles.metricLabel}>Recommended Price</span>
                    <div className={styles.recPriceRow}>
                      <span className={styles.recommendedPriceVal}>
                        ₹{(rec.recommendedPrice || 0).toLocaleString('en-IN')}
                      </span>
                      {priceDiff !== 0 && (
                        <span
                          className={priceDiff < 0 ? styles.diffDown : styles.diffUp}
                          title="Difference from current selling price"
                        >
                          {priceDiff < 0
                            ? `-₹${Math.abs(priceDiff).toLocaleString('en-IN')}`
                            : `+₹${priceDiff.toLocaleString('en-IN')}`}
                        </span>
                      )}
                    </div>
                    <span className={styles.metricSubHighlight}>
                      Expected Margin: {rec.expectedMargin || 0}%
                    </span>
                  </div>
                </div>

                {/* Calculation Explanation Card */}
                {rec.explanation && (
                  <div className={styles.explanationBox}>
                    <span className={styles.explanationIcon}>💡</span>
                    <div className={styles.explanationText}>{rec.explanation}</div>
                  </div>
                )}

                {/* Action Buttons Row */}
                <div className={styles.cardActions}>
                  <button
                    type="button"
                    className={styles.ruleConfigButton}
                    onClick={() => setConfiguringProduct(product)}
                    title="Configure margin floor and undercut percentage"
                  >
                    <SlidersIcon size={14} />
                    <span>Configure Rule</span>
                  </button>

                  <div className={styles.actionButtonGroup}>
                    <button
                      type="button"
                      className={styles.secondaryAction}
                      onClick={() => handleRecalculate(product._id)}
                      disabled={isRecalculating}
                      title="Recalculate recommendation with latest data"
                    >
                      <RefreshIcon size={13} />
                      <span>{isRecalculating ? 'Calculating...' : 'Recalculate'}</span>
                    </button>

                    <button
                      type="button"
                      className={styles.approveButton}
                      onClick={() => handleApprove(product._id)}
                      disabled={isApproving || isApproved || isNoCompetitor}
                      title={
                        isApproved
                          ? 'This recommendation is already approved and applied'
                          : 'Update store selling price to recommended price'
                      }
                    >
                      <CheckCircleIcon size={14} />
                      <span>{isApproving ? 'Approving...' : isApproved ? 'Applied' : 'Approve Price'}</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Pricing Rule Config Modal */}
      {configuringProduct && (
        <PricingRuleModal
          product={configuringProduct}
          onClose={() => setConfiguringProduct(null)}
          onRuleSaved={() => {
            fetchRecommendations();
          }}
        />
      )}
    </div>
  );
}
