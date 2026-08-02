import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { SessionMetricsTracker } from "./services/sessionMetrics";
import { CoinAnimationManager } from "./services/coinAnimation";
import { ChartDisplayConfig } from "./services/chartDisplayConfig";
import { ChartViewportController } from "./services/chartViewportController";
import { OrderProcessRegistry } from "./services/orderProcessRegistry";

// Instantiate decoupled services in memory
const sessionMetrics = new SessionMetricsTracker();
const coinAnimationManager = new CoinAnimationManager();
const chartDisplayConfig = new ChartDisplayConfig(() => drawChart());
const chartViewportController = new ChartViewportController(110);
const orderProcessRegistry = new OrderProcessRegistry();


interface InstanceConfig {
  instance_id: string;
  symbol: string;
  port: string;
  parent_api_port: string;
}

interface TickData {
  time: number;
  bid: number;
  ask: number;
}

// Global state variables

interface HftEvent {
  e: 'HFT_EVENT';
  type: 'buy' | 'sell' | 'cancel' | 'query' | 'buy_placed' | 'sell_placed' | 'cancel_failed' | 'cancel_buy' | 'cancel_sell' | 'cancel_buy_failed' | 'cancel_sell_failed';
  time: number;
  price?: number;
  qty?: number;
  symbol: string;
  orderId?: string;
  detail: string;
}

interface VisualMarker {
  x: number;
  y: number;
  events: HftEvent[];
}

export interface ChasePipelineProcess {
  id: number;
  pipeline_id: number;
  symbol: string;
  entry_order_id?: string;
  exit_order_id?: string;
  status: 'CHASING' | 'WAITING_FILL' | 'PLACING_TP' | 'COMPLETED' | 'ABORTED' | string;
  sub_status: string;
  initial_price?: number;
  last_tick_price?: number;
  last_order_price?: number;
  side: string;
  amount: number;
  created_at?: string;
  finished_at?: string;
}

interface OpenOrder {
  id: string;
  symbol: string;
  type: string;
  side: string;
  price: number;
  amount: number;
  filled: number;
  remaining: number;
  status: string;
  datetime: string;
}

let history: TickData[] = [];
let hftEvents: HftEvent[] = [];
let openOrders: OpenOrder[] = [];
let activeChaseProcesses: ChasePipelineProcess[] = [];
let maxPoints = 150;
let xAdvanceMode: 'tick' | 'second' = 'second';
let animationFrameId: number | null = null;
let tickTimes: number[] = [];
let hz = 0;
let mouseX: number | null = null;
let mouseY: number | null = null;
let activeMarkers: VisualMarker[] = [];

// WebSocket reference for direct public Binance connection
let binancePublicWs: WebSocket | null = null;

// ── Data Source Control Flags ──────────────────────────────────────────────
const dataSourceFlags = {
  ticker:  true,
  orders:  true,
  queries: true,
  stats:   true,
  mods:    true,
  chart:   true,
};

type DataSourceKey = keyof typeof dataSourceFlags;

function setDataSource(key: DataSourceKey, enabled: boolean) {
  dataSourceFlags[key] = enabled;
  const card = document.getElementById(`ds-card-${key}`);
  const dot  = document.getElementById(`ds-dot-${key}`);
  const sw   = document.getElementById(`ds-switch-${key}`) as HTMLInputElement | null;
  if (card) {
    card.classList.toggle('ds-active',   enabled);
    card.classList.toggle('ds-inactive', !enabled);
  }
  if (dot) {
    dot.classList.toggle('active', enabled);
    dot.classList.toggle('paused', !enabled);
  }
  if (sw && sw.checked !== enabled) sw.checked = enabled;
}

// DOM references
let botTitleEl: HTMLElement | null = null;
let connBadgeEl: HTMLElement | null = null;
let connLedEl: HTMLElement | null = null;
let connTextEl: HTMLElement | null = null;
let symbolDisplayEl: HTMLElement | null = null;
let instanceIdDisplayEl: HTMLElement | null = null;
let portDisplayEl: HTMLElement | null = null;

let bidValEl: HTMLElement | null = null;
let askValEl: HTMLElement | null = null;
let spreadValEl: HTMLElement | null = null;
let feedRateValEl: HTMLElement | null = null;

let placedSuccessValEl: HTMLElement | null = null;
let placedFailedValEl: HTMLElement | null = null;
let modifiedValEl: HTMLElement | null = null;
let buySellValEl: HTMLElement | null = null;
let sessionPnLValEl: HTMLElement | null = null;
let unrealizedPnLValEl: HTMLElement | null = null;

let canvasEl: HTMLCanvasElement | null = null;
let samplesSelectEl: HTMLSelectElement | null = null;
let logConsoleEl: HTMLElement | null = null;
let clearLogBtnEl: HTMLElement | null = null;
let modsListEl: HTMLElement | null = null;
let openOrdersWrapperEl: HTMLElement | null = null;
let tooltipEl: HTMLElement | null = null;

// Getted config
let config: InstanceConfig = { instance_id: "--", symbol: "--", port: "12001", parent_api_port: "8000" };

// Parse URL parameters for browser/dev-server debug mode
const urlParams = new URLSearchParams(window.location.search);
const qPort = urlParams.get('port');
const qId = urlParams.get('instance_id');
const qSym = urlParams.get('symbol');
if (qPort) config.port = qPort;
if (qId) config.instance_id = qId;
if (qSym) config.symbol = qSym;

// Log helper
function addLog(text: string, type: 'info' | 'warn' | 'err' | 'success' = 'info') {
  if (!logConsoleEl) return;
  const time = new Date().toLocaleTimeString();
  const row = document.createElement("div");
  row.className = `log-row ${type}`;
  
  const timeSpan = document.createElement("span");
  timeSpan.style.color = "#4b5563";
  timeSpan.textContent = `[${time}]`;
  
  const textSpan = document.createElement("span");
  textSpan.textContent = text;
  
  row.appendChild(timeSpan);
  row.appendChild(textSpan);
  
  logConsoleEl.appendChild(row);
  logConsoleEl.scrollTop = logConsoleEl.scrollHeight;

  // Prune rows if too many
  while (logConsoleEl.children.length > 100) {
    logConsoleEl.removeChild(logConsoleEl.firstChild!);
  }
}

