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
 * Sanitize raw telemetry or partial status to canonical StrategyTriggerStatus (v2.2.0)
 */
export function sanitizeTriggerStatus(
  raw: Partial<StrategyTriggerStatus>,
  contextGetter?: ContextGetter
): StrategyTriggerStatus {
  const ctx = contextGetter
    ? contextGetter()
    : { symbol: '1000PEPEUSDC', instanceId: 8, latestPrice: 0.002575 };
  const symbol = raw.symbol || ctx.symbol || '1000PEPEUSDC';
  const instanceId = raw.instance_id || ctx.instanceId || 8;
  const strategy = raw.strategy || 'GRID_POSITION_FLIPPER';

  const reqMetric =
    typeof raw.required_metric_pc === 'number' && raw.required_metric_pc !== 0
      ? raw.required_metric_pc
      : typeof raw.required_pullback_pc === 'number' && raw.required_pullback_pc !== 0
      ? raw.required_pullback_pc * 100
      : 0.75;

  const currMetric =
    typeof raw.current_metric_pc === 'number'
      ? raw.current_metric_pc
      : typeof raw.actual_pullback_pc === 'number'
      ? raw.actual_pullback_pc * 100
      : 0.0;

  const deltaRem =
    typeof raw.delta_remaining_pc === 'number'
      ? raw.delta_remaining_pc
      : Math.max(0, reqMetric - currMetric);

  const posSide: PositionSide = raw.position_side || 'LONG';
  const currentPrice =
    raw.current_price && raw.current_price > 0
      ? raw.current_price
      : ctx.latestPrice > 0
      ? ctx.latestPrice
      : 0.002575;
  const entryPrice =
    raw.entry_price && raw.entry_price > 0 ? raw.entry_price : currentPrice;

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
    if (
      conmutatorMode === 'TREND_BUY' ||
      conmutatorMode === 'FLIP_BUY' ||
      conmutatorMode === 'SEED'
    ) {
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
 * Live tick update handler: recalculates adverse pullback, delta remaining, and dynamic mode.
 */
export function computeLiveTickUpdate(
  current: StrategyTriggerStatus,
  bid: number,
  ask: number
): StrategyTriggerStatus {
  const latestPrice = (bid + ask) / 2 || bid;
  if (!latestPrice || latestPrice <= 0) return current;

  const updated: StrategyTriggerStatus = { ...current };
  updated.current_price = latestPrice;

  if (updated.entry_price > 0 && updated.position_side !== 'FLAT') {
    const reqMetric = updated.required_metric_pc || 0.75;
    let adversePullbackPc = 0;

    if (updated.position_side === 'LONG') {
      adversePullbackPc = ((updated.entry_price - latestPrice) / updated.entry_price) * 100;
    } else if (updated.position_side === 'SHORT') {
      adversePullbackPc = ((latestPrice - updated.entry_price) / updated.entry_price) * 100;
    }

    updated.current_metric_pc = adversePullbackPc;
    updated.delta_remaining_pc = Math.max(0, reqMetric - updated.current_metric_pc);

    if (updated.current_metric_pc >= reqMetric) {
      updated.state = 'FLIP_CONMUTATED';
      updated.conmutator_mode = updated.position_side === 'LONG' ? 'FLIP_SELL' : 'FLIP_BUY';
      updated.resolved_side = updated.position_side === 'LONG' ? 'SELL' : 'BUY';
    } else {
      updated.state = 'TREND_ACCUMULATION';
      updated.conmutator_mode = updated.position_side === 'LONG' ? 'TREND_BUY' : 'TREND_SELL';
      updated.resolved_side = updated.position_side === 'LONG' ? 'BUY' : 'SELL';
    }
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
          normalizeSymbol(p.symbol) === normSymbol &&
          p.status !== 'COMPLETED' &&
          p.status !== 'ABORTED'
      )
      .forEach((p) => {
        const side: 'BUY' | 'SELL' = (p.side || 'BUY').toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
        let startPrice =
          p.initial_price && p.initial_price > 0
            ? p.initial_price
            : p.last_order_price || s.current_price;
        let endPrice =
          p.last_order_price && p.last_order_price > 0
            ? p.last_order_price
            : p.last_tick_price || startPrice;

        const isTpPhase = p.status === 'WAITING_TP_FILL' || p.status === 'PLACING_TP';
        if (isTpPhase) {
          startPrice = p.last_order_price || p.initial_price || s.current_price;
          const profitMultiplier =
            side === 'BUY'
              ? 1 + (s.required_metric_pc ? s.required_metric_pc / 100 : 0.005)
              : 1 - (s.required_metric_pc ? s.required_metric_pc / 100 : 0.005);
          endPrice =
            p.last_tick_price && p.last_tick_price !== startPrice
              ? p.last_tick_price
              : startPrice * profitMultiplier;
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
