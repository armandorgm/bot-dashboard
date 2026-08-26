import {
  ChasePipelineProcess,
  ConmutatorMode,
  OpenOrder,
  PositionSide,
  ProcessRangeSpan,
  ResolvedSide,
  StrategyTriggerStatus,
  TriggerState,
} from '../types';
import { formatNum, getSymbolDecimals, normalizeSymbol } from '../utils/formatters';
import { FRAME_BUDGET_MS } from '../utils/constants';

export interface PoiSources {
  getOpenOrders?: () => OpenOrder[];
  getActiveProcesses?: () => ChasePipelineProcess[];
}

/**
 * Single Responsibility: Manage calculation, logarithmic viewport projection,
 * and rendering of the Tactical Price Spectrum & Polarity Conmutator Bar (Propuesta Gama).
 * 
 * - Center is ALWAYS fixed at 50% (Current Market Price).
 * - Left side [P_min, P_market] and Right side [P_market, P_max] scale logarithmically.
 * - Dynamic POI aggregation (Open Orders, Chasing/TP Processes, Flip Trigger, Entry Ref).
 * - Anti-cluttering & clustering for micro-pins with distance < 3.5%.
 * - Live reactive updates on WebSocket ticker ticks with Alpha 4 FPS throttling.
 */
export class TriggerGaugeManager {
  private currentStatus: StrategyTriggerStatus | null = null;
  private instanceStatusMap: Map<number, StrategyTriggerStatus> = new Map();
  private contextGetter?: () => { symbol: string; instanceId: number; latestPrice: number };
  private poiSources?: PoiSources;
  private lastRenderTime: number = 0;
  private rafId: number | null = null;
  private needsRender: boolean = false;

  public setContextGetter(getter: () => { symbol: string; instanceId: number; latestPrice: number }): void {
    this.contextGetter = getter;
  }

  public setPoiSources(sources: PoiSources): void {
    this.poiSources = sources;
  }

  public getStatus(): StrategyTriggerStatus | null {
    if (this.currentStatus) return this.currentStatus;
    // Synthesize fallback status from context if available
    if (this.contextGetter) {
      const ctx = this.contextGetter();
      if (ctx.instanceId > 0 && ctx.latestPrice > 0) {
        return this.getSanitizedStatus({
          instance_id: ctx.instanceId,
          symbol: ctx.symbol || '1000PEPEUSDC',
          strategy: 'GRID_POSITION_FLIPPER',
          state: 'TREND_ACCUMULATION',
          conmutator_mode: 'TREND_BUY',
          resolved_side: 'BUY',
          position_side: 'LONG',
          entry_price: ctx.latestPrice,
          current_price: ctx.latestPrice,
          trigger_price: ctx.latestPrice * (1 - 0.0075),
          current_metric_pc: 0.3523,
          required_metric_pc: 0.75,
          delta_remaining_pc: 0.3977,
          multiplier: 3.0,
        });
      }
    }
    return null;
  }

  public getStatusForInstance(instanceId: number): StrategyTriggerStatus | undefined {
    return this.instanceStatusMap.get(instanceId);
  }

  public setStatus(status: StrategyTriggerStatus | null): void {
    if (status) {
      const sanitized = this.getSanitizedStatus(status);
      this.currentStatus = sanitized;
      this.instanceStatusMap.set(sanitized.instance_id, sanitized);
    } else {
      this.currentStatus = null;
    }
    this.render();
  }

  public updateFromTelemetry(instanceId: number, status?: StrategyTriggerStatus): void {
    if (status) {
      const sanitized = this.getSanitizedStatus(status);
      this.instanceStatusMap.set(instanceId, sanitized);
      if (this.currentStatus?.instance_id === instanceId || !this.currentStatus) {
        this.currentStatus = sanitized;
        this.requestRender();
      }
    }
  }

  public requestRender(): void {
    this.needsRender = true;
    if (this.rafId === null) {
      if (typeof requestAnimationFrame !== 'undefined') {
        this.rafId = requestAnimationFrame(this.renderLoop);
      } else {
        this.render();
      }
    }
  }

  private renderLoop = (timestamp: DOMHighResTimeStamp): void => {
    this.rafId = null;
    if (!this.needsRender) return;

    const elapsed = timestamp - this.lastRenderTime;
    if (elapsed >= FRAME_BUDGET_MS) {
      this.lastRenderTime = timestamp;
      this.needsRender = false;
      this.render();
    } else {
      this.rafId = requestAnimationFrame(this.renderLoop);
    }
  };