// Formatting helper
function formatNum(num: number, decimals: number = 6): string {
  return num.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// Chart drawing
function drawChart() {
  if (!canvasEl) return;
  if (!dataSourceFlags.chart) return; // 🔴 CHART RENDER OFF — canvas frozen
  const ctx = canvasEl.getContext('2d');
  if (!ctx) return;

  const width  = canvasEl.width;
  const height = canvasEl.height;

  // ── Background ──────────────────────────────────────────────────────────
  ctx.fillStyle = '#060913';
  ctx.fillRect(0, 0, width, height);

  if (history.length < 2) {
    ctx.fillStyle = '#475569';
    ctx.font = chartDisplayConfig.getScaledFont(13);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('WAITING FOR TICKER FEED DATA FROM BOT...', width / 2, height / 2);
    return;
  }

  // ── Auto-fit data range (ignoring manual yCenter/yRange) ────────────────
  let dataMin = Infinity;
  let dataMax = -Infinity;
  for (const pt of history) {
    if (pt.bid > 0 && pt.bid < dataMin) dataMin = pt.bid;
    if (pt.ask > 0 && pt.ask > dataMax) dataMax = pt.ask;
  }
  if (dataMin === Infinity || dataMax === -Infinity) { dataMin = 0; dataMax = 0.004; }

  // ── Linear Y scale (Viewport State from Controller) ────────────────────
  const viewport = chartViewportController.getState();
  const autoHalf   = (dataMax - dataMin) * 0.6 || dataMin * 0.05 || 0.0001;
  const autoCenter = (dataMax + dataMin) / 2;

  const yCtr = viewport.yCenter !== null ? viewport.yCenter : autoCenter;
  const yHalf = viewport.yRange !== null ? viewport.yRange : autoHalf;

  const yMin = yCtr - yHalf;
  const yMax = yCtr + yHalf;
  const ySpan = yMax - yMin || 1e-9;

  const rightMargin = 110;
  const chartWidth  = width - rightMargin;
  const chartTop    = 15;
  const chartBottom = height - 35;
  const chartH      = chartBottom - chartTop;

  // Linear mappers (X-axis unlinked from live advance when user pans) ──────
  const now = Date.now();
  const timeWindow = maxPoints * 1000; // window in ms
  const xOffset = viewport.xOffsetMs || 0;

  // Calculate slice indices for tick mode
  const endIdx = Math.max(1, history.length - viewport.sampleOffset);
  const startIdx = Math.max(0, endIdx - maxPoints);

  const liveEndTime = xAdvanceMode === 'second'
    ? now
    : (history.length > 0 ? history[Math.min(history.length - 1, endIdx - 1)].time : now);

  const tMax = liveEndTime - xOffset;
  const tMin = xAdvanceMode === 'second'
    ? tMax - timeWindow
    : (history.length > startIdx ? history[startIdx].time : tMax - timeWindow);

  const getXForTime = (time: number) => {
    if (xAdvanceMode === 'second') {
      if (time <= tMin) return 0;
      if (time >= tMax) return chartWidth;
      return ((time - tMin) / Math.max(1, tMax - tMin)) * chartWidth;
    } else {
      if (history.length === 0) return 0;
      const minT = history[startIdx]?.time ?? history[0].time;
      const maxT = history[Math.min(history.length - 1, endIdx - 1)]?.time ?? history[history.length - 1].time;
      if (time <= minT) return 0;
      if (time >= maxT) return chartWidth;
      return ((time - minT) / Math.max(1, maxT - minT)) * chartWidth;
    }
  };

  const getX = (index: number) => {
    if (xAdvanceMode === 'second') {
      if (index < 0 || index >= history.length) return 0;
      return getXForTime(history[index].time);
    } else {
      const relIdx = index - startIdx;
      return relIdx * (chartWidth / Math.max(1, maxPoints - 1));
    }
  };

  const getTimeForX = (x: number): number => {
    if (xAdvanceMode === 'second') {
      return tMin + (x / Math.max(1, chartWidth)) * Math.max(1, tMax - tMin);
    } else {
      const relIndex = (x / Math.max(1, chartWidth)) * (maxPoints - 1);
      const exactIndex = startIdx + relIndex;
      const i0 = Math.floor(exactIndex);
      const i1 = Math.min(history.length - 1, Math.ceil(exactIndex));
      if (i0 >= 0 && i1 < history.length) {
        const t0 = history[i0].time;
        const t1 = history[i1].time;
        return t0 + (exactIndex - i0) * (t1 - t0);
      }
      return history.length > 0 ? history[history.length - 1].time : Date.now();
    }
  };

  const getY = (price: number) => {
    return chartBottom - ((price - yMin) / ySpan) * chartH;
  };

  // ── Y-axis drag handle highlight ─────────────────────────────────────────
  const isYZoomActive = chartViewportController.isZooming();
  ctx.fillStyle = isYZoomActive
    ? 'rgba(99, 102, 241, 0.10)'
    : 'rgba(99, 102, 241, 0.03)';
  ctx.fillRect(chartWidth, 0, rightMargin, height);

  const gripX = chartWidth + rightMargin / 2;
  const gripY = height / 2;
  ctx.strokeStyle = isYZoomActive
    ? 'rgba(129, 140, 248, 0.7)'
    : 'rgba(99, 102, 241, 0.25)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);
  for (const offset of [-5, 0, 5]) {
    ctx.beginPath();
    ctx.moveTo(gripX - 10, gripY + offset);
    ctx.lineTo(gripX + 10, gripY + offset);
    ctx.stroke();
  }
  ctx.fillStyle = isYZoomActive
    ? 'rgba(129, 140, 248, 0.9)'
    : 'rgba(99, 102, 241, 0.35)';
  ctx.font = chartDisplayConfig.getScaledFont(7);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('↕ DRAG', gripX, gripY + 18);

  // ── Grid lines (horizontal) ──────────────────────────────────────────────
  const decimals = config.symbol.toLowerCase().includes('pepe') ? 8 : 4;
  const gridCount = 5;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(148, 163, 184, 0.5)';
  ctx.font = chartDisplayConfig.getScaledFont(9);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  for (let i = 0; i <= gridCount; i++) {
    const frac     = i / gridCount;
    const priceVal = yMin + (1 - frac) * ySpan;
    const y        = chartTop + frac * chartH;

    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(chartWidth, y);
    ctx.stroke();
    ctx.fillText(priceVal.toFixed(decimals), chartWidth + 6, y);
  }

  // ── Grid lines (vertical/timeline) ───────────────────────────────────────
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
  ctx.lineWidth = 1;
  ctx.fillStyle = 'rgba(148, 163, 184, 0.35)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = chartDisplayConfig.getScaledFont(8);
  const vGridCount = 4;
  for (let i = 0; i <= vGridCount; i++) {
    const frac = i / vGridCount;
    const x = frac * chartWidth;

    ctx.beginPath();
    ctx.moveTo(x, chartTop);
    ctx.lineTo(x, chartBottom);
    ctx.stroke();

    const timeVal = getTimeForX(x);
    let label = '';
    if (xAdvanceMode === 'second') {
      const diffSec = Math.round((timeVal - now) / 1000);
      label = diffSec === 0 ? 'NOW' : `${diffSec}s`;
    } else {
      label = new Date(timeVal).toLocaleTimeString('es-ES', { hour12: false });
    }
    ctx.fillText(label, x, chartBottom + 5);
    if (xAdvanceMode === 'second') {
      const absTimeStr = new Date(timeVal).toLocaleTimeString('es-ES', { hour12: false });
      ctx.fillStyle = 'rgba(148, 163, 184, 0.15)';
      ctx.fillText(absTimeStr, x, chartBottom + 14);
      ctx.fillStyle = 'rgba(148, 163, 184, 0.35)';
    }
  }

  // ── 1. Spread shaded area ────────────────────────────────────────────────
  ctx.fillStyle = 'rgba(59, 130, 246, 0.05)';
  ctx.beginPath();
  ctx.moveTo(getX(0), getY(history[0].bid));
  for (let i = 1; i < history.length; i++) ctx.lineTo(getX(i), getY(history[i].bid));
  for (let i = history.length - 1; i >= 0; i--) ctx.lineTo(getX(i), getY(history[i].ask));
  ctx.closePath();
  ctx.fill();

  // ── 2. Bid line (green) ──────────────────────────────────────────────────
  ctx.strokeStyle = '#10b981';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(getX(0), getY(history[0].bid));
  for (let i = 1; i < history.length; i++) ctx.lineTo(getX(i), getY(history[i].bid));
  ctx.stroke();

  // ── 3. Ask line (red) ────────────────────────────────────────────────────
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(getX(0), getY(history[0].ask));
  for (let i = 1; i < history.length; i++) ctx.lineTo(getX(i), getY(history[i].ask));
  ctx.stroke();

  // ── 4. HFT event markers ─────────────────────────────────────────────────
  const visibleEvents = hftEvents.filter(e => e.time >= tMin && e.time <= tMax);
  const queryEvents   = visibleEvents.filter(e => e.type === 'query');
  const tradingEvents = visibleEvents.filter(e => e.type !== 'query');

  activeMarkers = [];
  const clusterRadius = 12;

  for (const evt of queryEvents) {
    const x = getXForTime(evt.time);
    let merged = false;
    for (const marker of activeMarkers) {
      if (Math.abs(marker.x - x) < clusterRadius && marker.events[0].type === 'query') {
        marker.events.push(evt); merged = true; break;
      }
    }
    if (!merged) activeMarkers.push({ x, y: 25, events: [evt] });
  }

  const positionOccupancy: Record<string, number> = {};
  for (const evt of tradingEvents) {
    let x = getXForTime(evt.time);
    const y = evt.price ? getY(evt.price) : height / 2;
    const key = `${Math.round(evt.time / 500) * 500},${evt.price || 0}`;
    const occupancy = positionOccupancy[key] || 0;
    positionOccupancy[key] = occupancy + 1;
    activeMarkers.push({ x: x + occupancy * 10, y, events: [evt] });
  }

  // ── 5. Order price level lines (dashed) ──────────────────────────────────
  hftEvents.forEach((placedEvt) => {
    if (placedEvt.type !== 'buy_placed' && placedEvt.type !== 'sell_placed') return;
    const orderId = placedEvt.orderId;
    if (!orderId) return;
    const closingEvt = hftEvents.find(
      e => e.orderId !== undefined &&
           String(e.orderId) === String(orderId) &&
           ['buy','sell','cancel','cancel_buy','cancel_sell','cancel_buy_failed','cancel_sell_failed'].includes(e.type) &&
           e.time >= placedEvt.time
    );
    const tStart = placedEvt.time;
    const tEnd   = closingEvt ? closingEvt.time : tMax;
    if (tEnd < tMin || tStart > tMax) return;
    const xStart = getXForTime(Math.max(tStart, tMin));
    const xEnd   = getXForTime(Math.min(tEnd,   tMax));
    const yVal   = getY(placedEvt.price || 0);
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.0;
    ctx.strokeStyle = placedEvt.type === 'buy_placed' ? 'rgba(16,185,129,0.45)' : 'rgba(239,68,68,0.45)';
    ctx.beginPath();
    ctx.moveTo(xStart, yVal);
    ctx.lineTo(xEnd, yVal);
    ctx.stroke();
    ctx.restore();
  });

  // ── 5.5. Chase v2 Order Link Visualization ──────────────────────────────
  activeChaseProcesses.forEach((proc) => {
    // Persiste únicamente hasta que el proceso esté en estado COMPLETED o ABORTED
    if (proc.status === 'COMPLETED' || proc.status === 'ABORTED') return;

    // Buscar el marcador de la orden de entrada por entry_order_id
    let entryX: number | null = null;
    let entryY: number | null = null;
    if (proc.entry_order_id) {
      for (const m of activeMarkers) {
        const found = m.events.find(e => String(e.orderId) === String(proc.entry_order_id));
        if (found) {
          entryX = m.x;
          entryY = m.y;
          break;
        }
      }
    }

    // Buscar marcador de exit_order_id si existe
    let exitX: number | null = null;
    let exitY: number | null = null;
    if (proc.exit_order_id) {
      for (const m of activeMarkers) {
        const found = m.events.find(e => String(e.orderId) === String(proc.exit_order_id));
        if (found) {
          exitX = m.x;
          exitY = m.y;
          break;
        }
      }
    }

    // Si no se encuentra el marcador de entrada en pantalla pero tenemos last_order_price / initial_price
    const targetPrice = proc.last_order_price || proc.initial_price;
    if (entryX === null && targetPrice) {
      entryY = getY(targetPrice);
      entryX = chartWidth * 0.2; // posición relativa por defecto
    }

    if (entryX !== null && entryY !== null) {
      ctx.save();
      const isChasing = proc.status === 'CHASING';
      const isWaiting = proc.status === 'WAITING_FILL';

      const lineColor = isChasing ? '#f59e0b' : isWaiting ? '#06b6d4' : '#10b981';
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1.8;
      ctx.setLineDash([5, 4]);

      const targetX = exitX !== null ? exitX : chartWidth;
      const targetY = exitY !== null ? exitY : entryY;

      // Dibujar línea conectora (Bezier curve suave o recta)
      ctx.beginPath();
      ctx.moveTo(entryX, entryY);
      const cpX1 = entryX + (targetX - entryX) * 0.5;
      const cpY1 = entryY;
      const cpX2 = entryX + (targetX - entryX) * 0.5;
      const cpY2 = targetY;
      ctx.bezierCurveTo(cpX1, cpY1, cpX2, cpY2, targetX, targetY);
      ctx.stroke();

      // Dibujar Badge de Identificación en el centro del vínculo
      const midX = (entryX + targetX) / 2;
      const midY = (entryY + targetY) / 2;
      const badgeText = `CHASE #${proc.id} | ${proc.sub_status || proc.status}`;
      
      ctx.font = chartDisplayConfig.getScaledFont(8, "'JetBrains Mono', monospace", true);
      const textWidth = ctx.measureText(badgeText).width;
      
      const badgePaddingH = chartDisplayConfig.getScaledSize(6);
      const badgeH = chartDisplayConfig.getScaledSize(16);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = chartDisplayConfig.getScaledSize(1);
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.roundRect(midX - textWidth / 2 - badgePaddingH, midY - badgeH / 2, textWidth + badgePaddingH * 2, badgeH, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = lineColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(badgeText, midX, midY);

      ctx.restore();
    }
  });

  // ── 6. Draw event markers ────────────────────────────────────────────────
  for (const m of activeMarkers) {
    const clusterR = chartDisplayConfig.getScaledSize(8);
    const triR = chartDisplayConfig.getScaledSize(5);
    if (m.events.length > 1) {
      ctx.beginPath();
      ctx.arc(m.x, m.y, clusterR, 0, 2 * Math.PI);
      ctx.fillStyle = '#4f46e5';
      ctx.fill();
      ctx.strokeStyle = '#818cf8';
      ctx.lineWidth = chartDisplayConfig.getScaledSize(1.5);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = chartDisplayConfig.getScaledFont(8, "'JetBrains Mono', monospace", true);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(m.events.length.toString(), m.x, m.y);
    } else {
      const evt = m.events[0];
      if (evt.type === 'buy') {
        ctx.beginPath(); ctx.moveTo(m.x, m.y - triR - 1); ctx.lineTo(m.x - triR, m.y + triR); ctx.lineTo(m.x + triR, m.y + triR); ctx.closePath();
        ctx.fillStyle = '#10b981'; ctx.fill(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 0.5; ctx.stroke();
      } else if (evt.type === 'buy_placed') {
        ctx.beginPath(); ctx.moveTo(m.x, m.y - triR - 1); ctx.lineTo(m.x - triR, m.y + triR); ctx.lineTo(m.x + triR, m.y + triR); ctx.closePath();
        ctx.strokeStyle = '#10b981'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.fillStyle = 'rgba(16,185,129,0.15)'; ctx.fill();
      } else if (evt.type === 'sell') {
        ctx.beginPath(); ctx.moveTo(m.x, m.y + triR + 1); ctx.lineTo(m.x - triR, m.y - triR); ctx.lineTo(m.x + triR, m.y - triR); ctx.closePath();
        ctx.fillStyle = '#ef4444'; ctx.fill(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 0.5; ctx.stroke();
      } else if (evt.type === 'sell_placed') {
        ctx.beginPath(); ctx.moveTo(m.x, m.y + triR + 1); ctx.lineTo(m.x - triR, m.y - triR); ctx.lineTo(m.x + triR, m.y - triR); ctx.closePath();
        ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.fillStyle = 'rgba(239,68,68,0.15)'; ctx.fill();
      } else if (evt.type === 'cancel' || evt.type === 'cancel_buy' || evt.type === 'cancel_sell') {
        const cc = evt.type === 'cancel_buy' ? '#10b981' : evt.type === 'cancel_sell' ? '#ef4444' : '#f59e0b';
        ctx.strokeStyle = cc; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(m.x-4,m.y-4); ctx.lineTo(m.x+4,m.y+4); ctx.moveTo(m.x+4,m.y-4); ctx.lineTo(m.x-4,m.y+4); ctx.stroke();
      } else if (evt.type === 'cancel_failed' || evt.type === 'cancel_buy_failed' || evt.type === 'cancel_sell_failed') {
        const cc = evt.type === 'cancel_buy_failed' ? '#10b981' : '#ef4444';
        ctx.strokeStyle = cc; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(m.x-5,m.y-5); ctx.lineTo(m.x+5,m.y+5); ctx.moveTo(m.x+5,m.y-5); ctx.lineTo(m.x-5,m.y+5); ctx.stroke();
        ctx.beginPath(); ctx.arc(m.x, m.y, clusterR, 0, 2 * Math.PI); ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 1.5; ctx.stroke();
      } else if (evt.type === 'query') {
        ctx.beginPath(); ctx.arc(m.x, m.y, chartDisplayConfig.getScaledSize(4), 0, 2 * Math.PI);
        ctx.fillStyle = '#60a5fa'; ctx.fill(); ctx.strokeStyle = '#3b82f6'; ctx.stroke();
      }

      // Decoraciones y marca permanente de por vida del Process ID por orderId
      if (evt.orderId) {
        // Consultar registro permanente de por vida o proceso activo
        const procInfo = orderProcessRegistry.getProcessInfo(evt.orderId);
        const chaseProc = procInfo ? null : activeChaseProcesses.find(p =>
          p.status !== 'COMPLETED' && p.status !== 'ABORTED' &&
          (String(p.entry_order_id) === String(evt.orderId) || String(p.exit_order_id) === String(evt.orderId))
        );

        const processId = procInfo ? procInfo.processId : chaseProc ? chaseProc.id : null;
        const role = procInfo ? procInfo.role : chaseProc ? (String(chaseProc.entry_order_id) === String(evt.orderId) ? 'E' : 'X') : null;

        if (processId !== null && role !== null) {
          const roleColor = role === 'E' ? '#06b6d4' : '#10b981';

          ctx.save();
          // 1. Anillo punteado de rol rodeando el marcador
          ctx.beginPath();
          ctx.arc(m.x, m.y, chartDisplayConfig.getScaledSize(10), 0, 2 * Math.PI);
          ctx.strokeStyle = roleColor;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([2, 2]);
          ctx.stroke();

          // 2. Node Dot en el centro/vértice (conector visual)
          ctx.beginPath();
          ctx.arc(m.x, m.y, chartDisplayConfig.getScaledSize(2.5), 0, 2 * Math.PI);
          ctx.fillStyle = '#ffffff';
          ctx.fill();

          // 3. Micro-badge de por vida mostrando "#ID·E" o "#ID·X"
          const badgeText = `#${processId}·${role}`;
          ctx.font = chartDisplayConfig.getScaledFont(7, "'JetBrains Mono', monospace", true);
          const txtWidth = ctx.measureText(badgeText).width;

          const badgeH = chartDisplayConfig.getScaledSize(12);
          const badgePadding = chartDisplayConfig.getScaledSize(4);
          const badgeW = txtWidth + badgePadding * 2;

          const badgeOffset = chartDisplayConfig.getScaledSize(8);
          const badgeX = m.x + badgeOffset;
          const badgeY = m.y - badgeOffset - badgeH / 2;

          ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
          ctx.strokeStyle = roleColor;
          ctx.lineWidth = 1;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 3);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = roleColor;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(badgeText, badgeX + badgeW / 2, badgeY + badgeH / 2);

          ctx.restore();
        } else if (['buy', 'buy_placed', 'sell', 'sell_placed'].includes(evt.type)) {
          // Evaluar retardo de gracia (6 segundos) para dar tiempo a la propagación y persistencia de Python DB/Cache
          const eventAgeMs = Date.now() - evt.time;
          if (eventAgeMs >= 6000) {
            // Adorno para ordenes verdaderamente huérfanas / manuales / externas (no vinculadas tras 6s)
            const roleColor = '#c084fc'; // Púrpura/Violeta para huérfano / manual
            const badgeOffset = chartDisplayConfig.getScaledSize(8);
            const badgeRadius = chartDisplayConfig.getScaledSize(4.5);
            const badgeX = m.x + badgeOffset;
            const badgeY = m.y - badgeOffset;

            ctx.save();
            // 1. Anillo punteado discreto
            ctx.beginPath();
            ctx.arc(m.x, m.y, chartDisplayConfig.getScaledSize(9), 0, 2 * Math.PI);
            ctx.strokeStyle = 'rgba(192, 132, 252, 0.45)';
            ctx.lineWidth = 1.0;
            ctx.setLineDash([2, 3]);
            ctx.stroke();

            // 2. Micro-badge flotante con el símbolo '?' (Huérfana / Externa)
            ctx.fillStyle = roleColor;
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.arc(badgeX, badgeY, badgeRadius, 0, 2 * Math.PI);
            ctx.fill();

            ctx.fillStyle = '#0f172a';
            ctx.font = chartDisplayConfig.getScaledFont(7, "'JetBrains Mono', monospace", true);
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('?', badgeX, badgeY);

            ctx.restore();
          }
        }
      }
    }
  }

  // ── 6.5. Render 10-second coin animations for closed processes ──────────
  coinAnimationManager.render(ctx, decimals);

  // ── 7. Right Y-axis price flags (Bid / Ask) ──────────────────────────────
  const latest = history[history.length - 1];
  const yBid   = getY(latest.bid);
  const yAsk   = getY(latest.ask);

  ctx.font = chartDisplayConfig.getScaledFont(8, "'JetBrains Mono', monospace", true);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = '#10b981';
  ctx.fillRect(chartWidth + 3, yBid - 7, rightMargin - 6, 14);
  ctx.fillStyle = '#030712';
  ctx.fillText(`B: ${latest.bid.toFixed(decimals)}`, chartWidth + 6, yBid);

  ctx.fillStyle = '#ef4444';
  ctx.fillRect(chartWidth + 3, yAsk - 7, rightMargin - 6, 14);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(`A: ${latest.ask.toFixed(decimals)}`, chartWidth + 6, yAsk);

  // ── 8. Telemetry bar ─────────────────────────────────────────────────────
  ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
  ctx.fillRect(0, height - 22, width, 22);
  ctx.fillStyle = '#94a3b8';
  ctx.font = chartDisplayConfig.getScaledFont(10);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const spread = latest.ask - latest.bid;
  const zoomLabel = viewport.yRange !== null ? ` | ZOOM: ${(autoHalf / yHalf).toFixed(1)}x` : '';
  ctx.fillText(
    `SPREAD: ${spread.toFixed(decimals)} | MIN: ${dataMin.toFixed(decimals)} | MAX: ${dataMax.toFixed(decimals)} | MOTOR: ${hz} Hz | MUESTRAS: ${history.length}/${maxPoints}${zoomLabel}`,
    10, height - 11
  );

  // ── 9. Crosshair + snap ──────────────────────────────────────────────────
  if (mouseX !== null && mouseY !== null && mouseX < chartWidth) {
    let snapX = mouseX;
    let snapY = mouseY;
    let isSnapped = false;

    let closestMarker = null;
    let minDist = 15;
    for (const marker of activeMarkers) {
      const dx = mouseX - marker.x;
      const dy = mouseY - marker.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < minDist) { minDist = dist; closestMarker = marker; }
    }

    let snappedTime  = 0;
    let snappedPrice = 0;

    snappedTime = getTimeForX(snapX);

    const yFrac  = (chartBottom - snapY) / chartH;
    snappedPrice = yMin + yFrac * ySpan;

    if (closestMarker) {
      snapX = closestMarker.x;
      snapY = closestMarker.y;
      isSnapped = true;
      snappedTime  = closestMarker.events[0].time;
      snappedPrice = closestMarker.events[0].price || snappedPrice;
    }

    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1.0;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(snapX, chartTop); ctx.lineTo(snapX, height - 22); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, snapY); ctx.lineTo(chartWidth, snapY); ctx.stroke();
    ctx.restore();

    // Time badge (X axis)
    const timeStr = new Date(snappedTime).toLocaleTimeString('es-ES', { hour12: false });
    ctx.font = chartDisplayConfig.getScaledFont(9);
    const tBadgeW = ctx.measureText(timeStr).width + 10;
    const tBadgeH = 14;
    const tBadgeX = Math.max(0, Math.min(chartWidth - tBadgeW, snapX - tBadgeW / 2));
    const tBadgeY = height - 22 - tBadgeH;
    ctx.save();
    ctx.fillStyle = isSnapped ? '#4f46e5' : 'rgba(15,23,42,0.95)';
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.rect(tBadgeX, tBadgeY, tBadgeW, tBadgeH); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(timeStr, tBadgeX + tBadgeW / 2, tBadgeY + tBadgeH / 2);
    ctx.restore();

    // Price badge (Y axis)
    const priceStr = formatNum(snappedPrice, decimals);
    const pBadgeW  = ctx.measureText(priceStr).width + 8;
    const pBadgeH  = 14;
    const pBadgeX  = width - pBadgeW - 2;
    const pBadgeY  = Math.max(chartTop, Math.min(height - 22 - pBadgeH, snapY - pBadgeH / 2));
    ctx.save();
    ctx.fillStyle = isSnapped ? '#4f46e5' : 'rgba(15,23,42,0.95)';
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.rect(pBadgeX, pBadgeY, pBadgeW, pBadgeH); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(priceStr, pBadgeX + pBadgeW / 2, pBadgeY + pBadgeH / 2);
    ctx.restore();
  }
}

function pruneHistory() {
  const maxBuffer = Math.max(4000, maxPoints * 2);
  while (history.length > maxBuffer) {
    history.shift();
  }
}

function startSecondAnimationLoop() {
  if (animationFrameId !== null) return;
  const loop = () => {
    if (xAdvanceMode === 'second') {
      drawChart();
      animationFrameId = requestAnimationFrame(loop);
    } else {
      animationFrameId = null;
    }
  };
  animationFrameId = requestAnimationFrame(loop);
}

function stopSecondAnimationLoop() {
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}

function updateXAdvanceMode(mode: 'tick' | 'second') {
  xAdvanceMode = mode;
  if (mode === 'second') {
    startSecondAnimationLoop();
    addLog('[CHART] Eje X cambiado a modo TEMPORAL (avance por segundo).', 'info');
  } else {
    stopSecondAnimationLoop();
    pruneHistory();
    drawChart();
    addLog('[CHART] Eje X cambiado a modo TICK (avance por tick).', 'info');
  }
}

// Direct connection to Binance public WebSocket stream for ticks (market feed)
function connectBinancePublicWs(symbol: string) {
  // Extract clean symbol (e.g. SOL/USDT:USDT -> SOL/USDT -> solusdt)
  const baseSymbol = symbol.split(":")[0];
  const normalizedSymbol = baseSymbol.replace("/", "").toLowerCase();
  const wsUrl = `wss://fstream.binance.com/ws/${normalizedSymbol}@bookTicker`;

  addLog(`[BINANCE-PUBLIC-WS] Connecting to public ticker feed at ${wsUrl}...`, 'info');
  
  binancePublicWs = new WebSocket(wsUrl);

  binancePublicWs.onopen = () => {
    addLog(`[BINANCE-PUBLIC-WS] Connection established for ${symbol.toUpperCase()} ticker!`, 'success');
  };

  binancePublicWs.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (!data) return;
      // Diagnostic Log: prints tick count or contents

      const bidVal = Number(data.b);
      const askVal = Number(data.a);
      const spread = askVal - bidVal;

      const nowMs = performance.now();
      tickTimes.push(nowMs);
      tickTimes = tickTimes.filter(t => nowMs - t < 1000);
      hz = tickTimes.length;
      if (feedRateValEl) feedRateValEl.innerText = `${hz} Hz`;

      if (!dataSourceFlags.ticker) return;

      const decimals = config.symbol.toLowerCase().includes("pepe") ? 8 : 4;
      if (bidValEl) bidValEl.innerText = formatNum(bidVal, decimals);
      if (askValEl) askValEl.innerText = formatNum(askVal, decimals);
      if (spreadValEl) spreadValEl.innerText = formatNum(spread, decimals);

      history.push({ time: Date.now(), bid: bidVal, ask: askVal });
      pruneHistory();

      // Update Session Unrealized PnL based on live ticker and memory positions
      updatePnLDisplay(bidVal, askVal);

      drawChart();
    } catch (err) {
      console.error("[BINANCE-PUBLIC-WS] Parse error:", err);
    }
  };

  binancePublicWs.onclose = () => {
    addLog(`[BINANCE-PUBLIC-WS] Connection closed. Reconnecting in 3s...`, 'warn');
    setTimeout(() => connectBinancePublicWs(symbol), 3000);
  };
}

