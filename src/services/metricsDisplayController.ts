import { formatNum } from '../utils/formatters';
import { FRAME_BUDGET_MS } from '../utils/constants';

export interface PnLMetricsState {
  realizedPnL: number;
  unrealizedPnL: number;
  lifetimeRealized: number;
  lifetimeUnrealized: number;
  sessionNetTotal: number;
  instanceLifetimeNetTotal: number;
  pnlPerHour: number;
  lifetimePnlPerHour: number;
}

export interface FuturesBalanceMetricsState {
  availableBalance: number;
  totalMarginBalance: number;
  totalWalletBalance: number;
  totalUnrealizedProfit: number;
  marginRatioPc: number;
  healthStatus: 'SAFE' | 'WARNING' | 'CRITICAL';
}

export class MetricsDisplayController {
  // Cached DOM elements
  private bidEl: HTMLElement | null = null;
  private askEl: HTMLElement | null = null;
  private spreadEl: HTMLElement | null = null;
  private feedRateEl: HTMLElement | null = null;

  private sessionPnLEl: HTMLElement | null = null;
  private instanceTotalRealizedEl: HTMLElement | null = null;
  private unrealizedPnLEl: HTMLElement | null = null;
  private instanceTotalUnrealizedEl: HTMLElement | null = null;
  private sessionNetTotalEl: HTMLElement | null = null;
  private instanceTotalNetEl: HTMLElement | null = null;
  private pnlRateEl: HTMLElement | null = null;
  private lifetimePnlRateEl: HTMLElement | null = null;

  // Cached Futures Balance DOM elements
  private futuresAvailBalanceEl: HTMLElement | null = null;
  private futuresTotalBalanceEl: HTMLElement | null = null;
  private futuresMarginRatioEl: HTMLElement | null = null;
  private futuresHealthLedEl: HTMLElement | null = null;

  // Cached formatted strings for dirty checking
  private lastBidText = '';
  private lastAskText = '';
  private lastSpreadText = '';
  private lastFeedRateText = '';

  private lastSessionPnLText = '';
  private lastSessionPnLClass = '';
  private lastInstTotalRealizedText = '';
  private lastInstTotalRealizedClass = '';
  private lastUnrealizedText = '';
  private lastUnrealizedClass = '';
  private lastInstTotalUnrealizedText = '';
  private lastInstTotalUnrealizedClass = '';
  private lastSessionNetText = '';
  private lastSessionNetClass = '';
  private lastInstTotalNetText = '';
  private lastInstTotalNetClass = '';
  private lastPnlRateText = '';
  private lastPnlRateClass = '';
  private lastLifetimePnlRateText = '';
  private lastLifetimePnlRateClass = '';

  // Cached Balance strings
  private lastFuturesAvailText = '';
  private lastFuturesTotalText = '';
  private lastFuturesMarginRatioText = '';
  private lastFuturesMarginRatioColor = '';
  private lastFuturesHealthLedClass = '';

  // Pending State
  private pendingTicker = {
    bid: 0,
    ask: 0,
    hz: 0,
    decimals: 4,
    dirty: false,
  };

  private pendingPnL: (PnLMetricsState & { dirty: boolean }) = {
    realizedPnL: 0,
    unrealizedPnL: 0,
    lifetimeRealized: 0,
    lifetimeUnrealized: 0,
    sessionNetTotal: 0,
    instanceLifetimeNetTotal: 0,
    pnlPerHour: 0,
    lifetimePnlPerHour: 0,
    dirty: false,
  };

  private pendingBalance: (FuturesBalanceMetricsState & { dirty: boolean }) = {
    availableBalance: 0,
    totalMarginBalance: 0,
    totalWalletBalance: 0,
    totalUnrealizedProfit: 0,
    marginRatioPc: 0,
    healthStatus: 'SAFE',
    dirty: false,
  };

  private timerId: number | null = null;
  private intervalMs: number;

  constructor(intervalMs: number = FRAME_BUDGET_MS) {
    this.intervalMs = intervalMs;
  }

  public init(): void {
    this.cacheElements();
    this.start();
  }

