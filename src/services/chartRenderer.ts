import { TickData, HftEvent, VisualMarker, ChasePipelineProcess, InstanceConfig, StrategyTriggerStatus } from '../types';
import { formatNum, getSymbolDecimals } from '../utils/formatters';
import { ChartDisplayConfig } from './chartDisplayConfig';
import { ChartViewportController } from './chartViewportController';
import { CoinAnimationManager } from './coinAnimation';
import { OrderProcessRegistry } from './orderProcessRegistry';
import { dataSourceManager } from './dataSourceManager';
import { addLog } from './logger';
import { tooltipManager } from './tooltipManager';

export interface ChartContext {
  canvasEl: HTMLCanvasElement | null;
  chartDisplayConfig: ChartDisplayConfig;
  chartViewportController: ChartViewportController;
  coinAnimationManager: CoinAnimationManager;
  orderProcessRegistry: OrderProcessRegistry;
  getConfig: () => InstanceConfig;
  getHistory: () => TickData[];
  getHftEvents: () => HftEvent[];
  getActiveChaseProcesses: () => ChasePipelineProcess[];
  getTriggerStatus?: () => StrategyTriggerStatus | null;
  getMaxPoints: () => number;
  getHz: () => number;
}

export class ChartRenderer {
  private activeMarkers: VisualMarker[] = [];
  private animationFrameId: number | null = null;
  private xAdvanceMode: 'tick' | 'second' = 'second';

  constructor(private ctxState: ChartContext) {}

  public getActiveMarkers(): VisualMarker[] {
    return this.activeMarkers;
  }

  public getXAdvanceMode(): 'tick' | 'second' {
    return this.xAdvanceMode;
  }

