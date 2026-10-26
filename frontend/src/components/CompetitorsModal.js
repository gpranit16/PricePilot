'use client';

import React, { useState, useEffect, useCallback } from 'react';
import styles from './CompetitorsModal.module.css';
import {
  CloseIcon,
  SearchIcon,
  RefreshIcon,
  ExternalLinkIcon,
  HistoryIcon,
  TrashIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  AlertCircleIcon
} from './Icons';
import { getApiBase } from '../utils/api';

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

export default function CompetitorsModal({
  product,
  onClose,
  onOpenDiscovery,
  onOpenHistory
}) {
  const [competitors, setCompetitors] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [scrapingId, setScrapingId] = useState(null);
  const [scrapeFeedback, setScrapeFeedback] = useState({});

  const apiBase = getApiBase();

  const fetchCompetitors = useCallback(async () => {
    if (!product?._id) return;
    setIsLoading(true);
    try {
      const res = await fetch(`${apiBase}/products/${product._id}/competitors`, {
        cache: 'no-store',
        headers: { Accept: 'application/json' }
      });
      const data = await res.json();
      setCompetitors(data.competitors || []);
    } catch (err) {
      console.error('Error fetching competitors:', err);
    } finally {
      setIsLoading(false);
    }
  }, [apiBase, product]);

  useEffect(() => {
    fetchCompetitors();
  }, [fetchCompetitors]);

  // Scrape competitor live
  const handleScrapeNow = async (competitor) => {
    setScrapingId(competitor._id);
    setScrapeFeedback((prev) => ({ ...prev, [competitor._id]: null }));

    try {
      const res = await fetch(`${apiBase}/competitors/${competitor._id}/scrape`, {
        method: 'POST',
        headers: { Accept: 'application/json' }
      });
      const data = await res.json();

      if (data.success) {
        setScrapeFeedback((prev) => ({
          ...prev,
          [competitor._id]: {
            type: 'success',
            msg: `Extracted ₹${data.price.toLocaleString('en-IN')}`
          }
        }));
      } else {
        setScrapeFeedback((prev) => ({
          ...prev,
          [competitor._id]: {
            type: 'error',
            msg: data.error || 'Scrape failed'
          }
        }));
      }
      await fetchCompetitors();
    } catch (err) {
      setScrapeFeedback((prev) => ({
        ...prev,
        [competitor._id]: {
          type: 'error',
          msg: err.message || 'Scrape error'
        }
      }));
    } finally {
      setScrapingId(null);
    }
  };

  // Toggle active/paused status
  const handleToggleStatus = async (competitor) => {
    const nextStatus = competitor.trackingStatus === 'paused' ? 'active' : 'paused';
    try {
      const res = await fetch(`${apiBase}/competitors/${competitor._id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({ trackingStatus: nextStatus })
      });
      if (res.ok) {
        await fetchCompetitors();
      }
    } catch (err) {
      alert(`Failed to update status: ${err.message}`);
    }
  };

  // Delete competitor
  const handleDelete = async (competitor) => {
    if (!confirm(`Remove ${competitor.merchantName} competitor link?`)) return;
    try {
      const res = await fetch(`${apiBase}/competitors/${competitor._id}`, {
        method: 'DELETE',
        headers: { Accept: 'application/json' }
      });
      if (res.ok) {
        await fetchCompetitors();
      }
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.modalHeader}>
          <div className={styles.modalTitleGroup}>
            <h2 className={styles.modalTitle}>Tracked Competitors</h2>
            <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
              Direct price extraction & automated monitoring
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              className={styles.findButton}
              onClick={() => {
                onClose();
                onOpenDiscovery(product);
              }}
            >
              <PlusIcon size={14} />
              <span>Find Competitors</span>
            </button>
            <button
              type="button"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}
              onClick={onClose}
              aria-label="Close"
            >
              <CloseIcon size={18} />
            </button>
          </div>
        </div>

        {/* Product Strip */}
        <div className={styles.productStrip}>
          <div>
            <span className={styles.productSku}>{formatSku(product.sku)}</span>
            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
              {product.brand ? `${product.brand} ` : ''}
              {product.name}
            </span>
          </div>
          <div>
            Your Selling Price:{' '}
            <strong style={{ fontFamily: 'var(--font-mono)' }}>
              ₹{(product.sellingPrice || 0).toLocaleString('en-IN')}
            </strong>
          </div>
        </div>

        {/* Body */}
        <div className={styles.modalBody}>
          {isLoading ? (
            <div className={styles.emptyState}>Loading tracked competitor links...</div>
          ) : competitors.length === 0 ? (
            <div className={styles.emptyState}>
              <div style={{ fontFamily: 'var(--font-heading)', fontSize: 20 }}>
                No Competitors Linked Yet
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', maxWidth: 400 }}>
                Discover live competitor prices across Google Shopping, Amazon, Flipkart, and other
                verified Indian retailers.
              </p>
              <button
                type="button"
                className={styles.findButton}
                onClick={() => {
                  onClose();
                  onOpenDiscovery(product);
                }}
                style={{ marginTop: 8 }}
              >
                <SearchIcon size={14} />
                <span>Find Competitors for this Product</span>
              </button>
            </div>
          ) : (
            competitors.map((comp) => {
              const isDirect = comp.sourceType === 'direct_scrape';
              const isPaused = comp.trackingStatus === 'paused';
              const isError = comp.trackingStatus === 'error';
              const isScrapingThis = scrapingId === comp._id;
              const feedback = scrapeFeedback[comp._id];

              return (
                <div key={comp._id} className={styles.competitorItem}>
                  <div className={styles.itemTopRow}>
                    <div>
                      <div className={styles.merchantTitle}>{comp.merchantName}</div>
                      <div className={styles.externalTitle}>{comp.externalTitle}</div>
                    </div>

                    <div className={styles.priceTagGroup}>
                      <div className={styles.currentPrice}>
                        {comp.currentPrice
                          ? `₹${comp.currentPrice.toLocaleString('en-IN')}`
                          : '—'}
                      </div>
                      <div className={styles.priceSubtext}>
                        {isDirect ? 'Verified Page Scrape' : 'Search Result Price'}
                      </div>
                    </div>
                  </div>

                  {comp.lastError && (
                    <div className={styles.errorMessageText}>
                      ⚠️ Last Check Error: {comp.lastError}
                    </div>
                  )}

                  {feedback && (
                    <div
                      style={{
                        fontSize: 12,
                        padding: '4px 8px',
                        borderRadius: 4,
                        backgroundColor:
                          feedback.type === 'success'
                            ? 'var(--status-success-bg)'
                            : 'var(--status-error-bg)',
                        color:
                          feedback.type === 'success'
                            ? 'var(--status-success)'
                            : 'var(--status-error)'
                      }}
                    >
                      {feedback.msg}
                    </div>
                  )}

                  <div className={styles.itemMetaRow}>
                    <div className={styles.badgeGroup}>
                      <span
                        className={
                          isDirect ? styles.sourceBadgeDirect : styles.sourceBadgeSearch
                        }
                      >
                        {isDirect ? 'Direct Scrape' : 'Google Shopping'}
                      </span>

                      {isPaused && (
                        <span className={styles.statusPaused}>Tracking Paused</span>
                      )}
                      {isError && (
                        <span className={styles.statusError}>Extraction Error</span>
                      )}

                      <span>
                        Last Checked:{' '}
                        {comp.lastCheckedAt
                          ? new Date(comp.lastCheckedAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit'
                            })
                          : 'Never'}
                      </span>
                    </div>

                    <div className={styles.actionsGroup}>
                      <a
                        href={comp.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.iconButton}
                        title="View retailer listing"
                      >
                        <ExternalLinkIcon size={12} />
                        <span>Link</span>
                      </a>

                      <button
                        type="button"
                        className={styles.iconButton}
                        onClick={() => onOpenHistory(comp)}
                        title="View Price History"
                      >
                        <HistoryIcon size={13} />
                        <span>History ({comp.observationCount || 1})</span>
                      </button>

                      <button
                        type="button"
                        className={styles.iconButton}
                        onClick={() => handleToggleStatus(comp)}
                        title={isPaused ? 'Resume tracking' : 'Pause tracking'}
                      >
                        {isPaused ? <PlayIcon size={12} /> : <PauseIcon size={12} />}
                        <span>{isPaused ? 'Resume' : 'Pause'}</span>
                      </button>

                      <button
                        type="button"
                        className={styles.scrapeButton}
                        onClick={() => handleScrapeNow(comp)}
                        disabled={isScrapingThis}
                      >
                        <RefreshIcon
                          size={12}
                          className={isScrapingThis ? styles.spinning : ''}
                        />
                        <span>{isScrapingThis ? 'Scraping...' : 'Scrape Now'}</span>
                      </button>

                      <button
                        type="button"
                        className={styles.deleteButton}
                        onClick={() => handleDelete(comp)}
                        title="Remove link"
                      >
                        <TrashIcon size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
