import {
  ChasePipelineProcess,
  ConmutatorMode,
  OpenOrder,
  PositionSide,
  ResolvedSide,
  StrategyTriggerStatus,
  TacticalCluster,
  TacticalPOI,
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
      this.rafId = requestAnimationFrame(this.renderLoop);
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
  // GAMA SPECIFICATION: POI AGGREGATION & VIEWPORT LOGARITHMIC PROJECTION
  // ══════════════════════════════════════════════════════════════════════════════

  /**
   * Collect all Tactical Points of Interest from available sources and current status.
   */
  public getTacticalPois(s: StrategyTriggerStatus): TacticalPOI[] {
    const pois: TacticalPOI[] = [];
    const decimals = getSymbolDecimals(s.symbol);
    const normSymbol = normalizeSymbol(s.symbol);

    // 1. Flip Reversal Trigger
    if (s.trigger_price && s.trigger_price > 0) {
      const flipSide: 'BUY' | 'SELL' = s.position_side === 'LONG' ? 'SELL' : 'BUY';
      pois.push({
        id: 'poi-flip-trigger',
        price: s.trigger_price,
        category: 'FLIP_TRIGGER',
        side: flipSide,
        label: `⚡ Flip Target`,
        subLabel: `$${formatNum(s.trigger_price, decimals)} (${s.required_metric_pc.toFixed(2)}%)`,
        isPrimary: true,
      });
    }

    // 2. Entry Reference Price
    if (s.entry_price > 0 && s.position_side !== 'FLAT') {
      pois.push({
        id: 'poi-entry-ref',
        price: s.entry_price,
        category: 'ENTRY_REF',
        side: 'NEUTRAL',
        label: `Entry Ref`,
        subLabel: `$${formatNum(s.entry_price, decimals)}`,
      });
    }

    // 3. Real Open Orders from Exchange
    if (this.poiSources?.getOpenOrders) {
      const orders = this.poiSources.getOpenOrders();
      if (Array.isArray(orders)) {
        orders
          .filter((o) => normalizeSymbol(o.symbol) === normSymbol && o.price > 0)
          .forEach((o) => {
            const side: 'BUY' | 'SELL' = o.side.toUpperCase() === 'BUY' ? 'BUY' : 'SELL';
            pois.push({
              id: `poi-order-${o.id}`,
              price: o.price,
              category: 'REAL_ORDER',
              side: side,
              label: `Limit ${side}`,
              subLabel: `${o.amount} @ $${formatNum(o.price, decimals)}`,
            });
          });
      }
    }

    // 4. Active Pipeline Processes (Chasing & Pending TPs)
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
            const targetPrice = p.last_order_price || p.last_tick_price || p.initial_price || 0;
            if (targetPrice > 0) {
              const side: 'BUY' | 'SELL' = p.side.toUpperCase() === 'BUY' ? 'BUY' : 'SELL';
              const isTp = p.status === 'WAITING_TP_FILL' || p.status === 'PLACING_TP';
              pois.push({
                id: `poi-proc-${p.id}`,
                price: targetPrice,
                category: isTp ? 'EXECUTED_PENDING' : 'VIRTUAL_ORDER',
                side: side,
                label: isTp ? `TP Pending` : `Chase Order`,
                subLabel: `#${p.id} · ${p.status} @ $${formatNum(targetPrice, decimals)}`,
              });
            }
          });
      }
    }

    return pois;
  }

  /**
   * Pure Viewport Geometry: Calculate min and max bounds for the atemporal X-axis.
   * Ensures safe non-zero bounds centered around marketPrice.
   */
  public calculateViewportExtrema(
    marketPrice: number,
    pois: TacticalPOI[],
    minSafetyMarginPc: number = 0.0075 // Default 0.75% margin if no points exist
  ): { pMin: number; pMax: number } {
    if (marketPrice <= 0) {
      return { pMin: 0.99, pMax: 1.01 };
    }

    let minPrice = marketPrice * (1 - minSafetyMarginPc);
    let maxPrice = marketPrice * (1 + minSafetyMarginPc);

    for (const p of pois) {
      if (p.price > 0) {
        if (p.price < minPrice) minPrice = p.price;
        if (p.price > maxPrice) maxPrice = p.price;
      }
    }

    // Add extra 8% padding beyond the outermost points for visual clarity
    const leftSpan = marketPrice - minPrice;
    const rightSpan = maxPrice - marketPrice;

    const pMin = Math.max(0.00000001, marketPrice - leftSpan * 1.08);
    const pMax = marketPrice + rightSpan * 1.08;

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
   * Anti-Cluttering / Clustering Engine:
   * Groups POIs that are closer than thresholdPercent (default 3.5%) in viewport coordinates.
   */
  public clusterPois(
    pois: TacticalPOI[],
    marketPrice: number,
    pMin: number,
    pMax: number,
    thresholdPercent: number = 3.5
  ): TacticalCluster[] {
    if (pois.length === 0) return [];

    // Map each POI to its calculated X position
    const projected = pois.map((poi) => ({
      poi,
      x: this.calculateLogCoordinate(poi.price, marketPrice, pMin, pMax),
    }));

    // Sort by coordinate X ascending
    projected.sort((a, b) => a.x - b.x);

    const clusters: TacticalCluster[] = [];
    let currentCluster: { xSum: number; pois: TacticalPOI[]; count: number } | null = null;

    for (const item of projected) {
      if (!currentCluster) {
        currentCluster = { xSum: item.x, pois: [item.poi], count: 1 };
      } else {
        const avgX = currentCluster.xSum / currentCluster.count;
        if (Math.abs(item.x - avgX) <= thresholdPercent) {
          currentCluster.pois.push(item.poi);
          currentCluster.xSum += item.x;
          currentCluster.count += 1;
        } else {
          clusters.push({
            x: currentCluster.xSum / currentCluster.count,
            pois: currentCluster.pois,
          });
          currentCluster = { xSum: item.x, pois: [item.poi], count: 1 };
        }
      }
    }

    if (currentCluster) {
      clusters.push({
        x: currentCluster.xSum / currentCluster.count,
        pois: currentCluster.pois,
      });
    }

    return clusters;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // RENDERING ENGINE: MINIMALIST TACTICAL SPECTRUM
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

    // 1. Collect POIs & Viewport Extrema
    const pois = this.getTacticalPois(s);
    const { pMin, pMax } = this.calculateViewportExtrema(s.current_price, pois);
    const clusters = this.clusterPois(pois, s.current_price, pMin, pMax, 3.5);

    const currSign = s.current_metric_pc > 0 ? '+' : '';
    const reqSign = s.required_metric_pc > 0 ? '+' : '';
    const deltaSign = s.delta_remaining_pc > 0 ? '+' : '';

    // Explanatory footer text
    let statusDetailText = '';
    if (isFlip) {
      statusDetailText = `⚡ Giro conmutado a ${s.resolved_side}. Umbral de reversión alcanzado (+${s.required_metric_pc.toFixed(4)}%). Polaridad invertida.`;
    } else if (isReady) {
      statusDetailText = '🌱 Sin posición activa. Modo Semilla listo para apertura de ciclo.';
    } else {
      const oppositeSide = s.position_side === 'LONG' ? 'SHORT (SELL)' : 'LONG (BUY)';
      statusDetailText = `Acumulando en ${s.position_side} (${s.resolved_side}). A ${s.delta_remaining_pc.toFixed(4)}% de conmutar giro a ${oppositeSide}.`;
    }

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

      const pinsContainerEl = document.getElementById('tg-pins-container');
      if (pinsContainerEl) {
        this.syncPinsDom(pinsContainerEl, clusters, decimals);
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

        <!-- Tactical Price Spectrum Bar (Propuesta Gama: Eje X Atemporal Bipartito Logarítmico) -->
        <div class="trigger-bar-container">
          <div class="trigger-bar-labels">
            <span id="tg-min-label" style="color: #64748b; font-family: monospace; font-size: 0.68rem;">◀ $${formatNum(pMin, decimals)} (-${(((s.current_price - pMin) / s.current_price) * 100).toFixed(2)}%)</span>
            <span style="color: #94a3b8; font-weight: 700; font-size: 0.7rem; letter-spacing: 0.05em;">ESPECTRO TÁCTICO DE PRECIOS & POLARIDAD</span>
            <span id="tg-max-label" style="color: #64748b; font-family: monospace; font-size: 0.68rem;">(+${(((pMax - s.current_price) / s.current_price) * 100).toFixed(2)}%) $${formatNum(pMax, decimals)} ▶</span>
          </div>

          <div class="trigger-spectrum-track" style="position: relative; height: 32px; background: linear-gradient(90deg, rgba(16,185,129,0.06) 0%, rgba(15,23,42,0.8) 50%, rgba(239,68,68,0.06) 100%); border: 1px solid rgba(255,255,255,0.12); border-radius: 6px; overflow: visible;">
            <!-- Fixed Central Axis at 50% (Current Market Price) -->
            <div class="trigger-center-axis" style="position: absolute; left: 50%; top: 0; bottom: 0; width: 2px; background: #ffffff; box-shadow: 0 0 10px #ffffff; z-index: 5;">
              <div class="trigger-center-pill" style="position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%); margin-bottom: 3px; font-size: 0.65rem; font-weight: 800; color: #000000; background: #ffffff; padding: 1px 6px; border-radius: 4px; white-space: nowrap; box-shadow: 0 0 12px rgba(255,255,255,0.8); z-index: 6;">
                <span style="margin-right: 3px;">📍</span><span id="tg-center-price-pill">$${formatNum(s.current_price, decimals)}</span>
              </div>
            </div>

            <!-- Dynamic Tactical Pins & Clusters Container -->
            <div id="tg-pins-container" style="position: absolute; inset: 0; pointer-events: auto;"></div>
          </div>
        </div>

        <!-- Footer status detail -->
        <div class="trigger-gauge-footer">
          <span style="color: #94a3b8;">Estado Operacional:</span>
          <strong id="tg-status-detail" style="color: ${colorTheme.color};">${statusDetailText}</strong>
        </div>
      </div>
    `;

    const pinsContainerEl = document.getElementById('tg-pins-container');
    if (pinsContainerEl) {
      this.syncPinsDom(pinsContainerEl, clusters, decimals);
    }
  }

  /**
   * High-performance in-place DOM synchronization (Anti-Flickering):
   * Reconciles tactical pins by unique key without destroying DOM nodes during hover.
   */
  public syncPinsDom(container: HTMLElement, clusters: TacticalCluster[], decimals: number): void {
    const existingElements = new Map<string, HTMLElement>();

    container.querySelectorAll<HTMLElement>('[data-cluster-key]').forEach((el) => {
      const key = el.getAttribute('data-cluster-key');
      if (key) existingElements.set(key, el);
    });

    const activeKeys = new Set<string>();

    clusters.forEach((c) => {
      const clusterKey = c.pois.map((p) => p.id).sort().join('|');
      activeKeys.add(clusterKey);

      const existingEl = existingElements.get(clusterKey);
      const tooltipText = this.getClusterTooltipText(c, decimals);

      if (existingEl) {
        // Mutate existing node in-place: preserves browser :hover and native tooltips
        existingEl.style.left = `${c.x}%`;
        if (existingEl.title !== tooltipText) {
          existingEl.title = tooltipText;
        }
      } else {
        // Create new node only when first introduced
        const newEl = this.createPinDomElement(c, clusterKey, tooltipText);
        container.appendChild(newEl);
      }
    });

    // Remove nodes that are no longer part of active clusters
    existingElements.forEach((el, key) => {
      if (!activeKeys.has(key)) {
        el.remove();
      }
    });
  }

  /**
   * Helper to create a single DOM pin element
   */
  private createPinDomElement(c: TacticalCluster, clusterKey: string, tooltipText: string): HTMLElement {
    const el = document.createElement('div');
    el.setAttribute('data-cluster-key', clusterKey);
    el.title = tooltipText;
    el.style.position = 'absolute';
    el.style.left = `${c.x}%`;
    el.style.top = '50%';
    el.style.transform = 'translate(-50%, -50%)';
    el.style.zIndex = '4';
    el.style.cursor = 'pointer';

    if (c.pois.length === 1) {
      const p = c.pois[0];
      const pinStyle = this.getPinVisuals(p);
      el.className = 'tactical-micro-pin';
      el.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; pointer-events: none;">
          <div style="background: ${pinStyle.bg}; border: 1px solid ${pinStyle.border}; color: ${pinStyle.color}; font-size: 0.60rem; font-weight: 800; padding: 1px 4px; border-radius: 3px; white-space: nowrap; box-shadow: 0 2px 6px rgba(0,0,0,0.6); margin-bottom: 2px;">
            ${pinStyle.icon} ${p.label}
          </div>
          <div style="width: 8px; height: 8px; border-radius: 50%; background: ${pinStyle.color}; border: 2px solid #ffffff; box-shadow: 0 0 8px ${pinStyle.color};"></div>
        </div>
      `;
    } else {
      const primaryPoi = c.pois.find((p) => p.isPrimary) || c.pois[0];
      const pinStyle = this.getPinVisuals(primaryPoi);
      el.className = 'tactical-cluster-pin';
      el.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; pointer-events: none;">
          <div style="background: rgba(15,23,42,0.95); border: 1px solid ${pinStyle.border}; color: ${pinStyle.color}; font-size: 0.60rem; font-weight: 800; padding: 1px 5px; border-radius: 4px; white-space: nowrap; box-shadow: 0 0 10px ${pinStyle.bg};">
            📦 +${c.pois.length} POIs
          </div>
          <div style="width: 10px; height: 10px; border-radius: 50%; background: ${pinStyle.color}; border: 2px solid #ffffff; box-shadow: 0 0 10px ${pinStyle.color};"></div>
        </div>
      `;
    }

    return el;
  }

  /**
   * Helper to format tooltip text for a cluster
   */
  private getClusterTooltipText(c: TacticalCluster, decimals: number): string {
    if (c.pois.length === 1) {
      const p = c.pois[0];
      return `${p.label} | ${p.subLabel || ''} | $${formatNum(p.price, decimals)}`;
    }
    return c.pois
      .map((p) => `• ${p.label}: $${formatNum(p.price, decimals)} (${p.subLabel || ''})`)
      .join('\n');
  }

  /**
   * Map POI to visual theme
   */
  private getPinVisuals(p: TacticalPOI): { color: string; bg: string; border: string; icon: string } {
    switch (p.category) {
      case 'FLIP_TRIGGER':
        return {
          color: '#f59e0b',
          bg: 'rgba(245, 158, 11, 0.25)',
          border: '#f59e0b',
          icon: '⚡',
        };
      case 'ENTRY_REF':
        return {
          color: '#94a3b8',
          bg: 'rgba(148, 163, 184, 0.2)',
          border: '#94a3b8',
          icon: '🏷️',
        };
      case 'REAL_ORDER':
        if (p.side === 'BUY') {
          return {
            color: '#10b981',
            bg: 'rgba(16, 185, 129, 0.25)',
            border: '#10b981',
            icon: '🟢',
          };
        } else {
          return {
            color: '#ef4444',
            bg: 'rgba(239, 68, 68, 0.25)',
            border: '#ef4444',
            icon: '🔴',
          };
        }
      case 'EXECUTED_PENDING':
        return {
          color: '#a855f7',
          bg: 'rgba(168, 85, 247, 0.25)',
          border: '#a855f7',
          icon: '🔄',
        };
      case 'VIRTUAL_ORDER':
      case 'NEW_PROCESS':
      default:
        return {
          color: '#06b6d4',
          bg: 'rgba(6, 182, 212, 0.25)',
          border: '#06b6d4',
          icon: '🔷',
        };
    }
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

