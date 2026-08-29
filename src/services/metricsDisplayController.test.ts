import { MetricsDisplayController } from './metricsDisplayController';
import { FRAME_BUDGET_MS } from '../utils/constants';

export function runMetricsDisplayControllerVerification(): boolean {
  // Setup mock DOM elements
  const mockBidEl = document.createElement('div');
  mockBidEl.id = 'bid-val';
  document.body.appendChild(mockBidEl);

  const mockAskEl = document.createElement('div');
  mockAskEl.id = 'ask-val';
  document.body.appendChild(mockAskEl);

  const mockSpreadEl = document.createElement('div');
  mockSpreadEl.id = 'spread-val';
  document.body.appendChild(mockSpreadEl);

  const mockFeedRateEl = document.createElement('div');
  mockFeedRateEl.id = 'feed-rate-val';
  document.body.appendChild(mockFeedRateEl);

  const mockSessionPnLEl = document.createElement('div');
  mockSessionPnLEl.id = 'session-pnl-val';
  document.body.appendChild(mockSessionPnLEl);

  const mockAvailBalanceEl = document.createElement('div');
  mockAvailBalanceEl.id = 'futures-avail-balance-val';
  document.body.appendChild(mockAvailBalanceEl);

  const mockTotalBalanceEl = document.createElement('div');
  mockTotalBalanceEl.id = 'futures-total-balance-val';
  document.body.appendChild(mockTotalBalanceEl);

  const mockMarginRatioEl = document.createElement('div');
  mockMarginRatioEl.id = 'futures-margin-ratio-val';
  document.body.appendChild(mockMarginRatioEl);

  const mockHealthLedEl = document.createElement('div');
  mockHealthLedEl.id = 'futures-health-led';
  document.body.appendChild(mockHealthLedEl);

  const mockOvAvailBalanceEl = document.createElement('div');
  mockOvAvailBalanceEl.id = 'ov-futures-avail-balance-val';
  document.body.appendChild(mockOvAvailBalanceEl);

  const mockOvTotalBalanceEl = document.createElement('div');
  mockOvTotalBalanceEl.id = 'ov-futures-total-balance-val';
  document.body.appendChild(mockOvTotalBalanceEl);

  const mockOvMarginRatioEl = document.createElement('div');
  mockOvMarginRatioEl.id = 'ov-futures-margin-ratio-val';
  document.body.appendChild(mockOvMarginRatioEl);

  const mockOvHealthLedEl = document.createElement('div');
  mockOvHealthLedEl.id = 'ov-futures-health-led';
  document.body.appendChild(mockOvHealthLedEl);

  const controller = new MetricsDisplayController(FRAME_BUDGET_MS);


  try {
    controller.cacheElements();

    // 1. Initial State before flush
    controller.setTicker(0.002512, 0.002514, 45, 6);
    if ((mockBidEl.textContent as string) !== '') {
      throw new Error(`Expected DOM not to update immediately before flush, got '${mockBidEl.textContent}'`);
    }

    // 2. Manual flush updates DOM with formatted values
    controller.flush();
    if ((mockBidEl.textContent as string) !== '0.002512') {
      throw new Error(`Expected bid '0.002512', got '${mockBidEl.textContent}'`);
    }
    if ((mockAskEl.textContent as string) !== '0.002514') {
      throw new Error(`Expected ask '0.002514', got '${mockAskEl.textContent}'`);
    }
    if ((mockSpreadEl.textContent as string) !== '0.000002') {
      throw new Error(`Expected spread '0.000002', got '${mockSpreadEl.textContent}'`);
    }
    if ((mockFeedRateEl.textContent as string) !== '45 Hz') {
      throw new Error(`Expected '45 Hz', got '${mockFeedRateEl.textContent}'`);
    }

    // 3. Dirty checking: flush without changes shouldn't mutate DOM reference unnecessarily
    const prevBidText = mockBidEl.textContent as string;
    controller.flush();
    if ((mockBidEl.textContent as string) !== prevBidText) {
      throw new Error('Dirty check failed');
    }

    // 4. PnL State batching test
    controller.setPnLState({
      realizedPnL: 1.2345,
      unrealizedPnL: -0.5,
      lifetimeRealized: 10.5,
      lifetimeUnrealized: -0.5,
      sessionNetTotal: 0.7345,
      instanceLifetimeNetTotal: 10.0,
      pnlPerHour: 0.25,
      lifetimePnlPerHour: 1.1,
    });

    controller.flush();
    if ((mockSessionPnLEl.textContent as string) !== '+$1.2345') {
      throw new Error(`Expected session PnL '+$1.2345', got '${mockSessionPnLEl.textContent}'`);
    }
    if (!mockSessionPnLEl.className.includes('pnl-positive')) {
      throw new Error(`Expected positive class on PnL, got '${mockSessionPnLEl.className}'`);
    }

    // 5. Balance State and Health Indicator Test
    controller.setBalanceState({
      availableBalance: 850.5,
      totalMarginBalance: 1250.75,
      totalWalletBalance: 1240.0,
      totalUnrealizedProfit: 10.75,
      marginRatioPc: 2.34,
      healthStatus: 'SAFE',
    });

    controller.flush();
    if ((mockAvailBalanceEl.textContent as string) !== '$850.50') {
      throw new Error(`Expected available balance '$850.50', got '${mockAvailBalanceEl.textContent}'`);
    }
    if ((mockOvAvailBalanceEl.textContent as string) !== '$850.50') {
      throw new Error(`Expected Global Overview available balance '$850.50', got '${mockOvAvailBalanceEl.textContent}'`);
    }
    if ((mockTotalBalanceEl.textContent as string) !== '$1,250.75') {
      throw new Error(`Expected total margin balance '$1,250.75', got '${mockTotalBalanceEl.textContent}'`);
    }
    if ((mockOvTotalBalanceEl.textContent as string) !== '$1,250.75') {
      throw new Error(`Expected Global Overview total balance '$1,250.75', got '${mockOvTotalBalanceEl.textContent}'`);
    }
    if ((mockMarginRatioEl.textContent as string) !== 'MR: 2.34%') {
      throw new Error(`Expected margin ratio 'MR: 2.34%', got '${mockMarginRatioEl.textContent}'`);
    }
    if ((mockOvMarginRatioEl.textContent as string) !== 'MR: 2.34%') {
      throw new Error(`Expected Global Overview margin ratio 'MR: 2.34%', got '${mockOvMarginRatioEl.textContent}'`);
    }
    if (!mockHealthLedEl.className.includes('led-green') || !mockOvHealthLedEl.className.includes('led-green')) {
      throw new Error(`Expected safe health class 'led-green'`);
    }

    // 6. Critical Health Margin Ratio Test
    controller.setBalanceState({
      availableBalance: 50.0,
      totalMarginBalance: 500.0,
      totalWalletBalance: 600.0,
      totalUnrealizedProfit: -100.0,
      marginRatioPc: 85.5,
      healthStatus: 'CRITICAL',
    });
    controller.flush();
    if (!mockHealthLedEl.className.includes('led-red') || !mockOvHealthLedEl.className.includes('led-red')) {
      throw new Error(`Expected critical health class 'led-red'`);
    }

    return true;
  } finally {
    controller.stop();
    if (mockBidEl.parentNode) mockBidEl.parentNode.removeChild(mockBidEl);
    if (mockAskEl.parentNode) mockAskEl.parentNode.removeChild(mockAskEl);
    if (mockSpreadEl.parentNode) mockSpreadEl.parentNode.removeChild(mockSpreadEl);
    if (mockFeedRateEl.parentNode) mockFeedRateEl.parentNode.removeChild(mockFeedRateEl);
    if (mockSessionPnLEl.parentNode) mockSessionPnLEl.parentNode.removeChild(mockSessionPnLEl);
    if (mockAvailBalanceEl.parentNode) mockAvailBalanceEl.parentNode.removeChild(mockAvailBalanceEl);
    if (mockTotalBalanceEl.parentNode) mockTotalBalanceEl.parentNode.removeChild(mockTotalBalanceEl);
    if (mockMarginRatioEl.parentNode) mockMarginRatioEl.parentNode.removeChild(mockMarginRatioEl);
    if (mockHealthLedEl.parentNode) mockHealthLedEl.parentNode.removeChild(mockHealthLedEl);
    if (mockOvAvailBalanceEl.parentNode) mockOvAvailBalanceEl.parentNode.removeChild(mockOvAvailBalanceEl);
    if (mockOvTotalBalanceEl.parentNode) mockOvTotalBalanceEl.parentNode.removeChild(mockOvTotalBalanceEl);
    if (mockOvMarginRatioEl.parentNode) mockOvMarginRatioEl.parentNode.removeChild(mockOvMarginRatioEl);
    if (mockOvHealthLedEl.parentNode) mockOvHealthLedEl.parentNode.removeChild(mockOvHealthLedEl);
  }
}