// Websocket integration
function connectWebSocket() {
  const wsUrl = `ws://127.0.0.1:${config.port}/ws/notifications`;
  addLog(`Connecting to local bot WebSocket at ${wsUrl}...`, 'info');
  
  const ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    if (connBadgeEl && connLedEl && connTextEl) {
      connBadgeEl.style.borderColor = 'rgba(16, 185, 129, 0.2)';
      connBadgeEl.style.background = 'rgba(16, 185, 129, 0.05)';
      connLedEl.className = 'led led-green';
      connTextEl.textContent = 'CONNECTED';
    }
    addLog(`WebSocket connection established! Listening for local metrics/logs.`, 'success');
    // Fetch latest open orders to sync
    fetchOpenOrders();
  };

  ws.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      
      if (payload.type === 'ticker_update' && payload.data) {
        // Ticker updates are handled directly by public Binance WS
        return;
      }
      else if (payload.type === 'stats_update' && payload.data) {
        const d = payload.data;
        if (placedSuccessValEl) placedSuccessValEl.innerText = d.placed_success.toString();
        if (placedFailedValEl) placedFailedValEl.innerText = d.placed_failed.toString();
        if (modifiedValEl) modifiedValEl.innerText = d.modified.toString();
        if (buySellValEl) buySellValEl.innerText = `${d.buys} / ${d.sells}`;
        if (modsListEl && d.last_modifications) {
          updateModificationsList(d.last_modifications);
        }
      }
      else if (payload.type === 'order_update' && payload.data) {
        // Consolidated: order updates are now processed EXCLUSIVELY via Tauri's Rust Core private WS stream.
        return;
      }
      else if (payload.type === 'modifications_update' && payload.data) {
        updateModificationsList(payload.data);
      }
      else if (payload.type === 'query_log' && payload.data) {
        const d = payload.data;
        const isCancelQuery = d.method.toUpperCase().includes("DELETE /FAPI/V1/ORDER") || d.method.toLowerCase().includes("cancel_order");
        if (d.is_error && isCancelQuery) {
          let orderId = "";
          const paramsStr = typeof d.parameters === 'string' ? d.parameters : JSON.stringify(d.parameters);
          const idMatch = paramsStr.match(/orderId['"\s:]+([0-9a-zA-Z_-]+)/i) || paramsStr.match(/id['"\s:]+([0-9a-zA-Z_-]+)/i);
          if (idMatch) orderId = idMatch[1];
          
          let priceVal = history.length > 0 ? history[history.length - 1].bid : 0;
          let isBuy = true;
          
          const existingOrder = openOrders.find(o => String(o.id) === String(orderId)) || 
                                hftEvents.find(e => e.orderId && String(e.orderId) === String(orderId));
          if (existingOrder) {
            priceVal = existingOrder.price || priceVal;
            isBuy = ('side' in existingOrder) ? (existingOrder.side.toUpperCase() === 'BUY') : true;
          }
          
          hftEvents.push({
            e: 'HFT_EVENT',
            type: isBuy ? 'cancel_buy_failed' : 'cancel_sell_failed',
            time: d.timestamp || Date.now(),
            price: priceVal,
            qty: 0,
            symbol: config.symbol,
            orderId: orderId,
            detail: `Failed cancellation: ${d.error || 'Unknown error'}`
          });
          
          if (hftEvents.length > 500) {
            hftEvents.shift();
          }
          addLog(`[CANCEL ERROR] Failed to cancel order #${orderId}: ${d.error || 'Unknown error'}`, 'err');
          drawChart();
        } else {
          const priceVal = history.length > 0 ? history[history.length - 1].bid : 0;
          const timeVal = d.timestamp || Date.now();
          
          hftEvents.push({
            e: 'HFT_EVENT',
            type: 'query',
            time: timeVal,
            price: priceVal,
            qty: 0,
            symbol: config.symbol,
            detail: `${d.method} | Params: ${JSON.stringify(d.parameters)}`
          });
          
          if (hftEvents.length > 500) {
            hftEvents.shift();
          }

          if (d.is_error) {
            addLog(`[QUERY ERROR] ${d.method} failed: ${d.error || 'Unknown error'}`, 'err');
          }
          
          drawChart();
        }
      }
      else if (payload.type === 'ws_log' && payload.data) {
        const d = payload.data;
        console.debug(`[WS PACKET] ${d.url} - Size: ${d.length} bytes - Snippet: ${d.snippet}`);
      }
      else {
        const type = payload.type || 'EVENT';
        const rawString = JSON.stringify(payload.data || payload);
        addLog(`[${type}] ${rawString}`, 'info');
      }
    } catch (e) {
      console.error("Error parsing websocket message", e);
    }
  };

  ws.onclose = () => {
    if (connBadgeEl && connLedEl && connTextEl) {
      connBadgeEl.style.borderColor = 'rgba(239, 68, 68, 0.2)';
      connBadgeEl.style.background = 'rgba(239, 68, 68, 0.05)';
      connLedEl.className = 'led led-red';
      connTextEl.textContent = 'DISCONNECTED';
    }
    addLog(`WebSocket disconnected. Retrying in 3s...`, 'err');
    setTimeout(connectWebSocket, 3000);
  };

  ws.onerror = () => {
    ws.close();
  };
}