  /**
   * Live tick update handler: called on every market ticker WebSocket event.
   * Recalculates adverse pullback, delta remaining, and dynamic mode.
   */
  public onTick(bid: number, ask: number): void {
    const latestPrice = (bid + ask) / 2 || bid;
    if (!latestPrice || latestPrice <= 0) return;

    let s = this.getStatus();
    if (!s) return;

    // Mutate and recalculate live metrics
    s.current_price = latestPrice;

    if (s.entry_price > 0 && s.position_side !== 'FLAT') {
      const reqMetric = s.required_metric_pc || 0.75;
      let adversePullbackPc = 0;

      if (s.position_side === 'LONG') {
        adversePullbackPc = ((s.entry_price - latestPrice) / s.entry_price) * 100;
      } else if (s.position_side === 'SHORT') {
        adversePullbackPc = ((latestPrice - s.entry_price) / s.entry_price) * 100;
      }

      // Live current metric & remaining delta
      s.current_metric_pc = adversePullbackPc;
      s.delta_remaining_pc = Math.max(0, reqMetric - s.current_metric_pc);

      // Re-evaluate conmutator dynamic mode and state
      if (s.current_metric_pc >= reqMetric) {
        s.state = 'FLIP_CONMUTATED';
        s.conmutator_mode = s.position_side === 'LONG' ? 'FLIP_SELL' : 'FLIP_BUY';
        s.resolved_side = s.position_side === 'LONG' ? 'SELL' : 'BUY';
      } else {
        s.state = 'TREND_ACCUMULATION';
        s.conmutator_mode = s.position_side === 'LONG' ? 'TREND_BUY' : 'TREND_SELL';
        s.resolved_side = s.position_side === 'LONG' ? 'BUY' : 'SELL';
      }
    }

    this.currentStatus = s;
    this.instanceStatusMap.set(s.instance_id, s);

    this.requestRender();
  }

  public getSanitizedStatus(raw: Partial<StrategyTriggerStatus>): StrategyTriggerStatus {
    const ctx = this.contextGetter ? this.contextGetter() : { symbol: '1000PEPEUSDC', instanceId: 8, latestPrice: 0.002575 };
    const symbol = raw.symbol || ctx.symbol || '1000PEPEUSDC';
    const instanceId = raw.instance_id || ctx.instanceId || 8;
    const strategy = raw.strategy || 'GRID_POSITION_FLIPPER';

    const reqMetric = typeof raw.required_metric_pc === 'number' && raw.required_metric_pc !== 0
      ? raw.required_metric_pc
      : (typeof raw.required_pullback_pc === 'number' && raw.required_pullback_pc !== 0 ? raw.required_pullback_pc * 100 : 0.75);

    const currMetric = typeof raw.current_metric_pc === 'number'
      ? raw.current_metric_pc
      : (typeof raw.actual_pullback_pc === 'number' ? raw.actual_pullback_pc * 100 : 0.0);

    const deltaRem = typeof raw.delta_remaining_pc === 'number'
      ? raw.delta_remaining_pc
      : Math.max(0, reqMetric - currMetric);

    const posSide: PositionSide = raw.position_side || 'LONG';
    const currentPrice = (raw.current_price && raw.current_price > 0) ? raw.current_price : (ctx.latestPrice > 0 ? ctx.latestPrice : 0.002575);
    const entryPrice = (raw.entry_price && raw.entry_price > 0) ? raw.entry_price : currentPrice;

    let triggerPrice = raw.trigger_price;
    if (!triggerPrice || triggerPrice <= 0) {
      const dir = posSide === 'LONG' ? -1 : 1;
      triggerPrice = entryPrice * (1 + dir * (reqMetric / 100));
    }

    // Normalize raw states to v2.2.0 TriggerState
    let state: TriggerState = raw.state as TriggerState;
    if (!state || state === 'NO_DATA') {
      if (posSide === 'FLAT') {
        state = 'READY';
      } else if (currMetric >= reqMetric) {
        state = 'FLIP_CONMUTATED';
      } else {
        state = 'TREND_ACCUMULATION';
      }
    } else if (state === ('PASSED' as any)) {
      state = 'FLIP_CONMUTATED';
    } else if (state === ('BLOCKED' as any)) {
      state = 'TREND_ACCUMULATION';
    }

    // Determine conmutator_mode & resolved_side per v2.2.0 spec
    let conmutatorMode: ConmutatorMode = raw.conmutator_mode as ConmutatorMode;
    let resolvedSide: ResolvedSide = raw.resolved_side as ResolvedSide;

    if (!conmutatorMode) {
      if (posSide === 'FLAT' || state === 'READY') {
        conmutatorMode = 'SEED';
        resolvedSide = resolvedSide || 'BUY';
      } else if (posSide === 'LONG') {
        if (state === 'FLIP_CONMUTATED' || currMetric >= reqMetric) {
          conmutatorMode = 'FLIP_SELL';
          resolvedSide = 'SELL';
        } else {
          conmutatorMode = 'TREND_BUY';
          resolvedSide = 'BUY';
        }
      } else {
        // SHORT
        if (state === 'FLIP_CONMUTATED' || currMetric >= reqMetric) {
          conmutatorMode = 'FLIP_BUY';
          resolvedSide = 'BUY';
        } else {
          conmutatorMode = 'TREND_SELL';
          resolvedSide = 'SELL';
        }
      }
    }

    if (!resolvedSide) {
      if (conmutatorMode === 'TREND_BUY' || conmutatorMode === 'FLIP_BUY' || conmutatorMode === 'SEED') {
        resolvedSide = 'BUY';
      } else {
        resolvedSide = 'SELL';
      }
    }

    return {
      instance_id: instanceId,
      symbol: symbol,
      strategy: strategy,
      condition_name: raw.condition_name || 'PULLBACK_CONMUTATOR',
      state: state,
      conmutator_mode: conmutatorMode,
      resolved_side: resolvedSide,
      position_side: posSide,
      entry_price: entryPrice,
      current_price: currentPrice,
      trigger_price: triggerPrice,
      actual_pullback_pc: raw.actual_pullback_pc,
      required_pullback_pc: raw.required_pullback_pc,
      current_metric_pc: currMetric,
      required_metric_pc: reqMetric,
      delta_remaining_pc: deltaRem,
      multiplier: raw.multiplier || 3.0,
      timestamp: raw.timestamp || new Date().toISOString(),
      updated_at: raw.updated_at || Date.now() / 1000,
    };
  }

