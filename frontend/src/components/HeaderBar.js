'use client';

import React, { useState, useEffect } from 'react';
import styles from './HeaderBar.module.css';
import { MenuIcon, BellIcon } from './Icons';
import NotificationPanel from './NotificationPanel';
import { getApiBase } from '../utils/api';

export default function HeaderBar({ onToggleSidebar }) {
  const [dbConnected, setDbConnected] = useState(false);
  const [apiOnline, setApiOnline] = useState(false);
  const [aiOnline, setAiOnline] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  useEffect(() => {
    const apiBase = getApiBase();

    const checkLiveHealthAndUnread = async () => {
      try {
        const [healthRes, countRes, aiRes] = await Promise.allSettled([
          fetch(`${apiBase}/health`, { cache: 'no-store' }),
          fetch(`${apiBase}/notifications/unread-count`, { cache: 'no-store' }),
          fetch(`${apiBase}/ai/status`, { cache: 'no-store' })
        ]);

        if (healthRes.status === 'fulfilled' && healthRes.value.ok) {
          const data = await healthRes.value.json();
          setApiOnline(true);
          setDbConnected(data?.database?.status === 'connected');
        } else {
          setApiOnline(false);
          setDbConnected(false);
        }

        if (countRes.status === 'fulfilled' && countRes.value.ok) {
          const countData = await countRes.value.json();
          setUnreadCount(countData.unreadCount || 0);
        }

        if (aiRes.status === 'fulfilled' && aiRes.value.ok) {
          const aiData = await aiRes.value.json();
          setAiOnline(Boolean(aiData.enabled));
        } else {
          setAiOnline(false);
        }
      } catch (err) {
        setApiOnline(false);
        setDbConnected(false);
        setAiOnline(false);
      }
    };

    checkLiveHealthAndUnread();
    const interval = setInterval(checkLiveHealthAndUnread, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <>
      <header className={styles.headerBar}>
        <div className={styles.leftGroup}>
          <button
            type="button"
            className={styles.menuButton}
            onClick={onToggleSidebar}
            aria-label="Toggle navigation"
          >
            <MenuIcon size={18} />
          </button>
          <span className={styles.mobileBrand}>PricePilot</span>
        </div>

        <div className={styles.statusIndicatorGroup}>
          {/* Notification Bell with Unread Badge */}
          <button
            type="button"
            className={styles.bellButton}
            onClick={() => setIsPanelOpen(!isPanelOpen)}
            title="Price & Stock Alerts"
            aria-label="View price alerts"
          >
            <BellIcon size={17} />
            {unreadCount > 0 && (
              <span className={styles.bellBadge}>{unreadCount > 99 ? '99+' : unreadCount}</span>
            )}
          </button>

          <div className={styles.statusDotItem} title="Express Backend API Status">
            <span className={`${styles.dot} ${!apiOnline ? styles.dotOffline : ''}`} />
            <span>API {apiOnline ? 'Online' : 'Offline'}</span>
          </div>
          <div className={styles.statusDotItem} title="MongoDB Atlas Database Status">
            <span className={`${styles.dot} ${!dbConnected ? styles.dotOffline : ''}`} />
            <span>Atlas {dbConnected ? 'Connected' : 'Disconnected'}</span>
          </div>
          <div className={styles.statusDotItem} title="Google Gemini AI Integration">
            <span
              className={`${styles.dot} ${!aiOnline ? styles.dotOffline : ''}`}
              style={{ backgroundColor: aiOnline ? 'var(--accent-primary)' : undefined }}
            />
            <span>Gemini {aiOnline ? 'Active' : 'Offline'}</span>
          </div>
        </div>
      </header>

      {/* Floating In-App Notification Panel */}
      <NotificationPanel
        isOpen={isPanelOpen}
        onClose={() => setIsPanelOpen(false)}
        onUnreadCountChange={(count) => setUnreadCount(count)}
      />
    </>
  );
}