// Sizing logic
function handleResize() {
  if (!canvasEl) return;
  const rect = canvasEl.parentElement!.getBoundingClientRect();
  canvasEl.width = rect.width;
  canvasEl.height = rect.height;
  drawChart();
}

// Open Orders management
async function fetchOpenOrders() {
  const parentPort = config.parent_api_port || "8000";
  try {
    const response = await fetch(`http://127.0.0.1:${parentPort}/api/orders/open`);
    if (response.ok) {
      const data = await response.json();
      if (data && Array.isArray(data)) {
        // Normalize symbol comparison
        const activeSymbol = config.symbol.replace("/", "").replace(":", "").toUpperCase();
        openOrders = data.filter((o: any) => {
          const oSym = o.symbol.replace("/", "").replace(":", "").toUpperCase();
          return oSym === activeSymbol;
        }).map((o: any) => ({
          id: o.id,
          symbol: o.symbol,
          type: o.type,
          side: o.side,
          price: Number(o.price || 0),
          amount: Number(o.amount || 0),
          filled: Number(o.filled || 0),
          remaining: Number(o.remaining || 0),
          status: o.status,
          datetime: o.datetime
        }));
        renderOpenOrders();
      }
    }
  } catch (err) {
    console.error("Failed to fetch initial open orders:", err);
  }
}