  /**
   * Determine color theme based on v2.2.0 Conmutator Mode & State
   */
  public getMetricColor(currentMetric: number, requiredMetric: number, state: string, conmutatorMode?: string): {
    color: string;
    bg: string;
    border: string;
    ledClass: string;
  } {
    if (conmutatorMode === 'TREND_BUY') {
      return {
        color: '#10b981', // Emerald Green (Trend Buy)
        bg: 'rgba(16, 185, 129, 0.12)',
        border: 'rgba(16, 185, 129, 0.4)',
        ledClass: 'led-green',
      };
    }
    if (conmutatorMode === 'TREND_SELL') {
      return {
        color: '#ef4444', // Red/Orange (Trend Sell)
        bg: 'rgba(239, 68, 68, 0.12)',
        border: 'rgba(239, 68, 68, 0.4)',
        ledClass: 'led-red',
      };
    }
    if (conmutatorMode === 'FLIP_SELL') {
      return {
        color: '#f59e0b', // Amber / Warning Gold (Flip to Short)
        bg: 'rgba(245, 158, 11, 0.12)',
        border: 'rgba(245, 158, 11, 0.4)',
        ledClass: 'led-yellow',
      };
    }
    if (conmutatorMode === 'FLIP_BUY') {
      return {
        color: '#3b82f6', // Blue / Bright Azure (Flip to Long)
        bg: 'rgba(59, 130, 246, 0.12)',
        border: 'rgba(59, 130, 246, 0.4)',
        ledClass: 'led-blue',
      };
    }
    if (conmutatorMode === 'SEED' || state === 'READY') {
      return {
        color: '#06b6d4', // Cyan (Seed Mode)
        bg: 'rgba(6, 182, 212, 0.12)',
        border: 'rgba(6, 182, 212, 0.4)',
        ledClass: 'led-cyan',
      };
    }

    // Fallback based on metric & state
    if (state === 'FLIP_CONMUTATED' || state === 'PASSED' || currentMetric >= requiredMetric) {
      return {
        color: '#10b981',
        bg: 'rgba(16, 185, 129, 0.12)',
        border: 'rgba(16, 185, 129, 0.4)',
        ledClass: 'led-green',
      };
    }
    if (currentMetric > 0) {
      return {
        color: '#f59e0b',
        bg: 'rgba(245, 158, 11, 0.12)',
        border: 'rgba(245, 158, 11, 0.4)',
        ledClass: 'led-yellow',
      };
    }
    return {
      color: '#ef4444',
      bg: 'rgba(239, 68, 68, 0.12)',
      border: 'rgba(239, 68, 68, 0.4)',
      ledClass: 'led-red',
    };
  }

