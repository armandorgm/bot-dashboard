import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// Domain Models & Utilities
import { InstanceConfig, TickData, HftEvent, ChasePipelineProcess, ModificationInfo } from './types';
import { getSymbolDecimals } from './utils/formatters';

// Specialized Domain Services
import { SessionMetricsTracker } from './services/sessionMetrics';
import { CoinAnimationManager } from './services/coinAnimation';
import { ChartDisplayConfig } from './services/chartDisplayConfig';
import { ChartViewportController } from './services/chartViewportController';
import { OrderProcessRegistry } from './services/orderProcessRegistry';
import { logger, addLog } from './services/logger';
import { dataSourceManager } from './services/dataSourceManager';
import { tooltipManager } from './services/tooltipManager';
import { ChartRenderer } from './services/chartRenderer';
import { openOrdersManager } from './services/openOrdersManager';
import { strategyManifestService } from './services/strategyManifestService';
import { instanceService } from './services/instanceService';
import { globalOverviewManager } from './services/globalOverviewManager';
import { MarketFeedService } from './services/marketFeedService';
import { triggerGaugeManager } from './services/triggerGaugeManager';
import { metricsDisplayController } from './services/metricsDisplayController';
import { runTriggerGaugeVerification } from './services/triggerGaugeManager.test';
import { runOpenOrdersManagerVerification } from './services/openOrdersManager.test';
import { runMetricsDisplayControllerVerification } from './services/metricsDisplayController.test';

// ── Service Instantiations ──────────────────────────────────────────────────
const sessionMetrics = new SessionMetricsTracker();
const coinAnimationManager = new CoinAnimationManager();
const chartDisplayConfig = new ChartDisplayConfig(() => chartRenderer.requestRender());
const chartViewportController = new ChartViewportController(110);
const orderProcessRegistry = new OrderProcessRegistry();

// State Variables
let config: InstanceConfig = {
  instance_id: '--',
  symbol: '--',
  port: '8000',
  parent_api_port: '8000',
};

let history: TickData[] = [];
let hftEvents: HftEvent[] = [];
let activeChaseProcesses: ChasePipelineProcess[] = [];
let maxPoints = 150;
const sessionStartTimeMap = new Map<number, number>();
const trackedSessionProcessIds = new Set<number>();
const completedSessionProcessIds = new Set<number>();
let lastLoggedProcessCount = -1;

// Parse URL parameters for browser/dev-server debug mode
const urlParams = new URLSearchParams(window.location.search);
const qPort = urlParams.get('port');
const qId = urlParams.get('instance_id');
const qSym = urlParams.get('symbol');
if (qPort) config.port = qPort;
if (qId) config.instance_id = qId;
if (qSym) config.symbol = qSym;

triggerGaugeManager.setContextGetter(() => {
  const currentSelected = instanceService.getSelectedInstanceId();
  const instId = currentSelected !== null ? currentSelected : parseInt(config.instance_id || '8', 10);
  const latestPrice = history.length > 0 ? (history[history.length - 1].bid || history[history.length - 1].ask) : 0;
  return {
    symbol: config.symbol !== '--' ? config.symbol : '1000PEPEUSDC',
    instanceId: isNaN(instId) ? 8 : instId,
    latestPrice: latestPrice > 0 ? latestPrice : 0.002575,
  };
});

// Chart Renderer Engine

const chartRenderer = new ChartRenderer({
  canvasEl: null,
  chartDisplayConfig,
  chartViewportController,
  coinAnimationManager,
  orderProcessRegistry,
  getConfig: () => config,
  getHistory: () => history,
  getHftEvents: () => hftEvents,
  getActiveChaseProcesses: () => activeChaseProcesses,
  getTriggerStatus: () => triggerGaugeManager.getStatus(),
  getMaxPoints: () => maxPoints,
  getHz: () => marketFeed.getHz(),
});

// Wire Trigger Gauge Context Getter
triggerGaugeManager.setContextGetter(() => {
  const currentSelected = instanceService.getSelectedInstanceId();
  const targetInstId = currentSelected !== null ? currentSelected : parseInt(config.instance_id || '1', 10);
  const latestPrice = history.length > 0 ? history[history.length - 1].bid : 0;
  return {
    symbol: config.symbol,
    instanceId: targetInstId,
    latestPrice: latestPrice,
  };
});