  public cacheElements(): void {
    this.bidEl = document.getElementById('bid-val');
    this.askEl = document.getElementById('ask-val');
    this.spreadEl = document.getElementById('spread-val');
    this.feedRateEl = document.getElementById('feed-rate-val');

    this.sessionPnLEl = document.getElementById('session-pnl-val');
    this.instanceTotalRealizedEl = document.getElementById('instance-total-realized-val');
    this.unrealizedPnLEl = document.getElementById('unrealized-pnl-val');
    this.instanceTotalUnrealizedEl = document.getElementById('instance-total-unrealized-val');
    this.sessionNetTotalEl = document.getElementById('session-net-total-val');
    this.instanceTotalNetEl = document.getElementById('instance-total-net-val');
    this.pnlRateEl = document.getElementById('pnl-rate-val');
    this.lifetimePnlRateEl = document.getElementById('lifetime-pnl-rate-val');

    this.futuresAvailBalanceEl = document.getElementById('futures-avail-balance-val');
    this.futuresTotalBalanceEl = document.getElementById('futures-total-balance-val');
    this.futuresMarginRatioEl = document.getElementById('futures-margin-ratio-val');
    this.futuresHealthLedEl = document.getElementById('futures-health-led');
  }

  public setBalanceState(state: FuturesBalanceMetricsState): void {
    this.pendingBalance.availableBalance = state.availableBalance;
    this.pendingBalance.totalMarginBalance = state.totalMarginBalance;
    this.pendingBalance.totalWalletBalance = state.totalWalletBalance;
    this.pendingBalance.totalUnrealizedProfit = state.totalUnrealizedProfit;
    this.pendingBalance.marginRatioPc = state.marginRatioPc;
    this.pendingBalance.healthStatus = state.healthStatus;
    this.pendingBalance.dirty = true;
  }


  public setTicker(bid: number, ask: number, hz: number, decimals: number): void {
    this.pendingTicker.bid = bid;
    this.pendingTicker.ask = ask;
    this.pendingTicker.hz = hz;
    this.pendingTicker.decimals = decimals;
    this.pendingTicker.dirty = true;
  }

  public setPnLState(state: PnLMetricsState): void {
    this.pendingPnL.realizedPnL = state.realizedPnL;
    this.pendingPnL.unrealizedPnL = state.unrealizedPnL;
    this.pendingPnL.lifetimeRealized = state.lifetimeRealized;
    this.pendingPnL.lifetimeUnrealized = state.lifetimeUnrealized;
    this.pendingPnL.sessionNetTotal = state.sessionNetTotal;
    this.pendingPnL.instanceLifetimeNetTotal = state.instanceLifetimeNetTotal;
    this.pendingPnL.pnlPerHour = state.pnlPerHour;
    this.pendingPnL.lifetimePnlPerHour = state.lifetimePnlPerHour;
    this.pendingPnL.dirty = true;
  }

  public start(): void {
    if (this.timerId !== null) return;
    this.timerId = window.setInterval(() => {
      this.flush();
    }, this.intervalMs);
  }