  public draw(): void {
    const { canvasEl, chartDisplayConfig, chartViewportController, coinAnimationManager, orderProcessRegistry } = this.ctxState;
    if (!canvasEl) return;
    if (!dataSourceManager.isEnabled('chart')) return; // Canvas frozen if chart feed disabled

    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;

    const width = canvasEl.width;
    const height = canvasEl.height;
    const history = this.ctxState.getHistory();
    const hftEvents = this.ctxState.getHftEvents();
    const activeChaseProcesses = this.ctxState.getActiveChaseProcesses();
    const config = this.ctxState.getConfig();
    const maxPoints = this.ctxState.getMaxPoints();
    const hz = this.ctxState.getHz();

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

    // ── Auto-fit data range ────────────────────────────────────────────────
    let dataMin = Infinity;
    let dataMax = -Infinity;
    for (const pt of history) {
      if (pt.bid > 0 && pt.bid < dataMin) dataMin = pt.bid;
      if (pt.ask > 0 && pt.ask > dataMax) dataMax = pt.ask;
    }
    if (dataMin === Infinity || dataMax === -Infinity) {
      dataMin = 0;
      dataMax = 0.004;
    }

    // ── Linear Y scale (Viewport State from Controller) ────────────────────
    const viewport = chartViewportController.getState();
    const autoHalf = (dataMax - dataMin) * 0.6 || dataMin * 0.05 || 0.0001;
    const autoCenter = (dataMax + dataMin) / 2;

    const yCtr = viewport.yCenter !== null ? viewport.yCenter : autoCenter;
    const yHalf = viewport.yRange !== null ? viewport.yRange : autoHalf;

    const yMin = yCtr - yHalf;
    const yMax = yCtr + yHalf;
    const ySpan = yMax - yMin || 1e-9;

    const rightMargin = 110;
    const chartWidth = width - rightMargin;
    const chartTop = 15;
    const chartBottom = height - 35;
    const chartH = chartBottom - chartTop;

    // Linear mappers (X-axis unlinked from live advance when user pans) ──────
    const now = Date.now();
    const timeWindow = maxPoints * 1000;
    const xOffset = viewport.xOffsetMs || 0;

    const endIdx = Math.max(1, history.length - viewport.sampleOffset);
    const startIdx = Math.max(0, endIdx - maxPoints);

    const liveEndTime =
      this.xAdvanceMode === 'second'
        ? now
        : history.length > 0
        ? history[Math.min(history.length - 1, endIdx - 1)].time
        : now;

    const tMax = liveEndTime - xOffset;
    const tMin =
      this.xAdvanceMode === 'second'
        ? tMax - timeWindow
        : history.length > startIdx
        ? history[startIdx].time
        : tMax - timeWindow;

    const getXForTime = (time: number) => {
      if (this.xAdvanceMode === 'second') {
        if (time <= tMin) return 0;
        if (time >= tMax) return chartWidth;
        return ((time - tMin) / Math.max(1, tMax - tMin)) * chartWidth;
      } else {
        if (history.length === 0) return 0;
        const minT = history[startIdx]?.time ?? history[0].time;
        const maxT =
          history[Math.min(history.length - 1, endIdx - 1)]?.time ?? history[history.length - 1].time;
        if (time <= minT) return 0;
        if (time >= maxT) return chartWidth;
        return ((time - minT) / Math.max(1, maxT - minT)) * chartWidth;
      }
    };

    const getX = (index: number) => {
      if (this.xAdvanceMode === 'second') {
        if (index < 0 || index >= history.length) return 0;
        return getXForTime(history[index].time);
      } else {
        const relIdx = index - startIdx;
        return relIdx * (chartWidth / Math.max(1, maxPoints - 1));
      }
    };

    const getTimeForX = (x: number): number => {
      if (this.xAdvanceMode === 'second') {
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
    ctx.fillStyle = isYZoomActive ? 'rgba(99, 102, 241, 0.10)' : 'rgba(99, 102, 241, 0.03)';
    ctx.fillRect(chartWidth, 0, rightMargin, height);

    const gripX = chartWidth + rightMargin / 2;
    const gripY = height / 2;
    ctx.strokeStyle = isYZoomActive ? 'rgba(129, 140, 248, 0.7)' : 'rgba(99, 102, 241, 0.25)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    for (const offset of [-5, 0, 5]) {
      ctx.beginPath();
      ctx.moveTo(gripX - 10, gripY + offset);
      ctx.lineTo(gripX + 10, gripY + offset);
      ctx.stroke();
    }
    ctx.fillStyle = isYZoomActive ? 'rgba(129, 140, 248, 0.9)' : 'rgba(99, 102, 241, 0.35)';
    ctx.font = chartDisplayConfig.getScaledFont(7);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('↕ DRAG', gripX, gripY + 18);

    // ── Grid lines (horizontal) ──────────────────────────────────────────────
    const decimals = getSymbolDecimals(config.symbol);
    const gridCount = 5;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(148, 163, 184, 0.5)';
    ctx.font = chartDisplayConfig.getScaledFont(9);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    for (let i = 0; i <= gridCount; i++) {
      const frac = i / gridCount;
      const priceVal = yMin + (1 - frac) * ySpan;
      const y = chartTop + frac * chartH;

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
      if (this.xAdvanceMode === 'second') {
        const diffSec = Math.round((timeVal - now) / 1000);
        label = diffSec === 0 ? 'NOW' : `${diffSec}s`;
      } else {
        label = new Date(timeVal).toLocaleTimeString('es-ES', { hour12: false });
      }
      ctx.fillText(label, x, chartBottom + 5);
      if (this.xAdvanceMode === 'second') {
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
    const visibleEvents = hftEvents.filter((e) => e.time >= tMin && e.time <= tMax);
    const queryEvents = visibleEvents.filter((e) => e.type === 'query');
    const tradingEvents = visibleEvents.filter((e) => e.type !== 'query');

    this.activeMarkers = [];
    const clusterRadius = 12;

    for (const evt of queryEvents) {
      const x = getXForTime(evt.time);
      let merged = false;
      for (const marker of this.activeMarkers) {
        if (Math.abs(marker.x - x) < clusterRadius && marker.events[0].type === 'query') {
          marker.events.push(evt);
          merged = true;
          break;
        }
      }
      if (!merged) this.activeMarkers.push({ x, y: 25, events: [evt] });
    }

    const positionOccupancy: Record<string, number> = {};
    for (const evt of tradingEvents) {
      const x = getXForTime(evt.time);
      const y = evt.price ? getY(evt.price) : height / 2;
      const key = `${Math.round(evt.time / 500) * 500},${evt.price || 0}`;
      const occupancy = positionOccupancy[key] || 0;
      positionOccupancy[key] = occupancy + 1;
      this.activeMarkers.push({ x: x + occupancy * 10, y, events: [evt] });
    }

    // ── 5. Order price level lines (dashed) ──────────────────────────────────
    hftEvents.forEach((placedEvt) => {
      if (placedEvt.type !== 'buy_placed' && placedEvt.type !== 'sell_placed') return;
      const orderId = placedEvt.orderId;
      if (!orderId) return;
      const closingEvt = hftEvents.find(
        (e) =>
          e.orderId !== undefined &&
          String(e.orderId) === String(orderId) &&
          ['buy', 'sell', 'cancel', 'cancel_buy', 'cancel_sell', 'cancel_buy_failed', 'cancel_sell_failed'].includes(e.type) &&
          e.time >= placedEvt.time
      );
      const tStart = placedEvt.time;
      const tEnd = closingEvt ? closingEvt.time : tMax;
      if (tEnd < tMin || tStart > tMax) return;
      const xStart = getXForTime(Math.max(tStart, tMin));
      const xEnd = getXForTime(Math.min(tEnd, tMax));
      const yVal = getY(placedEvt.price || 0);
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
      if (proc.status === 'COMPLETED' || proc.status === 'ABORTED') return;

      let entryX: number | null = null;
      let entryY: number | null = null;
      if (proc.entry_order_id) {
        for (const m of this.activeMarkers) {
          const found = m.events.find((e) => String(e.orderId) === String(proc.entry_order_id));
          if (found) {
            entryX = m.x;
            entryY = m.y;
            break;
          }
        }
      }

      let exitX: number | null = null;
      let exitY: number | null = null;
      if (proc.exit_order_id) {
        for (const m of this.activeMarkers) {
          const found = m.events.find((e) => String(e.orderId) === String(proc.exit_order_id));
          if (found) {
            exitX = m.x;
            exitY = m.y;
            break;
          }
        }
      }

      const targetPrice = proc.last_order_price || proc.initial_price;
      if (entryX === null && targetPrice) {
        entryY = getY(targetPrice);
        entryX = chartWidth * 0.2;
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

        ctx.beginPath();
        ctx.moveTo(entryX, entryY);
        const cpX1 = entryX + (targetX - entryX) * 0.5;
        const cpY1 = entryY;
        const cpX2 = entryX + (targetX - entryX) * 0.5;
        const cpY2 = targetY;
        ctx.bezierCurveTo(cpX1, cpY1, cpX2, cpY2, targetX, targetY);
        ctx.stroke();

        const midX = (entryX + targetX) / 2;
        const midY = (entryY + targetY) / 2;
        const badgeText = `CHASE #${proc.id} | ${proc.sub_status || proc.status}`;

        ctx.font = chartDisplayConfig.getScaledFont(8, "'JetBrains Mono', monospace", true);
        const textWidth = ctx.measureText(badgeText).width;

        const badgePaddingH = chartDisplayConfig.getScaledSize(6);
        const badgeW = textWidth + badgePaddingH * 2;
        const badgeH = chartDisplayConfig.getScaledSize(14);


        ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.roundRect(midX - badgeW / 2, midY - badgeH / 2, badgeW, badgeH, 4);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = lineColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(badgeText, midX, midY);

        ctx.restore();
      }
    });

    // ── 5.6. Strategy Trigger & Flip Reversal Threshold Line (Guide v2.2.0 Macro View) ───────
    const triggerStatus = this.ctxState.getTriggerStatus ? this.ctxState.getTriggerStatus() : null;
    if (triggerStatus && triggerStatus.trigger_price !== null && triggerStatus.trigger_price > 0) {
      const trigPrice = triggerStatus.trigger_price;
      const yTrig = getY(trigPrice);
      const isFlipActive = triggerStatus.state === 'FLIP_CONMUTATED' || triggerStatus.conmutator_mode?.startsWith('FLIP_');
      const isTrendAcc = triggerStatus.state === 'TREND_ACCUMULATION' || (!isFlipActive && triggerStatus.state !== 'READY');

      // Color rules per v2.2.0 section 4.A:
      // - Soft Purple/Indigo (#818CF8) for TREND_ACCUMULATION (potential reversal target)
      // - Bright Orange (#F97316) for FLIP_CONMUTATED (active flip execution)
      const trigColor = isFlipActive ? '#f97316' : isTrendAcc ? '#818cf8' : '#38bdf8';

      // 1. Dynamic Reversal Gradient Zone (between current price and trigger price)
      if (isTrendAcc && history.length > 0) {
        const yCurrent = getY(history[history.length - 1].bid);
        const topY = Math.min(yTrig, yCurrent);
        const botY = Math.max(yTrig, yCurrent);
        const blockH = botY - topY;
        if (blockH > 1) {
          ctx.save();
          const grad = ctx.createLinearGradient(0, topY, 0, botY);
          grad.addColorStop(0, 'rgba(129, 140, 248, 0.07)');
          grad.addColorStop(1, 'rgba(99, 102, 241, 0.01)');
          ctx.fillStyle = grad;
          ctx.fillRect(0, topY, chartWidth, blockH);
          ctx.restore();
        }
      }

      // 2. Entry Reference Price Line
      if (triggerStatus.entry_price > 0) {
        const yEntry = getY(triggerStatus.entry_price);
        ctx.save();
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(0, yEntry);
        ctx.lineTo(chartWidth, yEntry);
        ctx.stroke();

        // Label on chart
        ctx.font = chartDisplayConfig.getScaledFont(8, "'JetBrains Mono', monospace", true);
        ctx.fillStyle = 'rgba(148, 163, 184, 0.7)';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(`Entry Ref: ${triggerStatus.entry_price.toFixed(decimals)}`, 10, yEntry - 2);
        ctx.restore();
      }

      // 3. Dynamic Flip Threshold Line
      ctx.save();
      ctx.strokeStyle = trigColor;
      ctx.lineWidth = 1.8;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(0, yTrig);
      ctx.lineTo(chartWidth, yTrig);
      ctx.stroke();

      // Trigger Badge on chart canvas
      const reqSign = triggerStatus.required_metric_pc > 0 ? '+' : '';
      const trigLabel = `⚡ Flip Target: ${trigPrice.toFixed(decimals)} (${reqSign}${triggerStatus.required_metric_pc.toFixed(3)}%)`;
      ctx.font = chartDisplayConfig.getScaledFont(8, "'JetBrains Mono', monospace", true);
      const trigLblW = ctx.measureText(trigLabel).width + 12;
      const trigLblH = 15;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
      ctx.strokeStyle = trigColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(chartWidth - trigLblW - 8, yTrig - trigLblH - 2, trigLblW, trigLblH, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = trigColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(trigLabel, chartWidth - trigLblW / 2 - 8, yTrig - trigLblH / 2 - 2);
      ctx.restore();
    }

    // ── 6. Render visible markers ────────────────────────────────────────────
    for (const m of this.activeMarkers) {
      if (m.events.length === 0) continue;
      const isCluster = m.events.length > 1;
      const clusterR = chartDisplayConfig.getScaledSize(6);

      if (isCluster) {
        ctx.beginPath();
        ctx.arc(m.x, m.y, clusterR, 0, 2 * Math.PI);
        ctx.fillStyle = '#6366f1';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = chartDisplayConfig.getScaledFont(7, "'JetBrains Mono', monospace", true);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(m.events.length.toString(), m.x, m.y);
      } else {
        const evt = m.events[0];
        const triR = chartDisplayConfig.getScaledSize(5);

        if (evt.type === 'buy') {
          ctx.beginPath();
          ctx.moveTo(m.x, m.y - triR - 1);
          ctx.lineTo(m.x - triR, m.y + triR);
          ctx.lineTo(m.x + triR, m.y + triR);
          ctx.closePath();
          ctx.fillStyle = '#10b981';
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 0.5;
          ctx.stroke();
        } else if (evt.type === 'buy_placed') {
          ctx.beginPath();
          ctx.moveTo(m.x, m.y - triR - 1);
          ctx.lineTo(m.x - triR, m.y + triR);
          ctx.lineTo(m.x + triR, m.y + triR);
          ctx.closePath();
          ctx.strokeStyle = '#10b981';
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.fillStyle = 'rgba(16,185,129,0.15)';
          ctx.fill();
        } else if (evt.type === 'sell') {
          ctx.beginPath();
          ctx.moveTo(m.x, m.y + triR + 1);
          ctx.lineTo(m.x - triR, m.y - triR);
          ctx.lineTo(m.x + triR, m.y - triR);
          ctx.closePath();
          ctx.fillStyle = '#ef4444';
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 0.5;
          ctx.stroke();
        } else if (evt.type === 'sell_placed') {
          ctx.beginPath();
          ctx.moveTo(m.x, m.y + triR + 1);
          ctx.lineTo(m.x - triR, m.y - triR);
          ctx.lineTo(m.x + triR, m.y - triR);
          ctx.closePath();
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.fillStyle = 'rgba(239,68,68,0.15)';
          ctx.fill();
        } else if (evt.type === 'cancel' || evt.type === 'cancel_buy' || evt.type === 'cancel_sell') {
          const cc = evt.type === 'cancel_buy' ? '#10b981' : evt.type === 'cancel_sell' ? '#ef4444' : '#f59e0b';
          ctx.strokeStyle = cc;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(m.x - 4, m.y - 4);
          ctx.lineTo(m.x + 4, m.y + 4);
          ctx.moveTo(m.x + 4, m.y - 4);
          ctx.lineTo(m.x - 4, m.y + 4);
          ctx.stroke();
        } else if (evt.type === 'cancel_failed' || evt.type === 'cancel_buy_failed' || evt.type === 'cancel_sell_failed') {
          const cc = evt.type === 'cancel_buy_failed' ? '#10b981' : '#ef4444';
          ctx.strokeStyle = cc;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(m.x - 5, m.y - 5);
          ctx.lineTo(m.x + 5, m.y + 5);
          ctx.moveTo(m.x + 5, m.y - 5);
          ctx.lineTo(m.x - 5, m.y + 5);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(m.x, m.y, clusterR, 0, 2 * Math.PI);
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        } else if (evt.type === 'trigger_rejected' || evt.type === 'trigger_passed') {
          const isRej = evt.type === 'trigger_rejected';
          const iconColor = isRej ? '#ef4444' : '#10b981';

          ctx.save();
          ctx.beginPath();
          ctx.arc(m.x, m.y, chartDisplayConfig.getScaledSize(9), 0, 2 * Math.PI);
          ctx.fillStyle = isRej ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)';
          ctx.fill();
          ctx.strokeStyle = iconColor;
          ctx.lineWidth = 1.5;
          ctx.stroke();

          ctx.fillStyle = '#ffffff';
          ctx.font = chartDisplayConfig.getScaledFont(8, "'JetBrains Mono', monospace", true);
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(isRej ? '⛔' : '⚡', m.x, m.y);
          ctx.restore();
        } else if (evt.type === 'query') {
          ctx.beginPath();
          ctx.arc(m.x, m.y, chartDisplayConfig.getScaledSize(4), 0, 2 * Math.PI);
          ctx.fillStyle = '#60a5fa';
          ctx.fill();
          ctx.strokeStyle = '#3b82f6';
          ctx.stroke();
        }

        // Decoraciones y marca permanente del Process ID por orderId
        if (evt.orderId) {
          const procInfo = orderProcessRegistry.getProcessInfo(evt.orderId);
          const chaseProc = procInfo
            ? null
            : activeChaseProcesses.find(
                (p) =>
                  p.status !== 'COMPLETED' &&
                  p.status !== 'ABORTED' &&
                  (String(p.entry_order_id) === String(evt.orderId) || String(p.exit_order_id) === String(evt.orderId))
              );

          const processId = procInfo ? procInfo.processId : chaseProc ? chaseProc.id : null;
          const role = procInfo
            ? procInfo.role
            : chaseProc
            ? String(chaseProc.entry_order_id) === String(evt.orderId)
              ? 'E'
              : 'X'
            : null;

          if (processId !== null && role !== null) {
            const roleColor = role === 'E' ? '#06b6d4' : '#10b981';

            ctx.save();
            ctx.beginPath();
            ctx.arc(m.x, m.y, chartDisplayConfig.getScaledSize(10), 0, 2 * Math.PI);
            ctx.strokeStyle = roleColor;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([2, 2]);
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(m.x, m.y, chartDisplayConfig.getScaledSize(2.5), 0, 2 * Math.PI);
            ctx.fillStyle = '#ffffff';
            ctx.fill();

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
            const eventAgeMs = Date.now() - evt.time;
            if (eventAgeMs >= 6000) {
              const roleColor = '#c084fc';
              const badgeOffset = chartDisplayConfig.getScaledSize(8);
              const badgeRadius = chartDisplayConfig.getScaledSize(4.5);
              const badgeX = m.x + badgeOffset;
              const badgeY = m.y - badgeOffset;

              ctx.save();
              ctx.beginPath();
              ctx.arc(m.x, m.y, chartDisplayConfig.getScaledSize(9), 0, 2 * Math.PI);
              ctx.strokeStyle = 'rgba(192, 132, 252, 0.45)';
              ctx.lineWidth = 1.0;
              ctx.setLineDash([2, 3]);
              ctx.stroke();

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

    // ── 7. Right Y-axis price flags (Bid / Ask / Trigger / Entry) ───────────
    const latest = history[history.length - 1];
    const yBid = getY(latest.bid);
    const yAsk = getY(latest.ask);

    ctx.font = chartDisplayConfig.getScaledFont(8, "'JetBrains Mono', monospace", true);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    // Entry Ref Flag
    if (triggerStatus && triggerStatus.entry_price > 0) {
      const yEnt = getY(triggerStatus.entry_price);
      if (yEnt >= chartTop && yEnt <= chartBottom) {
        ctx.fillStyle = 'rgba(148, 163, 184, 0.7)';
        ctx.fillRect(chartWidth + 3, yEnt - 7, rightMargin - 6, 14);
        ctx.fillStyle = '#0f172a';
        ctx.fillText(`E: ${formatNum(triggerStatus.entry_price, decimals)}`, chartWidth + 6, yEnt);
      }
    }

    // Trigger Price Flag
    if (triggerStatus && triggerStatus.trigger_price !== null && triggerStatus.trigger_price > 0) {
      const yTrg = getY(triggerStatus.trigger_price);
      if (yTrg >= chartTop && yTrg <= chartBottom) {
        const isPassed = triggerStatus.state === 'PASSED' || triggerStatus.current_metric_pc >= triggerStatus.required_metric_pc;
        const flgColor = isPassed ? '#10b981' : '#f59e0b';
        ctx.fillStyle = flgColor;
        ctx.fillRect(chartWidth + 3, yTrg - 7, rightMargin - 6, 14);
        ctx.fillStyle = '#030712';
        ctx.fillText(`T: ${formatNum(triggerStatus.trigger_price, decimals)}`, chartWidth + 6, yTrg);
      }
    }

    ctx.fillStyle = '#10b981';
    ctx.fillRect(chartWidth + 3, yBid - 7, rightMargin - 6, 14);
    ctx.fillStyle = '#030712';
    ctx.fillText(`B: ${formatNum(latest.bid, decimals)}`, chartWidth + 6, yBid);

    ctx.fillStyle = '#ef4444';
    ctx.fillRect(chartWidth + 3, yAsk - 7, rightMargin - 6, 14);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`A: ${formatNum(latest.ask, decimals)}`, chartWidth + 6, yAsk);


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
      10,
      height - 11
    );

    // ── 9. Crosshair + snap ──────────────────────────────────────────────────
    const { x: mouseX, y: mouseY } = tooltipManager.getMousePosition();
    if (mouseX !== null && mouseY !== null && mouseX < chartWidth) {
      let snapX = mouseX;
      let snapY = mouseY;
      let isSnapped = false;

      let closestMarker = null;
      let minDist = 15;
      for (const marker of this.activeMarkers) {
        const dx = mouseX - marker.x;
        const dy = mouseY - marker.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < minDist) {
          minDist = dist;
          closestMarker = marker;
        }
      }

      let snappedTime = 0;
      let snappedPrice = 0;

      snappedTime = getTimeForX(snapX);

      const yFrac = (chartBottom - snapY) / chartH;
      snappedPrice = yMin + yFrac * ySpan;

      if (closestMarker) {
        snapX = closestMarker.x;
        snapY = closestMarker.y;
        isSnapped = true;
        snappedTime = closestMarker.events[0].time;
        snappedPrice = closestMarker.events[0].price || snappedPrice;
      }

      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 1.0;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(snapX, chartTop);
      ctx.lineTo(snapX, height - 22);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, snapY);
      ctx.lineTo(chartWidth, snapY);
      ctx.stroke();
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
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.rect(tBadgeX, tBadgeY, tBadgeW, tBadgeH);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(timeStr, tBadgeX + tBadgeW / 2, tBadgeY + tBadgeH / 2);
      ctx.restore();

      // Price badge (Y axis)
      const priceStr = formatNum(snappedPrice, decimals);
      const pBadgeW = ctx.measureText(priceStr).width + 8;
      const pBadgeH = 14;
      const pBadgeX = width - pBadgeW - 2;
      const pBadgeY = Math.max(chartTop, Math.min(height - 22 - pBadgeH, snapY - pBadgeH / 2));
      ctx.save();
      ctx.fillStyle = isSnapped ? '#4f46e5' : 'rgba(15,23,42,0.95)';
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.rect(pBadgeX, pBadgeY, pBadgeW, pBadgeH);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(priceStr, pBadgeX + pBadgeW / 2, pBadgeY + pBadgeH / 2);
      ctx.restore();
    }
  }

  public pruneHistory(history: TickData[]): void {
    const maxBuffer = Math.max(4000, this.ctxState.getMaxPoints() * 2);
    while (history.length > maxBuffer) {
      history.shift();
    }
  }

  public startSecondAnimationLoop(): void {
    if (this.animationFrameId !== null) return;
    const loop = () => {
      if (this.xAdvanceMode === 'second') {
        this.draw();
        this.animationFrameId = requestAnimationFrame(loop);
      } else {
        this.animationFrameId = null;
      }
    };
    this.animationFrameId = requestAnimationFrame(loop);
  }

  public stopSecondAnimationLoop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  public updateXAdvanceMode(mode: 'tick' | 'second', history: TickData[]): void {
    this.xAdvanceMode = mode;
    if (mode === 'second') {
      this.startSecondAnimationLoop();
      addLog('[CHART] Eje X cambiado a modo TEMPORAL (avance por segundo).', 'info');
    } else {
      this.stopSecondAnimationLoop();
      this.pruneHistory(history);
      this.draw();
      addLog('[CHART] Eje X cambiado a modo TICK (avance por tick).', 'info');
    }
  }

  public handleResize(): void {
    const canvasEl = this.ctxState.canvasEl;
    if (!canvasEl || !canvasEl.parentElement) return;
    const rect = canvasEl.parentElement.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      canvasEl.width = rect.width;
      canvasEl.height = rect.height;
      this.draw();
    }
  }
}
