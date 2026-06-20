import { useEffect, useState } from 'react';

// ============================================================
// INSTALL PWA — "Add to Home Screen" prompt
// Listens for the browser's beforeinstallprompt event and shows
// a dismissible banner. On iOS (no beforeinstallprompt) it shows
// manual Share → Add to Home Screen instructions.
// ============================================================

export function InstallPWA() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [visible, setVisible] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    // Already installed (standalone)? Don't show.
    const standalone = window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true;
    if (standalone) return;

    // Respect a previous dismissal for ~7 days.
    const dismissed = Number(localStorage.getItem('pwa_install_dismissed') || 0);
    if (dismissed && Date.now() - dismissed < 7 * 24 * 60 * 60 * 1000) return;

    const ua = window.navigator.userAgent.toLowerCase();
    const ios = /iphone|ipad|ipod/.test(ua) && !(window as any).MSStream;
    if (ios) { setIsIOS(true); setVisible(true); return; }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setVisible(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const dismiss = () => {
    setVisible(false);
    localStorage.setItem('pwa_install_dismissed', String(Date.now()));
  };

  const install = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    try { await deferredPrompt.userChoice; } catch { }
    setDeferredPrompt(null);
    dismiss();
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-24 left-4 right-4 sm:left-auto sm:right-6 sm:w-80 z-[55] quantum-modal rounded-2xl p-4 shadow-2xl animate-fade-in-up border border-cyan-500/20">
      <div className="flex items-start gap-3">
        <div className="text-2xl">💎</div>
        <div className="flex-1">
          <div className="text-sm font-black text-white">Install Wealth AI</div>
          {isIOS ? (
            <p className="text-[11px] text-slate-400 mt-1">
              Tap <span className="text-cyan-400 font-bold">Share</span> →{' '}
              <span className="text-cyan-400 font-bold">Add to Home Screen</span> for the full-screen app.
            </p>
          ) : (
            <p className="text-[11px] text-slate-400 mt-1">
              Add to your home screen for instant access &amp; offline support.
            </p>
          )}
          <div className="flex gap-2 mt-3">
            {!isIOS && (
              <button onClick={install} className="quantum-btn-primary px-3 py-1.5 bg-gradient-to-r from-cyan-600 to-indigo-600 rounded-lg text-xs font-bold text-white">
                ⬇️ Install
              </button>
            )}
            <button onClick={dismiss} className="quantum-btn-ghost px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-400">
              Not now
            </button>
          </div>
        </div>
        <button onClick={dismiss} className="text-slate-500 hover:text-white text-lg leading-none">×</button>
      </div>
    </div>
  );
}

export default InstallPWA;
