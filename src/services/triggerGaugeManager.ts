import {
  ConmutatorMode,
  ProcessRangeSpan,
  StrategyTriggerStatus,
  TacticalCluster,
  TacticalPOI,
  TacticalProcessGap,
  TriggerState,
} from '../types';
import {
  calculateLogCoordinate,
  calculateProcessGaps,
  calculateViewportExtrema,
  clusterPois,
  projectAndAssignLanes,
} from './triggerGaugeMath';
import {
  getCompactStatusBadgeHtml,
  getConmutatorModeBadgeInfo,
  getMetricColor,
  getPoiVisualConfig,
} from './triggerGaugeTheme';
import {
  computeLiveTickUpdate,
  ContextGetter,
  extractProcessSpans,
  extractTacticalPois,
  PoiSources,
  sanitizeTriggerStatus,
} from './triggerGaugeState';
import { TriggerGaugeDomRenderer } from './triggerGaugeDomRenderer';

export type { PoiSources };

/**
 * Facade Pattern Coordinator for Tactical Price Spectrum & Polarity Conmutator.
 * 
 * Delegates responsibilities to:
 * - `triggerGaugeMath.ts`: Pure geometric projection & lane assignment.
 * - `triggerGaugeTheme.ts`: Visual tokens, color themes & badge formatting.
 * - `triggerGaugeState.ts`: Telemetry sanitization, live onTick metrics & POI/span extraction.
 * - `triggerGaugeDomRenderer.ts`: In-place DOM reconciliation & RAF throttling.
 */
export class TriggerGaugeManager {
  private currentStatus: StrategyTriggerStatus | null = null;
  private instanceStatusMap: Map<number, StrategyTriggerStatus> = new Map();
  private contextGetter?: ContextGetter;
  private poiSources?: PoiSources;
  private domRenderer: TriggerGaugeDomRenderer = new TriggerGaugeDomRenderer();

  public setContextGetter(getter: ContextGetter): void {
    this.contextGetter = getter;
  }

  public setPoiSources(sources: PoiSources): void {
    this.poiSources = sources;
  }

  public getStatus(): StrategyTriggerStatus | null {
    if (this.currentStatus) return this.currentStatus;
    if (this.contextGetter) {
      const ctx = this.contextGetter();
      if (ctx.instanceId > 0 && ctx.latestPrice > 0) {
        return this.getSanitizedStatus({
          instance_id: ctx.instanceId,
          symbol: ctx.symbol || '--',
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

  public setActiveInstance(instanceId: number): void {
    const cached = this.instanceStatusMap.get(instanceId);
    this.currentStatus = cached || null;
    this.render();
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
    this.domRenderer.requestRender(() => this.render());
  }

  public onTick(bid: number, ask: number): void {
    const s = this.getStatus();
    if (!s) return;

    const updated = computeLiveTickUpdate(s, bid, ask);
    this.currentStatus = updated;
    this.instanceStatusMap.set(updated.instance_id, updated);
    this.requestRender();
  }

  public getSanitizedStatus(raw: Partial<StrategyTriggerStatus>): StrategyTriggerStatus {
    return sanitizeTriggerStatus(raw, this.contextGetter);
  }

  public getMetricColor(
    currentMetric: number,
    requiredMetric: number,
    state: string,
    conmutatorMode?: string
  ) {
    return getMetricColor(currentMetric, requiredMetric, state, conmutatorMode);
  }

  public getConmutatorModeBadgeInfo(mode?: ConmutatorMode, state?: TriggerState) {
    return getConmutatorModeBadgeInfo(mode, state);
  }

  public getPoiVisualConfig(category: any, side?: string) {
    return getPoiVisualConfig(category, side);
  }

  public getCompactStatusBadgeHtml(s?: StrategyTriggerStatus): string {
    const sanitized = s ? this.getSanitizedStatus(s) : undefined;
    return getCompactStatusBadgeHtml(s, sanitized);
  }

  public getProcessSpans(s: StrategyTriggerStatus): ProcessRangeSpan[] {
    const activeProcesses = this.poiSources?.getActiveProcesses ? this.poiSources.getActiveProcesses() : undefined;
    return extractProcessSpans(s, activeProcesses);
  }

  public getTacticalPois(s: StrategyTriggerStatus): TacticalPOI[] {
    const openOrders = this.poiSources?.getOpenOrders ? this.poiSources.getOpenOrders() : undefined;
    const activeProcesses = this.poiSources?.getActiveProcesses ? this.poiSources.getActiveProcesses() : undefined;
    return extractTacticalPois(s, openOrders, activeProcesses);
  }

  public calculateViewportExtrema(
    marketPrice: number,
    triggerOrPois?: any,
    spansOrMargin?: any,
    minSafetyMarginPc?: number
  ) {
    return calculateViewportExtrema(marketPrice, triggerOrPois, spansOrMargin, minSafetyMarginPc);
  }

  public calculateLogCoordinate(
    price: number,
    marketPrice: number,
    pMin: number,
    pMax: number
  ): number {
    return calculateLogCoordinate(price, marketPrice, pMin, pMax);
  }

  public projectAndAssignLanes(
    spans: ProcessRangeSpan[],
    marketPrice: number,
    pMin: number,
    pMax: number
  ) {
    return projectAndAssignLanes(spans, marketPrice, pMin, pMax);
  }

  public clusterPois(
    pois: TacticalPOI[],
    marketPrice: number,
    pMin: number,
    pMax: number,
    clusterRadiusPc: number = 3.5
  ): TacticalCluster[] {
    return clusterPois(pois, marketPrice, pMin, pMax, clusterRadiusPc);
  }

  public render(containerId: string = 'trigger-gauge-container'): void {
    const s = this.getStatus();
    const spans = s ? this.getProcessSpans(s) : [];
    this.domRenderer.render(containerId, s, spans);
  }

  public syncSpansDom(
    container: HTMLElement,
    spans: ProcessRangeSpan[],
    decimals: number,
    marketPrice: number
  ): void {
    this.domRenderer.syncSpansDom(container, spans, decimals, marketPrice);
  }

  public syncPinsDom(
    container: HTMLElement,
    clusters: TacticalCluster[],
    decimals: number
  ): void {
    this.domRenderer.syncPinsDom(container, clusters, decimals);
  }

  public getSpanTooltipHtml(span: ProcessRangeSpan, decimals: number, marketPrice: number): string {
    return this.domRenderer.getSpanTooltipHtml(span, decimals, marketPrice);
  }

  public getFlipTargetTooltipHtml(s: StrategyTriggerStatus, decimals: number): string {
    return this.domRenderer.getFlipTargetTooltipHtml(s, decimals);
  }

  public calculateProcessGaps(
    spans: ProcessRangeSpan[],
    marketPrice: number,
    pMin: number,
    pMax: number
  ): TacticalProcessGap[] {
    return calculateProcessGaps(spans, marketPrice, pMin, pMax);
  }

  public syncGapsDom(
    container: HTMLElement,
    gaps: TacticalProcessGap[],
    decimals: number,
    marketPrice: number
  ): void {
    this.domRenderer.syncGapsDom(container, gaps, decimals, marketPrice);
  }

  public getGapTooltipHtml(gap: TacticalProcessGap, decimals: number, marketPrice?: number): string {
    return this.domRenderer.getGapTooltipHtml(gap, decimals, marketPrice);
  }

  public getSpanTooltipText(span: ProcessRangeSpan, decimals: number, marketPrice: number): string {
    return this.domRenderer.getSpanTooltipText(span, decimals, marketPrice);
  }
}

export const triggerGaugeManager = new TriggerGaugeManager();
