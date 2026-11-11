'use client';

import React, { useState, useEffect, useCallback } from 'react';
import styles from './NotificationPanel.module.css';
import {
  CloseIcon,
  BellIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  PackageIcon,
  CheckIcon,
  RefreshIcon
} from './Icons';
import { getApiBase } from '../utils/api';

function formatRelativeTime(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);

  if (diffSec < 60) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

export default function NotificationPanel({ isOpen, onClose, onUnreadCountChange }) {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [filter, setFilter] = useState('all'); // 'all' | 'unread'
  const [isLoading, setIsLoading] = useState(false);
  const [isMarkingAll, setIsMarkingAll] = useState(false);

  const apiBase = getApiBase();

  const fetchNotifications = useCallback(async () => {
    setIsLoading(true);
    try {
      const unreadParam = filter === 'unread' ? '&unreadOnly=true' : '';
      const res = await fetch(`${apiBase}/notifications?page=1&limit=50${unreadParam}`);
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
        setUnreadCount(data.unreadCount || 0);
        if (onUnreadCountChange) {
          onUnreadCountChange(data.unreadCount || 0);
        }
      }
    } catch (err) {
      console.warn('Failed to load notifications:', err.message);
    } finally {
      setIsLoading(false);
    }
  }, [apiBase, filter, onUnreadCountChange]);

  useEffect(() => {
    if (isOpen) {
      fetchNotifications();
    }
  }, [isOpen, fetchNotifications]);

  const handleMarkAsRead = async (id, e) => {
    if (e) e.stopPropagation();
    try {
      const res = await fetch(`${apiBase}/notifications/${id}/read`, {
        method: 'PATCH'
      });
      if (res.ok) {
        setNotifications((prev) =>
          prev.map((n) => (n._id === id ? { ...n, isRead: true } : n))
        );
        const newUnread = Math.max(unreadCount - 1, 0);
        setUnreadCount(newUnread);
        if (onUnreadCountChange) onUnreadCountChange(newUnread);
      }
    } catch (err) {
      console.warn('Failed to mark read:', err.message);
    }
  };

  const handleMarkAllAsRead = async () => {
    setIsMarkingAll(true);
    try {
      const res = await fetch(`${apiBase}/notifications/read-all`, {
        method: 'PATCH'
      });
      if (res.ok) {
        setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
        setUnreadCount(0);
        if (onUnreadCountChange) onUnreadCountChange(0);
      }
    } catch (err) {
      console.warn('Failed to mark all as read:', err.message);
    } finally {
      setIsMarkingAll(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className={styles.panelOverlay} onClick={onClose} role="dialog" aria-modal="true">
      <div className={styles.panelContainer} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerTitleRow}>
            <BellIcon size={18} color="#E27396" />
            <h2 className={styles.title}>Price & Stock Alerts</h2>
            {unreadCount > 0 && (
              <span className={styles.unreadBadge}>{unreadCount} new</span>
            )}
          </div>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close notification panel"
          >
            <CloseIcon size={18} />
          </button>
        </div>

        {/* Toolbar */}
        <div className={styles.toolbar}>
          <div className={styles.tabGroup}>
            <button
              type="button"
              className={`${styles.tabButton} ${filter === 'all' ? styles.tabButtonActive : ''}`}
              onClick={() => setFilter('all')}
            >
              All Alerts
            </button>
            <button
              type="button"
              className={`${styles.tabButton} ${filter === 'unread' ? styles.tabButtonActive : ''}`}
              onClick={() => setFilter('unread')}
            >
              Unread ({unreadCount})
            </button>
          </div>

          <button
            type="button"
            className={styles.markAllButton}
            onClick={handleMarkAllAsRead}
            disabled={unreadCount === 0 || isMarkingAll}
          >
            <CheckIcon size={12} style={{ marginRight: 4 }} />
            Mark all read
          </button>
        </div>

        {/* Notification List */}
        <div className={styles.notificationList}>
          {isLoading ? (
            <div className={styles.emptyState}>
              <RefreshIcon size={24} className={styles.emptyIcon} />
              <div className={styles.emptyTitle}>Checking alerts...</div>
            </div>
          ) : notifications.length === 0 ? (
            <div className={styles.emptyState}>
              <BellIcon size={32} className={styles.emptyIcon} />
              <div className={styles.emptyTitle}>
                {filter === 'unread' ? 'No unread alerts' : 'No price alerts yet'}
              </div>
              <div className={styles.emptyText}>
                Automated monitoring scans active competitors every 6 hours and flags price drops, increases, and stock changes.
              </div>
            </div>
          ) : (
            notifications.map((notif) => {
              const isDrop = notif.type === 'price_drop';
              const isIncrease = notif.type === 'price_increase';
              const isOos = notif.type === 'out_of_stock';
              const isRestock = notif.type === 'back_in_stock';

              return (
                <div
                  key={notif._id}
                  className={`${styles.notificationCard} ${!notif.isRead ? styles.notificationUnread : ''}`}
                >
                  <div className={styles.cardTopRow}>
                    {isDrop && (
                      <span className={`${styles.badge} ${styles.badgeDrop}`}>
                        <TrendingDownIcon size={12} />
                        Price Drop ({Math.abs(notif.changePercent)}%)
                      </span>
                    )}
                    {isIncrease && (
                      <span className={`${styles.badge} ${styles.badgeIncrease}`}>
                        <TrendingUpIcon size={12} />
                        Price Increase (+{notif.changePercent}%)
                      </span>
                    )}
                    {isOos && (
                      <span className={`${styles.badge} ${styles.badgeOos}`}>
                        <PackageIcon size={12} />
                        Out of Stock
                      </span>
                    )}
                    {isRestock && (
                      <span className={`${styles.badge} ${styles.badgeRestock}`}>
                        <PackageIcon size={12} />
                        Back in Stock
                      </span>
                    )}
                    <span className={styles.timeAgo}>{formatRelativeTime(notif.createdAt)}</span>
                  </div>

                  <div className={styles.productTitle}>
                    {notif.productId?.name || 'Catalogue Product'}
                  </div>

                  <div className={styles.merchantSubtitle}>
                    <span>Retailer:</span>
                    <strong>{notif.competitorId?.merchantName || 'Online Merchant'}</strong>
                    {notif.productId?.sku && (
                      <span style={{ color: '#8C7F86', fontSize: 11 }}>
                        • SKU: {notif.productId.sku}
                      </span>
                    )}
                  </div>

                  {(isDrop || isIncrease) && notif.previousPrice && notif.newPrice && (
                    <div className={styles.priceChangeRow}>
                      <span className={styles.oldPrice}>₹{notif.previousPrice.toLocaleString('en-IN')}</span>
                      <span>→</span>
                      <span className={styles.newPrice}>₹{notif.newPrice.toLocaleString('en-IN')}</span>
                      {isDrop && (
                        <span className={styles.percentDrop}>
                          (-₹{Math.abs(notif.changeAmount).toLocaleString('en-IN')})
                        </span>
                      )}
                      {isIncrease && (
                        <span className={styles.percentIncrease}>
                          (+₹{notif.changeAmount.toLocaleString('en-IN')})
                        </span>
                      )}
                    </div>
                  )}

                  {!notif.isRead && (
                    <div className={styles.cardActions}>
                      <button
                        type="button"
                        className={styles.markReadBtn}
                        onClick={(e) => handleMarkAsRead(notif._id, e)}
                      >
                        ✓ Mark read
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <div className={styles.footerNote}>
            <span className={styles.liveDot} />
            <span>Automated Monitoring Active</span>
          </div>
          <button
            type="button"
            className={styles.markReadBtn}
            onClick={fetchNotifications}
            title="Refresh alerts"
          >
            Refresh
          </button>
        </div>
      </div>
    </div>
  );
}

