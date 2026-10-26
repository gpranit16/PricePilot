'use client';

import React, { useState, useEffect, useCallback } from 'react';
import styles from './CompetitorTrackingView.module.css';
import {
  RefreshIcon,
  ExternalLinkIcon,
  HistoryIcon,
  TrashIcon,
  SearchIcon,
  PlusIcon,
  PauseIcon,
  PlayIcon,
  AlertCircleIcon
} from './Icons';
import PriceHistoryModal from './PriceHistoryModal';
import CompetitorDiscoveryModal from './CompetitorDiscoveryModal';
import { getApiBase } from '../utils/api';

export default function CompetitorTrackingView() {
  const [products, setProducts] = useState([]);
  const [competitors, setCompetitors] = useState([]);
  const [selectedProductId, setSelectedProductId] = useState('all');
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [scrapingId, setScrapingId] = useState(null);

  // Modals
  const [historyCompetitor, setHistoryCompetitor] = useState(null);
  const [discoveryProduct, setDiscoveryProduct] = useState(null);

  const apiBase = getApiBase();

  // Fetch all products and all their competitors
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const prodRes = await fetch(`${apiBase}/products`, { cache: 'no-store' });
      const prodData = await prodRes.json();
      const loadedProducts = prodData.products || [];
      setProducts(loadedProducts);

      // Fetch competitors for each product
      let allComps = [];
      for (const p of loadedProducts) {
        try {
          const compRes = await fetch(`${apiBase}/products/${p._id}/competitors`, { cache: 'no-store' });
          const compData = await compRes.json();
          const items = (compData.competitors || []).map((c) => ({
            ...c,
            productInfo: p
          }));
          allComps = allComps.concat(items);
        } catch (e) {}
      }

      setCompetitors(allComps);
    } catch (err) {
      console.error('Error fetching competitor tracking data:', err);
    } finally {
      setIsLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Scrape Now
  const handleScrapeNow = async (comp) => {
    setScrapingId(comp._id);
    try {
      const res = await fetch(`${apiBase}/competitors/${comp._id}/scrape`, {
        method: 'POST',
        headers: { Accept: 'application/json' }
      });
      const data = await res.json();
      if (data.success) {
        alert(`Successfully scraped: ₹${data.price.toLocaleString('en-IN')}`);
      } else {
        alert(`Scrape check notice: ${data.error || 'Failed to extract price'}`);
      }
      await fetchData();
    } catch (err) {
      alert(`Scrape failed: ${err.message}`);
    } finally {
      setScrapingId(null);
    }
  };

  // Toggle active/paused
  const handleToggleStatus = async (comp) => {
    const nextStatus = comp.trackingStatus === 'paused' ? 'active' : 'paused';
    try {
      await fetch(`${apiBase}/competitors/${comp._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackingStatus: nextStatus })
      });
      await fetchData();
    } catch (err) {
      alert(`Error toggling status: ${err.message}`);
    }
  };

  // Delete
  const handleDelete = async (comp) => {
    if (!confirm(`Delete competitor link for ${comp.merchantName}?`)) return;
    try {
      await fetch(`${apiBase}/competitors/${comp._id}`, { method: 'DELETE' });
      await fetchData();
    } catch (err) {
      alert(`Delete error: ${err.message}`);
    }
  };

  // Filtered list
  const filtered = competitors.filter((c) => {
    if (selectedProductId !== 'all' && c.productId !== selectedProductId) return false;
    if (search.trim()) {
      const term = search.toLowerCase();
      const matchMerchant = (c.merchantName || '').toLowerCase().includes(term);
      const matchTitle = (c.externalTitle || '').toLowerCase().includes(term);
      const matchProd = (c.productInfo?.name || '').toLowerCase().includes(term);
      const matchSku = (c.productInfo?.sku || '').toLowerCase().includes(term);
      return matchMerchant || matchTitle || matchProd || matchSku;
    }
    return true;
  });

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.headerRow}>
        <div>
          <h1 className={styles.heading}>Competitor Tracking</h1>
          <p className={styles.subheading}>
            Real-time competitor monitoring, SerpApi discovery, and direct page price extraction.
          </p>
        </div>

        {products.length > 0 && (
          <button
            type="button"
            className={styles.scrapeButton}
            onClick={() => setDiscoveryProduct(products[0])}
          >
            <PlusIcon size={14} />
            <span>Discover Competitors</span>
          </button>
        )}
      </div>

      {/* Filter and Search Bar */}
      <div className={styles.filterBar}>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Filter by retailer, product title or SKU..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <select
          className={styles.selectInput}
          value={selectedProductId}
          onChange={(e) => setSelectedProductId(e.target.value)}
        >
          <option value="all">All Catalogue Products ({products.length})</option>
          {products.map((p) => (
            <option key={p._id} value={p._id}>
              {p.sku} — {p.name}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className={styles.tableContainer}>
        {isLoading ? (
          <div className={styles.emptyState}>
            <p>Loading competitor tracking records...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className={styles.emptyState}>
            <div style={{ fontFamily: 'var(--font-heading)', fontSize: 22 }}>
              No Competitor Links Found
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', maxWidth: 440 }}>
              {search || selectedProductId !== 'all'
                ? 'No tracked competitors match your current search or filter.'
                : 'You have not added any competitor listings yet. Select a product in the catalogue and click "Find Competitors" to discover listings across Indian retailers.'}
            </p>
          </div>
        ) : (
          <>
            {/* Desktop Table View */}
            <div className={styles.desktopTableView}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Your Product</th>
                    <th>Retailer & Listing</th>
                    <th>Competitor Price</th>
                    <th>Source Type</th>
                    <th>Status</th>
                    <th>Last Checked</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((comp) => {
                    const isDirect = comp.sourceType === 'direct_scrape';
                    const isPaused = comp.trackingStatus === 'paused';
                    const isError = comp.trackingStatus === 'error';
                    const isScrapingThis = scrapingId === comp._id;

                    return (
                      <tr key={comp._id} className={styles.tableRow}>
                        <td>
                          <div className={styles.productName}>{comp.productInfo?.name}</div>
                          <span className={styles.productSku}>{comp.productInfo?.sku}</span>
                        </td>

                        <td>
                          <div className={styles.merchantTag}>{comp.merchantName}</div>
                          <div className={styles.competitorTitle} title={comp.externalTitle}>
                            {comp.externalTitle}
                          </div>
                        </td>

                        <td>
                          <span className={styles.monoPrice}>
                            {comp.currentPrice
                              ? `₹${comp.currentPrice.toLocaleString('en-IN')}`
                              : '—'}
                          </span>
                        </td>

                        <td>
                          <span
                            className={
                              isDirect ? styles.sourceBadgeDirect : styles.sourceBadgeSearch
                            }
                          >
                            {isDirect ? 'Verified Scrape' : 'Google Shopping'}
                          </span>
                        </td>

                        <td>
                          {isPaused ? (
                            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Paused</span>
                          ) : isError ? (
                            <span style={{ fontSize: 11, color: 'var(--status-error)' }} title={comp.lastError}>
                              Check Error
                            </span>
                          ) : (
                            <span style={{ fontSize: 11, color: 'var(--status-success)', fontWeight: 600 }}>
                              Active
                            </span>
                          )}
                        </td>

                        <td>
                          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                            {comp.lastCheckedAt
                              ? new Date(comp.lastCheckedAt).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit'
                                })
                              : 'Never'}
                          </span>
                        </td>

                        <td style={{ textAlign: 'right' }}>
                          <div className={styles.actionsGroup} style={{ justifyContent: 'flex-end' }}>
                            <a
                              href={comp.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={styles.iconButton}
                              title="Open external link"
                            >
                              <ExternalLinkIcon size={12} />
                              <span>Link</span>
                            </a>

                            <button
                              type="button"
                              className={styles.iconButton}
                              onClick={() => setHistoryCompetitor(comp)}
                              title="View price history"
                            >
                              <HistoryIcon size={13} />
                              <span>History</span>
                            </button>

                            <button
                              type="button"
                              className={styles.iconButton}
                              onClick={() => handleToggleStatus(comp)}
                              title={isPaused ? 'Resume tracking' : 'Pause tracking'}
                            >
                              {isPaused ? <PlayIcon size={11} /> : <PauseIcon size={11} />}
                            </button>

                            <button
                              type="button"
                              className={styles.scrapeButton}
                              onClick={() => handleScrapeNow(comp)}
                              disabled={isScrapingThis}
                              title="Extract fresh price directly from page"
                            >
                              <RefreshIcon size={12} className={isScrapingThis ? styles.spinning : ''} />
                              <span>{isScrapingThis ? 'Checking...' : 'Scrape Now'}</span>
                            </button>

                            <button
                              type="button"
                              className={styles.deleteButton}
                              onClick={() => handleDelete(comp)}
                              title="Remove competitor link"
                            >
                              <TrashIcon size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Responsive Flexbox Cards */}
            <div className={styles.mobileCardList}>
              {filtered.map((comp) => {
                const isDirect = comp.sourceType === 'direct_scrape';
                const isPaused = comp.trackingStatus === 'paused';
                const isError = comp.trackingStatus === 'error';
                const isScrapingThis = scrapingId === comp._id;

                return (
                  <div key={comp._id} className={styles.mobileCard}>
                    <div className={styles.mobileCardHeader}>
                      <div className={styles.mobileCardHeaderLeft}>
                        <span className={styles.merchantTag}>{comp.merchantName}</span>
                        <div className={styles.mobileListingTitle}>{comp.externalTitle}</div>
                      </div>
                      <div className={styles.mobilePriceTag}>
                        <div className={styles.monoPrice}>
                          {comp.currentPrice
                            ? `₹${comp.currentPrice.toLocaleString('en-IN')}`
                            : '—'}
                        </div>
                        <span className={isDirect ? styles.sourceBadgeDirect : styles.sourceBadgeSearch}>
                          {isDirect ? 'Verified' : 'Google Shopping'}
                        </span>
                      </div>
                    </div>

                    <div className={styles.mobileProductRef}>
                      <span className={styles.productRefLabel}>Tracking for:</span>
                      <span className={styles.productRefName}>{comp.productInfo?.name}</span>
                      <span className={styles.productSku}>{comp.productInfo?.sku}</span>
                    </div>

                    <div className={styles.mobileStatusBar}>
                      <div className={styles.statusIndicator}>
                        <span className={styles.statusLabel}>Status: </span>
                        {isPaused ? (
                          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Paused</span>
                        ) : isError ? (
                          <span style={{ fontSize: 11, color: 'var(--status-error)' }}>Error</span>
                        ) : (
                          <span style={{ fontSize: 11, color: 'var(--status-success)', fontWeight: 600 }}>Active</span>
                        )}
                      </div>
                      <div className={styles.lastCheckedText}>
                        Checked: {comp.lastCheckedAt ? new Date(comp.lastCheckedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Never'}
                      </div>
                    </div>

                    <div className={styles.mobileActions}>
                      <button
                        type="button"
                        className={styles.mobileScrapeAction}
                        onClick={() => handleScrapeNow(comp)}
                        disabled={isScrapingThis}
                      >
                        <RefreshIcon size={12} className={isScrapingThis ? styles.spinning : ''} />
                        <span>{isScrapingThis ? 'Checking...' : 'Scrape Now'}</span>
                      </button>

                      <button
                        type="button"
                        className={styles.mobileSecondaryAction}
                        onClick={() => setHistoryCompetitor(comp)}
                      >
                        <HistoryIcon size={12} />
                        <span>History</span>
                      </button>

                      <a
                        href={comp.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.mobileSecondaryAction}
                      >
                        <ExternalLinkIcon size={12} />
                        <span>Link</span>
                      </a>

                      <button
                        type="button"
                        className={styles.mobileIconAction}
                        onClick={() => handleToggleStatus(comp)}
                        title={isPaused ? 'Resume tracking' : 'Pause tracking'}
                      >
                        {isPaused ? <PlayIcon size={12} /> : <PauseIcon size={12} />}
                      </button>

                      <button
                        type="button"
                        className={styles.mobileDeleteAction}
                        onClick={() => handleDelete(comp)}
                        title="Delete"
                      >
                        <TrashIcon size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* History Modal */}
      {historyCompetitor && (
        <PriceHistoryModal
          competitor={historyCompetitor}
          onClose={() => setHistoryCompetitor(null)}
        />
      )}

      {/* Discovery Modal */}
      {discoveryProduct && (
        <CompetitorDiscoveryModal
          product={discoveryProduct}
          onClose={() => setDiscoveryProduct(null)}
          onCompetitorAdded={fetchData}
        />
      )}
    </div>
  );
}
