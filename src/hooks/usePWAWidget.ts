import { useState, useEffect, useCallback } from 'react';

// ============================================================
// PWA Widget Manager — handles background sync, notifications,
// app badge, and widget installation
// ============================================================

interface WidgetStatus {
  periodicSyncSupported: boolean;
  notificationsSupported: boolean;
  badgeSupported: boolean;
  notificationsPermission: NotificationPermission;
  periodicSyncRegistered: boolean;
}

export function usePWAWidget() {
  const [status, setStatus] = useState<WidgetStatus>({
    periodicSyncSupported: false,
    notificationsSupported: false,
    badgeSupported: false,
    notificationsPermission: 'default',
    periodicSyncRegistered: false,
  });
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    const checkSupport = async () => {
      const swReg = await navigator.serviceWorker?.getRegistration?.().catch(() => undefined);

      const newStatus: WidgetStatus = {
        // v5.1 null-guard: getRegistration() returns undefined when no SW is
        // registered yet (first visit / SW blocked / non-secure context) —
        // `'periodicSync' in undefined` used to CRASH the page here.
        periodicSyncSupported: !!swReg && 'periodicSync' in swReg,
        // v6.2: guard the ACCESS too — iOS Safari < 16.4 and some webviews
        // have NO Notification constructor ('Notification' in window is
        // false, so reading Notification.permission below threw).
        notificationsSupported: 'Notification' in window,
        badgeSupported: 'setAppBadge' in navigator,
        notificationsPermission: 'Notification' in window ? Notification.permission : 'default',
        periodicSyncRegistered: false,
      };

      if (newStatus.periodicSyncSupported && swReg) {
        try {
          const tags = await (swReg as any).periodicSync.getTags();
          newStatus.periodicSyncRegistered = tags.includes('wealth-ai-price-sync');
        } catch { /* noop */ }
      }

      setStatus(newStatus);
    };

    checkSupport().catch(() => { /* v6.2: async env probing must never reject unhandled */ });

    // Listen for beforeinstallprompt
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstallPrompt(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  // Request notification permission
  const requestNotificationPermission = useCallback(async (): Promise<boolean> => {
    if (!('Notification' in window)) return false;
    const permission = await Notification.requestPermission();
    setStatus(prev => ({ ...prev, notificationsPermission: permission }));
    return permission === 'granted';
  }, []);

  // Register periodic background sync (Chrome/Android only)
  const registerPeriodicSync = useCallback(async (): Promise<boolean> => {
    if (!('serviceWorker' in navigator)) return false;
    try {
      const reg = await navigator.serviceWorker.ready;
      if (!('periodicSync' in reg)) return false;

      // Request background sync permission
      const status = await (navigator as any).permissions?.query({
        name: 'periodic-background-sync',
      });

      if (status?.state !== 'granted') {
        console.warn('[PWA] Periodic background sync permission not granted');
        return false;
      }

      // Register periodic sync — minimum interval is 1 min, we use 15 min
      await (reg as any).periodicSync.register('wealth-ai-price-sync', {
        minInterval: 15 * 60 * 1000, // 15 minutes
      });

      setStatus(prev => ({ ...prev, periodicSyncRegistered: true }));
      console.log('[PWA] Periodic background sync registered (every 15 min)');
      return true;
    } catch (e) {
      console.error('[PWA] Failed to register periodic sync:', e);
      return false;
    }
  }, []);

  // Set app icon badge with P&L %
  const setAppBadge = useCallback(async (plPct: number): Promise<void> => {
    if (!('setAppBadge' in navigator)) return;
    try {
      const badgeNum = Math.round(Math.abs(plPct));
      if (badgeNum > 0) {
        await (navigator as any).setAppBadge(badgeNum);
      } else {
        await (navigator as any).clearAppBadge();
      }
    } catch { /* noop */ }
  }, []);

  // Trigger immediate background sync (manual refresh)
  const triggerBackgroundSync = useCallback(async (): Promise<void> => {
    if (!('serviceWorker' in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      // Send message to SW to fetch prices now
      reg.active?.postMessage({ type: 'TRIGGER_PRICE_SYNC' });
    } catch { /* noop */ }
  }, []);

  // Install PWA prompt
  const installPWA = useCallback(async (): Promise<boolean> => {
    if (!deferredPrompt) return false;
    try {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      setDeferredPrompt(null);
      setShowInstallPrompt(false);
      return outcome === 'accepted';
    } catch {
      return false;
    }
  }, [deferredPrompt]);

  // Open widget page
  const openWidget = useCallback(() => {
    const token = localStorage.getItem('wealthai_session_token') || sessionStorage.getItem('wealthai_session_token');
    // FIX (audit M-3): pass the token via the URL FRAGMENT — fragments are not
    // sent to servers (no access-log/referrer leakage) and widget.html strips
    // it from the address bar immediately.
    const url = token ? `/widget.html#token=${encodeURIComponent(token)}` : '/widget.html';
    window.open(url, '_blank', 'width=400,height=600,noopener,noreferrer');
  }, []);

  // Setup everything (called after login)
  const setupWidget = useCallback(async (): Promise<{ notifications: boolean; sync: boolean }> => {
    const notifications = await requestNotificationPermission();
    const sync = await registerPeriodicSync();
    return { notifications, sync };
  }, [requestNotificationPermission, registerPeriodicSync]);

  return {
    status,
    showInstallPrompt,
    requestNotificationPermission,
    registerPeriodicSync,
    setAppBadge,
    triggerBackgroundSync,
    installPWA,
    openWidget,
    setupWidget,
  };
}
