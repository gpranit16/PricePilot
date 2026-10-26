'use client';

import React, { useState, useEffect, useCallback, useTransition } from 'react';
import styles from './ProductCatalogue.module.css';
import {
  PlusIcon,
  UploadIcon,
  SearchIcon,
  EditIcon,
  TrashIcon,
  CloseIcon,
  ImageIcon,
  AlertCircleIcon,
  CheckCircleIcon,
  CompetitorIcon
} from './Icons';
import CompetitorDiscoveryModal from './CompetitorDiscoveryModal';
import CompetitorsModal from './CompetitorsModal';
import PriceHistoryModal from './PriceHistoryModal';
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

export default function ProductCatalogue() {
  const [products, setProducts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [errorMessage, setErrorMessage] = useState(null);

  // Modal dialog states
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [isCsvModalOpen, setIsCsvModalOpen] = useState(false);
  const [deletingProduct, setDeletingProduct] = useState(null);

  // Competitor tracking modal states
  const [discoveryProduct, setDiscoveryProduct] = useState(null);
  const [viewCompetitorsProduct, setViewCompetitorsProduct] = useState(null);
  const [historyCompetitor, setHistoryCompetitor] = useState(null);

  // Form input state
  const [formData, setFormData] = useState({
    sku: '',
    name: '',
    brand: '',
    category: '',
    costPrice: '',
    sellingPrice: '',
    imageUrl: ''
  });
  const [formError, setFormError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  // CSV Import state
  const [csvText, setCsvText] = useState('');
  const [csvResult, setCsvResult] = useState(null);
  const [isImporting, setIsImporting] = useState(false);

  const apiBase = getApiBase();

  // Fetch products from backend
  const fetchProducts = useCallback(
    async (searchTerm = '') => {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const queryParam = searchTerm.trim() ? `?search=${encodeURIComponent(searchTerm.trim())}` : '';
        const res = await fetch(`${apiBase}/products${queryParam}`, {
          cache: 'no-store',
          headers: { Accept: 'application/json' }
        });

        if (!res.ok) {
          throw new Error(`Server returned HTTP ${res.status}: ${res.statusText}`);
        }

        const data = await res.json();
        setProducts(data.products || []);
      } catch (err) {
        setErrorMessage(err.message || 'Failed to fetch products from backend');
        setProducts([]);
      } finally {
        setIsLoading(false);
      }
    },
    [apiBase]
  );

  // Initial load
  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  // Debounced search
  useEffect(() => {
    const handler = setTimeout(() => {
      fetchProducts(search);
    }, 250);
    return () => clearTimeout(handler);
  }, [search, fetchProducts]);

  // Open Form modal for Add or Edit
  const openFormModal = (product = null) => {
    setFormError(null);
    if (product) {
      setEditingProduct(product);
      setFormData({
        sku: product.sku || '',
        name: product.name || '',
        brand: product.brand || '',
        category: product.category || '',
        costPrice: product.costPrice !== undefined ? String(product.costPrice) : '',
        sellingPrice: product.sellingPrice !== undefined ? String(product.sellingPrice) : '',
        imageUrl: product.imageUrl || ''
      });
    } else {
      setEditingProduct(null);
      setFormData({
        sku: '',
        name: '',
        brand: '',
        category: 'General',
        costPrice: '',
        sellingPrice: '',
        imageUrl: ''
      });
    }
    setIsFormOpen(true);
  };

  // Save product (POST or PUT)
  const handleSaveProduct = async (e) => {
    e.preventDefault();
    setFormError(null);

    // Validation
    if (!formData.sku.trim()) {
      setFormError('SKU is required.');
      return;
    }
    if (!formData.name.trim()) {
      setFormError('Product name is required.');
      return;
    }
    const cost = parseFloat(formData.costPrice);
    if (isNaN(cost) || cost <= 0) {
      setFormError('Cost price must be a valid number greater than 0.');
      return;
    }
    const selling = parseFloat(formData.sellingPrice);
    if (isNaN(selling) || selling < 0) {
      setFormError('Selling price must be a valid non-negative number.');
      return;
    }

    setIsSaving(true);
    try {
      const url = editingProduct
        ? `${apiBase}/products/${editingProduct._id}`
        : `${apiBase}/products`;
      const method = editingProduct ? 'PUT' : 'POST';

      const payload = {
        sku: formData.sku.trim().toUpperCase(),
        name: formData.name.trim(),
        brand: formData.brand.trim(),
        category: formData.category.trim() || 'General',
        costPrice: cost,
        sellingPrice: selling,
        imageUrl: formData.imageUrl.trim()
      };

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || `Failed to save product (HTTP ${res.status})`);
      }

      setIsFormOpen(false);
      setEditingProduct(null);
      await fetchProducts(search);
    } catch (err) {
      setFormError(err.message || 'Error occurred while saving product');
    } finally {
      setIsSaving(false);
    }
  };

  // Delete product
  const handleDeleteProduct = async () => {
    if (!deletingProduct) return;
    try {
      const res = await fetch(`${apiBase}/products/${deletingProduct._id}`, {
        method: 'DELETE',
        headers: { Accept: 'application/json' }
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to delete product');
      }
      setDeletingProduct(null);
      await fetchProducts(search);
    } catch (err) {
      alert(`Delete Error: ${err.message}`);
    }
  };

  // CSV Import
  const handleImportCsv = async () => {
    if (!csvText.trim()) {
      setCsvResult({ success: false, message: 'Please enter or select CSV content to import.' });
      return;
    }

    setIsImporting(true);
    setCsvResult(null);
    try {
      const res = await fetch(`${apiBase}/products/import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({ csvData: csvText })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to import CSV data');
      }

      setCsvResult(data);
      await fetchProducts(search);
    } catch (err) {
      setCsvResult({ success: false, message: err.message });
    } finally {
      setIsImporting(false);
    }
  };

  // Handle local CSV file selection
  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setCsvText(event.target.result || '');
      setCsvResult(null);
    };
    reader.readAsText(file);
  };

  // Helper sample CSV loader
  const loadSampleCsv = () => {
    const sample = `sku,name,costPrice,sellingPrice,brand,category,imageUrl
SHIRT-NAVY-M,Classic Cotton Oxford Shirt,750,1499,Woodland,Apparel,https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=100
BAG-LTH-BRN,Heritage Leather Messenger Bag,1800,3299,UrbanHide,Accessories,https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=100
SHOE-RUN-42,Aerofit Performance Running Shoes,1200,2499,StrideRun,Footwear,https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=100
WATCH-CHR-SLV,Minimalist Chronograph Watch,2100,4500,AuraTime,Accessories,https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=100`;
    setCsvText(sample);
    setCsvResult(null);
  };

  return (
    <div className={styles.container}>
      {/* Header Row */}
      <div className={styles.headerRow}>
        <div>
          <h1 className={styles.heading}>Product Catalogue</h1>
          <p className={styles.subheading}>
            Manage your store catalogue, cost basis, selling prices, and image assets.
          </p>
        </div>

        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => {
              setCsvResult(null);
              setIsCsvModalOpen(true);
            }}
          >
            <UploadIcon size={16} />
            <span>Import CSV</span>
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => openFormModal()}
          >
            <PlusIcon size={16} />
            <span>Add Product</span>
          </button>
        </div>
      </div>

      {/* Search Input Bar */}
      <div className={styles.searchBar}>
        <SearchIcon size={16} className={styles.searchIcon} />
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search products by name, SKU or brand..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button
            type="button"
            className={styles.clearSearchButton}
            onClick={() => setSearch('')}
            aria-label="Clear search"
          >
            <CloseIcon size={14} />
          </button>
        )}
      </div>

      {/* Error state if backend unreachable */}
      {errorMessage && (
        <div className={styles.errorBanner} style={{ marginBottom: 16 }}>
          <AlertCircleIcon size={18} />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Product Table */}
      <div className={styles.tableContainer}>
        {isLoading && products.length === 0 ? (
          <div className={styles.emptyState}>
            <p className={styles.emptySubtitle}>Loading catalogue from database...</p>
          </div>
        ) : products.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyTitle}>
              {search ? 'No Matching Products' : 'No Products in Catalogue'}
            </div>
            <p className={styles.emptySubtitle}>
              {search
                ? `No products found matching "${search}". Try searching for another SKU or product name.`
                : 'Your catalogue is currently empty. Add your first product manually or import a bulk product CSV file.'}
            </p>
            <div className={styles.emptyActions}>
              {search ? (
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => setSearch('')}
                >
                  Clear Search
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={() => openFormModal()}
                  >
                    <PlusIcon size={16} />
                    <span>Add First Product</span>
                  </button>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => {
                      loadSampleCsv();
                      setIsCsvModalOpen(true);
                    }}
                  >
                    <UploadIcon size={16} />
                    <span>Import Sample CSV</span>
                  </button>
                </>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* Desktop Table View */}
            <div className={styles.desktopTableView}>
              <table className={styles.productTable}>
                <thead>
                  <tr>
                    <th style={{ width: 60 }}>Image</th>
                    <th>Product Name & Brand</th>
                    <th>SKU</th>
                    <th>Cost Price</th>
                    <th>Selling Price</th>
                    <th>Gross Margin</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((product) => {
                    const cost = product.costPrice || 0;
                    const selling = product.sellingPrice || 0;
                    const marginPercent =
                      selling > 0 ? Math.round(((selling - cost) / selling) * 1000) / 10 : 0;
                    const isHealthy = marginPercent >= 25;

                    return (
                      <tr key={product._id} className={styles.tableRow}>
                        <td>
                          <div className={styles.thumbnailWrapper}>
                            {product.imageUrl ? (
                              <>
                                <img
                                  src={product.imageUrl}
                                  alt={product.name}
                                  className={styles.thumbnailImg}
                                  onError={(e) => {
                                    e.currentTarget.style.display = 'none';
                                    if (e.currentTarget.nextSibling) {
                                      e.currentTarget.nextSibling.style.display = 'flex';
                                    }
                                  }}
                                />
                                <div
                                  className={styles.thumbnailPlaceholder}
                                  style={{ display: 'none' }}
                                >
                                  <ImageIcon size={18} />
                                </div>
                              </>
                            ) : (
                              <div className={styles.thumbnailPlaceholder}>
                                <ImageIcon size={18} />
                              </div>
                            )}
                          </div>
                        </td>

                        <td>
                          <div className={styles.nameCell}>
                            <div>
                              <div className={styles.productTitle}>{product.name}</div>
                              <div className={styles.productMeta}>
                                {product.brand ? `${product.brand} • ` : ''}
                                {product.category || 'General'}
                              </div>
                            </div>
                          </div>
                        </td>

                        <td>
                          <span className={styles.skuCode}>{formatSku(product.sku)}</span>
                        </td>

                        <td>
                          <span className={styles.monoPrice}>
                            ₹{cost.toLocaleString('en-IN')}
                          </span>
                        </td>

                        <td>
                          <span className={styles.monoPrice} style={{ fontWeight: 600 }}>
                            ₹{selling.toLocaleString('en-IN')}
                          </span>
                        </td>

                        <td>
                          <span
                            className={`
                              ${styles.marginBadge}
                              ${isHealthy ? styles.marginHealthy : styles.marginThin}
                            `}
                          >
                            {marginPercent}%
                          </span>
                        </td>

                        <td style={{ textAlign: 'right' }}>
                          <div
                            className={styles.actionButtonGroup}
                            style={{ justifyContent: 'flex-end', flexWrap: 'wrap', gap: 6 }}
                          >
                            <button
                              type="button"
                              className={styles.actionButton}
                              style={{
                                borderColor: 'var(--accent-primary)',
                                color: 'var(--accent-primary)',
                                fontWeight: 600,
                                backgroundColor: 'rgba(123, 60, 89, 0.05)'
                              }}
                              onClick={() => setDiscoveryProduct(product)}
                              title="Discover Competitors on Google Shopping"
                            >
                              <SearchIcon size={13} />
                              <span>Find Competitors</span>
                            </button>
                            <button
                              type="button"
                              className={styles.actionButton}
                              onClick={() => setViewCompetitorsProduct(product)}
                              title="View & manage tracked competitors"
                            >
                              <CompetitorIcon size={13} />
                              <span>Competitors</span>
                            </button>
                            <button
                              type="button"
                              className={styles.actionButton}
                              onClick={() => openFormModal(product)}
                              title="Edit Product"
                            >
                              <EditIcon size={13} />
                              <span>Edit</span>
                            </button>
                            <button
                              type="button"
                              className={styles.deleteButton}
                              onClick={() => setDeletingProduct(product)}
                              title="Delete Product"
                            >
                              <TrashIcon size={13} />
                              <span>Delete</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Responsive Flexbox Card View */}
            <div className={styles.mobileCardList}>
              {products.map((product) => {
                const cost = product.costPrice || 0;
                const selling = product.sellingPrice || 0;
                const marginPercent =
                  selling > 0 ? Math.round(((selling - cost) / selling) * 1000) / 10 : 0;
                const isHealthy = marginPercent >= 25;

                return (
                  <div key={product._id} className={styles.mobileCard}>
                    <div className={styles.mobileCardTop}>
                      <div className={styles.thumbnailWrapper}>
                        {product.imageUrl ? (
                          <>
                            <img
                              src={product.imageUrl}
                              alt={product.name}
                              className={styles.thumbnailImg}
                              onError={(e) => {
                                e.currentTarget.style.display = 'none';
                                if (e.currentTarget.nextSibling) {
                                  e.currentTarget.nextSibling.style.display = 'flex';
                                }
                              }}
                            />
                            <div
                              className={styles.thumbnailPlaceholder}
                              style={{ display: 'none' }}
                            >
                              <ImageIcon size={18} />
                            </div>
                          </>
                        ) : (
                          <div className={styles.thumbnailPlaceholder}>
                            <ImageIcon size={18} />
                          </div>
                        )}
                      </div>
                      <div className={styles.mobileCardInfo}>
                        <div className={styles.productTitle}>{product.name}</div>
                        <div className={styles.productMeta}>
                          {product.brand ? `${product.brand} • ` : ''}
                          {product.category || 'General'}
                        </div>
                      </div>
                      <span className={styles.skuCode}>{formatSku(product.sku)}</span>
                    </div>

                    <div className={styles.mobilePriceStrip}>
                      <div className={styles.priceStat}>
                        <span className={styles.statLabel}>Cost</span>
                        <span className={styles.statValue}>₹{cost.toLocaleString('en-IN')}</span>
                      </div>
                      <div className={styles.priceStat}>
                        <span className={styles.statLabel}>Selling</span>
                        <span className={styles.statValueHighlight}>₹{selling.toLocaleString('en-IN')}</span>
                      </div>
                      <div className={styles.priceStat}>
                        <span className={styles.statLabel}>Margin</span>
                        <span
                          className={`
                            ${styles.marginBadge}
                            ${isHealthy ? styles.marginHealthy : styles.marginThin}
                          `}
                        >
                          {marginPercent}%
                        </span>
                      </div>
                    </div>

                    <div className={styles.mobileActions}>
                      <button
                        type="button"
                        className={styles.mobilePrimaryAction}
                        onClick={() => setDiscoveryProduct(product)}
                      >
                        <SearchIcon size={14} />
                        <span>Find Competitors</span>
                      </button>
                      <button
                        type="button"
                        className={styles.mobileSecondaryAction}
                        onClick={() => setViewCompetitorsProduct(product)}
                      >
                        <CompetitorIcon size={14} />
                        <span>Competitors</span>
                      </button>
                      <button
                        type="button"
                        className={styles.mobileIconAction}
                        onClick={() => openFormModal(product)}
                        title="Edit Product"
                      >
                        <EditIcon size={14} />
                        <span>Edit</span>
                      </button>
                      <button
                        type="button"
                        className={styles.mobileDeleteAction}
                        onClick={() => setDeletingProduct(product)}
                        title="Delete Product"
                      >
                        <TrashIcon size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* ================= MODAL: ADD / EDIT PRODUCT ================= */}
      {isFormOpen && (
        <div className={styles.modalBackdrop} onClick={() => setIsFormOpen(false)}>
          <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>
                {editingProduct ? 'Edit Product' : 'Add New Product'}
              </h2>
              <button
                type="button"
                className={styles.modalCloseButton}
                onClick={() => setIsFormOpen(false)}
                aria-label="Close modal"
              >
                <CloseIcon size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveProduct}>
              <div className={styles.modalBody}>
                {formError && (
                  <div className={styles.errorBanner}>
                    <AlertCircleIcon size={16} />
                    <span>{formError}</span>
                  </div>
                )}

                <div className={styles.formGrid}>
                  <div className={styles.formGroup}>
                    <label className={styles.label}>Product SKU *</label>
                    <input
                      type="text"
                      className={`${styles.input} ${styles.inputMono}`}
                      placeholder="e.g. TSH-BLK-001"
                      value={formData.sku}
                      onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                      required
                    />
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.label}>Brand</label>
                    <input
                      type="text"
                      className={styles.input}
                      placeholder="e.g. UrbanFit"
                      value={formData.brand}
                      onChange={(e) => setFormData({ ...formData, brand: e.target.value })}
                    />
                  </div>

                  <div className={`${styles.formGroup} ${styles.fullWidth}`}>
                    <label className={styles.label}>Product Name *</label>
                    <input
                      type="text"
                      className={styles.input}
                      placeholder="e.g. Classic Heavyweight Cotton T-Shirt"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      required
                    />
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.label}>Cost Price (₹) *</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      className={`${styles.input} ${styles.inputMono}`}
                      placeholder="e.g. 450"
                      value={formData.costPrice}
                      onChange={(e) => setFormData({ ...formData, costPrice: e.target.value })}
                      required
                    />
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.label}>Selling Price (₹) *</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className={`${styles.input} ${styles.inputMono}`}
                      placeholder="e.g. 899"
                      value={formData.sellingPrice}
                      onChange={(e) => setFormData({ ...formData, sellingPrice: e.target.value })}
                      required
                    />
                  </div>

                  <div className={`${styles.formGroup} ${styles.fullWidth}`}>
                    <label className={styles.label}>Category</label>
                    <input
                      type="text"
                      className={styles.input}
                      placeholder="e.g. Apparel, Accessories, Electronics"
                      value={formData.category}
                      onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    />
                  </div>

                  <div className={`${styles.formGroup} ${styles.fullWidth}`}>
                    <label className={styles.label}>Product Image URL (Optional)</label>
                    <input
                      type="url"
                      className={styles.input}
                      placeholder="https://example.com/images/product.jpg"
                      value={formData.imageUrl}
                      onChange={(e) => setFormData({ ...formData, imageUrl: e.target.value })}
                    />

                    {formData.imageUrl && (
                      <div className={styles.imagePreviewRow}>
                        <div className={styles.thumbnailWrapper}>
                          <img
                            src={formData.imageUrl}
                            alt="Preview"
                            className={styles.thumbnailImg}
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                              if (e.currentTarget.nextSibling) {
                                e.currentTarget.nextSibling.style.display = 'flex';
                              }
                            }}
                          />
                          <div
                            className={styles.thumbnailPlaceholder}
                            style={{ display: 'none' }}
                          >
                            <ImageIcon size={16} />
                          </div>
                        </div>
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                          Image preview
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className={styles.modalFooter}>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => setIsFormOpen(false)}
                  disabled={isSaving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={styles.primaryButton}
                  disabled={isSaving}
                >
                  {isSaving ? 'Saving...' : editingProduct ? 'Update Product' : 'Create Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL: CSV IMPORT ================= */}
      {isCsvModalOpen && (
        <div className={styles.modalBackdrop} onClick={() => setIsCsvModalOpen(false)}>
          <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Import Products via CSV</h2>
              <button
                type="button"
                className={styles.modalCloseButton}
                onClick={() => setIsCsvModalOpen(false)}
                aria-label="Close modal"
              >
                <CloseIcon size={18} />
              </button>
            </div>

            <div className={styles.modalBody}>
              <div className={styles.csvHelperBar}>
                <span>Required columns: <code>sku, name, costPrice, sellingPrice</code></span>
                <button
                  type="button"
                  className={styles.textLinkButton}
                  onClick={loadSampleCsv}
                >
                  Load Sample CSV
                </button>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>Select CSV File</label>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFileUpload}
                  style={{ fontSize: 12.5 }}
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>Or Paste CSV Data Directly</label>
                <textarea
                  className={styles.csvTextarea}
                  placeholder={`sku,name,costPrice,sellingPrice,brand,category,imageUrl\nTSH-01,Classic Tee,350,799,Woodland,Apparel,https://...`}
                  value={csvText}
                  onChange={(e) => {
                    setCsvText(e.target.value);
                    setCsvResult(null);
                  }}
                />
              </div>

              {/* Import Results Banner */}
              {csvResult && (
                <div>
                  {csvResult.success ? (
                    <div className={styles.successBanner}>
                      <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <CheckCircleIcon size={16} />
                        <span>Import Completed</span>
                      </div>
                      <div style={{ marginTop: 4 }}>
                        Created: <strong>{csvResult.createdCount}</strong> • Updated:{' '}
                        <strong>{csvResult.updatedCount}</strong> • Failed rows:{' '}
                        <strong>{csvResult.failedCount || 0}</strong>
                      </div>
                    </div>
                  ) : (
                    <div className={styles.errorBanner}>
                      <AlertCircleIcon size={16} />
                      <span>{csvResult.message || 'CSV Import failed'}</span>
                    </div>
                  )}

                  {/* Row-level errors list */}
                  {csvResult.errors && csvResult.errors.length > 0 && (
                    <div className={styles.errorList}>
                      {csvResult.errors.map((err, idx) => (
                        <div key={idx} className={styles.errorListItem}>
                          • Row {err.row} {err.sku ? `(SKU: ${err.sku})` : ''}: {err.message}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className={styles.modalFooter}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => setIsCsvModalOpen(false)}
                disabled={isImporting}
              >
                Close
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={handleImportCsv}
                disabled={isImporting || !csvText.trim()}
              >
                <UploadIcon size={16} />
                <span>{isImporting ? 'Importing...' : 'Start Import'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL: DELETE CONFIRMATION ================= */}
      {deletingProduct && (
        <div className={styles.modalBackdrop} onClick={() => setDeletingProduct(null)}>
          <div
            className={styles.modalCard}
            style={{ maxWidth: 440 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Confirm Delete</h2>
              <button
                type="button"
                className={styles.modalCloseButton}
                onClick={() => setDeletingProduct(null)}
                aria-label="Close modal"
              >
                <CloseIcon size={18} />
              </button>
            </div>

            <div className={styles.modalBody}>
              <p style={{ fontSize: 13.5, color: 'var(--text-primary)', lineHeight: 1.5 }}>
                Are you sure you want to remove{' '}
                <strong>{deletingProduct.name}</strong> (SKU:{' '}
                <code>{deletingProduct.sku}</code>) from your catalogue?
              </p>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                This action cannot be undone.
              </p>
            </div>

            <div className={styles.modalFooter}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => setDeletingProduct(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.deleteButton}
                style={{
                  backgroundColor: 'var(--status-error)',
                  color: '#FFFFFF',
                  borderColor: 'var(--status-error)'
                }}
                onClick={handleDeleteProduct}
              >
                <TrashIcon size={14} />
                <span>Delete Product</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= COMPETITOR DISCOVERY MODAL ================= */}
      {discoveryProduct && (
        <CompetitorDiscoveryModal
          product={discoveryProduct}
          onClose={() => setDiscoveryProduct(null)}
          onCompetitorAdded={() => {
            fetchProducts(search);
          }}
        />
      )}

      {/* ================= COMPETITORS LIST / MANAGEMENT MODAL ================= */}
      {viewCompetitorsProduct && (
        <CompetitorsModal
          product={viewCompetitorsProduct}
          onClose={() => setViewCompetitorsProduct(null)}
          onOpenDiscovery={(p) => setDiscoveryProduct(p)}
          onOpenHistory={(comp) => setHistoryCompetitor(comp)}
        />
      )}

      {/* ================= PRICE OBSERVATIONS HISTORY MODAL ================= */}
      {historyCompetitor && (
        <PriceHistoryModal
          competitor={historyCompetitor}
          onClose={() => setHistoryCompetitor(null)}
        />
      )}
    </div>
  );
}
