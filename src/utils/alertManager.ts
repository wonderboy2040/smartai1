// Intelligent Alert System
// ML-based anomaly detection, technical pattern alerts, smart money tracking

interface Alert {
  id: string;
  symbol: string;
  type: AlertType;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  timestamp: number;
  read: boolean;
}

type AlertType =
  | 'price_spike'
  | 'price_dump'
  | 'volume_anomaly'
  | 'rsi_extreme'
  | 'macd_crossover'
  | 'support_break'
  | 'resistance_break'
  | 'golden_cross'
  | 'death_cross'
  | 'news_driven'
  | 'smart_money';

export class AlertManager {
  private alerts: Alert[] = [];
  private maxAlerts = 50;
  private listeners: Set<(alerts: Alert[]) => void> = new Set();

  /**
   * Process price data and generate alerts
   */
  processPriceData(
    symbol: string,
    priceData: any,
    prevPriceData?: any
  ): Alert | null {
    const alerts: Alert[] = [];

    // Price spike detection (>5% in single period)
    if (priceData?.change > 5) {
      alerts.push({
        id: this.generateId(),
        symbol,
        type: 'price_spike',
        message: `${symbol} spiked +${priceData.change.toFixed(1)}% — major bullish move`,
        severity: 'warning',
        timestamp: Date.now(),
        read: false
      });
    } else if (priceData?.change < -5) {
      alerts.push({
        id: this.generateId(),
        symbol,
        type: 'price_dump',
        message: `${symbol} dropped ${priceData.change.toFixed(1)}% — panic selling`,
        severity: 'critical',
        timestamp: Date.now(),
        read: false
      });
    }

    // RSI extreme alerts
    if (priceData?.rsi >= 80) {
      alerts.push({
        id: this.generateId(),
        symbol,
        type: 'rsi_extreme',
        message: `${symbol} RSI ${priceData.rsi.toFixed(0)} — extremely overbought, reversal likely`,
        severity: 'warning',
        timestamp: Date.now(),
        read: false
      });
    } else if (priceData?.rsi <= 20) {
      alerts.push({
        id: this.generateId(),
        symbol,
        type: 'rsi_extreme',
        message: `${symbol} RSI ${priceData.rsi.toFixed(0)} — extremely oversold, bounce potential`,
        severity: 'warning',
        timestamp: Date.now(),
        read: false
      });
    }

    // MACD crossover detection
    if (priceData?.macd !== undefined && prevPriceData?.macd !== undefined) {
      const prevMacd = prevPriceData.macd;
      const currMacd = priceData.macd;

      if (prevMacd <= 0 && currMacd > 0) {
        alerts.push({
          id: this.generateId(),
          symbol,
          type: 'macd_crossover',
          message: `${symbol} MACD bullish crossover — momentum shifting up`,
          severity: 'info',
          timestamp: Date.now(),
          read: false
        });
      } else if (prevMacd >= 0 && currMacd < 0) {
        alerts.push({
          id: this.generateId(),
          symbol,
          type: 'macd_crossover',
          message: `${symbol} MACD bearish crossover — momentum weakening`,
          severity: 'warning',
          timestamp: Date.now(),
          read: false
        });
      }
    }

    // Golden/Death Cross (SMA20 vs SMA50)
    if (priceData?.sma20 && priceData?.sma50 && prevPriceData?.sma20 && prevPriceData?.sma50) {
      if (prevPriceData.sma20 <= prevPriceData.sma50 && priceData.sma20 > priceData.sma50) {
        alerts.push({
          id: this.generateId(),
          symbol,
          type: 'golden_cross',
          message: `${symbol} Golden Cross active — SMA20 crossed above SMA50, strong buy signal`,
          severity: 'info',
          timestamp: Date.now(),
          read: false
        });
      } else if (prevPriceData.sma20 >= prevPriceData.sma50 && priceData.sma20 < priceData.sma50) {
        alerts.push({
          id: this.generateId(),
          symbol,
          type: 'death_cross',
          message: `${symbol} Death Cross forming — SMA20 crossed below SMA50, caution`,
          severity: 'critical',
          timestamp: Date.now(),
          read: false
        });
      }
    }

    // Volume anomaly (sudden high volume)
    if (priceData?.volume && prevPriceData?.volume) {
      const volumeRatio = priceData.volume / prevPriceData.volume;
      if (volumeRatio > 5 && priceData.change > 3) {
        alerts.push({
          id: this.generateId(),
          symbol,
          type: 'volume_anomaly',
          message: `${symbol} 5x volume surge (${(priceData.volume / 1000000).toFixed(1)}M) — institutional activity detected`,
          severity: 'warning',
          timestamp: Date.now(),
          read: false
        });
      }
    }

    // Add alerts to store
    for (const alert of alerts) {
      this.alerts.unshift(alert);
      if (this.alerts.length > this.maxAlerts) this.alerts.pop();
    }

    if (alerts.length > 0) {
      this.notifyListeners();
      return alerts[0];
    }

    return null;
  }

  /**
   * Get all alerts
   */
  getAlerts(unreadOnly: boolean = false): Alert[] {
    return unreadOnly ? this.alerts.filter(a => !a.read) : this.alerts;
  }

  /**
   * Mark alert as read
   */
  markAsRead(id: string): void {
    const alert = this.alerts.find(a => a.id === id);
    if (alert) {
      alert.read = true;
      this.notifyListeners();
    }
  }

  /**
   * Clear all alerts
   */
  clearAlerts(): void {
    this.alerts = [];
    this.notifyListeners();
  }

  /**
   * Subscribe to alert changes
   */
  subscribe(listener: (alerts: Alert[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener([...this.alerts]);
    }
  }

  private generateId(): string {
    return `alert_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  }
}

// ========================================
// SMART MONEY TRACKER
// ========================================

export interface SmartMoneySignal {
  symbol: string;
  type: 'accumulation' | 'distribution' | 'large_block';
  volume: number;
  price: number;
  confidence: number;
  timestamp: number;
}

export function detectSmartMoney(
  symbol: string,
  currentVolume: number,
  currentChange: number,
  avgVolume: number = 1000000
): SmartMoneySignal | null {
  const volumeRatio = currentVolume / avgVolume;

  // High volume + small price move = smart money positioning
  if (volumeRatio > 3 && Math.abs(currentChange) < 2) {
    return {
      symbol,
      type: currentChange > 0 ? 'accumulation' : 'distribution',
      volume: currentVolume,
      price: 0,
      confidence: Math.min(95, Math.round(volumeRatio * 15)),
      timestamp: Date.now()
    };
  }

  // Extremely high volume = likely large block trade
  if (volumeRatio > 10 && currentVolume > 10000000) {
    return {
      symbol,
      type: 'large_block',
      volume: currentVolume,
      price: 0,
      confidence: Math.min(99, Math.round(60 + volumeRatio * 3)),
      timestamp: Date.now()
    };
  }

  return null;
}
