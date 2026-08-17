import { StrategyTriggerStatus } from '../types';
import { formatNum, getSymbolDecimals } from '../utils/formatters';

/**
 * Single Responsibility: Manage calculation, color mapping and rendering of the
 * Pullback / Trigger Status Gauge (Micro-Barra Diferencial y Medidor de Umbral).
 */
export class TriggerGaugeManager {
  private currentStatus: StrategyTriggerStatus | null = null;
  private instanceStatusMap: Map<number, StrategyTriggerStatus> = new Map();

  public getStatus(): StrategyTriggerStatus | null {
    return this.currentStatus;
  }

  public getStatusForInstance(instanceId: number): StrategyTriggerStatus | undefined {
    return this.instanceStatusMap.get(instanceId);
  }

  public setStatus(status: StrategyTriggerStatus | null): void {
    this.currentStatus = status;
    if (status) {
      this.instanceStatusMap.set(status.instance_id, status);
    }
    this.render();
  }

  public updateFromTelemetry(instanceId: number, status?: StrategyTriggerStatus): void {
    if (status) {
      this.instanceStatusMap.set(instanceId, status);
      if (this.currentStatus?.instance_id === instanceId || !this.currentStatus) {
        this.currentStatus = status;
        this.render();
      }
    }
  }

  /**
   * Determine color theme based on pullback metric vs required threshold
   */
  public getMetricColor(currentMetric: number, requiredMetric: number, state: string): {
    color: string;
    bg: string;
    border: string;
    ledClass: string;
  } {
    if (state === 'PASSED' || currentMetric >= requiredMetric) {
      return {
        color: '#10b981', // Emerald Green
        bg: 'rgba(16, 185, 129, 0.12)',
        border: 'rgba(16, 185, 129, 0.4)',
        ledClass: 'led-green',
      };
    }
    if (currentMetric >= 0 && currentMetric < requiredMetric) {
      return {
        color: '#f59e0b', // Amber / Yellow
        bg: 'rgba(245, 158, 11, 0.12)',
        border: 'rgba(245, 158, 11, 0.4)',
        ledClass: 'led-yellow',
      };
    }
    // Negative pullback / Blocked
    return {
      color: '#ef4444', // Red
      bg: 'rgba(239, 68, 68, 0.12)',
      border: 'rgba(239, 68, 68, 0.4)',
      ledClass: 'led-red',
    };
  }

  /**
   * Render the visual gauge inside the target DOM container
   */
  public render(containerId: string = 'trigger-gauge-container'): void {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!this.currentStatus) {
      container.style.display = 'none';
      return;
    }

    container.style.display = 'flex';
    const s = this.currentStatus;
    const decimals = getSymbolDecimals(s.symbol);

    const isPassed = s.state === 'PASSED' || s.current_metric_pc >= s.required_metric_pc;
    const isReady = s.state === 'READY' || s.position_side === 'FLAT';

    const colorTheme = this.getMetricColor(s.current_metric_pc, s.required_metric_pc, s.state);


    // Calculate dynamic range for the visual track: default [-0.50%, +0.50%]
    const maxVal = Math.max(0.5, Math.abs(s.required_metric_pc) * 2, Math.abs(s.current_metric_pc) * 1.3);
    const minVal = -maxVal;
    const totalSpan = maxVal - minVal || 1;

    // Relative percentage on the track (0% to 100%)
    const getTrackPosPercent = (val: number) => {
      const clamped = Math.max(minVal, Math.min(maxVal, val));
      return ((clamped - minVal) / totalSpan) * 100;
    };

    const zeroPos = getTrackPosPercent(0);
    const targetPos = getTrackPosPercent(s.required_metric_pc);
    const currentPos = getTrackPosPercent(s.current_metric_pc);

    // Progress bar fill geometry
    let fillLeft = zeroPos;
    let fillWidth = 0;
    if (s.current_metric_pc >= 0) {
      fillLeft = zeroPos;
      fillWidth = currentPos - zeroPos;
    } else {
      fillLeft = currentPos;
      fillWidth = zeroPos - currentPos;
    }

    const currSign = s.current_metric_pc > 0 ? '+' : '';
    const reqSign = s.required_metric_pc > 0 ? '+' : '';
    const deltaSign = s.delta_remaining_pc > 0 ? '+' : '';

    // Status message
    let statusBadgeText = '';
    let statusDetailText = '';
    if (isPassed) {
      statusBadgeText = '✅ UMBRAL ALCANZADO / AUTORIZADO';
      statusDetailText = `Pullback superó el objetivo requerido (+${s.required_metric_pc.toFixed(4)}%). Flip autorizado.`;
    } else if (isReady) {
      statusBadgeText = '⚪ READY (FLAT)';
      statusDetailText = 'Sin posición activa. Listo para nueva entrada sin restricción de pullback.';
    } else {
      statusBadgeText = '⛔ BLOQUEADO';
      statusDetailText = `Falta ${deltaSign}${s.delta_remaining_pc.toFixed(4)}% de rebote para autorizar flip`;
    }