// Market Feed Service Coordinator
const marketFeed = new MarketFeedService({
  getConfig: () => config,
  onTicker: (bid, ask) => {
    history.push({ time: Date.now(), bid, ask });
    chartRenderer.pruneHistory(history);
    updatePnLDisplay(bid, ask);
    triggerGaugeManager.onTick(bid, ask);
    chartRenderer.requestRender();
  },
  onStrategyTriggerStatus: (status) => {
    const currentSelected = instanceService.getSelectedInstanceId();
    const currentTargetId =
      currentSelected !== null ? currentSelected : parseInt(config.instance_id || '1', 10);
    if (status.instance_id === currentTargetId || !currentSelected) {
      triggerGaugeManager.setStatus(status);
      chartRenderer.requestRender();
    } else {
      triggerGaugeManager.updateFromTelemetry(status.instance_id, status);
    }
  },

  onStatsUpdate: (d) => {
    const placedSuccessValEl = document.getElementById('placed-success-val');
    const placedFailedValEl = document.getElementById('placed-failed-val');
    const modifiedValEl = document.getElementById('modified-val');
    const buySellValEl = document.getElementById('buy-sell-val');

    if (placedSuccessValEl) placedSuccessValEl.innerText = d.placed_success.toString();
    if (placedFailedValEl) placedFailedValEl.innerText = d.placed_failed.toString();
    if (modifiedValEl) modifiedValEl.innerText = d.modified.toString();
    if (buySellValEl) buySellValEl.innerText = `${d.buys} / ${d.sells}`;
    if (d.last_modifications) {
      updateModificationsList(d.last_modifications);
    }
  },
  onModificationsUpdate: (mods) => updateModificationsList(mods),
  onPipelinesActive: (data, rawText) => processActivePipelinesData(data, rawText),
  onSessionUpdate: (d) => {
    const currentSelected = instanceService.getSelectedInstanceId();
    const targetInstId =
      d.instance_id !== null && d.instance_id !== undefined
        ? d.instance_id
        : currentSelected !== null
        ? currentSelected
        : parseInt(config.instance_id || '1', 10);
    if (typeof d.net_pnl === 'number') {
      sessionMetrics.setRealizedPnL(d.net_pnl, targetInstId);
    }
    if (d.start_time) {
      const rawStr = String(d.start_time);
      const isoStr = rawStr.endsWith('Z') ? rawStr : rawStr + 'Z';
      const parsedTs = new Date(isoStr).getTime();
      if (!isNaN(parsedTs)) {
        sessionStartTimeMap.set(targetInstId, parsedTs);
      }
    }
    const latestBid = history.length > 0 ? history[history.length - 1].bid : 0;
    const latestAsk = history.length > 0 ? history[history.length - 1].ask : 0;
    updatePnLDisplay(latestBid, latestAsk);
  },
  onInstanceTelemetry: (d) => {
    const currentSelected = instanceService.getSelectedInstanceId();
    const currentTargetId =
      currentSelected !== null ? currentSelected : parseInt(config.instance_id || '1', 10);
    if (d.instance_id === undefined || String(d.instance_id) === String(currentTargetId)) {
      instanceService.updateInstanceCapitalDisplay(d.used_capital, d.allocated_capital, d.available_capital);
      const pnlVal = d.lifetime_pnl ?? d.total_pnl ?? d.realized_pnl;
      if (pnlVal !== undefined) {
        const inst = instanceService.findInstance(currentTargetId);
        if (inst) inst.lifetime_pnl = pnlVal;
      }
      const latestBid = history.length > 0 ? history[history.length - 1].bid : 0;
      const latestAsk = history.length > 0 ? history[history.length - 1].ask : 0;
      updatePnLDisplay(latestBid, latestAsk);
    }
  },
  onHftEvent: (evt) => {
    hftEvents.push(evt);
    if (hftEvents.length > 500) hftEvents.shift();
    chartRenderer.requestRender();
  },
  onOpenOrdersRequested: () => openOrdersManager.fetchOpenOrders(config.parent_api_port, config.symbol),
  onActivePipelinesRequested: () => fetchActivePipelines(),
  onWsConnected: () => {
    const connBadgeEl = document.getElementById('conn-badge');
    const connLedEl = document.getElementById('conn-led');
    const connTextEl = document.getElementById('conn-text');
    if (connBadgeEl && connLedEl && connTextEl) {
      connBadgeEl.style.borderColor = 'rgba(16, 185, 129, 0.2)';
      connBadgeEl.style.background = 'rgba(16, 185, 129, 0.05)';
      connLedEl.className = 'led led-green';
      connTextEl.textContent = 'CONNECTED';
    }
  },
  onWsDisconnected: () => {
    const connBadgeEl = document.getElementById('conn-badge');
    const connLedEl = document.getElementById('conn-led');
    const connTextEl = document.getElementById('conn-text');
    if (connBadgeEl && connLedEl && connTextEl) {
      connBadgeEl.style.borderColor = 'rgba(239, 68, 68, 0.2)';
      connBadgeEl.style.background = 'rgba(239, 68, 68, 0.05)';
      connLedEl.className = 'led led-red';
      connTextEl.textContent = 'DISCONNECTED';
    }
  },
});

