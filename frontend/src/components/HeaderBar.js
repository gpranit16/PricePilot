'use client';

import React, { useState, useEffect } from 'react';
import styles from './HeaderBar.module.css';
import { MenuIcon } from './Icons';
import { getApiBase } from '../utils/api';

export default function HeaderBar({ onToggleSidebar }) {
  const [dbConnected, setDbConnected] = useState(false);
  const [apiOnline, setApiOnline] = useState(false);

  useEffect(() => {
    const apiBase = getApiBase();

    const checkLiveHealth = async () => {
      try {
        const res = await fetch(`${apiBase}/health`, { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          setApiOnline(true);
          setDbConnected(data?.database?.status === 'connected');
        } else {
          setApiOnline(false);
          setDbConnected(false);
        }
      } catch (err) {
        setApiOnline(false);
        setDbConnected(false);
      }
    };

    checkLiveHealth();
    const interval = setInterval(checkLiveHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
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
        <div className={styles.statusDotItem} title="Express Backend API Status">
          <span className={`${styles.dot} ${!apiOnline ? styles.dotOffline : ''}`} />
          <span>API {apiOnline ? 'Online' : 'Offline'}</span>
        </div>
        <div className={styles.statusDotItem} title="MongoDB Atlas Database Status">
          <span className={`${styles.dot} ${!dbConnected ? styles.dotOffline : ''}`} />
          <span>Atlas {dbConnected ? 'Connected' : 'Disconnected'}</span>
        </div>
      </div>
    </header>
  );
}