    container.innerHTML = `
      <div class="trigger-gauge-card" style="border-color: ${colorTheme.border};">
        <!-- Header -->
        <div class="trigger-gauge-header">
          <div class="trigger-gauge-title-group">
            <span class="trigger-gauge-icon">🎯</span>
            <div>
              <div class="trigger-gauge-title">
                Condición ${s.position_side} Flip: Pullback actual vs Requerido (${reqSign}${s.required_metric_pc.toFixed(4)}%)
              </div>
              <div class="trigger-gauge-subtitle">
                Estrategia: <span style="color: #60a5fa; font-weight: bold;">${s.strategy}</span> · Símbolo: <span style="color: #cbd5e1; font-weight: bold;">${s.symbol}</span>
              </div>
            </div>
          </div>
          <div class="trigger-status-badge" style="background: ${colorTheme.bg}; color: ${colorTheme.color}; border: 1px solid ${colorTheme.border};">
            <span class="pulse-indicator" style="background-color: ${colorTheme.color}; box-shadow: 0 0 8px ${colorTheme.color};"></span>
            <span>${statusBadgeText}</span>
          </div>
        </div>

        <!-- Metrics Row -->
        <div class="trigger-metrics-row">
          <div class="trigger-metric-chip">
            <span class="trigger-chip-lbl">Pullback Actual:</span>
            <span class="trigger-chip-val" style="color: ${colorTheme.color}; font-weight: 800;">
              ${currSign}${s.current_metric_pc.toFixed(4)}%
            </span>
          </div>
          <div class="trigger-metric-chip">
            <span class="trigger-chip-lbl">Umbral Requerido:</span>
            <span class="trigger-chip-val" style="color: #f59e0b; font-weight: 700;">
              ${reqSign}${s.required_metric_pc.toFixed(4)}%
            </span>
          </div>
          <div class="trigger-metric-chip">
            <span class="trigger-chip-lbl">Delta Faltante:</span>
            <span class="trigger-chip-val" style="color: ${isPassed ? '#10b981' : '#f87171'}; font-weight: 700;">
              ${isPassed ? '0.0000%' : `${deltaSign}${s.delta_remaining_pc.toFixed(4)}%`}
            </span>
          </div>
          <div class="trigger-metric-chip">
            <span class="trigger-chip-lbl">Target Price:</span>
            <span class="trigger-chip-val" style="color: #38bdf8;">
              $${s.trigger_price !== null ? formatNum(s.trigger_price, decimals) : '--'}
            </span>
          </div>
          <div class="trigger-metric-chip">
            <span class="trigger-chip-lbl">Entry Ref:</span>
            <span class="trigger-chip-val" style="color: #94a3b8;">
              $${s.entry_price > 0 ? formatNum(s.entry_price, decimals) : '--'}
            </span>
          </div>
          <div class="trigger-metric-chip">
            <span class="trigger-chip-lbl">Market Price:</span>
            <span class="trigger-chip-val" style="color: #e2e8f0;">
              $${formatNum(s.current_price, decimals)}
            </span>
          </div>
        </div>

        <!-- Bidirectional Progress Bar / Gauge -->
        <div class="trigger-bar-container">
          <!-- Scale limits labels -->
          <div class="trigger-bar-labels">
            <span>[${minVal.toFixed(2)}%]</span>
            <span style="color: #94a3b8;">[0.00% Base]</span>
            <span>[+${maxVal.toFixed(2)}%]</span>
          </div>

          <div class="trigger-bar-track">
            <!-- Zero Divider Line -->
            <div class="trigger-zero-line" style="left: ${zeroPos}%;"></div>

            <!-- Target Required Line & Marker -->
            <div class="trigger-target-line" style="left: ${targetPos}%;" title="Umbral Objetivo: ${reqSign}${s.required_metric_pc.toFixed(4)}%">
              <div class="trigger-target-pin">▲ Target (${reqSign}${s.required_metric_pc.toFixed(3)}%)</div>
            </div>

            <!-- Metric Progress Fill -->
            <div class="trigger-progress-fill" style="left: ${fillLeft}%; width: ${Math.max(2, fillWidth)}%; background: ${colorTheme.color};"></div>

            <!-- Current Metric Marker Bubble -->
            <div class="trigger-current-marker" style="left: ${currentPos}%; background: ${colorTheme.color};" title="Pullback Actual: ${currSign}${s.current_metric_pc.toFixed(4)}%">
              <span class="trigger-marker-dot"></span>
              <span class="trigger-marker-label" style="border-color: ${colorTheme.color};">
                ${currSign}${s.current_metric_pc.toFixed(4)}%
              </span>
            </div>
          </div>
        </div>

        <!-- Footer status detail -->
        <div class="trigger-gauge-footer">
          <span style="color: #94a3b8;">Estado:</span>
          <strong style="color: ${colorTheme.color};">${statusDetailText}</strong>
        </div>
      </div>
    `;
  }

  /**
   * Helper for rendering compact badge in global matrix table
   */
  public getCompactStatusBadgeHtml(s?: StrategyTriggerStatus): string {
    if (!s) return '<span style="color: #64748b;">--</span>';
    const isPassed = s.state === 'PASSED' || s.current_metric_pc >= s.required_metric_pc;
    const isReady = s.state === 'READY' || s.position_side === 'FLAT';
    const theme = this.getMetricColor(s.current_metric_pc, s.required_metric_pc, s.state);
    const currSign = s.current_metric_pc > 0 ? '+' : '';

    if (isReady) {
      return `<span style="background: rgba(148, 163, 184, 0.1); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.3); padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold;">⚪ FLAT</span>`;
    }

    const badgeIcon = isPassed ? '✅' : '⛔';
    const deltaText = isPassed ? 'PASSED' : `-${s.delta_remaining_pc.toFixed(2)}%`;

    return `
      <div style="display: inline-flex; align-items: center; gap: 4px; background: ${theme.bg}; color: ${theme.color}; border: 1px solid ${theme.border}; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-family: monospace; font-weight: bold;" title="Pullback: ${currSign}${s.current_metric_pc.toFixed(4)}% | Target: ${s.required_metric_pc}% | Delta: ${s.delta_remaining_pc}%">
        <span>${badgeIcon}</span>
        <span>${currSign}${s.current_metric_pc.toFixed(2)}%</span>
        <span style="opacity: 0.7; font-size: 9px;">(${deltaText})</span>
      </div>
    `;
  }
}

export const triggerGaugeManager = new TriggerGaugeManager();