// ── PnL and Metrics Display Coordination ────────────────────────────────────
function updatePnLDisplay(currentBid: number, currentAsk: number) {
  const currentSelected = instanceService.getSelectedInstanceId();
  const targetInstId = currentSelected !== null ? currentSelected : parseInt(config.instance_id || '1', 10);
  const realizedPnL = sessionMetrics.getRealizedPnL(targetInstId);
  const startTimeMs = sessionStartTimeMap.get(targetInstId);
  const unrealizedPnL = sessionMetrics.calculateUnrealizedPnL(currentBid, currentAsk, config.symbol, targetInstId, startTimeMs);

  const loadedInsts = instanceService.getLoadedInstances();
  const currentInstDataForNet = loadedInsts.find((i) => i.id === targetInstId);
  const instanceLifetimeRealized = currentInstDataForNet ? currentInstDataForNet.lifetime_pnl || 0 : realizedPnL;
  const totalInstanceUnrealized = sessionMetrics.calculateUnrealizedPnL(currentBid, currentAsk, config.symbol, targetInstId);

  const sessionNetTotal = realizedPnL + unrealizedPnL;
  const instanceLifetimeNetTotal = instanceLifetimeRealized + totalInstanceUnrealized;

  const sessionStartMs = sessionStartTimeMap.get(targetInstId) || Date.now();
  const rawElapsedMs = Date.now() - sessionStartMs;
  const elapsedMs = Math.max(60000, rawElapsedMs > 0 ? rawElapsedMs : 60000);
  const elapsedHours = elapsedMs / (1000 * 3600);
  const pnlPerHour = sessionNetTotal / elapsedHours;

  const instCreatedTs =
    currentInstDataForNet && (currentInstDataForNet as any).created_at
      ? new Date((currentInstDataForNet as any).created_at).getTime()
      : sessionStartMs;
  const rawTotalElapsedMs = Date.now() - instCreatedTs;
  const totalElapsedHours = Math.max(0.0166, (rawTotalElapsedMs > 0 ? rawTotalElapsedMs : elapsedMs) / (1000 * 3600));
  const lifetimePnlPerHour = instanceLifetimeNetTotal / totalElapsedHours;

  // Dispatch to batched dirty-checking display controller
  metricsDisplayController.setPnLState({
    realizedPnL,
    unrealizedPnL,
    lifetimeRealized: instanceLifetimeRealized,
    lifetimeUnrealized: totalInstanceUnrealized,
    sessionNetTotal,
    instanceLifetimeNetTotal,
    pnlPerHour,
    lifetimePnlPerHour,
  });

  const sessionTimeValEl = document.getElementById('session-time-val');
  if (sessionTimeValEl) {
    const displayMs = Math.max(0, rawElapsedMs);
    const totalSec = Math.floor(displayMs / 1000);
    const hours = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    sessionTimeValEl.innerText = `${hours}h ${mins}m`;
  }

  const totalTradesCount = currentInstDataForNet ? (currentInstDataForNet as any).total_trades || 0 : completedSessionProcessIds.size;
  const sessionTradesCount = completedSessionProcessIds.size;

  const sessionTradesCountValEl = document.getElementById('session-trades-count-val');
  const instanceTotalTradesCountValEl = document.getElementById('instance-total-trades-count-val');
  const tradesCountValEl = document.getElementById('trades-count-val');

  if (sessionTradesCountValEl) sessionTradesCountValEl.innerText = `${sessionTradesCount}`;
  if (instanceTotalTradesCountValEl) instanceTotalTradesCountValEl.innerText = `${totalTradesCount}`;
  if (tradesCountValEl) tradesCountValEl.innerText = `${sessionTradesCount} / ${totalTradesCount}`;

  const sessTradesPerHour = sessionTradesCount / elapsedHours;
  const totalTradesPerHour = totalTradesCount / totalElapsedHours;

  const sessionTradesRateValEl = document.getElementById('session-trades-rate-val');
  const instanceTotalTradesRateValEl = document.getElementById('instance-total-trades-rate-val');
  const tradesRateValEl = document.getElementById('trades-rate-val');

  if (sessionTradesRateValEl) sessionTradesRateValEl.innerText = `${sessTradesPerHour.toFixed(1)} /h`;
  if (instanceTotalTradesRateValEl) instanceTotalTradesRateValEl.innerText = `${totalTradesPerHour.toFixed(1)} /h`;
  if (tradesRateValEl) tradesRateValEl.innerText = `${sessTradesPerHour.toFixed(1)} / ${totalTradesPerHour.toFixed(1)}`;
}

