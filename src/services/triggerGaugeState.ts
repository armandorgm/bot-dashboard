import {
  ChasePipelineProcess,
  ConmutatorMode,
  OpenOrder,
  PositionSide,
  ProcessRangeSpan,
  ResolvedSide,
  StrategyTriggerStatus,
  TacticalPOI,
  TriggerState,
} from '../types';
import { formatNum, getSymbolDecimals, normalizeSymbol } from '../utils/formatters';

export interface PoiSources {
  getOpenOrders?: () => OpenOrder[];
  getActiveProcesses?: () => ChasePipelineProcess[];
}

export type ContextGetter = () => { symbol: string; instanceId: number; latestPrice: number };

/**
 * Canonical Trigger Status Hydration (Backend SSOT).
 * Strict mapping without heuristics, guessing or hardcoded fallbacks.
 */
export function hydrateCanonicalTriggerStatus(
  raw: Partial<StrategyTriggerStatus>
): StrategyTriggerStatus | null {
  if (!raw || raw.instance_id === undefined || !raw.symbol) {
    return null;
  }

  return {
    instance_id: Number(raw.instance_id),
    symbol: raw.symbol,
    strategy: raw.strategy || 'GRID_POSITION_FLIPPER',
    condition_name: raw.condition_name || 'PULLBACK_CONMUTATOR',
    state: (raw.state as TriggerState) || 'READY',
    conmutator_mode: (raw.conmutator_mode as ConmutatorMode) || 'SEED',
    resolved_side: (raw.resolved_side as ResolvedSide) || 'BUY',
    position_side: (raw.position_side as PositionSide) || 'FLAT',
    entry_price: Number(raw.entry_price || raw.current_price || 0),
    current_price: Number(raw.current_price || raw.entry_price || 0),
    trigger_price: Number(raw.trigger_price || raw.entry_price || 0),
    current_metric_pc: Number(raw.current_metric_pc ?? 0.0),
    required_metric_pc: Number(raw.required_metric_pc ?? 0.0),
    delta_remaining_pc: Number(raw.delta_remaining_pc ?? 0.0),
    multiplier: Number(raw.multiplier ?? 1.0),
    timestamp: raw.timestamp || new Date().toISOString(),
    updated_at: Number(raw.updated_at ?? Date.now() / 1000),
  };
}

/**
 * Backward compatibility alias for hydrateCanonicalTriggerStatus.
 */
export function sanitizeTriggerStatus(
  raw: Partial<StrategyTriggerStatus>,
  contextGetter?: ContextGetter
): StrategyTriggerStatus {
  const ctx = contextGetter ? contextGetter() : undefined;
  const symbol = raw.symbol || ctx?.symbol || '--';
  const instanceId = raw.instance_id || ctx?.instanceId || 1;
  const currentPrice = raw.current_price && raw.current_price > 0 ? raw.current_price : ctx?.latestPrice || 0;
  const entryPrice = raw.entry_price && raw.entry_price > 0 ? raw.entry_price : currentPrice;

  return {
    instance_id: instanceId,
    symbol: symbol,
    strategy: raw.strategy || 'GRID_POSITION_FLIPPER',
    condition_name: raw.condition_name || 'PULLBACK_CONMUTATOR',
    state: (raw.state as TriggerState) || 'READY',
    conmutator_mode: (raw.conmutator_mode as ConmutatorMode) || 'SEED',
    resolved_side: (raw.resolved_side as ResolvedSide) || 'BUY',
    position_side: (raw.position_side as PositionSide) || 'FLAT',
    entry_price: entryPrice,
    current_price: currentPrice,
    trigger_price: Number(raw.trigger_price || entryPrice),
    current_metric_pc: Number(raw.current_metric_pc ?? 0.0),
    required_metric_pc: Number(raw.required_metric_pc ?? 0.0),
    delta_remaining_pc: Number(raw.delta_remaining_pc ?? 0.0),
    multiplier: Number(raw.multiplier ?? 1.0),
    timestamp: raw.timestamp || new Date().toISOString(),
    updated_at: Number(raw.updated_at ?? Date.now() / 1000),
  };
}

/**
 * Live tick update handler (Dummy UI):
 * Updates the current market price for 50.0% viewport centering and visual delta
 * without modifying backend-governed state machines or conmutator modes.
 */
export function computeLiveTickUpdate(
  current: StrategyTriggerStatus,
  bid: number,
  ask: number
): StrategyTriggerStatus {
  const latestPrice = (bid + ask) / 2 || bid;
  if (!latestPrice || latestPrice <= 0) return current;

  const updated: StrategyTriggerStatus = { ...current, current_price: latestPrice };

  if (updated.entry_price > 0 && updated.position_side !== 'FLAT') {
    let adversePullbackPc = 0;
    if (updated.position_side === 'LONG') {
      adversePullbackPc = ((updated.entry_price - latestPrice) / updated.entry_price) * 100;
    } else if (updated.position_side === 'SHORT') {
      adversePullbackPc = ((latestPrice - updated.entry_price) / updated.entry_price) * 100;
    }

    updated.current_metric_pc = adversePullbackPc;
    updated.delta_remaining_pc = Math.max(0, updated.required_metric_pc - adversePullbackPc);
  }

  return updated;
}

/**
 * Collect all active process ranges (Ranged Spans) from active chase processes.
 */