function renderOpenOrders() {
  if (!openOrdersWrapperEl) return;
  
  if (openOrders.length === 0) {
    openOrdersWrapperEl.innerHTML = `
      <div class="open-orders-empty">
        <span>📭</span>
        <span>No open orders on the grid.</span>
      </div>
    `;
    return;
  }

  const decimals = config.symbol.toLowerCase().includes("pepe") ? 8 : 4;
  
  let html = `
    <table class="open-orders-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>SYMBOL</th>
          <th>SIDE</th>
          <th>PRICE</th>
          <th>AMOUNT</th>
          <th>FILLED</th>
          <th>REMAINING</th>
          <th>TYPE</th>
          <th style="text-align: center;">ACTION</th>
        </tr>
      </thead>
      <tbody>
  `;

  for (const order of openOrders) {
    const isBuy = order.side.toUpperCase() === 'BUY';
    const sideClass = isBuy ? 'buy' : 'sell';
    const sideText = order.side.toUpperCase();
    const formattedPrice = Number(order.price).toFixed(decimals);
    const formattedAmount = Number(order.amount).toFixed(2);
    const formattedFilled = Number(order.filled).toFixed(2);
    const formattedRemaining = Number(order.remaining).toFixed(2);

    html += `
      <tr>
        <td style="color: var(--text-secondary);">#${order.id}</td>
        <td style="font-weight: 700;">${order.symbol}</td>
        <td>
          <span class="open-orders-side ${sideClass}">${sideText}</span>
        </td>
        <td style="font-weight: 700;">$${formattedPrice}</td>
        <td style="color: #e5e7eb;">${formattedAmount}</td>
        <td style="color: var(--text-secondary);">${formattedFilled}</td>
        <td style="color: #f3f4f6;">${formattedRemaining}</td>
        <td style="color: var(--text-secondary);">${order.type}</td>
        <td style="text-align: center;">
          <button class="btn-cancel-order" data-id="${order.id}" data-symbol="${order.symbol}">CANCEL</button>
        </td>
      </tr>
    `;
  }

  html += `
      </tbody>
    </table>
  `;

  openOrdersWrapperEl.innerHTML = html;

  // Bind cancel buttons
  const buttons = openOrdersWrapperEl.querySelectorAll('.btn-cancel-order');
  buttons.forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const target = e.currentTarget as HTMLButtonElement;
      const orderId = target.getAttribute('data-id')!;
      const orderSym = target.getAttribute('data-symbol')!;
      await cancelOrder(orderId, orderSym);
      // Optimistically remove or trigger refresh
      openOrders = openOrders.filter(o => o.id !== orderId);
      renderOpenOrders();
    });
  });
}

let lastLoggedProcessCount = -1;

// Set to keep track of process IDs seen in active state during this session
const trackedSessionProcessIds = new Set<number>();
const completedSessionProcessIds = new Set<number>();

async function fetchActivePipelines() {
  const parentPort = config.parent_api_port || "8000";
  try {
    const response = await fetch(`http://127.0.0.1:${parentPort}/api/pipelines/active`);
    if (response.ok) {
      const rawText = await response.clone().text();
      const data: ChasePipelineProcess[] = await response.json();

      // Register new active processes in the SessionMetricsTracker
      data.forEach((proc) => {
        if (proc.status !== 'COMPLETED' && proc.status !== 'ABORTED') {
          trackedSessionProcessIds.add(proc.id);
          const entryPrice = proc.last_order_price || proc.initial_price || 0;
          if (entryPrice > 0) {
            sessionMetrics.registerPosition({
              processId: proc.id,
              entryPrice: entryPrice,
              amount: proc.amount || 0,
              side: proc.side || 'BUY',
              createdAt: Date.now()
            });
          }
        }
      });

      // Detect processes that transition to COMPLETED or were recently finished
      for (const procId of Array.from(trackedSessionProcessIds)) {
        const proc = data.find(p => p.id === procId);
        // If process is now COMPLETED or no longer present in active list
        if (proc && proc.status === 'COMPLETED' && !completedSessionProcessIds.has(procId)) {
          completedSessionProcessIds.add(procId);
          trackedSessionProcessIds.delete(procId);

          const pos = sessionMetrics.closePosition(procId);
          const entryPrice = pos ? pos.entryPrice : (proc.initial_price || proc.last_order_price || 0);
          const exitPrice = proc.last_tick_price || proc.last_order_price || entryPrice;
          const amount = pos ? pos.amount : (proc.amount || 1);
          const side = pos ? pos.side : (proc.side || 'BUY');

          const isLong = side.toUpperCase() === 'BUY' || side.toUpperCase() === 'LONG';
          const priceDiff = isLong ? (exitPrice - entryPrice) : (entryPrice - exitPrice);
          const tradePnL = priceDiff * amount;

          // Add to Session Realized PnL
          sessionMetrics.addRealizedPnL(tradePnL);
          addLog(`[SESSION PnL] Process #${procId} COMPLETED. Trade PnL: $${tradePnL.toFixed(4)}`, tradePnL >= 0 ? 'success' : 'warn');

          // Find anchor canvas coordinates for exit or entry marker
          let anchorX = canvasEl ? canvasEl.width * 0.5 : 200;
          let anchorY = canvasEl ? canvasEl.height * 0.5 : 150;

          if (proc.exit_order_id) {
            const foundMarker = activeMarkers.find(m => m.events.some(e => String(e.orderId) === String(proc.exit_order_id)));
            if (foundMarker) {
              anchorX = foundMarker.x;
              anchorY = foundMarker.y;
            }
          }

          // Trigger 10-second golden coin animation
          coinAnimationManager.triggerCoinAnimation(
            procId,
            entryPrice,
            exitPrice,
            amount,
            side,
            anchorX,
            anchorY
          );
        }
      }

      // Permanently register orderId -> processId relations for lifetime display
      data.forEach(proc => orderProcessRegistry.registerProcess(proc));

      activeChaseProcesses = data;
      if (data.length !== lastLoggedProcessCount) {
        lastLoggedProcessCount = data.length;
        addLog(`[ACTIVE PIPELINES API] ${data.length} procesos activos recibidos: ${rawText}`, 'info');
      }

      // Update PnL displays
      const latestBid = history.length > 0 ? history[history.length - 1].bid : 0;
      const latestAsk = history.length > 0 ? history[history.length - 1].ask : 0;
      updatePnLDisplay(latestBid, latestAsk);

      drawChart();
    }
  } catch (err) {
    console.warn("Failed to fetch active pipeline processes:", err);
  }
}

async function cancelOrder(orderId: string, symbol: string) {
  const orderObj = openOrders.find(o => String(o.id) === String(orderId));
  try {
    addLog(`Sending cancellation request for order #${orderId}...`, 'info');
    let binanceSymbol = symbol.replace("/", "").replace(":", "");
    const response = await fetch(`http://localhost:8001/fapi/v1/order?symbol=${binanceSymbol}&orderId=${orderId}`, {
      method: 'DELETE',
    });
    let resData: any = {};
    const contentType = response.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
      resData = await response.json();
    } else {
      resData = { msg: await response.text() };
    }
    if (!response.ok) {
      throw new Error(resData.msg || 'Error processing cancellation');
    }
    addLog(`Order #${orderId} cancelled successfully on exchange.`, 'success');
  } catch (err: any) {
    addLog(`Error cancelling order #${orderId}: ${err.message}`, 'err');
    if (orderObj) {
      const isBuy = orderObj.side.toUpperCase() === 'BUY';
      hftEvents.push({
        e: 'HFT_EVENT',
        type: isBuy ? 'cancel_buy_failed' : 'cancel_sell_failed',
        time: Date.now(),
        price: orderObj.price,
        qty: orderObj.amount,
        symbol: symbol,
        orderId: orderId,
        detail: `Cancellation failed: ${err.message}`
      });
      if (hftEvents.length > 500) {
        hftEvents.shift();
      }
      drawChart();
    }
  }
}

