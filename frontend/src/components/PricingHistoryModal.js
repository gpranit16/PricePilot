'use client';

import React, { useState, useEffect } from 'react';
import styles from './PricingHistoryModal.module.css';
import { CloseIcon } from './Icons';
import { getApiBase } from '../utils/api';

export default function PricingHistoryModal({ product, onClose }) {
  const [history, setHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  const apiBase = getApiBase();

  useEffect(() => {
    async function fetchHistory() {
      if (!product?._id) return;
      setIsLoading(true);
      try {
        const res = await fetch(`${apiBase}/pricing/history/${product._id}`);
        const data = await res.json();
        setHistory(data.history || []);
      } catch (err) {
        console.error('Failed to fetch pricing history:', err);
      } finally {
        setIsLoading(false);
      }
    }
    fetchHistory();
  }, [product, apiBase]);

  const formatStrategy = (strat) => {
    switch (strat) {
      case 'match_competitor':
        return 'Match Lowest';
      case 'lowest_competitor':
      case 'undercut_competitor':
        return 'Undercut Lowest';
      case 'maintain_margin':
        return 'Maintain Margin';
      case 'premium_pricing':
        return 'Premium Markup';
      default:
        return strat || 'Dynamic Strategy';
    }
  };

  const getStatusClass = (status) => {
    if (status === 'approved') return styles.statusApproved;
    if (status === 'rejected') return styles.statusRejected;
    return styles.statusPending;
  };

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div className={styles.modalTitleGroup}>
            <h2 className={styles.modalTitle}>Pricing Decision History</h2>
            <span className={styles.modalSubtitle}>
              Audit log of price recommendations and approvals for {product.name}
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

        <div className={styles.historyList}>
          {isLoading ? (
            <div className={styles.emptyState}>Loading pricing audit history...</div>
          ) : history.length === 0 ? (
            <div className={styles.emptyState}>
              No pricing history records found for this product.
            </div>
          ) : (
            history.map((record) => {
              const dateStr = record.createdAt
                ? new Date(record.createdAt).toLocaleString('en-IN', {
                    dateStyle: 'medium',
                    timeStyle: 'short'
                  })
                : '—';

              return (
                <div key={record._id} className={styles.historyCard}>
                  <div className={styles.historyHeader}>
                    <span className={styles.dateText}>{dateStr}</span>
                    <span
                      className={`${styles.statusBadge} ${getStatusClass(record.status)}`}
                    >
                      {record.status}
                    </span>
                  </div>

                  <div className={styles.priceFlowRow}>
                    <span className={styles.strategyBadge}>
                      {formatStrategy(record.strategy)}
                    </span>
                    <span className={styles.priceTag}>
                      ₹{(record.previousPrice || record.currentSellingPrice || 0).toLocaleString('en-IN')}
                    </span>
                    <span className={styles.priceArrow}>➔</span>
                    <span className={styles.priceTag} style={{ color: 'var(--accent-primary)' }}>
                      ₹{(record.recommendedPrice || 0).toLocaleString('en-IN')}
                    </span>
                  </div>

                  <div className={styles.metricsRow}>
                    <span>
                      Expected Margin: <strong>{record.expectedMargin || 0}%</strong>
                    </span>
                    {record.expectedProfit !== undefined && (
                      <span>
                        Expected Profit: <strong>₹{record.expectedProfit}</strong>
                      </span>
                    )}
                    {record.floorApplied && (
                      <span style={{ color: '#D97706' }}>
                        🛡️ Margin Floor Enforced
                      </span>
                    )}
                    {record.boundApplied && (
                      <span style={{ color: '#D97706' }}>
                        Bound: {record.boundApplied}
                      </span>
                    )}
                  </div>

                  {record.explanation && (
                    <div className={styles.explanationText}>
                      {record.explanation}
                    </div>
                  )}

                  {record.rejectionReason && (
                    <div className={styles.explanationText} style={{ color: '#C62828' }}>
                      Rejection Reason: {record.rejectionReason}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