// ── Active Pipelines Coordination ───────────────────────────────────────────
function processActivePipelinesData(data: ChasePipelineProcess[], rawText?: string) {
  if (!Array.isArray(data)) return;

  const canvasEl = document.getElementById('hft-chart') as HTMLCanvasElement | null;
  const activeMarkers = chartRenderer.getActiveMarkers();

  data.forEach((proc) => {
    if (proc.status !== 'COMPLETED' && proc.status !== 'ABORTED') {
      trackedSessionProcessIds.add(proc.id);
      const isPositionOpen = proc.status === 'WAITING_TP_FILL' || Boolean(proc.exit_order_id);
      const entryPrice = proc.last_order_price || proc.initial_price || 0;
      if (isPositionOpen && entryPrice > 0) {
        let procCreatedAt = Date.now();
        if (proc.created_at) {
          const rawStr = String(proc.created_at);
          const isoStr = rawStr.endsWith('Z') ? rawStr : rawStr + 'Z';
          const parsed = new Date(isoStr).getTime();
          if (!isNaN(parsed)) procCreatedAt = parsed;
        }
        sessionMetrics.registerPosition({
          processId: proc.id,
          instanceId: proc.instance_id,
          symbol: proc.symbol,
          entryPrice: entryPrice,
          amount: proc.amount || 0,
          side: proc.side || 'BUY',
          createdAt: procCreatedAt,
        });
      }
    }
  });

  for (const procId of Array.from(trackedSessionProcessIds)) {
    const proc = data.find((p) => p.id === procId);
    if (proc && proc.status === 'COMPLETED' && !completedSessionProcessIds.has(procId)) {
      completedSessionProcessIds.add(procId);
      trackedSessionProcessIds.delete(procId);

      const pos = sessionMetrics.closePosition(procId);
      const entryPrice = pos ? pos.entryPrice : proc.initial_price || proc.last_order_price || 0;
      const exitPrice = proc.last_tick_price || proc.last_order_price || entryPrice;
      const amount = pos ? pos.amount : proc.amount || 1;
      const side = pos ? pos.side : proc.side || 'BUY';

      const isLong = side.toUpperCase() === 'BUY' || side.toUpperCase() === 'LONG';
      const priceDiff = isLong ? exitPrice - entryPrice : entryPrice - exitPrice;
      const tradePnL = priceDiff * amount;

      const currentSelected = instanceService.getSelectedInstanceId();
      const procInstId = proc.instance_id || (currentSelected !== null ? currentSelected : parseInt(config.instance_id || '1', 10));
      sessionMetrics.addRealizedPnL(tradePnL, procInstId);
      addLog(`[SESSION PnL] Process #${procId} (Inst #${procInstId}) COMPLETED. Trade PnL: $${tradePnL.toFixed(4)}`, tradePnL >= 0 ? 'success' : 'warn');

      let anchorX = canvasEl ? canvasEl.width * 0.5 : 200;
      let anchorY = canvasEl ? canvasEl.height * 0.5 : 150;

      if (proc.exit_order_id) {
        const foundMarker = activeMarkers.find((m) => m.events.some((e) => String(e.orderId) === String(proc.exit_order_id)));
        if (foundMarker) {
          anchorX = foundMarker.x;
          anchorY = foundMarker.y;
        }
      }

      coinAnimationManager.triggerCoinAnimation(procId, entryPrice, exitPrice, amount, side, anchorX, anchorY);
    }
  }

  data.forEach((proc) => orderProcessRegistry.registerProcess(proc));

  activeChaseProcesses = data;
  if (data.length !== lastLoggedProcessCount) {
    lastLoggedProcessCount = data.length;
    if (rawText) {
      addLog(`[ACTIVE PIPELINES API] ${data.length} procesos activos recibidos: ${rawText}`, 'info');
    }
  }

  const latestBid = history.length > 0 ? history[history.length - 1].bid : 0;
  const latestAsk = history.length > 0 ? history[history.length - 1].ask : 0;
  updatePnLDisplay(latestBid, latestAsk);

  chartRenderer.draw();
}