  public stop(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  public flush(): void {
    this.flushTicker();
    this.flushPnL();
    this.flushBalance();
  }

  private flushBalance(): void {
    if (!this.pendingBalance.dirty) return;
    this.pendingBalance.dirty = false;

    if (!this.futuresAvailBalanceEl) this.cacheElements();

    const b = this.pendingBalance;

    // 1. Available / Free Margin
    const availText = `$${b.availableBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (availText !== this.lastFuturesAvailText && this.futuresAvailBalanceEl) {
      this.futuresAvailBalanceEl.textContent = availText;
      this.lastFuturesAvailText = availText;
    }

    // 2. Total Margin Balance / Total Equity
    const totalText = `$${b.totalMarginBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (totalText !== this.lastFuturesTotalText && this.futuresTotalBalanceEl) {
      this.futuresTotalBalanceEl.textContent = totalText;
      this.lastFuturesTotalText = totalText;
    }

    // 3. Margin Ratio %
    const mrText = `MR: ${b.marginRatioPc.toFixed(2)}%`;
    const mrColor = b.healthStatus === 'CRITICAL' ? '#ef4444' : b.healthStatus === 'WARNING' ? '#f59e0b' : '#10b981';
    if (mrText !== this.lastFuturesMarginRatioText && this.futuresMarginRatioEl) {
      this.futuresMarginRatioEl.textContent = mrText;
      this.lastFuturesMarginRatioText = mrText;
    }
    if (mrColor !== this.lastFuturesMarginRatioColor && this.futuresMarginRatioEl) {
      this.futuresMarginRatioEl.style.color = mrColor;
      this.lastFuturesMarginRatioColor = mrColor;
    }

    // 4. Health LED
    const ledClass = 'led ' + (b.healthStatus === 'CRITICAL' ? 'led-red' : b.healthStatus === 'WARNING' ? 'led-yellow' : 'led-green');
    if (ledClass !== this.lastFuturesHealthLedClass && this.futuresHealthLedEl) {
      this.futuresHealthLedEl.className = ledClass;
      this.lastFuturesHealthLedClass = ledClass;
    }
  }

  private flushTicker(): void {
    if (!this.pendingTicker.dirty) return;
    this.pendingTicker.dirty = false;

    // Check if elements need refreshing
    if (!this.bidEl) this.cacheElements();

    const { bid, ask, hz, decimals } = this.pendingTicker;
    const spread = ask > 0 && bid > 0 ? ask - bid : 0;

    // Feed Rate
    const hzText = `${hz} Hz`;
    if (hzText !== this.lastFeedRateText && this.feedRateEl) {
      this.feedRateEl.textContent = hzText;
      this.lastFeedRateText = hzText;
    }

    // Bid
    const bidText = formatNum(bid, decimals);
    if (bidText !== this.lastBidText && this.bidEl) {
      this.bidEl.textContent = bidText;
      this.lastBidText = bidText;
    }

    // Ask
    const askText = formatNum(ask, decimals);
    if (askText !== this.lastAskText && this.askEl) {
      this.askEl.textContent = askText;
      this.lastAskText = askText;
    }

    // Spread
    const spreadText = formatNum(spread, decimals);
    if (spreadText !== this.lastSpreadText && this.spreadEl) {
      this.spreadEl.textContent = spreadText;
      this.lastSpreadText = spreadText;
    }
  }

  private flushPnL(): void {
    if (!this.pendingPnL.dirty) return;
    this.pendingPnL.dirty = false;

    if (!this.sessionPnLEl) this.cacheElements();

    const p = this.pendingPnL;

    // 1. Session Realized PnL
    const sSign = p.realizedPnL > 0 ? '+' : '';
    const sText = `$${sSign}${p.realizedPnL.toFixed(4)}`;
    const sClass = 'card-price val-primary ' + (p.realizedPnL > 0 ? 'pnl-positive' : p.realizedPnL < 0 ? 'pnl-negative' : 'pnl-neutral');
    if (sText !== this.lastSessionPnLText && this.sessionPnLEl) {
      this.sessionPnLEl.textContent = sText;
      this.lastSessionPnLText = sText;
    }
    if (sClass !== this.lastSessionPnLClass && this.sessionPnLEl) {
      this.sessionPnLEl.className = sClass;
      this.lastSessionPnLClass = sClass;
    }

    // 2. Instance Lifetime Realized PnL
    const lSign = p.lifetimeRealized > 0 ? '+' : '';
    const lText = `$${lSign}${p.lifetimeRealized.toFixed(4)}`;
    const lClass = 'val-secondary ' + (p.lifetimeRealized > 0 ? 'pnl-positive' : p.lifetimeRealized < 0 ? 'pnl-negative' : 'pnl-neutral');
    if (lText !== this.lastInstTotalRealizedText && this.instanceTotalRealizedEl) {
      this.instanceTotalRealizedEl.textContent = lText;
      this.lastInstTotalRealizedText = lText;
    }
    if (lClass !== this.lastInstTotalRealizedClass && this.instanceTotalRealizedEl) {
      this.instanceTotalRealizedEl.className = lClass;
      this.lastInstTotalRealizedClass = lClass;
    }

    // 3. Unrealized PnL
    const uSign = p.unrealizedPnL > 0 ? '+' : '';
    const uText = `$${uSign}${p.unrealizedPnL.toFixed(4)}`;
    const uClass = 'card-price val-primary ' + (p.unrealizedPnL > 0 ? 'pnl-positive' : p.unrealizedPnL < 0 ? 'pnl-negative' : 'pnl-neutral');
    if (uText !== this.lastUnrealizedText && this.unrealizedPnLEl) {
      this.unrealizedPnLEl.textContent = uText;
      this.lastUnrealizedText = uText;
    }
    if (uClass !== this.lastUnrealizedClass && this.unrealizedPnLEl) {
      this.unrealizedPnLEl.className = uClass;
      this.lastUnrealizedClass = uClass;
    }

    // 4. Instance Total Unrealized
    const tuSign = p.lifetimeUnrealized > 0 ? '+' : '';
    const tuText = `$${tuSign}${p.lifetimeUnrealized.toFixed(4)}`;
    const tuClass = 'val-secondary ' + (p.lifetimeUnrealized > 0 ? 'pnl-positive' : p.lifetimeUnrealized < 0 ? 'pnl-negative' : 'pnl-neutral');
    if (tuText !== this.lastInstTotalUnrealizedText && this.instanceTotalUnrealizedEl) {
      this.instanceTotalUnrealizedEl.textContent = tuText;
      this.lastInstTotalUnrealizedText = tuText;
    }
    if (tuClass !== this.lastInstTotalUnrealizedClass && this.instanceTotalUnrealizedEl) {
      this.instanceTotalUnrealizedEl.className = tuClass;
      this.lastInstTotalUnrealizedClass = tuClass;
    }

    // 5. Session Net Total
    const snSign = p.sessionNetTotal > 0 ? '+' : '';
    const snText = `$${snSign}${p.sessionNetTotal.toFixed(4)}`;
    const snClass = 'card-price val-primary ' + (p.sessionNetTotal > 0 ? 'pnl-positive' : p.sessionNetTotal < 0 ? 'pnl-negative' : 'pnl-neutral');
    if (snText !== this.lastSessionNetText && this.sessionNetTotalEl) {
      this.sessionNetTotalEl.textContent = snText;
      this.lastSessionNetText = snText;
    }
    if (snClass !== this.lastSessionNetClass && this.sessionNetTotalEl) {
      this.sessionNetTotalEl.className = snClass;
      this.lastSessionNetClass = snClass;
    }

    // 6. Instance Lifetime Net Total
    const inSign = p.instanceLifetimeNetTotal > 0 ? '+' : '';
    const inText = `$${inSign}${p.instanceLifetimeNetTotal.toFixed(4)}`;
    const inClass = 'val-secondary ' + (p.instanceLifetimeNetTotal > 0 ? 'pnl-positive' : p.instanceLifetimeNetTotal < 0 ? 'pnl-negative' : 'pnl-neutral');
    if (inText !== this.lastInstTotalNetText && this.instanceTotalNetEl) {
      this.instanceTotalNetEl.textContent = inText;
      this.lastInstTotalNetText = inText;
    }
    if (inClass !== this.lastInstTotalNetClass && this.instanceTotalNetEl) {
      this.instanceTotalNetEl.className = inClass;
      this.lastInstTotalNetClass = inClass;
    }

    // 7. PnL / Hour
    const rateSign = p.pnlPerHour > 0 ? '+' : '';
    const rateText = `$${rateSign}${p.pnlPerHour.toFixed(4)} /h`;
    const rateClass = 'card-price val-primary ' + (p.pnlPerHour > 0 ? 'pnl-positive' : p.pnlPerHour < 0 ? 'pnl-negative' : 'pnl-neutral');
    if (rateText !== this.lastPnlRateText && this.pnlRateEl) {
      this.pnlRateEl.textContent = rateText;
      this.lastPnlRateText = rateText;
    }
    if (rateClass !== this.lastPnlRateClass && this.pnlRateEl) {
      this.pnlRateEl.className = rateClass;
      this.lastPnlRateClass = rateClass;
    }

    // 8. Lifetime PnL / Hour
    if (this.lifetimePnlRateEl) {
      const lRateSign = p.lifetimePnlPerHour > 0 ? '+' : '';
      const lRateText = `$${lRateSign}${p.lifetimePnlPerHour.toFixed(4)} /h`;
      const lRateClass = 'val-secondary ' + (p.lifetimePnlPerHour > 0 ? 'pnl-positive' : p.lifetimePnlPerHour < 0 ? 'pnl-negative' : 'pnl-neutral');
      if (lRateText !== this.lastLifetimePnlRateText) {
        this.lifetimePnlRateEl.textContent = lRateText;
        this.lastLifetimePnlRateText = lRateText;
      }
      if (lRateClass !== this.lastLifetimePnlRateClass) {
        this.lifetimePnlRateEl.className = lRateClass;
        this.lastLifetimePnlRateClass = lRateClass;
      }
    }
  }
}

export const metricsDisplayController = new MetricsDisplayController(FRAME_BUDGET_MS);
