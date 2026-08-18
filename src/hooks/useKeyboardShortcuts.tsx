import { useEffect } from 'react';

type KeyHandler = (event: KeyboardEvent) => void;
type KeyCombo = string; // e.g., 'ctrl+k', 'cmd+shift+p'

interface ShortcutConfig {
  key: KeyCombo;
  handler: KeyHandler;
  description: string;
  enabled?: boolean;
}

// Parse key combo string into components
function parseKeyCombo(combo: string): {
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
} {
  const parts = combo.toLowerCase().split('+');
  const key = parts[parts.length - 1];

  return {
    key,
    ctrl: parts.includes('ctrl'),
    shift: parts.includes('shift'),
    alt: parts.includes('alt'),
    meta: parts.includes('cmd') || parts.includes('meta')
  };
}

// Check if event matches key combo
function matchesCombo(event: KeyboardEvent, combo: string): boolean {
  const parsed = parseKeyCombo(combo);
  const eventKey = event.key.toLowerCase();

  return (
    eventKey === parsed.key &&
    event.ctrlKey === parsed.ctrl &&
    event.shiftKey === parsed.shift &&
    event.altKey === parsed.alt &&
    event.metaKey === parsed.meta
  );
}

// Global shortcuts registry
class ShortcutsRegistry {
  private shortcuts = new Map<string, ShortcutConfig>();
  private listener: ((e: KeyboardEvent) => void) | null = null;

  register(id: string, config: ShortcutConfig): void {
    this.shortcuts.set(id, config);
    this.updateListener();
  }

  unregister(id: string): void {
    this.shortcuts.delete(id);
    if (this.shortcuts.size === 0) {
      this.removeListener();
    }
  }

  private updateListener(): void {
    if (this.listener) {
      document.removeEventListener('keydown', this.listener);
    }

    this.listener = (event: KeyboardEvent) => {
      // Ignore if user is typing in input
      const target = event.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      // Check all registered shortcuts
      for (const [, config] of this.shortcuts.entries()) {
        if (config.enabled !== false && matchesCombo(event, config.key)) {
          event.preventDefault();
          config.handler(event);
          console.log(`[Shortcuts] Triggered: ${config.key} (${config.description})`);
          break;
        }
      }
    };

    document.addEventListener('keydown', this.listener);
  }

  private removeListener(): void {
    if (this.listener) {
      document.removeEventListener('keydown', this.listener);
      this.listener = null;
    }
  }

  getAll(): Array<{ id: string; config: ShortcutConfig }> {
    return Array.from(this.shortcuts.entries()).map(([id, config]) => ({
      id,
      config
    }));
  }

  clear(): void {
    this.shortcuts.clear();
    this.removeListener();
  }
}

// Global registry instance
export const shortcutsRegistry = new ShortcutsRegistry();

// React hook for keyboard shortcuts
export function useKeyboardShortcut(
  key: KeyCombo,
  handler: KeyHandler,
  description: string,
  enabled = true
): void {
  const id = `shortcut_${Math.random().toString(36).slice(2, 9)}`;

  useEffect(() => {
    shortcutsRegistry.register(id, { key, handler, description, enabled });

    return () => {
      shortcutsRegistry.unregister(id);
    };
  }, [key, handler, description, enabled, id]);
}

// React hook for multiple shortcuts
export function useKeyboardShortcuts(shortcuts: ShortcutConfig[]): void {
  const ids = shortcuts.map(() => `shortcut_${Math.random().toString(36).slice(2, 9)}`);

  useEffect(() => {
    shortcuts.forEach((config, i) => {
      shortcutsRegistry.register(ids[i], config);
    });

    return () => {
      ids.forEach(id => shortcutsRegistry.unregister(id));
    };
  }, [shortcuts]);
}

// Shortcuts help modal component
export const ShortcutsHelp: React.FC<{ isOpen: boolean; onClose: () => void }> = ({
  isOpen,
  onClose
}) => {
  const shortcuts = shortcutsRegistry.getAll();

  useKeyboardShortcut('escape', onClose, 'Close shortcuts help', isOpen);

  if (!isOpen) return null;

  // Group by category
  const grouped: Record<string, Array<{ key: string; description: string }>> = {
    Navigation: [],
    Actions: [],
    Other: []
  };

  shortcuts.forEach(({ config }) => {
    const category = config.key.includes('ctrl') || config.key.includes('cmd')
      ? 'Actions'
      : 'Navigation';

    grouped[category].push({
      key: config.key,
      description: config.description
    });
  });

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-slate-900 rounded-2xl border border-cyan-500/20 p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-white">Keyboard Shortcuts</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        {Object.entries(grouped).map(([category, items]) => (
          items.length > 0 && (
            <div key={category} className="mb-6">
              <h3 className="text-lg font-semibold text-cyan-400 mb-3">{category}</h3>
              <div className="space-y-2">
                {items.map(({ key, description }, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between py-2 px-3 bg-slate-800/50 rounded-lg"
                  >
                    <span className="text-slate-300">{description}</span>
                    <kbd className="px-3 py-1 text-xs font-mono bg-slate-700/50 text-cyan-400 rounded border border-slate-600">
                      {key.toUpperCase()}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          )
        ))}

        <p className="text-xs text-slate-500 text-center mt-6">
          Press <kbd className="px-2 py-1 bg-slate-800 rounded">ESC</kbd> to close
        </p>
      </div>
    </div>
  );
};

// Common shortcuts hook for the app
export function useAppShortcuts(callbacks: {
  openChat?: () => void;
  refresh?: () => void;
  openPortfolio?: () => void;
  openDashboard?: () => void;
  openPlanner?: () => void;
  toggleTheme?: () => void;
  showHelp?: () => void;
}) {
  const shortcuts: ShortcutConfig[] = [
    {
      key: 'ctrl+k',
      handler: () => callbacks.openChat?.(),
      description: 'Open Neural Chat',
      enabled: !!callbacks.openChat
    },
    {
      key: 'cmd+k',
      handler: () => callbacks.openChat?.(),
      description: 'Open Neural Chat (Mac)',
      enabled: !!callbacks.openChat
    },
    {
      key: 'ctrl+r',
      handler: (e) => {
        e.preventDefault();
        callbacks.refresh?.();
      },
      description: 'Refresh data',
      enabled: !!callbacks.refresh
    },
    {
      key: 'ctrl+p',
      handler: (e) => {
        e.preventDefault();
        callbacks.openPortfolio?.();
      },
      description: 'Go to Portfolio',
      enabled: !!callbacks.openPortfolio
    },
    {
      key: 'ctrl+d',
      handler: () => callbacks.openDashboard?.(),
      description: 'Go to Dashboard',
      enabled: !!callbacks.openDashboard
    },
    {
      key: 'ctrl+shift+p',
      handler: () => callbacks.openPlanner?.(),
      description: 'Go to Planner',
      enabled: !!callbacks.openPlanner
    },
    {
      key: 'ctrl+shift+t',
      handler: () => callbacks.toggleTheme?.(),
      description: 'Toggle theme',
      enabled: !!callbacks.toggleTheme
    },
    {
      key: 'shift+/',
      handler: () => callbacks.showHelp?.(),
      description: 'Show shortcuts help',
      enabled: !!callbacks.showHelp
    }
  ];

  useKeyboardShortcuts(shortcuts.filter(s => s.enabled));
}