// Init procedure
window.addEventListener("DOMContentLoaded", async () => {
  // Query UI selectors
  botTitleEl = document.getElementById("bot-title");
  connBadgeEl = document.getElementById("conn-badge");
  connLedEl = document.getElementById("conn-led");
  connTextEl = document.getElementById("conn-text");
  symbolDisplayEl = document.getElementById("symbol-display");
  instanceIdDisplayEl = document.getElementById("instance-id-display");
  portDisplayEl = document.getElementById("port-display");
  
  bidValEl = document.getElementById("bid-val");
  askValEl = document.getElementById("ask-val");
  spreadValEl = document.getElementById("spread-val");
  feedRateValEl = document.getElementById("feed-rate-val");

  placedSuccessValEl = document.getElementById("placed-success-val");
  placedFailedValEl = document.getElementById("placed-failed-val");
  modifiedValEl = document.getElementById("modified-val");
  buySellValEl = document.getElementById("buy-sell-val");
  sessionPnLValEl = document.getElementById("session-pnl-val");
  unrealizedPnLValEl = document.getElementById("unrealized-pnl-val");

  canvasEl = document.getElementById("hft-chart") as HTMLCanvasElement;
  modsListEl = document.getElementById("mods-list");
  openOrdersWrapperEl = document.getElementById("open-orders-wrapper");
  tooltipEl = document.getElementById("chart-tooltip");
  samplesSelectEl = document.getElementById("samples-select") as HTMLSelectElement;
  logConsoleEl = document.getElementById("log-console");
  clearLogBtnEl = document.getElementById("clear-log-btn");

  // ── BASE AMOUNT (USD) Config Handling ─────────────────────────────────────
  const baseAmountInput = document.getElementById("base-amount-input") as HTMLInputElement;
  const btnSaveBaseAmount = document.getElementById("btn-save-base-amount") as HTMLButtonElement;

  if (baseAmountInput && btnSaveBaseAmount) {
    // Initial fetch of trade_amount from PostgreSQL via API
    fetch("http://127.0.0.1:8000/api/bot/config")
      .then(res => res.json())
      .then(data => {
        if (data && data.trade_amount) {
          baseAmountInput.value = data.trade_amount.toString();
        }
      })
      .catch(err => console.error("[BASE USD] Error fetching initial config:", err));

    btnSaveBaseAmount.addEventListener("click", async () => {
      const val = parseFloat(baseAmountInput.value);
      if (isNaN(val) || val <= 0) {
        addLog("[BASE USD ERROR] Ingrese un valor mayor a 0", "warn");
        return;
      }
      try {
        btnSaveBaseAmount.disabled = true;
        btnSaveBaseAmount.textContent = "...";
        const res = await fetch("http://127.0.0.1:8000/api/bot/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trade_amount: val })
        });
        if (res.ok) {
          addLog(`[BASE USD UPDATED] Nuevo valor base en PostgreSQL: $${val} USD`, "info");
        } else {
          addLog(`[BASE USD ERROR] Error en la API al guardar`, "err");
        }
      } catch (err) {
        addLog(`[BASE USD ERROR] ${err}`, "err");
      } finally {
        btnSaveBaseAmount.disabled = false;
        btnSaveBaseAmount.textContent = "SET";
      }
    });
  }

  if (canvasEl) {
    // ── Mouse hover tracking for Tooltip ────────────────────────────────────

    canvasEl.addEventListener("mousemove", (e: MouseEvent) => {
      const rect = canvasEl!.getBoundingClientRect();
      mouseX = e.clientX - rect.left;
      mouseY = e.clientY - rect.top;

      let hoverMarker: VisualMarker | null = null;
      for (const marker of activeMarkers) {
        const dx = mouseX! - marker.x;
        const dy = mouseY! - marker.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 15) {
          hoverMarker = marker;
          break;
        }
      }

      if (hoverMarker) {
        if (tooltipEl) {
          const isCluster = hoverMarker.events.length > 1;
          let content = `<div style="font-weight: 700; border-bottom: 1px solid rgba(255,255,255,0.15); padding-bottom: 5px; margin-bottom: 6px; color: #60a5fa; font-size: 11px; display: flex; justify-content: space-between; align-items: center;">`;
          content += `<span>${isCluster ? `CLUSTER (${hoverMarker.events.length} Eventos)` : 'DETALLE DEL EVENTO'}</span>`;
          content += `<span style="color: #94a3b8; font-weight: normal; font-size: 10px;">${config.symbol}</span></div>`;

          content += `<div style="max-height: 240px; overflow-y: auto; padding-right: 2px;">`;

          hoverMarker.events.forEach((evt, idx) => {
            const timeStr = new Date(evt.time).toLocaleTimeString('es-ES', { hour12: false }) + '.' + String(evt.time % 1000).padStart(3, '0');
            const typeUpper = evt.type.toUpperCase();
            const decimals = config.symbol.toLowerCase().includes("pepe") ? 8 : 4;
            const priceStr = evt.price !== undefined ? evt.price.toFixed(decimals) : '--';
            const qtyStr = evt.qty !== undefined ? evt.qty.toString() : '--';

            let typeColor = '#60a5fa';
            if (typeUpper.includes('BUY')) typeColor = '#10b981';
            else if (typeUpper.includes('SELL')) typeColor = '#ef4444';
            else if (typeUpper.includes('CANCEL')) typeColor = '#f59e0b';

            let chaseBadgeHtml = '';
            if (evt.orderId) {
              const procInfo = orderProcessRegistry.getProcessInfo(evt.orderId);
              const chaseProc = procInfo ? null : activeChaseProcesses.find(p =>
                p.status !== 'COMPLETED' && p.status !== 'ABORTED' &&
                (String(p.entry_order_id) === String(evt.orderId) || String(p.exit_order_id) === String(evt.orderId))
              );

              const procId = procInfo ? procInfo.processId : chaseProc ? chaseProc.id : null;
              const role = procInfo ? procInfo.role : chaseProc ? (String(chaseProc.entry_order_id) === String(evt.orderId) ? 'E' : 'X') : null;

              if (procId !== null && role !== null) {
                const roleLbl = role === 'E' ? 'ENTRY [E]' : 'EXIT [X]';
                const roleColor = role === 'E' ? '#06b6d4' : '#10b981';
                chaseBadgeHtml = `<span style="background: ${roleColor}22; color: ${roleColor}; border: 1px solid ${roleColor}66; padding: 1px 5px; border-radius: 3px; font-size: 9px; font-weight: bold;">CHASE #${procId} (${roleLbl})</span>`;
              }
            }

            const borderTop = idx > 0 ? 'border-top: 1px dashed rgba(255,255,255,0.08); margin-top: 6px; padding-top: 6px;' : '';

            content += `
              <div style="${borderTop} font-size: 11px; line-height: 1.4;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
                  <span style="color: ${typeColor}; font-weight: bold;">${typeUpper}</span>
                  <span style="color: #94a3b8; font-size: 10px;">${timeStr}</span>
                </div>
                ${chaseBadgeHtml ? `<div style="margin-bottom: 3px;">${chaseBadgeHtml}</div>` : ''}
                <table style="width: 100%; border-collapse: collapse; font-size: 10px; margin-top: 2px; color: #cbd5e1;">
                  ${evt.orderId ? `<tr><td style="color: #64748b; padding-right: 6px; width: 60px;">Order ID:</td><td style="font-weight: 600; font-family: monospace; color: #f1f5f9;">${evt.orderId}</td></tr>` : ''}
                  <tr><td style="color: #64748b; padding-right: 6px; width: 60px;">Precio:</td><td style="color: #38bdf8; font-weight: 600;">$${priceStr}</td></tr>
                  <tr><td style="color: #64748b; padding-right: 6px; width: 60px;">Cantidad:</td><td style="color: #f1f5f9;">${qtyStr}</td></tr>
                  ${evt.detail ? `<tr><td style="color: #64748b; padding-right: 6px; vertical-align: top; width: 60px;">Detalle:</td><td style="color: #94a3b8; word-break: break-word;">${evt.detail}</td></tr>` : ''}
                </table>
              </div>
            `;
          });

          content += `</div>`;
          tooltipEl.innerHTML = content;
          tooltipEl.style.display = 'block';

          const tooltipWidth = tooltipEl.offsetWidth || 260;
          const tooltipHeight = tooltipEl.offsetHeight || 120;

          let leftPos = e.clientX + 15;
          let topPos = e.clientY + 15;
          
          if (e.clientX + tooltipWidth + 15 > window.innerWidth) {
            leftPos = e.clientX - tooltipWidth - 15;
          }
          if (e.clientY + tooltipHeight + 15 > window.innerHeight) {
            topPos = e.clientY - tooltipHeight - 15;
          }

          if (leftPos < 10) leftPos = 10;
          if (topPos < 10) topPos = 10;
          
          tooltipEl.style.left = `${leftPos}px`;
          tooltipEl.style.top = `${topPos}px`;
        }
      } else {
        if (tooltipEl) tooltipEl.style.display = 'none';
      }

      drawChart();
    });

    canvasEl.addEventListener("mouseleave", () => {
      mouseX = null;
      mouseY = null;
      if (tooltipEl) tooltipEl.style.display = 'none';
      drawChart();
    });

    // ── Attach SOLID Viewport Controller (2D Panning & Y Zoom) ─────────────
    chartViewportController.attach(
      canvasEl,
      () => drawChart(),
      () => {
        let min = Infinity, max = -Infinity;
        for (const pt of history) {
          if (pt.bid > 0 && pt.bid < min) min = pt.bid;
          if (pt.ask > 0 && pt.ask > max) max = pt.ask;
        }
        if (min === Infinity || max === -Infinity) { min = 0; max = 0.004; }
        return { min, max };
      },
      () => maxPoints
    );
  }

  // ── Attach SOLID Scale & Fullscreen Controls ─────────────────────────────
  const zoomOutBtn = document.getElementById("btn-chart-zoom-out");
  const zoomInBtn = document.getElementById("btn-chart-zoom-in");
  const resetScaleBtn = document.getElementById("btn-chart-reset-scale");
  const scaleLabel = document.getElementById("chart-scale-label");
  const fullscreenBtn = document.getElementById("btn-chart-fullscreen");
  const chartSection = document.querySelector(".chart-section") as HTMLElement;

  const updateScaleUI = () => {
    if (scaleLabel) scaleLabel.innerText = chartDisplayConfig.getFormattedScale();
  };

  if (zoomOutBtn) {
    zoomOutBtn.addEventListener("click", () => {
      chartDisplayConfig.zoomOut();
      updateScaleUI();
    });
  }

  if (zoomInBtn) {
    zoomInBtn.addEventListener("click", () => {
      chartDisplayConfig.zoomIn();
      updateScaleUI();
    });
  }

  if (resetScaleBtn) {
    resetScaleBtn.addEventListener("click", () => {
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
        drawChart();
      }, 60);
    };

    fullscreenBtn.addEventListener("click", () => {
      const isFull = chartDisplayConfig.toggleFullscreen(chartSection);
      fullscreenBtn.innerHTML = isFull ? '⛶ Exit Fullscreen' : '⛶ Fullscreen';
      handleFullscreenResize();
    });

    document.addEventListener("fullscreenchange", () => {
      const isFull = chartDisplayConfig.isFullscreen();
      fullscreenBtn.innerHTML = isFull ? '⛶ Exit Fullscreen' : '⛶ Fullscreen';
      handleFullscreenResize();
    });
  }

  // Load instance variables from Tauri Rust environment
  try {
    config = await invoke<InstanceConfig>("get_instance_config");
    
    if (botTitleEl) botTitleEl.innerText = `BOT INSTANCE #${config.instance_id}`;
    if (symbolDisplayEl) symbolDisplayEl.innerText = config.symbol;
    if (instanceIdDisplayEl) instanceIdDisplayEl.innerText = config.instance_id;
    if (portDisplayEl) portDisplayEl.innerText = config.port;
    
    await fetchOpenOrders();

    // Listen to private WebSocket stream direct from Rust Core
    await listen("binance-private-event", (event) => {
      handleBinancePrivateEvent(event.payload as string);
    });

    // Listen to native Rust Core system logs
    await listen("binance-rust-log", (event) => {
      addLog(event.payload as string, 'info');
    });

    // Trigger asynchronous stream initialization in Rust Core now that listeners are ready
    await invoke("start_private_stream");
  } catch (err) {
    addLog(`Error fetching instance variables: ${err}`, 'err');
  }

  // Layout callbacks
  window.addEventListener('resize', handleResize);
  setTimeout(handleResize, 100);

  if (samplesSelectEl) {
    samplesSelectEl.addEventListener("change", (e) => {
      maxPoints = Number((e.target as HTMLSelectElement).value);
      pruneHistory();
      drawChart();
    });
  }

  const xAdvanceSelectEl = document.getElementById("x-advance-select") as HTMLSelectElement | null;
  if (xAdvanceSelectEl) {
    xAdvanceSelectEl.addEventListener("change", (e) => {
      const mode = (e.target as HTMLSelectElement).value as 'tick' | 'second';
      updateXAdvanceMode(mode);
    });
  }

  if (clearLogBtnEl) {
    clearLogBtnEl.addEventListener("click", () => {
      if (logConsoleEl) logConsoleEl.innerHTML = "";
    });
  }

  // Load initial chase behavior and set selector
  const chaseSelectEl = document.getElementById("chase-behavior-select") as HTMLSelectElement | null;
  if (chaseSelectEl) {
    const parentPort = config.parent_api_port || "8000";
    try {
      const response = await fetch(`http://127.0.0.1:${parentPort}/api/grid/instances/${config.instance_id}/telemetry`);
      if (response.ok) {
        const data = await response.json();
        if (data && data.chase_behavior) {
          chaseSelectEl.value = data.chase_behavior;
          addLog(`Initial chase behavior loaded: ${data.chase_behavior.toUpperCase()}`, 'info');
        }
      }
    } catch (err) {
      console.warn("Failed to load initial chase behavior via telemetry endpoint.", err);
    }

    chaseSelectEl.addEventListener("change", async (e) => {
      const val = (e.target as HTMLSelectElement).value;
      const parentPort = config.parent_api_port || "8000";
      addLog(`Changing chase behavior to ${val.toUpperCase()} in hot...`, 'info');
      try {
        const res = await fetch(`http://127.0.0.1:${parentPort}/api/grid/instances/${config.instance_id}/chase-behavior`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ behavior: val })
        });
        if (res.ok) {
          addLog(`Successfully changed chase behavior to ${val.toUpperCase()} in hot!`, 'success');
        } else {
          const errData = await res.json().catch(() => ({ detail: res.statusText }));
          addLog(`Failed to change chase behavior: ${errData.detail}`, 'err');
        }
      } catch (err) {
        addLog(`Error updating chase behavior: ${err}`, 'err');
      }
    });
  }

  // Connect to public and local data sockets
  connectBinancePublicWs(config.symbol);
  connectWebSocket();

  // Fetch active Chase v2 pipeline processes and set up periodic refresh
  fetchActivePipelines();
  setInterval(fetchActivePipelines, 3000);

  // Initialize data source control panel
  initDataSourceControls();
});