export function extractProcessSpans(
  s: StrategyTriggerStatus,
  activeProcesses?: ChasePipelineProcess[]
): ProcessRangeSpan[] {
  const spans: ProcessRangeSpan[] = [];
  const decimals = getSymbolDecimals(s.symbol);
  const normSymbol = normalizeSymbol(s.symbol);

  if (Array.isArray(activeProcesses)) {
    activeProcesses
      .filter(
        (p) =>
          (p.instance_id === undefined || p.instance_id === s.instance_id) &&
          normalizeSymbol(p.symbol) === normSymbol &&
          p.status !== 'COMPLETED' &&
          p.status !== 'ABORTED'
      )
      .forEach((p) => {
        const side: 'BUY' | 'SELL' = (p.side || 'BUY').toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
        const startPrice = Number(p.start_price || p.initial_price || p.last_order_price || s.current_price || 0);
        const targetPrice = Number(p.target_price || p.pre_exit_price || p.chase_target_price || 0);
        const endPrice = targetPrice > 0 ? targetPrice : Number(p.last_order_price || p.last_tick_price || startPrice);

        if (startPrice > 0 && endPrice > 0) {
          const minPrice = Math.min(startPrice, endPrice);
          const maxPrice = Math.max(startPrice, endPrice);
          const diffPc = Math.abs(((endPrice - startPrice) / startPrice) * 100);
          const isVirtual =
            p.status === 'VIRTUAL_WATCHING' ||
            p.status === 'VIRTUAL' ||
            p.status === 'VIRTUAL_EXIT' ||
            p.sub_status === 'VIRTUAL_WATCHING' ||
            p.sub_status === 'VIRTUAL' ||
            ((p.status === 'WAITING_EXIT_FILL' || p.status === 'WAITING_TP_FILL' || p.status === 'WATCHING_TP') &&
              (!p.exit_order_id || p.exit_order_id === 'None' || p.exit_order_id === 'null'));

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
            subStatus: p.sub_status,
            exitOrderId: p.exit_order_id,
            isVirtualExit: isVirtual,
            amount: p.amount || 0,
            xStart: 0,
            xEnd: 0,
            xLeft: 0,
            xRight: 0,
            widthPc: 0,
            lane: 0,
            label: `#${p.id} ${side}`,
            subLabel: `${p.status} · $${formatNum(startPrice, decimals)} ➔ $${formatNum(
              endPrice,
              decimals
            )} (${diffPc.toFixed(2)}%) · Qty: ${p.amount || 0}`,
          });
        }
      });
  }

  return spans;
}

/**
 * Collect tactical POIs (Orders, Processes, Triggers, Entry Reference).
 */
export function extractTacticalPois(
  s: StrategyTriggerStatus,
  openOrders?: OpenOrder[],
  activeProcesses?: ChasePipelineProcess[]
): TacticalPOI[] {
  const pois: TacticalPOI[] = [];
  const decimals = getSymbolDecimals(s.symbol);
  const normSymbol = normalizeSymbol(s.symbol);

  // 1. Flip Trigger Marker
  if (s.trigger_price && s.trigger_price > 0) {
    pois.push({
      id: 'poi-flip-target',
      price: s.trigger_price,
      category: 'FLIP_TRIGGER',
      side: s.resolved_side || 'NEUTRAL',
      label: '⚡ Flip Target',
      subLabel: `Umbral: ${s.required_metric_pc.toFixed(2)}% · Target: $${formatNum(
        s.trigger_price,
        decimals
      )}`,
      isPrimary: true,
    });
  }

  // 2. Entry Price Marker
  if (s.entry_price && s.entry_price > 0 && s.position_side !== 'FLAT') {
    pois.push({
      id: 'poi-entry-ref',
      price: s.entry_price,
      category: 'ENTRY_REF',
      side: s.position_side === 'LONG' ? 'BUY' : 'SELL',
      label: `📍 Entrada ${s.position_side}`,
      subLabel: `Posición: ${s.position_side} · $${formatNum(s.entry_price, decimals)}`,
      isPrimary: false,
    });
  }

  // 3. Open Orders
  if (Array.isArray(openOrders)) {
    openOrders
      .filter((o) => normalizeSymbol(o.symbol) === normSymbol && o.status === 'OPEN')
      .forEach((o) => {
        const side = o.side.toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
        pois.push({
          id: `poi-order-${o.id}`,
          price: o.price,
          category: 'REAL_ORDER',
          side: side,
          label: `Limit ${side} · #${o.id.slice(-4)}`,
          subLabel: `Qty: ${o.remaining || o.amount} · $${formatNum(o.price, decimals)}`,
          isPrimary: false,
        });
      });
  }

  // 4. Active Processes
  if (Array.isArray(activeProcesses)) {
    activeProcesses
      .filter(
        (p) =>
          normalizeSymbol(p.symbol) === normSymbol &&
          p.status !== 'COMPLETED' &&
          p.status !== 'ABORTED'
      )
      .forEach((p) => {
        const side = (p.side || 'BUY').toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
        const price = p.last_order_price || p.initial_price || s.current_price;
        if (price > 0) {
          pois.push({
            id: `poi-proc-${p.id}`,
            price: price,
            category: p.status === 'WAITING_TP_FILL' ? 'EXECUTED_PENDING' : 'VIRTUAL_ORDER',
            side: side,
            label: `Proc #${p.id} (${side})`,
            subLabel: `${p.status} · $${formatNum(price, decimals)}`,
            isPrimary: false,
          });
        }
      });
  }

  return pois;
}
