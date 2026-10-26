'use client';

import React, { useState } from 'react';
import styles from './page.module.css';
import Sidebar from '../components/Sidebar';
import HeaderBar from '../components/HeaderBar';
import ProductCatalogue from '../components/ProductCatalogue';
import CompetitorTrackingView from '../components/CompetitorTrackingView';
import DynamicRepricingView from '../components/DynamicRepricingView';

export default function DashboardPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('catalogue');

  return (
    <div className={styles.appContainer}>
      {/* Compact Deep-Plum Sidebar */}
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        activeTab={activeTab}
        onSelectTab={(tab) => setActiveTab(tab)}
      />

      {/* Mobile Drawer Backdrop */}
      {sidebarOpen && (
        <div
          className={styles.backdrop}
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Main Content Area */}
      <div className={styles.mainWrapper}>
        {/* Minimalist Header with Mobile Toggle & Small Status Dots */}
        <HeaderBar onToggleSidebar={() => setSidebarOpen(!sidebarOpen)} />

        <main className={styles.contentCanvas}>
          {activeTab === 'catalogue' && <ProductCatalogue />}
          {activeTab === 'competitors' && <CompetitorTrackingView />}
          {activeTab === 'pricing' && <DynamicRepricingView />}
        </main>
      </div>
    </div>
  );
}
