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

    return true;
  } finally {
    controller.stop();
    if (mockBidEl.parentNode) mockBidEl.parentNode.removeChild(mockBidEl);
    if (mockAskEl.parentNode) mockAskEl.parentNode.removeChild(mockAskEl);
    if (mockSpreadEl.parentNode) mockSpreadEl.parentNode.removeChild(mockSpreadEl);
    if (mockFeedRateEl.parentNode) mockFeedRateEl.parentNode.removeChild(mockFeedRateEl);
    if (mockSessionPnLEl.parentNode) mockSessionPnLEl.parentNode.removeChild(mockSessionPnLEl);
  }
}
