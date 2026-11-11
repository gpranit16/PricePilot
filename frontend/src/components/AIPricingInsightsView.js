'use client';

import React, { useState, useEffect, useCallback } from 'react';
import styles from './AIPricingInsightsView.module.css';
import { RefreshIcon, AlertCircleIcon, ShieldIcon, CheckCircleIcon } from './Icons';
import { getApiBase } from '../utils/api';

export default function AIPricingInsightsView({ onNavigateTab }) {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState('all');
  const [errorMessage, setErrorMessage] = useState(null);

  const apiBase = getApiBase();

  const fetchInsights = useCallback(async (isManual = false) => {
    if (isManual) setIsRefreshing(true);
    else setIsLoading(true);
    setErrorMessage(null);

    try {
      const endpoint = isManual ? `${apiBase}/ai/insights/refresh` : `${apiBase}/ai/insights`;
      const res = await fetch(endpoint, {
        method: isManual ? 'POST' : 'GET',
        headers: { Accept: 'application/json' }
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || 'Failed to fetch AI pricing insights.');
      }
      setData(json.data);
    } catch (err) {
      setErrorMessage(err.message || 'Failed to load insights.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [apiBase]);

  useEffect(() => {
    fetchInsights(false);
  }, [fetchInsights]);

  const insightsList = data?.insights || [];
  const metrics = data?.metrics || {};

  const filteredInsights = insightsList.filter((item) => {
    if (activeFilter === 'all') return true;
    if (activeFilter === 'opportunities') return item.type === 'pricing_opportunity';
    if (activeFilter === 'price_drops') return item.type === 'competitor_price_drop';
    if (activeFilter === 'margin_risks') return item.type === 'margin_risk';
    if (activeFilter === 'data_gaps') return item.type === 'data_gap';
    return true;
  });

  const getSeverityBadge = (severity) => {
    if (severity === 'high') return <span className={styles.severityHigh}>High Priority</span>;
    if (severity === 'medium') return <span className={styles.severityMedium}>Medium Priority</span>;
    return <span className={styles.severityLow}>Low Priority</span>;
  };

  const getTypeIcon = (type) => {
    switch (type) {
      case 'pricing_opportunity':
        return { icon: '⚡', bg: '#FFF8E1' };
      case 'competitor_price_drop':
        return { icon: '📉', bg: '#FFEBEE' };
      case 'margin_risk':
        return { icon: '🛡️', bg: '#FAF2F5' };
      case 'data_gap':
        return { icon: '🔍', bg: '#E8F5E9' };
      case 'pending_approval':
        return { icon: '⏳', bg: '#EDE7F6' };
      default:
        return { icon: '💡', bg: '#F5F5F5' };
    }
  };

  const handleActionClick = (insight) => {
    if (!onNavigateTab) return;
    if (insight.type === 'data_gap') {
      onNavigateTab('competitors');
    } else {
      onNavigateTab('pricing');
    }
  };

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.headerRow}>
        <div>
          <h1 className={styles.heading}>AI Pricing Intelligence & Insights</h1>
          <p className={styles.subheading}>
            Synthesized market strategy and pricing opportunities powered by verified retailer data.
          </p>
        </div>

        <button
          type="button"
          className={styles.refreshButton}
          onClick={() => fetchInsights(true)}
          disabled={isRefreshing || isLoading}
          title="Regenerate pricing insights"
        >
          <RefreshIcon size={14} />
          <span>{isRefreshing ? 'Regenerating...' : 'Refresh Insights'}</span>
        </button>
      </div>

      {/* Error Banner */}
      {errorMessage && (
        <div className={styles.errorBanner}>
          <AlertCircleIcon size={16} />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Loading State */}
      {isLoading ? (
        <div className={styles.loadingBox}>
          <div className={styles.spinner} />
          <span>Analyzing catalogue benchmarks and competitor pricing movements...</span>
        </div>
      ) : (
        <>
          {/* Executive Strategic Summary */}
          {data?.summary && (
            <div className={styles.summaryCard}>
              <div className={styles.summaryHeader}>
                <span className={styles.summaryBadge}>
                  ✨ Strategic Market Brief ({data.source === 'gemini' ? 'Gemini AI' : 'Deterministic Engine'})
                </span>
                {data.generatedAt && (
                  <span className={styles.timestamp}>
                    Updated {new Date(data.generatedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
              <div className={styles.summaryText}>{data.summary}</div>
            </div>
          )}

          {/* Key KPI Metrics Strip */}
          <div className={styles.kpiStrip}>
            <div className={styles.kpiCard}>
              <span className={styles.kpiLabel}>Total Products</span>
              <span className={styles.kpiValue}>{metrics.totalProducts || 0}</span>
            </div>
            <div className={styles.kpiCard}>
              <span className={styles.kpiLabel}>Cheaper Competitors</span>
              <span className={styles.kpiValue} style={{ color: '#C62828' }}>
                {metrics.underpricedCount || 0}
              </span>
            </div>
            <div className={styles.kpiCard}>
              <span className={styles.kpiLabel}>Pending Repricing</span>
              <span className={styles.kpiValue} style={{ color: 'var(--accent-primary)' }}>
                {metrics.pendingRecommendationsCount || 0}
              </span>
            </div>
            <div className={styles.kpiCard}>
              <span className={styles.kpiLabel}>Data Gaps</span>
              <span className={styles.kpiValue} style={{ color: '#B78103' }}>
                {metrics.dataGapsCount || 0}
              </span>
            </div>
            <div className={styles.kpiCard}>
              <span className={styles.kpiLabel}>Floor Protected</span>
              <span className={styles.kpiValue} style={{ color: '#2E7D32' }}>
                {metrics.floorProtectedCount || 0}
              </span>
            </div>
          </div>

          {/* Filter Bar */}
          <div className={styles.filterBar}>
            <button
              type="button"
              className={`${styles.filterTab} ${activeFilter === 'all' ? styles.filterTabActive : ''}`}
              onClick={() => setActiveFilter('all')}
            >
              All Insights ({insightsList.length})
            </button>
            <button
              type="button"
              className={`${styles.filterTab} ${activeFilter === 'opportunities' ? styles.filterTabActive : ''}`}
              onClick={() => setActiveFilter('opportunities')}
            >
              Pricing Opportunities
            </button>
            <button
              type="button"
              className={`${styles.filterTab} ${activeFilter === 'price_drops' ? styles.filterTabActive : ''}`}
              onClick={() => setActiveFilter('price_drops')}
            >
              Competitor Drops
            </button>
            <button
              type="button"
              className={`${styles.filterTab} ${activeFilter === 'margin_risks' ? styles.filterTabActive : ''}`}
              onClick={() => setActiveFilter('margin_risks')}
            >
              Margin Protection
            </button>
            <button
              type="button"
              className={`${styles.filterTab} ${activeFilter === 'data_gaps' ? styles.filterTabActive : ''}`}
              onClick={() => setActiveFilter('data_gaps')}
            >
              Data Gaps
            </button>
          </div>

          {/* Insights Cards List */}
          <div className={styles.insightsList}>
            {filteredInsights.length === 0 ? (
              <div className={styles.emptyState}>
                No insights found for this filter category.
              </div>
            ) : (
              filteredInsights.map((insight, idx) => {
                const typeInfo = getTypeIcon(insight.type);

                return (
                  <div key={idx} className={styles.insightCard}>
                    <div className={styles.cardTopRow}>
                      <div className={styles.titleArea}>
                        <div
                          className={styles.typeIconWrapper}
                          style={{ backgroundColor: typeInfo.bg }}
                        >
                          {typeInfo.icon}
                        </div>
                        <h3 className={styles.cardTitle}>{insight.title}</h3>
                      </div>
                      {getSeverityBadge(insight.severity)}
                    </div>

                    <div className={styles.cardBody}>
                      <div className={styles.description}>{insight.description}</div>

                      {insight.businessImplication && (
                        <div className={styles.implicationBox}>
                          <span className={styles.implicationLabel}>Business Implication:</span>
                          <span>{insight.businessImplication}</span>
                        </div>
                      )}
                    </div>

                    <div className={styles.actionRow}>
                      <div className={styles.actionText}>
                        <span>👉 <strong>Recommended Action:</strong> {insight.recommendedAction}</span>
                      </div>

                      {onNavigateTab && (
                        <button
                          type="button"
                          className={styles.actionButton}
                          onClick={() => handleActionClick(insight)}
                        >
                          <span>{insight.type === 'data_gap' ? 'Find Competitors' : 'Review in Repricer'}</span>
                          <span>➔</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}

