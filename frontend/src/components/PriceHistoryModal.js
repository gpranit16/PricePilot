'use client';

import React, { useState, useEffect, useCallback } from 'react';
import styles from './PriceHistoryModal.module.css';
import { CloseIcon, AlertCircleIcon } from './Icons';
import { getApiBase } from '../utils/api';

export default function PriceHistoryModal({ competitor, onClose }) {
  const [history, setHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const apiBase = getApiBase();

  const fetchHistory = useCallback(async () => {
    if (!competitor?._id) return;
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`${apiBase}/competitors/${competitor._id}/history`, {
        cache: 'no-store',
        headers: { Accept: 'application/json' }
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to fetch price history');
      }

      setHistory(data.history || []);
    } catch (err) {
      setError(err.message || 'Error loading price observations');
    } finally {
      setIsLoading(false);
    }
  }, [apiBase, competitor]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>Price Observation History</h2>
          <button
            type="button"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}
            onClick={onClose}
            aria-label="Close"
          >
            <CloseIcon size={18} />
          </button>
        </div>

        {/* Competitor Summary */}
        <div className={styles.competitorStrip}>
          <div className={styles.merchantName}>{competitor.merchantName}</div>
          <div className={styles.competitorTitle}>{competitor.externalTitle}</div>
        </div>

        {/* Modal Body */}
        <div className={styles.modalBody}>
          {isLoading ? (
            <div className={styles.emptyHistory}>Loading observations...</div>
          ) : error ? (
            <div style={{ color: 'var(--status-error)', fontSize: 13, padding: 12 }}>
              <AlertCircleIcon size={16} />
              <span>{error}</span>
            </div>
          ) : history.length === 0 ? (
            <div className={styles.emptyHistory}>
              No price observations recorded yet. Run &quot;Scrape Now&quot; to perform the first live check.
            </div>
          ) : (
            <table className={styles.historyTable}>
              <thead>
                <tr>
                  <th>Observed Price</th>
                  <th>Source Method</th>
                  <th>Observed Date & Time</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {history.map((obs) => {
                  const isDirect = obs.sourceType === 'direct_scrape';
                  const isSearch = obs.sourceType === 'search_result';

                  return (
                    <tr key={obs._id}>
                      <td>
                        <span className={styles.priceText}>
                          ₹{(obs.price || 0).toLocaleString('en-IN')}
                        </span>
                      </td>
                      <td>
                        <span
                          className={
                            isDirect
                              ? styles.sourceBadgeDirect
                              : isSearch
                              ? styles.sourceBadgeSearch
                              : styles.sourceBadgeManual
                          }
                        >
                          {isDirect
                            ? 'Verified Scrape'
                            : isSearch
                            ? 'Google Shopping / SerpApi'
                            : 'Manual Entry'}
                        </span>
                      </td>
                      <td>
                        <span className={styles.timestamp}>
                          {new Date(obs.observedAt).toLocaleString('en-IN', {
                            dateStyle: 'medium',
                            timeStyle: 'short'
                          })}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                          {obs.notes || 'Recorded check'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