async function fetchActivePipelines() {
  const parentPort = config.parent_api_port || '8000';
  const currentSelected = instanceService.getSelectedInstanceId();
  const targetInstId = currentSelected !== null ? currentSelected : parseInt(config.instance_id || '1', 10);

  try {
    fetch(`http://127.0.0.1:${parentPort}/api/sessions/current?instance_id=${targetInstId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((resData) => {
        if (resData && resData.data) {
          if (typeof resData.data.net_pnl === 'number') {
            sessionMetrics.setRealizedPnL(resData.data.net_pnl, targetInstId);
          }
          if (resData.data.start_time) {
            const rawStr = String(resData.data.start_time);
            const isoStr = rawStr.endsWith('Z') ? rawStr : rawStr + 'Z';
            const parsedTs = new Date(isoStr).getTime();
            if (!isNaN(parsedTs)) {
              sessionStartTimeMap.set(targetInstId, parsedTs);
            }
          }
        }
      })
      .catch(() => {});

    const response = await fetch(`http://127.0.0.1:${parentPort}/api/pipelines/active`);
    if (response.ok) {
      const rawText = await response.clone().text();
      const data: ChasePipelineProcess[] = await response.json();
      processActivePipelinesData(data, rawText);
    }
  } catch (err) {
    console.warn('Failed to fetch active pipeline processes:', err);
  }
}

// ── Modifications List UI Helper ────────────────────────────────────────────
function updateModificationsList(mods: ModificationInfo[]) {
  const modsListEl = document.getElementById('mods-list');
  if (!modsListEl) return;
  if (mods.length === 0) {
    modsListEl.innerHTML = '<div class="mod-row-placeholder">No modifications detected yet.</div>';
    return;
  }

  modsListEl.innerHTML = '';
  const sortedMods = [...mods].reverse();
  const decimals = getSymbolDecimals(config.symbol);

  for (const m of sortedMods) {
    const card = document.createElement('div');
    card.className = 'mod-card';

    const header = document.createElement('div');
    header.className = 'mod-card-header';

    const sideBadge = document.createElement('span');
    sideBadge.className = `mod-card-side ${m.side.toLowerCase()}`;
    sideBadge.innerText = m.side;

    const timeSpan = document.createElement('span');
    timeSpan.className = 'mod-card-time';
    timeSpan.innerText = new Date(m.timestamp).toLocaleTimeString();

    header.appendChild(sideBadge);
    header.appendChild(timeSpan);

    const body = document.createElement('div');
    body.className = 'mod-card-body';

    const priceRow = document.createElement('div');
    priceRow.className = 'mod-card-price-row';

    const priceChange = document.createElement('div');
    priceChange.className = 'mod-card-price-change';

    if (m.old_price !== null && m.new_price !== null) {
      const oldPriceSpan = document.createElement('span');
      oldPriceSpan.className = 'price-old';
      oldPriceSpan.innerText = m.old_price.toFixed(decimals);

      const arrow = document.createElement('span');
      arrow.className = 'price-arrow';
      arrow.innerHTML = '&rarr;';

      const newPriceSpan = document.createElement('span');
      newPriceSpan.className = 'price-new';
      newPriceSpan.innerText = m.new_price.toFixed(decimals);

      priceChange.appendChild(oldPriceSpan);
      priceChange.appendChild(arrow);
      priceChange.appendChild(newPriceSpan);

      const pctSpan = document.createElement('span');
      const pct = ((m.new_price - m.old_price) / m.old_price) * 100;
      if (pct > 0) {
        pctSpan.className = 'price-pct up';
        pctSpan.innerText = `+${pct.toFixed(3)}%`;
      } else if (pct < 0) {
        pctSpan.className = 'price-pct down';
        pctSpan.innerText = `${pct.toFixed(3)}%`;
      } else {
        pctSpan.className = 'price-pct neutral';
        pctSpan.innerText = '0.000%';
      }
      priceRow.appendChild(priceChange);
      priceRow.appendChild(pctSpan);
    } else if (m.new_price !== null) {
      const newPriceSpan = document.createElement('span');
      newPriceSpan.className = 'price-new';
      newPriceSpan.innerText = m.new_price.toFixed(decimals);
      priceChange.appendChild(newPriceSpan);
      priceRow.appendChild(priceChange);
    }

    const detailsRow = document.createElement('div');
    detailsRow.className = 'mod-card-details';

    const qtySpan = document.createElement('span');
    qtySpan.className = 'mod-card-qty';
    qtySpan.innerText = `QTY: ${m.quantity}`;

    const idSpan = document.createElement('span');
    idSpan.innerText = `ID: ...${m.order_id.slice(-6)}`;

    detailsRow.appendChild(qtySpan);
    detailsRow.appendChild(idSpan);

    body.appendChild(priceRow);
    body.appendChild(detailsRow);

    card.appendChild(header);
    card.appendChild(body);

    modsListEl.appendChild(card);
  }
}

// ── Active Instance Hot Swapping ────────────────────────────────────────────
function switchActiveInstance(instanceId: string | number) {
  const target = instanceService.findInstance(instanceId);
  if (!target) return;

  addLog(`[HOT-SWAP] Conmutando vista activa a la instancia: ${target.name} (${target.symbol})`, 'info');

  instanceService.setSelectedInstanceId(target.id);
  config.instance_id = String(target.id);
  config.symbol = target.symbol;
  if (target.params && target.params.port) {
    config.port = String(target.params.port);
  }

  const botTitleEl = document.getElementById('bot-title');
  if (botTitleEl) botTitleEl.innerText = `BOT INSTANCE ${target.name.toUpperCase()}`;

  const headerSelector = document.getElementById('header-instance-selector') as HTMLSelectElement | null;
  if (headerSelector) {
    if (headerSelector.value !== String(target.id)) {
      headerSelector.value = String(target.id);
    }
  }

  history = [];
  hftEvents = [];
  activeChaseProcesses = [];
  sessionMetrics.resetPositions();
  chartRenderer.draw();

  instanceService.updateInstanceStatusToggleUI(target.status);
  marketFeed.connectBinancePublicWs(target.symbol);

  if (typeof (window as any)._loadCycleSpeedForInstance === 'function') {
    (window as any)._loadCycleSpeedForInstance(target.id);
  }

  openOrdersManager.fetchOpenOrders(config.parent_api_port, target.symbol);
  fetchActivePipelines();
  instanceService.fetchInstanceTelemetry(target.id, config.parent_api_port);
  instanceService.fetchInstanceTriggerStatus(target.id, config.parent_api_port);
  triggerGaugeManager.render();
}


// ── Application Bootstrap ───────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  logger.init();
  metricsDisplayController.init();
  openOrdersManager.init();
  tooltipManager.init();
  try {
    runTriggerGaugeVerification();
    runOpenOrdersManagerVerification();
    runMetricsDisplayControllerVerification();
  } catch (err) {
    console.error('[OpenOrdersManager/TriggerGaugeManager/MetricsDisplayController] Verification error:', err);
  }
  triggerGaugeManager.render();


  const canvasEl = document.getElementById('hft-chart') as HTMLCanvasElement | null;
  (chartRenderer as any).ctxState.canvasEl = canvasEl;

  // SPA View Mode & Global Overview setup
  const overviewCallbacks = {
    onMonitor: (id: string) => {
      switchActiveInstance(id);
      globalOverviewManager.setViewMode('dashboard', () => chartRenderer.handleResize(), config.parent_api_port);
    },
    onStash: (id: number, name: string) => instanceService.openStashConfirmModal(id, name),
    onPop: (id: number, mode: 'NOW' | 'NO_FEES') =>
      instanceService.executePop(id, mode, config.parent_api_port, () =>
        globalOverviewManager.fetchGlobalOverview(config.parent_api_port, overviewCallbacks)
      ),
  };

  const btnNavHome = document.getElementById('btn-nav-home');
  if (btnNavHome) {
    btnNavHome.addEventListener('click', () =>
      globalOverviewManager.setViewMode('home', () => chartRenderer.handleResize(), config.parent_api_port)
    );
  }

  const btnRefreshOverview = document.getElementById('btn-refresh-overview');
  if (btnRefreshOverview) {
    btnRefreshOverview.addEventListener('click', () =>
      globalOverviewManager.fetchGlobalOverview(config.parent_api_port, overviewCallbacks)
    );
  }

  const instanceStatusToggle = document.getElementById('instance-status-toggle');
  if (instanceStatusToggle) {
    instanceStatusToggle.addEventListener('click', () => instanceService.toggleInstanceStatus(config.parent_api_port));
  }

  // Base Amount USD
  const baseAmountInput = document.getElementById('base-amount-input') as HTMLInputElement | null;
  const btnSaveBaseAmount = document.getElementById('btn-save-base-amount') as HTMLButtonElement | null;

  if (baseAmountInput && btnSaveBaseAmount) {
    fetch('http://127.0.0.1:8000/api/bot/config')
      .then((res) => res.json())
      .then((data) => {
        if (data && data.trade_amount) {
          baseAmountInput.value = data.trade_amount.toString();
        }
      })
      .catch((err) => console.error('[BASE USD] Error fetching initial config:', err));

    btnSaveBaseAmount.addEventListener('click', async () => {
      const val = parseFloat(baseAmountInput.value);
      if (isNaN(val) || val <= 0) {
        addLog('[BASE USD ERROR] Ingrese un valor mayor a 0', 'warn');
        return;
      }
      try {
        btnSaveBaseAmount.disabled = true;
        btnSaveBaseAmount.textContent = '...';
        const res = await fetch('http://127.0.0.1:8000/api/bot/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trade_amount: val }),
        });
        if (res.ok) {
          addLog(`[BASE USD UPDATED] Nuevo valor base en PostgreSQL: $${val} USD`, 'info');
        } else {
          addLog(`[BASE USD ERROR] Error en la API al guardar`, 'err');
        }
      } catch (err) {
        addLog(`[BASE USD ERROR] ${err}`, 'err');
      } finally {
        btnSaveBaseAmount.disabled = false;
        btnSaveBaseAmount.textContent = 'SET';
      }
    });
  }

  // Cycle Speed
  const cycleSpeedInput = document.getElementById('cycle-speed-input') as HTMLInputElement | null;
  const btnSetCycleSpeed = document.getElementById('btn-set-cycle-speed') as HTMLButtonElement | null;

  const loadCycleSpeedForInstance = (instanceId: number) => {
    if (!cycleSpeedInput) return;
    const inst = instanceService.findInstance(instanceId);
    if (inst) {
      const interval = inst.params?.interval_seconds ?? 10;
      cycleSpeedInput.value = String(interval);
    }
  };

  const setCycleSpeed = async () => {
    const parentPort = config?.parent_api_port || '8000';
    const currentInstId = instanceService.getSelectedInstanceId() || parseInt(config.instance_id || '1', 10);
    const val = parseFloat(cycleSpeedInput?.value || '10');

    if (isNaN(val) || val < 0.5 || val > 300) {
      addLog('[CYCLE SPEED ERROR] Valor fuera de rango (0.5s - 300s)', 'warn');
      return;
    }

    try {
      if (btnSetCycleSpeed) {
        btnSetCycleSpeed.disabled = true;
        btnSetCycleSpeed.textContent = '...';
      }
      addLog(`[CYCLE SPEED] Aplicando intervalo ${val}s a Instancia #${currentInstId}...`, 'info');
      const res = await fetch(`http://127.0.0.1:${parentPort}/api/grid/instances/${currentInstId}/cycle-speed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interval_seconds: val }),
      });
      if (res.ok) {
        const data = await res.json();
        addLog(
          `[CYCLE SPEED ✓] ${data.previous_interval_seconds}s → ${val}s — Instancia #${currentInstId} (efectivo en próximo ciclo)`,
          'info'
        );
        const updatedInst = instanceService.findInstance(currentInstId);
        if (updatedInst) {
          updatedInst.params = { ...updatedInst.params, interval_seconds: val };
        }
      } else {
        const errorText = await res.text();
        addLog(`[CYCLE SPEED ERROR] HTTP ${res.status}: ${errorText}`, 'err');
      }
    } catch (err: any) {
      addLog(`[CYCLE SPEED ERROR] ${err?.message ?? err}`, 'err');
    } finally {
      if (btnSetCycleSpeed) {
        btnSetCycleSpeed.disabled = false;
        btnSetCycleSpeed.textContent = 'SET';
      }
    }
  };

  if (cycleSpeedInput && btnSetCycleSpeed) {
    btnSetCycleSpeed.addEventListener('click', setCycleSpeed);
    cycleSpeedInput.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') setCycleSpeed();
    });
  }
  (window as any)._loadCycleSpeedForInstance = loadCycleSpeedForInstance;

  // Canvas Mouse & Panning / Zoom Controls
  if (canvasEl) {
    canvasEl.addEventListener('mousemove', (e: MouseEvent) => {
      const rect = canvasEl.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      tooltipManager.setMousePosition(mouseX, mouseY);

      let hoverMarker = null;
      for (const marker of chartRenderer.getActiveMarkers()) {
        const dx = mouseX - marker.x;
        const dy = mouseY - marker.y;
        if (Math.sqrt(dx * dx + dy * dy) < 15) {
          hoverMarker = marker;
          break;
        }
      }

      tooltipManager.update(e.clientX, e.clientY, hoverMarker, config.symbol, activeChaseProcesses);
      chartRenderer.draw();
    });

    canvasEl.addEventListener('mouseleave', () => {
      tooltipManager.setMousePosition(null, null);
      tooltipManager.hide();
      chartRenderer.draw();
    });

    chartViewportController.attach(
      canvasEl,
      () => chartRenderer.draw(),
      () => {
        let min = Infinity,
          max = -Infinity;
        for (const pt of history) {
          if (pt.bid > 0 && pt.bid < min) min = pt.bid;
          if (pt.ask > 0 && pt.ask > max) max = pt.ask;
        }
        if (min === Infinity || max === -Infinity) {
          min = 0;
          max = 0.004;
        }
        return { min, max };
      },
      () => maxPoints
    );
  }

  // Scale & Fullscreen Controls
  const zoomOutBtn = document.getElementById('btn-chart-zoom-out');
  const zoomInBtn = document.getElementById('btn-chart-zoom-in');
  const resetScaleBtn = document.getElementById('btn-chart-reset-scale');
  const scaleLabel = document.getElementById('chart-scale-label');
  const fullscreenBtn = document.getElementById('btn-chart-fullscreen');
  const chartSection = document.querySelector('.chart-section') as HTMLElement;

  const updateScaleUI = () => {
    if (scaleLabel) scaleLabel.innerText = chartDisplayConfig.getFormattedScale();
  };

  if (zoomOutBtn) {
    zoomOutBtn.addEventListener('click', () => {
      chartDisplayConfig.zoomOut();
      updateScaleUI();
    });
  }

  if (zoomInBtn) {
    zoomInBtn.addEventListener('click', () => {
      chartDisplayConfig.zoomIn();
      updateScaleUI();
    });
  }

  if (resetScaleBtn) {
    resetScaleBtn.addEventListener('click', () => {
      chartDisplayConfig.resetZoom();
      updateScaleUI();
    });
  }

  if (fullscreenBtn && chartSection) {
    const handleFullscreenResize = () => {
      setTimeout(() => {
        if (canvasEl && canvasEl.parentElement) {
          canvasEl.width = canvasEl.parentElement.clientWidth;
          canvasEl.height = canvasEl.parentElement.clientHeight;
        }
        chartRenderer.draw();
      }, 60);
    };

    fullscreenBtn.addEventListener('click', () => {
      const isFull = chartDisplayConfig.toggleFullscreen(chartSection);
      fullscreenBtn.innerHTML = isFull ? '⛶ Exit Fullscreen' : '⛶ Fullscreen';
      handleFullscreenResize();
    });

    document.addEventListener('fullscreenchange', () => {
      const isFull = chartDisplayConfig.isFullscreen();
      fullscreenBtn.innerHTML = isFull ? '⛶ Exit Fullscreen' : '⛶ Fullscreen';
      handleFullscreenResize();
    });
  }

  // Tauri Rust Environment Initialization
  try {
    config = await invoke<InstanceConfig>('get_instance_config');

    const botTitleEl = document.getElementById('bot-title');
    const symbolDisplayEl = document.getElementById('symbol-display');
    const instanceIdDisplayEl = document.getElementById('instance-id-display');
    const portDisplayEl = document.getElementById('port-display');

    if (botTitleEl) botTitleEl.innerText = `BOT INSTANCE #${config.instance_id}`;
    if (symbolDisplayEl) symbolDisplayEl.innerText = config.symbol;
    if (instanceIdDisplayEl) instanceIdDisplayEl.innerText = config.instance_id;
    if (portDisplayEl) portDisplayEl.innerText = config.port;

    await openOrdersManager.fetchOpenOrders(config.parent_api_port, config.symbol);

    await listen('binance-private-event', (event) => {
      marketFeed.handleBinancePrivateEvent(event.payload as string);
    });

    await listen('binance-rust-log', (event) => {
      addLog(event.payload as string, 'info');
    });

    await invoke('start_private_stream');
  } catch (err) {
    addLog(`Error fetching instance variables: ${err}`, 'err');
  }

  // Layout Listeners
  window.addEventListener('resize', () => chartRenderer.handleResize());
  setTimeout(() => chartRenderer.handleResize(), 100);

  const samplesSelectEl = document.getElementById('samples-select') as HTMLSelectElement | null;
  if (samplesSelectEl) {
    samplesSelectEl.addEventListener('change', (e) => {
      maxPoints = Number((e.target as HTMLSelectElement).value);
      chartRenderer.pruneHistory(history);
      chartRenderer.draw();
    });
  }

  const xAdvanceSelectEl = document.getElementById('x-advance-select') as HTMLSelectElement | null;
  if (xAdvanceSelectEl) {
    xAdvanceSelectEl.addEventListener('change', (e) => {
      const mode = (e.target as HTMLSelectElement).value as 'tick' | 'second';
      chartRenderer.updateXAdvanceMode(mode, history);
    });
  }

  const clearLogBtnEl = document.getElementById('clear-log-btn');
  if (clearLogBtnEl) {
    clearLogBtnEl.addEventListener('click', () => logger.clear());
  }

  // Connect WebSockets
  marketFeed.connectBinancePublicWs(config.symbol);
  marketFeed.connectLocalBotWebSocket();

  // Initial Sync & Interval Timers
  fetchActivePipelines();
  instanceService.fetchInstanceTelemetry(config.instance_id, config.parent_api_port);
  instanceService.fetchInstanceTriggerStatus(config.instance_id, config.parent_api_port);

  setInterval(() => {
    if (!document.hidden) {
      const activeId = instanceService.getSelectedInstanceId() || config.instance_id;
      fetchActivePipelines();
      instanceService.fetchInstanceTelemetry(activeId, config.parent_api_port);
      instanceService.fetchInstanceTriggerStatus(activeId, config.parent_api_port);
    }
  }, 60000);


  // Initialize Data Source Controls, Modal Listeners and Global Overview
  dataSourceManager.initControls();
  instanceService.initModalListeners(config.parent_api_port, (id) => switchActiveInstance(id));
  globalOverviewManager.setViewMode('home', () => chartRenderer.handleResize(), config.parent_api_port);

  setInterval(() => {
    if (document.hidden) return;
    if (globalOverviewManager.getViewMode() === 'home') {
      globalOverviewManager.fetchGlobalOverview(config.parent_api_port, overviewCallbacks);
    }
  }, 60000);

  strategyManifestService.fetchManifest(config.parent_api_port).then(() => {
    strategyManifestService.syncStrategySelectorOptions();
    instanceService.refreshInstanceModalDropdown(config.parent_api_port, config.instance_id);
  });

  // Initialize Addons Modal & UI Manager
  import('./services/addonUiManager').then(({ addonUiManager }) => {
    addonUiManager.setParentPort(config.parent_api_port);
    const addonsModal = document.getElementById('addons-modal');
    const openAddonsBtn = document.getElementById('btn-open-addons-modal');
    const closeAddonsBtn = document.getElementById('btn-close-addons-modal');
    const refreshAddonsBtn = document.getElementById('btn-refresh-addons-modal');

    if (openAddonsBtn && addonsModal) {
      openAddonsBtn.addEventListener('click', () => {
        addonsModal.style.display = 'flex';
        addonUiManager.fetchAddons();
      });
    }

    if (closeAddonsBtn && addonsModal) {
      closeAddonsBtn.addEventListener('click', () => {
        addonsModal.style.display = 'none';
      });
    }

    if (refreshAddonsBtn) {
      refreshAddonsBtn.addEventListener('click', () => {
        addonUiManager.fetchAddons();
      });
    }

    // Initial silent load of addons status
    addonUiManager.fetchAddons();
  });
});