  /**
   * Get human readable label and icon for a Conmutator Mode
   */
  public getConmutatorModeBadgeInfo(mode?: ConmutatorMode, state?: TriggerState): { label: string; subLabel: string } {
    switch (mode) {
      case 'TREND_BUY':
        return {
          label: '🟢 TENDENCIA: COMPRANDO (BUY)',
          subLabel: 'Seguimiento de tendencia activa en Long. Recomprando retrocesos del grid.',
        };
      case 'TREND_SELL':
        return {
          label: '🔴 TENDENCIA: VENDIENDO (SELL)',
          subLabel: 'Seguimiento de tendencia activa en Short. Revendiendo retrocesos del grid.',
        };
      case 'FLIP_SELL':
        return {
          label: '⚡ GIRO A SHORT (SELL)',
          subLabel: 'Umbral alcanzado. Conmutador invierte polaridad para girar a SHORT con 2x.',
        };
      case 'FLIP_BUY':
        return {
          label: '⚡ GIRO A LONG (BUY)',
          subLabel: 'Umbral alcanzado. Conmutador invierte polaridad para girar a LONG con 2x.',
        };
      case 'SEED':
        return {
          label: '🌱 INICIAL: MODO SEMILLA',
          subLabel: 'Sin posición activa. Listo para lanzar la primera orden semilla.',
        };
      default:
        if (state === 'FLIP_CONMUTATED') {
          return { label: '⚡ GIRO CONMUTADO', subLabel: 'Umbral de reversión alcanzado.' };
        }
        return { label: '⚪ CONMUTADOR LISTO', subLabel: 'Evaluando condiciones de disparo.' };
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // RANGED PROCESS SPANS & UNRANGED FLIP TARGET ENGINE (NO MERGING)
  // ══════════════════════════════════════════════════════════════════════════════

  /**
   * Collect all active process ranges (Ranged Spans) from active chase processes.
   */
  public getProcessSpans(s: StrategyTriggerStatus): ProcessRangeSpan[] {
    const spans: ProcessRangeSpan[] = [];
    const decimals = getSymbolDecimals(s.symbol);
    const normSymbol = normalizeSymbol(s.symbol);

    if (this.poiSources?.getActiveProcesses) {
      const procs = this.poiSources.getActiveProcesses();
      if (Array.isArray(procs)) {
        procs
          .filter(
            (p) =>
              normalizeSymbol(p.symbol) === normSymbol &&
              p.status !== 'COMPLETED' &&
              p.status !== 'ABORTED'
          )
          .forEach((p) => {
            const side: 'BUY' | 'SELL' = (p.side || 'BUY').toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
            let startPrice = p.initial_price && p.initial_price > 0 ? p.initial_price : (p.last_order_price || s.current_price);
            let endPrice = p.last_order_price && p.last_order_price > 0 ? p.last_order_price : (p.last_tick_price || startPrice);

            const isTpPhase = p.status === 'WAITING_TP_FILL' || p.status === 'PLACING_TP';
            if (isTpPhase) {
              startPrice = p.last_order_price || p.initial_price || s.current_price;
              const profitMultiplier = side === 'BUY' ? (1 + (s.required_metric_pc ? s.required_metric_pc / 100 : 0.005)) : (1 - (s.required_metric_pc ? s.required_metric_pc / 100 : 0.005));
              endPrice = p.last_tick_price && p.last_tick_price !== startPrice ? p.last_tick_price : startPrice * profitMultiplier;
            } else if (startPrice === endPrice) {
              const offset = side === 'BUY' ? 1.0025 : 0.9975;
              endPrice = startPrice * offset;
            }

            if (startPrice > 0 && endPrice > 0) {
              const minPrice = Math.min(startPrice, endPrice);
              const maxPrice = Math.max(startPrice, endPrice);
              const diffPc = Math.abs(((endPrice - startPrice) / startPrice) * 100);

              spans.push({
                id: `proc-span-${p.id}`,
                processId: p.id,
                pipelineId: p.pipeline_id,
                side: side,
                startPrice: startPrice,
                endPrice: endPrice,
                minPrice: minPrice,
                maxPrice: maxPrice,
                status: p.status,
                amount: p.amount || 0,
                xStart: 0,
                xEnd: 0,
                xLeft: 0,
                xRight: 0,
                widthPc: 0,
                lane: 0,
                label: `#${p.id} ${side}`,
                subLabel: `${p.status} · $${formatNum(startPrice, decimals)} ➔ $${formatNum(endPrice, decimals)} (${diffPc.toFixed(2)}%) · Qty: ${p.amount || 0}`,
              });
            }
          });
      }
    }

    return spans;
  }

  /**
   * Pure Viewport Geometry: Calculate min and max bounds for the atemporal X-axis.
   * Ensures safe non-zero bounds centered around marketPrice.
   */
  public calculateViewportExtrema(
    marketPrice: number,
    triggerPrice: number | null,
    spans: ProcessRangeSpan[],
    minSafetyMarginPc: number = 0.0075
  ): { pMin: number; pMax: number } {
    if (marketPrice <= 0) {
      return { pMin: 0.99, pMax: 1.01 };
    }

    let minPrice = marketPrice * (1 - minSafetyMarginPc);
    let maxPrice = marketPrice * (1 + minSafetyMarginPc);

    if (triggerPrice && triggerPrice > 0) {
      if (triggerPrice < minPrice) minPrice = triggerPrice;
      if (triggerPrice > maxPrice) maxPrice = triggerPrice;
    }

    for (const span of spans) {
      if (span.minPrice > 0 && span.minPrice < minPrice) minPrice = span.minPrice;
      if (span.maxPrice > 0 && span.maxPrice > maxPrice) maxPrice = span.maxPrice;
    }

    const leftSpan = marketPrice - minPrice;
    const rightSpan = maxPrice - marketPrice;

    const pMin = Math.max(0.00000001, marketPrice - leftSpan * 1.10);
    const pMax = marketPrice + rightSpan * 1.10;

    return { pMin, pMax };
  }

  /**
   * Logarithmic Bipartite Projection (Propuesta Gama):
   * - x(P_min) = 0%
   * - x(P_market) = 50% (Always exact center)
   * - x(P_max) = 100%
   */
  public calculateLogCoordinate(
    price: number,
    marketPrice: number,
    pMin: number,
    pMax: number
  ): number {
    if (price <= pMin) return 0;
    if (price >= pMax) return 100;
    if (price === marketPrice) return 50;

    if (price < marketPrice) {
      const denom = Math.log(marketPrice) - Math.log(pMin);
      if (denom <= 0) return 25;
      const num = Math.log(marketPrice) - Math.log(price);
      const ratio = 1 - num / denom;
      return Math.max(0, Math.min(50, 50 * ratio));
    } else {
      const denom = Math.log(pMax) - Math.log(marketPrice);
      if (denom <= 0) return 75;
      const num = Math.log(price) - Math.log(marketPrice);
      const ratio = num / denom;
      return Math.max(50, Math.min(100, 50 + 50 * ratio));
    }
  }

  /**
   * Project Spans to X coordinates and assign Tiered Lanes (NO MERGING).
   * Spans that overlap in price intervals are stacked into distinct lanes so all remain visible.
   */
  public projectAndAssignLanes(
    spans: ProcessRangeSpan[],
    marketPrice: number,
    pMin: number,
    pMax: number
  ): { spans: ProcessRangeSpan[]; totalLanes: number } {
    if (spans.length === 0) return { spans: [], totalLanes: 0 };

    // 1. Calculate X positions for each span
    spans.forEach((span) => {
      span.xStart = this.calculateLogCoordinate(span.startPrice, marketPrice, pMin, pMax);
      span.xEnd = this.calculateLogCoordinate(span.endPrice, marketPrice, pMin, pMax);
      span.xLeft = Math.min(span.xStart, span.xEnd);
      span.xRight = Math.max(span.xStart, span.xEnd);
      span.widthPc = Math.max(3.0, span.xRight - span.xLeft);
    });

    // 2. Sort by xLeft ascending (if equal, wider spans first)
    spans.sort((a, b) => a.xLeft - b.xLeft || (b.xRight - b.xLeft) - (a.xRight - a.xLeft));

    // 3. Assign lanes without merging
    const laneEnds: number[] = [];
    spans.forEach((span) => {
      let assignedLane = -1;
      for (let i = 0; i < laneEnds.length; i++) {
        if (laneEnds[i] <= span.xLeft) {
          assignedLane = i;
          laneEnds[i] = span.xRight + 0.8;
          break;
        }
      }
      if (assignedLane === -1) {
        assignedLane = laneEnds.length;
        laneEnds.push(span.xRight + 0.8);
      }
      span.lane = assignedLane;
    });

    return { spans, totalLanes: Math.max(1, laneEnds.length) };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // RENDERING ENGINE: TACTICAL SPECTRUM (RANGED SPANS + UNRANGED FLIP TARGET)
  // ══════════════════════════════════════════════════════════════════════════════

  /**
   * Render the visual Tactical Price Spectrum Bar inside the target DOM container
   */
  public render(containerId: string = 'trigger-gauge-container'): void {
    const container = document.getElementById(containerId);
    if (!container) return;

    const s = this.getStatus();
    if (!s) {
      container.style.display = 'none';
      return;
    }

    container.style.display = 'flex';
    const decimals = getSymbolDecimals(s.symbol);

    const isFlip = s.state === 'FLIP_CONMUTATED' || (s.conmutator_mode && s.conmutator_mode.startsWith('FLIP_'));
    const isReady = s.state === 'READY' || s.position_side === 'FLAT' || s.conmutator_mode === 'SEED';
    const colorTheme = this.getMetricColor(s.current_metric_pc, s.required_metric_pc, s.state, s.conmutator_mode);
    const badgeInfo = this.getConmutatorModeBadgeInfo(s.conmutator_mode, s.state);

    // 1. Collect Ranged Process Spans & Viewport Extrema
    const rawSpans = this.getProcessSpans(s);
    const { pMin, pMax } = this.calculateViewportExtrema(s.current_price, s.trigger_price, rawSpans);
    const { spans, totalLanes } = this.projectAndAssignLanes(rawSpans, s.current_price, pMin, pMax);

    // Flip Target X-coordinate
    let xFlip: number | null = null;
    if (s.trigger_price && s.trigger_price > 0) {
      xFlip = this.calculateLogCoordinate(s.trigger_price, s.current_price, pMin, pMax);
    }

    const currSign = s.current_metric_pc > 0 ? '+' : '';
    const reqSign = s.required_metric_pc > 0 ? '+' : '';
    const deltaSign = s.delta_remaining_pc > 0 ? '+' : '';

    let statusDetailText = '';
    if (isFlip) {
      statusDetailText = `⚡ Giro conmutado a ${s.resolved_side}. Umbral de reversión alcanzado (+${s.required_metric_pc.toFixed(4)}%). Polaridad invertida.`;
    } else if (isReady) {
      statusDetailText = '🌱 Sin posición activa. Modo Semilla listo para apertura de ciclo.';
    } else {
      const oppositeSide = s.position_side === 'LONG' ? 'SHORT (SELL)' : 'LONG (BUY)';
      statusDetailText = `Acumulando en ${s.position_side} (${s.resolved_side}). A ${s.delta_remaining_pc.toFixed(4)}% de conmutar giro a ${oppositeSide}.`;
    }

    const calculatedTrackHeight = Math.max(38, 14 + Math.max(1, totalLanes) * 24);

    // Fast-path in-place DOM update if elements already exist
    const cardEl = document.getElementById('tg-card');
    if (cardEl && cardEl.getAttribute('data-inst') === String(s.instance_id)) {
      cardEl.style.borderColor = colorTheme.border;

      const titlePosEl = document.getElementById('tg-title-pos');
      if (titlePosEl) {
        titlePosEl.innerHTML = `<span style="color: ${colorTheme.color}; font-weight: bold;">${s.position_side} → ${s.resolved_side}</span> · Umbral: ${reqSign}${s.required_metric_pc.toFixed(4)}%`;
      }

      const badgeEl = document.getElementById('tg-status-badge');
      if (badgeEl) {
        badgeEl.style.background = colorTheme.bg;
        badgeEl.style.color = colorTheme.color;
        badgeEl.style.border = `1px solid ${colorTheme.border}`;
        badgeEl.innerHTML = `
          <span class="pulse-indicator" style="background-color: ${colorTheme.color}; box-shadow: 0 0 8px ${colorTheme.color};"></span>
          <span>${badgeInfo.label}</span>
        `;
      }

      const chipModeEl = document.getElementById('tg-chip-mode');
      if (chipModeEl) {
        chipModeEl.style.color = colorTheme.color;
        chipModeEl.innerText = `${s.conmutator_mode || s.state} (${s.resolved_side})`;
      }

      const chipPullbackEl = document.getElementById('tg-chip-pullback');
      if (chipPullbackEl) {
        chipPullbackEl.style.color = colorTheme.color;
        chipPullbackEl.innerText = `${currSign}${s.current_metric_pc.toFixed(4)}%`;
      }

      const chipDeltaEl = document.getElementById('tg-chip-delta');
      if (chipDeltaEl) {
        chipDeltaEl.style.color = isFlip ? '#10b981' : '#38bdf8';
        chipDeltaEl.innerText = isFlip ? '0.0000%' : `${deltaSign}${s.delta_remaining_pc.toFixed(4)}%`;
      }

      const chipTargetEl = document.getElementById('tg-chip-target-price');
      if (chipTargetEl) {
        chipTargetEl.innerText = `$${s.trigger_price !== null ? formatNum(s.trigger_price, decimals) : '--'}`;
      }

      const chipMarketEl = document.getElementById('tg-chip-market-price');
      if (chipMarketEl) {
        chipMarketEl.innerText = `$${formatNum(s.current_price, decimals)}`;
      }

      const minLabelEl = document.getElementById('tg-min-label');
      if (minLabelEl) {
        minLabelEl.innerText = `◀ $${formatNum(pMin, decimals)} (-${(((s.current_price - pMin) / s.current_price) * 100).toFixed(2)}%)`;
      }

      const maxLabelEl = document.getElementById('tg-max-label');
      if (maxLabelEl) {
        maxLabelEl.innerText = `(+${(((pMax - s.current_price) / s.current_price) * 100).toFixed(2)}%) $${formatNum(pMax, decimals)} ▶`;
      }

      const centerPillEl = document.getElementById('tg-center-price-pill');
      if (centerPillEl) {
        centerPillEl.innerText = `$${formatNum(s.current_price, decimals)}`;
      }

      const trackEl = document.getElementById('tg-spectrum-track');
      if (trackEl) {
        trackEl.style.height = `${calculatedTrackHeight}px`;
      }

      // Sync Unranged Flip Target Marker
      const flipLineEl = document.getElementById('tg-flip-target-line');
      if (flipLineEl) {
        if (xFlip !== null) {
          flipLineEl.style.display = 'block';
          flipLineEl.style.left = `${xFlip}%`;
          const flipPillEl = document.getElementById('tg-flip-target-pill');
          if (flipPillEl) {
            flipPillEl.innerText = `⚡ Flip Target: $${formatNum(s.trigger_price!, decimals)}`;
          }
        } else {
          flipLineEl.style.display = 'none';
        }
      }

      const spansContainerEl = document.getElementById('tg-spans-container');
      if (spansContainerEl) {
        this.syncSpansDom(spansContainerEl, spans, decimals, s.current_price);
      }

      const detailEl = document.getElementById('tg-status-detail');
      if (detailEl) {
        detailEl.style.color = colorTheme.color;
        detailEl.innerText = statusDetailText;
      }

      return;
    }

    // Full template creation
    container.innerHTML = `
      <div id="tg-card" data-inst="${s.instance_id}" class="trigger-gauge-card" style="border-color: ${colorTheme.border}; width: 100%; box-sizing: border-box;">
        <!-- Header -->
        <div class="trigger-gauge-header">
          <div class="trigger-gauge-title-group">
            <span class="trigger-gauge-icon">⚡</span>
            <div>
              <div class="trigger-gauge-title">
                Conmutador de Polaridad: <span id="tg-title-pos"><span style="color: ${colorTheme.color}; font-weight: bold;">${s.position_side} → ${s.resolved_side}</span> · Umbral: ${reqSign}${s.required_metric_pc.toFixed(4)}%</span>
              </div>
              <div class="trigger-gauge-subtitle">
                Estrategia: <span style="color: #60a5fa; font-weight: bold;">${s.strategy}</span> · Símbolo: <span style="color: #cbd5e1; font-weight: bold;">${s.symbol}</span> · Multiplicador: <span style="color: #a78bfa; font-weight: bold;">${s.multiplier || 3}x</span>
              </div>
            </div>
          </div>
          <div id="tg-status-badge" class="trigger-status-badge" style="background: ${colorTheme.bg}; color: ${colorTheme.color}; border: 1px solid ${colorTheme.border};">
            <span class="pulse-indicator" style="background-color: ${colorTheme.color}; box-shadow: 0 0 8px ${colorTheme.color};"></span>
            <span>${badgeInfo.label}</span>
          </div>
        </div>

        <!-- Metrics Row -->
        <div class="trigger-metrics-row">
          <div class="trigger-metric-chip">
            <span class="trigger-chip-lbl">Modo Conmutador:</span>
            <span id="tg-chip-mode" class="trigger-chip-val" style="color: ${colorTheme.color}; font-weight: 800;">
              ${s.conmutator_mode || s.state} (${s.resolved_side})
            </span>
          </div>
          <div class="trigger-metric-chip">
            <span class="trigger-chip-lbl">Retroceso Actual:</span>
            <span id="tg-chip-pullback" class="trigger-chip-val" style="color: ${colorTheme.color}; font-weight: 800;">
              ${currSign}${s.current_metric_pc.toFixed(4)}%
            </span>
          </div>
          <div class="trigger-metric-chip">
            <span class="trigger-chip-lbl">Umbral de Giro:</span>
            <span class="trigger-chip-val" style="color: #f59e0b; font-weight: 700;">
              ${reqSign}${s.required_metric_pc.toFixed(4)}%
            </span>
          </div>
          <div class="trigger-metric-chip">
            <span class="trigger-chip-lbl">Distancia al Giro:</span>
            <span id="tg-chip-delta" class="trigger-chip-val" style="color: ${isFlip ? '#10b981' : '#38bdf8'}; font-weight: 700;">
              ${isFlip ? '0.0000%' : `${deltaSign}${s.delta_remaining_pc.toFixed(4)}%`}
            </span>
          </div>
          <div class="trigger-metric-chip">
            <span class="trigger-chip-lbl">Flip Target:</span>
            <span id="tg-chip-target-price" class="trigger-chip-val" style="color: #a78bfa; font-weight: 700;">
              $${s.trigger_price !== null ? formatNum(s.trigger_price, decimals) : '--'}
            </span>
          </div>
          <div class="trigger-metric-chip">
            <span class="trigger-chip-lbl">Market Price:</span>
            <span id="tg-chip-market-price" class="trigger-chip-val" style="color: #e2e8f0; font-weight: 700;">
              $${formatNum(s.current_price, decimals)}
            </span>
          </div>
        </div>

        <!-- Tactical Price Spectrum Bar (Ranged Process Spans & Unranged Flip Target) -->
        <div class="trigger-bar-container">
          <div class="trigger-bar-labels">
            <span id="tg-min-label" style="color: #64748b; font-family: monospace; font-size: 0.68rem;">◀ $${formatNum(pMin, decimals)} (-${(((s.current_price - pMin) / s.current_price) * 100).toFixed(2)}%)</span>
            <span style="color: #94a3b8; font-weight: 700; font-size: 0.7rem; letter-spacing: 0.05em;">ESPECTRO TÁCTICO: RANGOS DE PROCESOS & FLIP TARGET</span>
            <span id="tg-max-label" style="color: #64748b; font-family: monospace; font-size: 0.68rem;">(+${(((pMax - s.current_price) / s.current_price) * 100).toFixed(2)}%) $${formatNum(pMax, decimals)} ▶</span>
          </div>

          <div id="tg-spectrum-track" class="trigger-spectrum-track" style="height: ${calculatedTrackHeight}px;">
            <!-- Fixed Central Axis at 50% (Current Market Price) -->
            <div class="trigger-center-axis">
              <div class="trigger-center-pill">
                <span style="margin-right: 3px;">📍</span><span id="tg-center-price-pill">$${formatNum(s.current_price, decimals)}</span>
              </div>
            </div>

            <!-- Unranged Flip Target Marker -->
            <div id="tg-flip-target-line" class="tactical-flip-target-line" style="${xFlip !== null ? `left: ${xFlip}%; display: block;` : 'display: none;'}">
              <div id="tg-flip-target-pill" class="tactical-flip-target-pill">
                ⚡ Flip Target: $${s.trigger_price !== null ? formatNum(s.trigger_price, decimals) : '--'}
              </div>
            </div>

            <!-- Dynamic Tactical Process Spans Container -->
            <div id="tg-spans-container" style="position: absolute; inset: 0; pointer-events: auto;"></div>
          </div>
        </div>

        <!-- Footer status detail -->
        <div class="trigger-gauge-footer">
          <span style="color: #94a3b8;">Estado Operacional:</span>
          <strong id="tg-status-detail" style="color: ${colorTheme.color};">${statusDetailText}</strong>
        </div>
      </div>
    `;

    const spansContainerEl = document.getElementById('tg-spans-container');
    if (spansContainerEl) {
      this.syncSpansDom(spansContainerEl, spans, decimals, s.current_price);
    }
  }

  /**
   * High-performance in-place DOM synchronization for Process Spans (Anti-Flickering & No Merging).
   */
  public syncSpansDom(
    container: HTMLElement,
    spans: ProcessRangeSpan[],
    decimals: number,
    marketPrice: number
  ): void {
    const existingElements = new Map<string, HTMLElement>();

    container.querySelectorAll<HTMLElement>('[data-span-id]').forEach((el) => {
      const id = el.getAttribute('data-span-id');
      if (id) existingElements.set(id, el);
    });

    const activeIds = new Set<string>();

    spans.forEach((span) => {
      activeIds.add(span.id);
      const existingEl = existingElements.get(span.id);
      const topPx = 6 + span.lane * 24;
      const tooltipText = this.getSpanTooltipText(span, decimals, marketPrice);

      if (existingEl) {
        existingEl.style.left = `${span.xLeft}%`;
        existingEl.style.width = `${span.widthPc}%`;
        existingEl.style.top = `${topPx}px`;
        if (existingEl.title !== tooltipText) {
          existingEl.title = tooltipText;
        }
      } else {
        const newEl = document.createElement('div');
        newEl.setAttribute('data-span-id', span.id);
        newEl.title = tooltipText;
        newEl.className = `tactical-process-span ${span.side.toLowerCase()}`;
        newEl.style.left = `${span.xLeft}%`;
        newEl.style.width = `${span.widthPc}%`;
        newEl.style.top = `${topPx}px`;
        newEl.innerHTML = `
          <div class="tactical-span-content">
            <span class="tactical-span-badge">${span.label}</span>
            <span class="tactical-span-range">$${formatNum(span.startPrice, decimals)} ➔ $${formatNum(span.endPrice, decimals)}</span>
          </div>
        `;
        container.appendChild(newEl);
      }
    });

    // Remove old spans that are no longer active
    existingElements.forEach((el, id) => {
      if (!activeIds.has(id)) {
        el.remove();
      }
    });
  }

  /**
   * Tooltip generator for an individual Process Range Span
   */
  private getSpanTooltipText(span: ProcessRangeSpan, decimals: number, marketPrice: number): string {
    const deltaMarketPc = marketPrice > 0 ? (((span.startPrice - marketPrice) / marketPrice) * 100) : 0;
    const sign = deltaMarketPc > 0 ? '+' : '';
    return `Proceso #${span.processId} [${span.status}] | ${span.side} ${span.amount}\nRango: $${formatNum(span.startPrice, decimals)} ➔ $${formatNum(span.endPrice, decimals)}\nDelta al mercado: ${sign}${deltaMarketPc.toFixed(2)}%`;
  }

  /**
   * Helper for rendering compact badge in global matrix table per v2.2.0
   */
  public getCompactStatusBadgeHtml(s?: StrategyTriggerStatus): string {
    if (!s) return '<span style="color: #64748b;">--</span>';
    const sanitized = this.getSanitizedStatus(s);
    const theme = this.getMetricColor(sanitized.current_metric_pc, sanitized.required_metric_pc, sanitized.state, sanitized.conmutator_mode);

    let modeIcon = '🟢';
    let modeText = 'TREND';
    if (sanitized.conmutator_mode === 'TREND_BUY') {
      modeIcon = '🟢';
      modeText = 'TREND BUY';
    } else if (sanitized.conmutator_mode === 'TREND_SELL') {
      modeIcon = '🔴';
      modeText = 'TREND SELL';
    } else if (sanitized.conmutator_mode === 'FLIP_SELL') {
      modeIcon = '⚡';
      modeText = 'FLIP SELL';
    } else if (sanitized.conmutator_mode === 'FLIP_BUY') {
      modeIcon = '⚡';
      modeText = 'FLIP BUY';
    } else if (sanitized.conmutator_mode === 'SEED' || sanitized.state === 'READY') {
      modeIcon = '🌱';
      modeText = 'SEED';
    }

    const currSign = sanitized.current_metric_pc > 0 ? '+' : '';
    const isFlip = sanitized.state === 'FLIP_CONMUTATED' || sanitized.conmutator_mode?.startsWith('FLIP_');
    const deltaText = isFlip ? 'FLIP' : `-${sanitized.delta_remaining_pc.toFixed(2)}%`;

    return `
      <div style="display: inline-flex; align-items: center; gap: 4px; background: ${theme.bg}; color: ${theme.color}; border: 1px solid ${theme.border}; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-family: monospace; font-weight: bold;" title="Modo: ${sanitized.conmutator_mode} (${sanitized.resolved_side}) | Retroceso: ${currSign}${sanitized.current_metric_pc.toFixed(4)}% | Umbral: ${sanitized.required_metric_pc}%">
        <span>${modeIcon}</span>
        <span>${modeText}</span>
        <span style="opacity: 0.85; font-size: 9.5px;">${currSign}${sanitized.current_metric_pc.toFixed(2)}%</span>
        <span style="opacity: 0.65; font-size: 9px;">(${deltaText})</span>
      </div>
    `;
  }
}

export const triggerGaugeManager = new TriggerGaugeManager();

