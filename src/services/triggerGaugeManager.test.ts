import { TriggerGaugeManager } from './triggerGaugeManager';
import { StrategyTriggerStatus } from '../types';

export function runTriggerGaugeVerification(): boolean {
  const manager = new TriggerGaugeManager();

  // 1. Negative pullback (Blocked)
  const redTheme = manager.getMetricColor(-0.3523, 0.075, 'BLOCKED');
  if (redTheme.color !== '#ef4444' || redTheme.ledClass !== 'led-red') {
    throw new Error('Failed negative pullback theme check');
  }

  // 2. Positive pullback below threshold (Amber)
  const yellowTheme = manager.getMetricColor(0.045, 0.075, 'BLOCKED');
  if (yellowTheme.color !== '#f59e0b' || yellowTheme.ledClass !== 'led-yellow') {
    throw new Error('Failed intermediate pullback theme check');
  }

  // 3. Threshold reached (Emerald Green)
  const greenTheme = manager.getMetricColor(0.081, 0.075, 'PASSED');
  if (greenTheme.color !== '#10b981' || greenTheme.ledClass !== 'led-green') {
    throw new Error('Failed passed pullback theme check');
  }

  // 4. Compact badge HTML
  const mockStatus: StrategyTriggerStatus = {
    instance_id: 8,
    symbol: '1000PEPEUSDC',
    strategy: 'GRID_POSITION_FLIPPER',
    state: 'BLOCKED',
    position_side: 'LONG',
    entry_price: 0.0026,
    current_price: 0.00259084,
    trigger_price: 0.00260195,
    current_metric_pc: -0.3523,
    required_metric_pc: 0.075,
    delta_remaining_pc: 0.4273,
  };

  const badgeHtml = manager.getCompactStatusBadgeHtml(mockStatus);
  if (!badgeHtml.includes('⛔') || !badgeHtml.includes('-0.35%')) {
    throw new Error('Failed compact badge output check');
  }

  return true;
}