interface ModificationInfo {
  timestamp: number;
  order_id: string;
  side: string;
  quantity: number;
  old_price: number | null;
  new_price: number | null;
}

function updateModificationsList(mods: ModificationInfo[]) {
  if (!modsListEl) return;
  if (mods.length === 0) {
    modsListEl.innerHTML = '<div class="mod-row-placeholder">No modifications detected yet.</div>';
    return;
  }

  modsListEl.innerHTML = "";

  const sortedMods = [...mods].reverse();
  const decimals = config.symbol.toLowerCase().includes("pepe") ? 8 : 4;

  for (const m of sortedMods) {
    const card = document.createElement("div");
    card.className = "mod-card";

    const header = document.createElement("div");
    header.className = "mod-card-header";
    
    const sideBadge = document.createElement("span");
    sideBadge.className = `mod-card-side ${m.side.toLowerCase()}`;
    sideBadge.innerText = m.side;

    const timeSpan = document.createElement("span");
    timeSpan.className = "mod-card-time";
    timeSpan.innerText = new Date(m.timestamp).toLocaleTimeString();

    header.appendChild(sideBadge);
    header.appendChild(timeSpan);

    const body = document.createElement("div");
    body.className = "mod-card-body";

    const priceRow = document.createElement("div");
    priceRow.className = "mod-card-price-row";

    const priceChange = document.createElement("div");
    priceChange.className = "mod-card-price-change";

    if (m.old_price !== null && m.new_price !== null) {
      const oldPriceSpan = document.createElement("span");
      oldPriceSpan.className = "price-old";
      oldPriceSpan.innerText = m.old_price.toFixed(decimals);

      const arrow = document.createElement("span");
      arrow.className = "price-arrow";
      arrow.innerHTML = "&rarr;";

      const newPriceSpan = document.createElement("span");
      newPriceSpan.className = "price-new";
      newPriceSpan.innerText = m.new_price.toFixed(decimals);

      priceChange.appendChild(oldPriceSpan);
      priceChange.appendChild(arrow);
      priceChange.appendChild(newPriceSpan);

      const pctSpan = document.createElement("span");
      const pct = ((m.new_price - m.old_price) / m.old_price) * 100;
      if (pct > 0) {
        pctSpan.className = "price-pct up";
        pctSpan.innerText = `+${pct.toFixed(3)}%`;
      } else if (pct < 0) {
        pctSpan.className = "price-pct down";
        pctSpan.innerText = `${pct.toFixed(3)}%`;
      } else {
        pctSpan.className = "price-pct neutral";
        pctSpan.innerText = "0.000%";
      }
      priceRow.appendChild(priceChange);
      priceRow.appendChild(pctSpan);
    } else if (m.new_price !== null) {
      const newPriceSpan = document.createElement("span");
      newPriceSpan.className = "price-new";
      newPriceSpan.innerText = m.new_price.toFixed(decimals);
      priceChange.appendChild(newPriceSpan);
      priceRow.appendChild(priceChange);
    }

    const detailsRow = document.createElement("div");
    detailsRow.className = "mod-card-details";

    const qtySpan = document.createElement("span");
    qtySpan.className = "mod-card-qty";
    qtySpan.innerText = `QTY: ${m.quantity}`;

    const idSpan = document.createElement("span");
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

/**
 * Parses raw JSON messages from Binance Futures User Data Stream WebSocket
 * received directly through Tauri's Rust core native proxy.
 */
function handleBinancePrivateEvent(rawData: string) {
  try {
    addLog(`[PRIVATE DIRECT RX] Payload: ${rawData.slice(0, 150)}...`, 'success');
    // ── Diagnostic Marker Injector ──
    // This forces a visual blue query dot on the chart for EVERY message received from Rust Core
    // to visually confirm that the communication channel works.
    const priceValDiag = history.length > 0 ? history[history.length - 1].bid : 0;
    hftEvents.push({
      e: 'HFT_EVENT',
      type: 'query',
      time: Date.now(),
      price: priceValDiag,
      qty: 0,
      symbol: 'DIAGNOSTIC',
      detail: `[Rust WS Payload Received] Length: ${rawData.length} bytes`
    });
    if (hftEvents.length > 500) hftEvents.shift();
    drawChart();

    const event = JSON.parse(rawData);
    if (!event || !event.e) return;

    if (event.e === "ORDER_TRADE_UPDATE" && event.o) {
      if (!dataSourceFlags.orders) return; // respect flags
      const o = event.o;
      
      const symbol = o.s || "UNKNOWN";
      const activeSymbol = config.symbol.split(":")[0].replace("/", "").replace(":", "").toUpperCase();
      const eventSymbol = symbol.replace("/", "").replace(":", "").toUpperCase();
      if (activeSymbol !== eventSymbol) return;

      const side = o.S || "BUY";
      const status = o.X || "NEW";
      const executionType = o.x || "NEW";
      const price = Number(o.p || 0);
      const qty = Number(o.q || 0);
      const orderId = String(o.i || '');

      const msg = `[RUST-DIRECT-WS] ${side} ${qty} ${symbol} @ ${price} | Status: ${status} (exec: ${executionType})`;
      addLog(msg, status === 'FILLED' ? 'success' : (status === 'CANCELED' || status === 'REJECTED') ? 'warn' : 'info');

      const isBuy = side.toUpperCase() === 'BUY';
      const isFilled = status === 'FILLED';
      const isCanceled = status === 'CANCELED' || status === 'EXPIRED';

      let markerType: HftEvent['type'] = isBuy ? 'buy_placed' : 'sell_placed';
      if (isFilled) {
        markerType = isBuy ? 'buy' : 'sell';
      } else if (isCanceled) {
        markerType = isBuy ? 'cancel_buy' : 'cancel_sell';
      }

      hftEvents.push({
        e: 'HFT_EVENT',
        type: markerType,
        time: Date.now(),
        price: price,
        qty: qty,
        symbol: symbol,
        orderId: orderId,
        detail: `[Direct] Status: ${status} | Exec: ${executionType}`
      });

      fetchOpenOrders();
    } else if (event.e === "ACCOUNT_UPDATE") {
      const wallets = event.a?.B || [];
      for (const w of wallets) {
        if (w.a === "USDT" && Number(w.wb) > 0) {
          addLog(`[RUST-DIRECT-WS] Wallet Update → Asset: ${w.a} | Balance: ${w.wb}`, 'info');
        }
      }
    }
  } catch (err: any) {
    console.error("Failed to parse Binance private user data event:", err);
  }
}

/** Bind toggle switches and global ALL ON / ALL OFF buttons. */
function initDataSourceControls() {
  const ALL_KEYS: DataSourceKey[] = ['ticker', 'orders', 'queries', 'stats', 'mods', 'chart'];

  for (const key of ALL_KEYS) {
    const card = document.getElementById(`ds-card-${key}`);
    if (card) card.classList.add('ds-active');
  }

  for (const key of ALL_KEYS) {
    const sw = document.getElementById(`ds-switch-${key}`) as HTMLInputElement | null;
    if (!sw) continue;
    sw.addEventListener('change', () => {
      setDataSource(key, sw.checked);
    });
  }

  const enableAllBtn = document.getElementById('ds-enable-all-btn');
  if (enableAllBtn) {
    enableAllBtn.addEventListener('click', () => {
      for (const key of ALL_KEYS) setDataSource(key, true);
      addLog('[DATA FEED] Todas las fuentes activadas.', 'success');
    });
  }

  const disableAllBtn = document.getElementById('ds-disable-all-btn');
  if (disableAllBtn) {
    disableAllBtn.addEventListener('click', () => {
      for (const key of ALL_KEYS) setDataSource(key, false);
      addLog('[DATA FEED] Todas las fuentes desactivadas.', 'warn');
    });
  }
}

/**
 * Updates Session Realized PnL and Unrealized PnL DOM elements
 * with formatted currency and status neon colors.
 */
function updatePnLDisplay(currentBid: number, currentAsk: number) {
  const realizedPnL = sessionMetrics.getRealizedPnL();
  const unrealizedPnL = sessionMetrics.calculateUnrealizedPnL(currentBid, currentAsk);

  if (sessionPnLValEl) {
    const sign = realizedPnL > 0 ? '+' : '';
    sessionPnLValEl.innerText = `$${sign}${realizedPnL.toFixed(4)}`;
    sessionPnLValEl.className = 'card-price ' + (realizedPnL > 0 ? 'pnl-positive' : realizedPnL < 0 ? 'pnl-negative' : 'pnl-neutral');
  }

  if (unrealizedPnLValEl) {
    const sign = unrealizedPnL > 0 ? '+' : '';
    unrealizedPnLValEl.innerText = `$${sign}${unrealizedPnL.toFixed(4)}`;
    unrealizedPnLValEl.className = 'card-price ' + (unrealizedPnL > 0 ? 'pnl-positive' : unrealizedPnL < 0 ? 'pnl-negative' : 'pnl-neutral');
  }
}

// ── BotInstance Configuration Manager Controller ────────────────────────────

interface BotInstanceData {
  id: number;
  name: string;
  symbol: string;
  strategy_type: string;
  allocated_capital: number;
  used_capital?: number;
  status: string;
  params: Record<string, any>;
}

let loadedInstances: BotInstanceData[] = [];
let selectedInstanceId: number | null = null;

async function fetchBotInstancesList(): Promise<BotInstanceData[]> {
  try {
    const parentPort = config?.parent_api_port || "8000";
    const res = await fetch(`http://127.0.0.1:${parentPort}/api/grid/instances`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data as BotInstanceData[];
  } catch (err: any) {
    console.error("Failed to fetch bot instances:", err);
    addLog(`[INSTANCES] Error cargando instancias: ${err.message}`, "err");
    return [];
  }
}

function renderInstanceForm(inst: BotInstanceData) {
  const nameEl = document.getElementById("inst-edit-name") as HTMLInputElement;
  const symbolEl = document.getElementById("inst-edit-symbol") as HTMLInputElement;
  const stratEl = document.getElementById("inst-edit-strategy") as HTMLSelectElement;
  const statusEl = document.getElementById("inst-edit-status") as HTMLSelectElement;
  const capEl = document.getElementById("inst-edit-capital") as HTMLInputElement;

  const profitEl = document.getElementById("inst-edit-profit-pc") as HTMLInputElement;
  const threshEl = document.getElementById("inst-edit-threshold-pc") as HTMLInputElement;
  const chaseEl = document.getElementById("inst-edit-chase") as HTMLSelectElement;
  const bypassEl = document.getElementById("inst-edit-bypass-guards") as HTMLInputElement;
  const disableScaleEl = document.getElementById("inst-edit-disable-scaling") as HTMLInputElement;

  const rawJsonEl = document.getElementById("inst-edit-raw-json") as HTMLTextAreaElement;

  if (nameEl) nameEl.value = inst.name || "";
  if (symbolEl) symbolEl.value = inst.symbol || "";
  if (stratEl) stratEl.value = inst.strategy_type || "GRID";
  if (statusEl) statusEl.value = inst.status || "ACTIVE";
  if (capEl) capEl.value = (inst.allocated_capital || 0).toString();

  const params = inst.params || {};
  if (profitEl) profitEl.value = ((params.profit_pc ?? 0.005) * 100).toFixed(3);
  if (threshEl) threshEl.value = ((params.threshold_pc ?? 0.01) * 100).toFixed(3);
  if (chaseEl) chaseEl.value = params.chase_behavior || "flat";
  if (bypassEl) bypassEl.checked = !!params.bypass_global_guards;
  if (disableScaleEl) disableScaleEl.checked = !!params.disable_balance_scaling;

  if (rawJsonEl) rawJsonEl.value = JSON.stringify(params, null, 2);
}

function getInstanceStatusColor(status: string): string {
  switch ((status || '').toUpperCase()) {
    case 'ACTIVE':
    case 'RUNNING':
      return '#10b981'; // Verde
    case 'PAUSED':
    case 'IDLE':
    case 'WAITING':
      return '#f59e0b'; // Amarillo / Naranja
    case 'STOPPED':
    case 'ABORTED':
    case 'ERROR':
      return '#ef4444'; // Rojo
    default:
      return '#9ca3af'; // Gris
  }
}

async function refreshInstanceModalDropdown() {
  const selectDropdown = document.getElementById("instance-select-dropdown") as HTMLSelectElement;
  const headerSelector = document.getElementById("header-instance-selector") as HTMLSelectElement;
  
  if (selectDropdown) selectDropdown.innerHTML = `<option value="">Cargando instancias...</option>`;
  if (headerSelector) headerSelector.innerHTML = `<option value="">Cargando bots...</option>`;

  loadedInstances = await fetchBotInstancesList();

  if (loadedInstances.length === 0) {
    if (selectDropdown) selectDropdown.innerHTML = `<option value="">No hay instancias registradas</option>`;
    if (headerSelector) headerSelector.innerHTML = `<option value="">No hay bots</option>`;
    return;
  }

  const modalOptions = loadedInstances.map(inst => {
    const color = getInstanceStatusColor(inst.status);
    return `<option value="${inst.id}" style="color: ${color}; background: #111827;">[ID: ${inst.id}] ${inst.name} (${inst.symbol} - ${inst.strategy_type} - ${inst.status})</option>`;
  }).join("");

  const headerOptions = loadedInstances.map(inst => {
    const isSelected = String(inst.id) === String(config.instance_id) || inst.symbol === config.symbol;
    const color = getInstanceStatusColor(inst.status);
    return `<option value="${inst.id}" ${isSelected ? 'selected' : ''} style="color: ${color}; background: #111827;">● ${inst.name} [${inst.symbol}] (${inst.status})</option>`;
  }).join("");

  if (selectDropdown) selectDropdown.innerHTML = modalOptions;
  if (headerSelector) {
    headerSelector.innerHTML = headerOptions;
    // Ajustar el color del texto del selector según el bot seleccionado
    const selectedInst = loadedInstances.find(i => String(i.id) === String(config.instance_id)) || loadedInstances[0];
    if (selectedInst) {
      headerSelector.style.color = getInstanceStatusColor(selectedInst.status);
    }
  }

  // Select matching active instance or first
  const currentInstanceIdNum = parseInt(config?.instance_id || "1", 10);
  const match = loadedInstances.find(i => i.id === currentInstanceIdNum) || loadedInstances[0];

  if (match) {
    selectedInstanceId = match.id;
    if (selectDropdown) selectDropdown.value = match.id.toString();
    renderInstanceForm(match);
  }
}

function switchActiveInstance(instanceId: string | number) {
  const target = loadedInstances.find(inst => String(inst.id) === String(instanceId));
  if (!target) return;

  addLog(`[HOT-SWAP] Conmutando vista activa a la instancia: ${target.name} (${target.symbol})`, 'info');

  // Actualizar config global de la instancia
  config.instance_id = String(target.id);
  config.symbol = target.symbol;
  if (target.params && target.params.port) {
    config.port = String(target.params.port);
  }

  // Actualizar elementos DOM del Header
  if (botTitleEl) botTitleEl.innerText = `BOT INSTANCE ${target.name.toUpperCase()}`;
  if (symbolDisplayEl) symbolDisplayEl.innerText = target.symbol;
  if (instanceIdDisplayEl) instanceIdDisplayEl.innerText = String(target.id);
  if (portDisplayEl) portDisplayEl.innerText = config.port;

  // Actualizar selector del header y su color si existe
  const headerSelector = document.getElementById("header-instance-selector") as HTMLSelectElement | null;
  if (headerSelector) {
    if (headerSelector.value !== String(target.id)) {
      headerSelector.value = String(target.id);
    }
    headerSelector.style.color = getInstanceStatusColor(target.status);
  }

  // Limpiar estado visual anterior
  history = [];
  hftEvents = [];
  openOrders = [];
  activeChaseProcesses = [];
  drawChart();

  // Reconectar WebSocket público directo de Binance para los ticks del gráfico del nuevo símbolo
  connectBinancePublicWs(target.symbol);

  // Volver a consultar APIs REST para la nueva instancia seleccionada
  fetchOpenOrders();
  fetchActivePipelines();
}

async function saveInstanceConfigHot() {
  if (!selectedInstanceId) return;

  const feedbackEl = document.getElementById("instance-status-feedback");
  if (feedbackEl) feedbackEl.innerText = "Guardando cambios en caliente...";

  const nameEl = document.getElementById("inst-edit-name") as HTMLInputElement;
  const symbolEl = document.getElementById("inst-edit-symbol") as HTMLInputElement;
  const stratEl = document.getElementById("inst-edit-strategy") as HTMLSelectElement;
  const statusEl = document.getElementById("inst-edit-status") as HTMLSelectElement;
  const capEl = document.getElementById("inst-edit-capital") as HTMLInputElement;

  const profitEl = document.getElementById("inst-edit-profit-pc") as HTMLInputElement;
  const threshEl = document.getElementById("inst-edit-threshold-pc") as HTMLInputElement;
  const chaseEl = document.getElementById("inst-edit-chase") as HTMLSelectElement;
  const bypassEl = document.getElementById("inst-edit-bypass-guards") as HTMLInputElement;
  const disableScaleEl = document.getElementById("inst-edit-disable-scaling") as HTMLInputElement;

  const rawJsonEl = document.getElementById("inst-edit-raw-json") as HTMLTextAreaElement;

  // Build params object
  let updatedParams: Record<string, any> = {};
  try {
    if (rawJsonEl && rawJsonEl.value.trim()) {
      updatedParams = JSON.parse(rawJsonEl.value);
    }
  } catch (e) {
    if (feedbackEl) feedbackEl.innerText = "❌ Error sintáctico en JSON raw. Corrija la sintaxis.";
    return;
  }

  if (profitEl) updatedParams["profit_pc"] = parseFloat(profitEl.value) / 100.0;
  if (threshEl) updatedParams["threshold_pc"] = parseFloat(threshEl.value) / 100.0;
  if (chaseEl) updatedParams["chase_behavior"] = chaseEl.value;
  if (bypassEl) updatedParams["bypass_global_guards"] = bypassEl.checked;
  if (disableScaleEl) updatedParams["disable_balance_scaling"] = disableScaleEl.checked;

  const payload = {
    name: nameEl?.value || "Instance",
    symbol: symbolEl?.value || "1000PEPEUSDC",
    strategy_type: stratEl?.value || "GRID",
    status: statusEl?.value || "ACTIVE",
    allocated_capital: parseFloat(capEl?.value || "50"),
    params: updatedParams
  };

  try {
    const parentPort = config?.parent_api_port || "8000";
    const res = await fetch(`http://127.0.0.1:${parentPort}/api/grid/instances/${selectedInstanceId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(errData.detail || "Error actualizando instancia");
    }

    await res.json();
    if (feedbackEl) feedbackEl.innerText = "✅ Configuración actualizada y sincronizada en caliente.";
    addLog(`[INSTANCES] Instancia #${selectedInstanceId} guardada exitosamente. Status: ${payload.status}`, "success");

    // Refresh list
    setTimeout(() => {
      refreshInstanceModalDropdown();
    }, 1000);
  } catch (err: any) {
    console.error("Failed to save instance config:", err);
    if (feedbackEl) feedbackEl.innerText = `❌ Error: ${err.message}`;
    addLog(`[INSTANCES] Error guardando instancia: ${err.message}`, "err");
  }
}

function initInstanceModalListeners() {
  const modalEl = document.getElementById("instances-modal");
  const openBtn = document.getElementById("btn-open-instance-config");
  const closeBtn = document.getElementById("btn-close-instance-modal");
  const cancelBtn = document.getElementById("btn-cancel-instance-modal");
  const refreshBtn = document.getElementById("btn-refresh-instances");
  const saveBtn = document.getElementById("btn-save-instance-modal");
  const selectDropdown = document.getElementById("instance-select-dropdown") as HTMLSelectElement;
  const headerSelector = document.getElementById("header-instance-selector") as HTMLSelectElement;

  if (headerSelector) {
    headerSelector.addEventListener("change", () => {
      if (headerSelector.value) {
        switchActiveInstance(headerSelector.value);
      }
    });
  }

  if (openBtn) {
    openBtn.addEventListener("click", () => {
      if (modalEl) modalEl.style.display = "flex";
      refreshInstanceModalDropdown();
    });
  }

  const closeModal = () => {
    if (modalEl) modalEl.style.display = "none";
  };

  if (closeBtn) closeBtn.addEventListener("click", closeModal);
  if (cancelBtn) cancelBtn.addEventListener("click", closeModal);
  if (refreshBtn) refreshBtn.addEventListener("click", () => refreshInstanceModalDropdown());

  if (selectDropdown) {
    selectDropdown.addEventListener("change", () => {
      const selectedIdNum = parseInt(selectDropdown.value, 10);
      const match = loadedInstances.find(i => i.id === selectedIdNum);
      if (match) {
        selectedInstanceId = match.id;
        renderInstanceForm(match);
      }
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener("click", () => saveInstanceConfigHot());
  }

  // Cargar lista de instancias al iniciar la aplicación para poblar el header selector
  refreshInstanceModalDropdown();
}

// Bind modal listeners on document load
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => initInstanceModalListeners());
} else {
  initInstanceModalListeners();
}

