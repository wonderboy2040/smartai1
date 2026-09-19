import { useState } from 'react';
import { usePWAWidget } from '../hooks/usePWAWidget';

// ============================================================
// WIDGET SETUP PANEL — enables background price monitoring,
// push notifications, and app icon badge for the PWA widget
// ============================================================

export function WidgetSetup() {
  const { status, setupWidget, installPWA, openWidget, triggerBackgroundSync, setAppBadge } = usePWAWidget();
  const [setupDone, setSetupDone] = useState(false);
  const [settingUp, setSettingUp] = useState(false);
  const [showPanel, setShowPanel] = useState(false);

  const handleSetup = async () => {
    setSettingUp(true);
    const result = await setupWidget();
    setSetupDone(true);
    setSettingUp(false);
    if (result.notifications && result.sync) {
      alert('✅ Widget enabled! You will receive live price updates on your home screen every 15 minutes.');
    } else if (result.notifications) {
      alert('✅ Notifications enabled. Periodic background sync is not supported on this browser (iOS/Safari). You can still use the Live Widget button.');
    } else {
      alert('⚠️ Notifications were blocked. Please enable them in your browser settings to receive price updates.');
    }
  };

  const handleTestBadge = async () => {
    await setAppBadge(9);
    setTimeout(() => setAppBadge(0), 5000);
    alert('Badge test: Check your app icon — it should show "9" for 5 seconds.');
  };

  if (!showPanel) {
    return (
      <button
        onClick={() => setShowPanel(true)}
        className="quantum-btn-ghost px-3 py-2 rounded-xl text-xs font-bold text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/10 transition-all flex items-center gap-1.5"
      >
        📱 Widget
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setShowPanel(false)}>
      <div className="quantum-modal rounded-2xl p-5 shadow-2xl border border-cyan-500/30 max-w-md w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-black text-white flex items-center gap-2">
            📱 Home Screen Widget
          </h2>
          <button onClick={() => setShowPanel(false)} className="text-slate-400 hover:text-white text-xl">×</button>
        </div>

        <div className="space-y-4">
          {/* Feature explanation */}
          <div className="bg-slate-900/60 rounded-xl p-3 border border-slate-700/50">
            <p className="text-xs text-slate-300 leading-relaxed">
              Enable a live price widget on your home screen that shows your portfolio's India, US & Crypto prices
              <strong className="text-cyan-400"> without opening the app</strong>. You'll get:
            </p>
            <ul className="text-xs text-slate-400 mt-2 space-y-1">
              <li className="flex items-center gap-2"><span className="text-green-400">✓</span> Price updates every 15 minutes (background)</li>
              <li className="flex items-center gap-2"><span className="text-green-400">✓</span> Push notifications with P&L summary</li>
              <li className="flex items-center gap-2"><span className="text-green-400">✓</span> App icon badge showing today's P&L %</li>
              <li className="flex items-center gap-2"><span className="text-green-400">✓</span> Compact live widget page</li>
            </ul>
          </div>

          {/* Setup button */}
          {!setupDone ? (
            <button
              onClick={handleSetup}
              disabled={settingUp}
              className="w-full quantum-btn-primary px-4 py-3 bg-gradient-to-r from-cyan-600 to-indigo-600 rounded-xl text-sm font-bold text-white disabled:opacity-50"
            >
              {settingUp ? '⏳ Setting up...' : '🚀 Enable Widget Features'}
            </button>
          ) : (
            <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-3">
              <p className="text-xs text-green-400 font-bold">✅ Widget features enabled!</p>
            </div>
          )}

          {/* Feature status */}
          {setupDone && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">📊 Live Widget</span>
                <button
                  onClick={openWidget}
                  className="px-3 py-1.5 bg-cyan-600/20 border border-cyan-500/30 rounded-lg text-cyan-400 font-bold hover:bg-cyan-600/30"
                >
                  Open Widget
                </button>
              </div>

              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">🔔 Notifications</span>
                <span className={status.notificationsPermission === 'granted' ? 'text-green-400' : 'text-red-400'}>
                  {status.notificationsPermission === 'granted' ? '✅ Enabled' : '❌ Blocked'}
                </span>
              </div>

              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">🔄 Background Sync (15 min)</span>
                <span className={status.periodicSyncRegistered ? 'text-green-400' : 'text-slate-500'}>
                  {status.periodicSyncRegistered ? '✅ Active' : status.periodicSyncSupported ? '⚠️ Not registered' : '❌ Not supported (iOS)'}
                </span>
              </div>

              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">🏷️ App Badge</span>
                <button
                  onClick={handleTestBadge}
                  disabled={!status.badgeSupported}
                  className="px-3 py-1.5 bg-purple-600/20 border border-purple-500/30 rounded-lg text-purple-400 font-bold hover:bg-purple-600/30 disabled:opacity-50"
                >
                  Test Badge
                </button>
              </div>
            </div>
          )}

          {/* Install PWA */}
          <div className="border-t border-slate-700/50 pt-3">
            <p className="text-xs text-slate-400 mb-2">Install the app for the best widget experience:</p>
            <button
              onClick={installPWA}
              className="w-full quantum-btn-primary px-4 py-2.5 bg-gradient-to-r from-green-600 to-emerald-600 rounded-xl text-sm font-bold text-white"
            >
              ⬇️ Install App on Home Screen
            </button>
          </div>

          {/* Manual refresh */}
          {setupDone && (
            <button
              onClick={triggerBackgroundSync}
              className="w-full quantum-btn-ghost px-4 py-2 rounded-xl text-xs font-bold text-slate-300 border border-slate-600/50 hover:bg-slate-700/30"
            >
              ↻ Refresh Prices Now
            </button>
          )}

          {/* iOS note */}
          {!status.periodicSyncSupported && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3">
              <p className="text-xs text-amber-400">
                📱 <strong>iOS Note:</strong> Background sync is not supported on iOS/Safari. You can still use the Live Widget — just keep it open in a tab or add it to your home screen as a separate shortcut.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default WidgetSetup;
