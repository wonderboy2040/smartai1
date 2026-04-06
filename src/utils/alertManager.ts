// Intelligent Alert System
interface Alert {
  id: string;
  symbol: string;
  type: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  timestamp: number;
  read: boolean;
}

export class AlertManager {
  private alerts: Alert[] = [];
  private listeners: Set<(alerts: Alert[]) => void> = new Set();

  processPriceData(symbol: string, priceData: any, prevData?: any): Alert | null {
    const newAlerts: Alert[] = [];

    if (priceData?.change > 5) {
      newAlerts.push({
        id: this.id(), symbol, type: 'price_spike',
        message: `${symbol} spiked +${priceData.change.toFixed(1)}% — major bullish move`,
        severity: 'warning', timestamp: Date.now(), read: false
      });
    } else if (priceData?.change < -5) {
      newAlerts.push({
        id: this.id(), symbol, type: 'price_dump',
        message: `${symbol} dropped ${priceData.change.toFixed(1)}% — panic selling`,
        severity: 'critical', timestamp: Date.now(), read: false
      });
    }

    if (priceData?.rsi >= 80) {
      newAlerts.push({
        id: this.id(), symbol, type: 'rsi_extreme',
        message: `${symbol} RSI ${priceData.rsi.toFixed(0)} — extremely overbought`,
        severity: 'warning', timestamp: Date.now(), read: false
      });
    } else if (priceData?.rsi <= 20) {
      newAlerts.push({
        id: this.id(), symbol, type: 'rsi_extreme',
        message: `${symbol} RSI ${priceData.rsi.toFixed(0)} — extremely oversold`,
        severity: 'warning', timestamp: Date.now(), read: false
      });
    }

    if (priceData?.macd !== undefined && prevData?.macd !== undefined) {
      if (prevData.macd <= 0 && priceData.macd > 0) {
        newAlerts.push({
          id: this.id(), symbol, type: 'macd_crossover',
          message: `${symbol} MACD bullish crossover`,
          severity: 'info', timestamp: Date.now(), read: false
        });
      } else if (prevData.macd >= 0 && priceData.macd < 0) {
        newAlerts.push({
          id: this.id(), symbol, type: 'macd_crossover',
          message: `${symbol} MACD bearish crossover`,
          severity: 'warning', timestamp: Date.now(), read: false
        });
      }
    }

    if (priceData?.sma20 && priceData?.sma50 && prevData?.sma20 && prevData?.sma50) {
      if (prevData.sma20 <= prevData.sma50 && priceData.sma20 > priceData.sma50) {
        newAlerts.push({
          id: this.id(), symbol, type: 'golden_cross',
          message: `${symbol} Golden Cross — SMA20 > SMA50`,
          severity: 'info', timestamp: Date.now(), read: false
        });
      } else if (prevData.sma20 >= prevData.sma50 && priceData.sma20 < priceData.sma50) {
        newAlerts.push({
          id: this.id(), symbol, type: 'death_cross',
          message: `${symbol} Death Cross — SMA20 < SMA50`,
          severity: 'critical', timestamp: Date.now(), read: false
        });
      }
    }

    for (const a of newAlerts) this.alerts.unshift(a);
    if (this.alerts.length > 50) this.alerts.pop();
    if (newAlerts.length > 0) this.notify();
    return newAlerts.length > 0 ? newAlerts[0] : null;
  }

  getAlerts(unreadOnly = false): Alert[] {
    return unreadOnly ? this.alerts.filter(a => !a.read) : this.alerts;
  }
  markAsRead(id: string) {
    const a = this.alerts.find(x => x.id === id);
    if (a) { a.read = true; this.notify(); }
  }
  subscribe(fn: (alerts: Alert[]) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private notify() { this.listeners.forEach(fn => fn([...this.alerts])); }
  private id() { return `a_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }
}

export function detectSmartMoney(symbol: string, volume: number, change: number, avgVolume = 1000000) {
  const ratio = volume / avgVolume;
  if (ratio > 3 && Math.abs(change) < 2) {
    return { symbol, type: change > 0 ? 'accumulation' : 'distribution', volume, confidence: Math.min(95, Math.round(ratio * 15)) };
  }
  if (ratio > 10 && volume > 10000000) {
    return { symbol, type: 'large_block', volume, confidence: Math.min(99, Math.round(60 + ratio * 3)) };
  }
  return null;
}
