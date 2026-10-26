'use client';

import React, { useState, useEffect, useCallback } from 'react';
import styles from './CompetitorDiscoveryModal.module.css';
import {
  CloseIcon,
  SearchIcon,
  RefreshIcon,
  ExternalLinkIcon,
  CheckCircleIcon,
  AlertCircleIcon,
  PlusIcon,
  ImageIcon
} from './Icons';
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

export default function CompetitorDiscoveryModal({ product, onClose, onCompetitorAdded }) {
  const [candidates, setCandidates] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);
  const [activeTab, setActiveTab] = useState('auto'); // 'auto' | 'manual'
  const [trackingLoadingMap, setTrackingLoadingMap] = useState({});
  const [trackedSuccessMap, setTrackedSuccessMap] = useState({});

  // Manual competitor entry state
  const [manualMerchant, setManualMerchant] = useState('');
  const [manualTitle, setManualTitle] = useState('');
  const [manualUrl, setManualUrl] = useState('');
  const [manualPrice, setManualPrice] = useState('');
  const [manualError, setManualError] = useState(null);
  const [manualSuccess, setManualSuccess] = useState(null);
  const [isManualSubmitting, setIsManualSubmitting] = useState(false);

  const apiBase = getApiBase();

  // Run on-demand competitor discovery
  const runDiscovery = useCallback(async () => {
    if (!product?._id) return;
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetch(`${apiBase}/products/${product._id}/competitor-search`, {
        method: 'POST',
        headers: { Accept: 'application/json' }
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || 'Competitor discovery failed. Please try again.');
      }

      setCandidates(data.candidates || []);
    } catch (err) {
      setErrorMessage(err.message || 'Unable to connect to discovery service.');
    } finally {
      setIsLoading(false);
    }
  }, [product, apiBase]);

  useEffect(() => {
    runDiscovery();
  }, [runDiscovery]);

  // Handle confirming and saving a discovered competitor candidate
  const handleConfirmCandidate = async (candidate, index) => {
    if (candidate.isBroken) {
      alert('This candidate URL returned a Page Not Found (404) error on the retailer site and cannot be saved.');
      return;
    }

    setTrackingLoadingMap((prev) => ({ ...prev, [index]: true }));

    try {
      const res = await fetch(`${apiBase}/products/${product._id}/competitors`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          merchantName: candidate.merchantName,
          externalTitle: candidate.title,
          url: candidate.url,
          imageUrl: candidate.imageUrl || '',
          currentPrice: candidate.price,
          currency: candidate.currency || 'INR',
          sourceType: 'search_result',
          matchConfidence: candidate.matchQuality || 'moderate'
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to save competitor link.');
      }

      setTrackedSuccessMap((prev) => ({ ...prev, [index]: true }));
      if (onCompetitorAdded) onCompetitorAdded();
    } catch (err) {
      alert(err.message || 'Failed to link competitor.');
    } finally {
      setTrackingLoadingMap((prev) => ({ ...prev, [index]: false }));
    }
  };

  // Handle manual competitor URL submission
  const handleManualSubmit = async (e) => {
    e.preventDefault();
    setManualError(null);
    setManualSuccess(null);

    if (!manualMerchant.trim()) {
      setManualError('Merchant or store name is required.');
      return;
    }
    if (!manualUrl.trim()) {
      setManualError('Product URL is required.');
      return;
    }

    setIsManualSubmitting(true);
    try {
      const res = await fetch(`${apiBase}/products/${product._id}/competitors`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          merchantName: manualMerchant.trim(),
          externalTitle: manualTitle.trim() || product.name,
          url: manualUrl.trim(),
          currentPrice: manualPrice ? parseFloat(manualPrice) : null,
          currency: 'INR',
          sourceType: 'manual',
          matchConfidence: 'manual'
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to save competitor link.');
      }

      setManualSuccess(`Saved competitor link for ${manualMerchant.trim()}!`);
      setManualMerchant('');
      setManualTitle('');
      setManualUrl('');
      setManualPrice('');
      if (onCompetitorAdded) onCompetitorAdded();
    } catch (err) {
      setManualError(err.message || 'Failed to save competitor.');
    } finally {
      setIsManualSubmitting(false);
    }
  };

  const cleanSku = formatSku(product.sku);

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className={styles.modalHeader}>
          <div className={styles.modalTitleGroup}>
            <h2 className={styles.modalTitle}>Competitor Discovery</h2>
            <span className={styles.modalSubtitle}>
              Find and monitor competitor prices across verified Indian online retailers
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

        {/* Selected Product Strip */}
        <div className={styles.targetProductStrip}>
          <div className={styles.targetInfo}>
            <span className={styles.targetSku}>{cleanSku}</span>
            <span className={styles.targetTitle}>
              {product.brand ? `${product.brand} ` : ''}
              {product.name}
            </span>
          </div>
          <div className={styles.targetPrice}>
            Cost: <strong>₹{(product.costPrice || 0).toLocaleString('en-IN')}</strong> • Selling:{' '}
            <strong>₹{(product.sellingPrice || 0).toLocaleString('en-IN')}</strong>
          </div>
        </div>

        {/* Tab switcher */}
        <div className={styles.tabBar}>
          <button
            type="button"
            className={`${styles.tabButton} ${activeTab === 'auto' ? styles.tabButtonActive : ''}`}
            onClick={() => setActiveTab('auto')}
          >
            Discovered Candidates ({isLoading ? '...' : candidates.length})
          </button>
          <button
            type="button"
            className={`${styles.tabButton} ${activeTab === 'manual' ? styles.tabButtonActive : ''}`}
            onClick={() => setActiveTab('manual')}
          >
            Add Competitor Manually
          </button>
        </div>

        {/* Body Content */}
        <div className={styles.modalBody}>
          {activeTab === 'auto' && (
            <>
              {isLoading ? (
                <div className={styles.stateBox}>
                  <div className={styles.spinner} />
                  <div className={styles.loadingHeading}>Finding matching products...</div>
                  <p className={styles.loadingNote}>
                    Scanning retail listings and verifying page accessibility
                  </p>

                  <div className={styles.skeletonList}>
                    {[1, 2, 3].map((n) => (
                      <div key={n} className={styles.skeletonCard}>
                        <div className={styles.skeletonThumb} />
                        <div className={styles.skeletonContent}>
                          <div className={styles.skeletonLineShort} />
                          <div className={styles.skeletonLineLong} />
                          <div className={styles.skeletonLineMed} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : errorMessage ? (
                <div className={styles.stateBox}>
                  <div className={styles.errorBanner} style={{ width: '100%' }}>
                    <AlertCircleIcon size={18} />
                    <span>{errorMessage}</span>
                  </div>
                  <button
                    type="button"
                    className={styles.trackButton}
                    style={{ marginTop: 12 }}
                    onClick={runDiscovery}
                  >
                    <RefreshIcon size={14} />
                    <span>Retry Search</span>
                  </button>
                </div>
              ) : candidates.length === 0 ? (
                <div className={styles.stateBox}>
                  <div className={styles.stateTitle}>No Competitor Listings Found</div>
                  <p className={styles.stateText}>
                    No direct retailer matches were found automatically for this product. You can
                    paste a competitor URL manually.
                  </p>
                  <button
                    type="button"
                    className={styles.trackButton}
                    onClick={() => setActiveTab('manual')}
                    style={{ marginTop: 8 }}
                  >
                    Enter Competitor URL Manually
                  </button>
                </div>
              ) : (
                candidates.map((cand, idx) => {
                  const isTracked = cand.isAlreadyTracked || trackedSuccessMap[idx];
                  const isTrackingThis = trackingLoadingMap[idx];
                  const isBroken = Boolean(cand.isBroken);

                  // Match badge styling based on evaluated confidence
                  let badgeClass = styles.qualityBadgeMod;
                  if (cand.matchQuality === 'exact') badgeClass = styles.qualityBadgeExact;
                  else if (cand.matchQuality === 'high') badgeClass = styles.qualityBadgeHigh;
                  else if (cand.matchQuality === 'partial') badgeClass = styles.qualityBadgePartial;
                  else if (cand.matchQuality === 'mismatch') badgeClass = styles.qualityBadgeMismatch;

                  return (
                    <div
                      key={idx}
                      className={`${styles.candidateCard} ${isBroken ? styles.candidateCardBroken : ''}`}
                    >
                      {/* Product Thumbnail */}
                      <div className={styles.candidateThumb}>
                        {cand.imageUrl ? (
                          <>
                            <img
                              src={cand.imageUrl}
                              alt={cand.title}
                              className={styles.candidateImg}
                              onError={(e) => {
                                e.currentTarget.style.display = 'none';
                                if (e.currentTarget.nextSibling) {
                                  e.currentTarget.nextSibling.style.display = 'flex';
                                }
                              }}
                            />
                            <div
                              className={styles.candidatePlaceholder}
                              style={{ display: 'none' }}
                            >
                              <ImageIcon size={18} />
                            </div>
                          </>
                        ) : (
                          <div className={styles.candidatePlaceholder}>
                            <ImageIcon size={18} />
                          </div>
                        )}
                      </div>

                      <div className={styles.candidateDetails}>
                        {/* Merchant & Match Quality Row */}
                        <div className={styles.candidateMerchantRow}>
                          <span className={styles.merchantName}>{cand.merchantName}</span>
                          <span className={badgeClass}>
                            {cand.matchLabel || (cand.matchQuality === 'exact' ? 'Exact Match' : 'High Match')}
                          </span>
                        </div>

                        {/* Candidate Title */}
                        <div className={styles.candidateTitle} title={cand.title}>
                          {cand.title}
                        </div>

                        {/* Metadata badges row */}
                        <div className={styles.badgeRow}>
                          <span className={styles.linkTypeBadge}>
                            {cand.isGoogleShoppingLink
                              ? 'Google Shopping Offer'
                              : 'Direct Retailer'}
                          </span>

                          {isBroken && (
                            <span className={styles.brokenBadge}>
                              <AlertCircleIcon size={12} />
                              <span>Broken Link (404 Not Found)</span>
                            </span>
                          )}

                          {cand.urlStatus === 'protected' && (
                            <span className={styles.protectedBadge}>
                              <span>Access Protected</span>
                            </span>
                          )}
                        </div>

                        {/* Bottom Row: Price with Source Note & Action Buttons */}
                        <div className={styles.candidateBottomRow}>
                          <div className={styles.priceContainer}>
                            <span className={styles.candidatePrice}>
                              {cand.price
                                ? `₹${cand.price.toLocaleString('en-IN')}`
                                : 'Price unlisted'}
                            </span>
                            <span className={styles.priceSourceNote}>Search-result price</span>
                          </div>

                          <div className={styles.candidateActions}>
                            <a
                              href={cand.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={isBroken ? styles.verifyLinkBroken : styles.verifyLink}
                              title={
                                isBroken
                                  ? 'This URL returned a 404 error on the retailer website'
                                  : 'Open candidate URL in a new browser tab to inspect'
                              }
                            >
                              <span>Verify Link</span>
                              <ExternalLinkIcon size={12} />
                            </a>

                            {isTracked ? (
                              <span className={styles.alreadyTrackedBadge}>
                                <CheckCircleIcon size={14} />
                                <span>Tracked</span>
                              </span>
                            ) : isBroken ? (
                              <button
                                type="button"
                                className={styles.trackButtonDisabled}
                                disabled
                                title="This product link is broken (404) and cannot be tracked"
                              >
                                <span>Broken URL</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                className={styles.trackButton}
                                onClick={() => handleConfirmCandidate(cand, idx)}
                                disabled={isTrackingThis}
                              >
                                <PlusIcon size={13} />
                                <span>{isTrackingThis ? 'Saving...' : 'Confirm & Track'}</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </>
          )}

          {/* Manual Entry Tab */}
          {activeTab === 'manual' && (
            <form onSubmit={handleManualSubmit} className={styles.manualForm}>
              {manualError && (
                <div className={styles.errorBanner}>
                  <AlertCircleIcon size={16} />
                  <span>{manualError}</span>
                </div>
              )}
              {manualSuccess && (
                <div className={styles.successBanner}>
                  <CheckCircleIcon size={16} />
                  <span>{manualSuccess}</span>
                </div>
              )}

              <div className={styles.formGroup}>
                <label className={styles.label}>Competitor / Retailer Name *</label>
                <input
                  type="text"
                  className={styles.input}
                  placeholder="e.g. Amazon.in, Flipkart, Croma"
                  value={manualMerchant}
                  onChange={(e) => setManualMerchant(e.target.value)}
                  required
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>Competitor Product Title (Optional)</label>
                <input
                  type="text"
                  className={styles.input}
                  placeholder="e.g. boAt Airdopes 311 Pro (Active Black)"
                  value={manualTitle}
                  onChange={(e) => setManualTitle(e.target.value)}
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>Direct Product URL *</label>
                <input
                  type="url"
                  className={styles.input}
                  placeholder="https://www.flipkart.com/..."
                  value={manualUrl}
                  onChange={(e) => setManualUrl(e.target.value)}
                  required
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>Current Known Price (₹, Optional)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className={styles.input}
                  placeholder="e.g. 899"
                  value={manualPrice}
                  onChange={(e) => setManualPrice(e.target.value)}
                />
              </div>

              <button
                type="submit"
                className={styles.primaryButton}
                disabled={isManualSubmitting}
                style={{ marginTop: 8 }}
              >
                <PlusIcon size={14} />
                <span>{isManualSubmitting ? 'Saving Competitor...' : 'Link Competitor'}</span>
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
