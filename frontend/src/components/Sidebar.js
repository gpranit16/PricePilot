'use client';

import React from 'react';
import styles from './Sidebar.module.css';
import { CatalogueIcon, CompetitorIcon, PricingIcon } from './Icons';

export default function Sidebar({ isOpen, onClose, activeTab = 'catalogue', onSelectTab }) {
  const handleNav = (tab) => {
    if (onSelectTab) onSelectTab(tab);
    if (onClose) onClose();
  };

  return (
    <aside
      className={`${styles.sidebar} ${isOpen ? styles.sidebarOpen : ''}`}
      aria-label="Main Navigation"
    >
      <div className={styles.brandArea}>
        <h1 className={styles.brandName}>PricePilot</h1>
      </div>

      <nav className={styles.navSection}>
        <button
          type="button"
          className={`${styles.navItem} ${activeTab === 'catalogue' ? styles.navItemActive : ''}`}
          onClick={() => handleNav('catalogue')}
          aria-current={activeTab === 'catalogue' ? 'page' : undefined}
        >
          <CatalogueIcon size={16} />
          <span>Product Catalogue</span>
        </button>

        <button
          type="button"
          className={`${styles.navItem} ${activeTab === 'competitors' ? styles.navItemActive : ''}`}
          onClick={() => handleNav('competitors')}
          aria-current={activeTab === 'competitors' ? 'page' : undefined}
        >
          <CompetitorIcon size={16} />
          <span>Competitor Tracking</span>
        </button>

        <button
          type="button"
          className={`${styles.navItem} ${activeTab === 'pricing' ? styles.navItemActive : ''}`}
          onClick={() => handleNav('pricing')}
          aria-current={activeTab === 'pricing' ? 'page' : undefined}
        >
          <PricingIcon size={16} />
          <span>Dynamic Repricing</span>
        </button>
      </nav>
    </aside>
  );
}
