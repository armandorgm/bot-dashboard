import { TriggerGaugeManager } from './triggerGaugeManager';

export function runTriggerGaugeVerification(): boolean {
  const manager = new TriggerGaugeManager();

  // 1. TREND_BUY theme check (Emerald Green)
  const trendBuyTheme = manager.getMetricColor(0.3523, 0.75, 'TREND_ACCUMULATION', 'TREND_BUY');
  if (trendBuyTheme.color !== '#10b981' || trendBuyTheme.ledClass !== 'led-green') {
    throw new Error(`Failed TREND_BUY theme check: got ${trendBuyTheme.color}`);
  }

  // 2. TREND_SELL theme check (Red)
  const trendSellTheme = manager.getMetricColor(0.25, 0.75, 'TREND_ACCUMULATION', 'TREND_SELL');
  if (trendSellTheme.color !== '#ef4444' || trendSellTheme.ledClass !== 'led-red') {
    throw new Error(`Failed TREND_SELL theme check: got ${trendSellTheme.color}`);
  }

  // 3. FLIP_SELL theme check (Amber/Yellow)
  const flipSellTheme = manager.getMetricColor(0.7692, 0.75, 'FLIP_CONMUTATED', 'FLIP_SELL');
  if (flipSellTheme.color !== '#f59e0b' || flipSellTheme.ledClass !== 'led-yellow') {
    throw new Error(`Failed FLIP_SELL theme check: got ${flipSellTheme.color}`);
  }

  // 4. FLIP_BUY theme check (Azure Blue)
  const flipBuyTheme = manager.getMetricColor(0.85, 0.75, 'FLIP_CONMUTATED', 'FLIP_BUY');
  if (flipBuyTheme.color !== '#3b82f6' || flipBuyTheme.ledClass !== 'led-blue') {
    throw new Error(`Failed FLIP_BUY theme check: got ${flipBuyTheme.color}`);
  }

  // 5. SEED / READY theme check (Cyan)
  const seedTheme = manager.getMetricColor(0.0, 0.75, 'READY', 'SEED');
  if (seedTheme.color !== '#06b6d4' || seedTheme.ledClass !== 'led-cyan') {
    throw new Error(`Failed SEED theme check: got ${seedTheme.color}`);
  }

  // 6. Sanitization of v2.2.0 payload (Modo Tendencia)
  const sanitizedTrend = manager.getSanitizedStatus({
    instance_id: 8,
    symbol: '1000PEPEUSDC',
    strategy: 'GRID_POSITION_FLIPPER',
    condition_name: 'PULLBACK_CONMUTATOR',
    state: 'TREND_ACCUMULATION',
    conmutator_mode: 'TREND_BUY',
    resolved_side: 'BUY',
    position_side: 'LONG',
    entry_price: 0.0026,
    current_price: 0.00259084,
    trigger_price: 0.0025805,
    actual_pullback_pc: 0.003523,
    required_pullback_pc: 0.0075,
    current_metric_pc: 0.3523,
    required_metric_pc: 0.75,
    delta_remaining_pc: 0.3977,
    multiplier: 3.0,
  });

  if (
    sanitizedTrend.state !== 'TREND_ACCUMULATION' ||
    sanitizedTrend.conmutator_mode !== 'TREND_BUY' ||
    sanitizedTrend.resolved_side !== 'BUY' ||
    sanitizedTrend.required_metric_pc !== 0.75 ||
    sanitizedTrend.delta_remaining_pc !== 0.3977
  ) {
    throw new Error(`Sanitization failed for Trend Mode payload: ${JSON.stringify(sanitizedTrend)}`);
  }

  // 7. Sanitization of v2.2.0 payload (Modo Giro Conmutado / Flip)
  const sanitizedFlip = manager.getSanitizedStatus({
    instance_id: 8,
    symbol: '1000PEPEUSDC',
    strategy: 'GRID_POSITION_FLIPPER',
    condition_name: 'PULLBACK_CONMUTATOR',
    state: 'FLIP_CONMUTATED',
    conmutator_mode: 'FLIP_SELL',
    resolved_side: 'SELL',
    position_side: 'LONG',
    entry_price: 0.0026,
    current_price: 0.00258,
    trigger_price: 0.0025805,
    current_metric_pc: 0.7692,
    required_metric_pc: 0.75,
    delta_remaining_pc: 0.0,
    multiplier: 3.0,
  });

  if (
    sanitizedFlip.state !== 'FLIP_CONMUTATED' ||
    sanitizedFlip.conmutator_mode !== 'FLIP_SELL' ||
    sanitizedFlip.resolved_side !== 'SELL'
  ) {
    throw new Error(`Sanitization failed for Flip Mode payload: ${JSON.stringify(sanitizedFlip)}`);
  }

  // 8. Badge Info Helper check
  const badgeInfo = manager.getConmutatorModeBadgeInfo('FLIP_SELL', 'FLIP_CONMUTATED');
  if (!badgeInfo.label.includes('GIRO A SHORT (SELL)')) {
    throw new Error(`Failed badge info check: got ${badgeInfo.label}`);
  }

  // 9. Compact status badge for Global Overview
  const compactHtml = manager.getCompactStatusBadgeHtml(sanitizedTrend);
  if (!compactHtml.includes('TREND BUY') || !compactHtml.includes('0.35%')) {
    throw new Error(`Failed compact badge HTML check: got ${compactHtml}`);
  }

  const compactFlipHtml = manager.getCompactStatusBadgeHtml(sanitizedFlip);
  if (!compactFlipHtml.includes('FLIP SELL') || !compactFlipHtml.includes('0.77%')) {
    throw new Error(`Failed compact flip badge HTML check: got ${compactFlipHtml}`);
  }

  return true;
}
