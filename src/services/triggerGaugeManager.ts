import { ConmutatorMode, PositionSide, ResolvedSide, StrategyTriggerStatus, TriggerState } from '../types';
import { formatNum, getSymbolDecimals } from '../utils/formatters';

/**
 * Single Responsibility: Manage calculation, color mapping and rendering of the
 * Dynamic Polarity Conmutator and Trend Follower (v2.2.0 Visual Architecture).
 * Fully live and reactive to real-time market ticks.
 */
export class TriggerGaugeManager {
  private currentStatus: StrategyTriggerStatus | null = null;
  private instanceStatusMap: Map<number, StrategyTriggerStatus> = new Map();
  private contextGetter?: () => { symbol: string; instanceId: number; latestPrice: number };

  public setContextGetter(getter: () => { symbol: string; instanceId: number; latestPrice: number }): void {
    this.contextGetter = getter;
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
        this.render();
      }
    }
  }

  /**
   * Live tick update handler: called on every market ticker WebSocket event
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

    this.render();
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

  /**
   * Render the visual gauge and conmutator panel inside the target DOM container
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

    // Track dynamic range for visual bar: [0.00%, maxVal%]
    const maxVal = Math.max(1.0, s.required_metric_pc * 1.5, Math.abs(s.current_metric_pc) * 1.2);
    const minVal = 0.0;
    const totalSpan = maxVal - minVal || 1;

    const getTrackPosPercent = (val: number) => {
      const clamped = Math.max(minVal, Math.min(maxVal, Math.max(0, val)));
      return ((clamped - minVal) / totalSpan) * 100;
    };

    const targetPos = getTrackPosPercent(s.required_metric_pc);
    const currentPos = getTrackPosPercent(s.current_metric_pc);

    // Progress bar fill width from 0%
    const fillWidth = Math.max(2, Math.min(100, currentPos));

    const currSign = s.current_metric_pc > 0 ? '+' : '';
    const reqSign = s.required_metric_pc > 0 ? '+' : '';
    const deltaSign = s.delta_remaining_pc > 0 ? '+' : '';

    // Explanatory footer text
    let statusDetailText = '';
    if (isFlip) {
      statusDetailText = `Giro conmutado a ${s.resolved_side}. Umbral de reversión alcanzado (+${s.required_metric_pc.toFixed(4)}%). Conmutador en polaridad invertida.`;
    } else if (isReady) {
      statusDetailText = 'Sin posición activa. Modo Semilla listo para apertura de ciclo.';
    } else {
      const oppositeSide = s.position_side === 'LONG' ? 'SHORT (SELL)' : 'LONG (BUY)';
      statusDetailText = `Acumulando en ${s.position_side} (${s.resolved_side}). A ${s.delta_remaining_pc.toFixed(4)}% del umbral para conmutar giro a ${oppositeSide}.`;
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

      const fillEl = document.getElementById('tg-progress-fill');
      if (fillEl) {
        fillEl.style.width = `${fillWidth}%`;
        fillEl.style.background = colorTheme.color;
      }

      const markerEl = document.getElementById('tg-current-marker');
      if (markerEl) {
        markerEl.style.left = `${currentPos}%`;
        markerEl.style.background = colorTheme.color;
      }

      const markerLabelEl = document.getElementById('tg-marker-label');
      if (markerLabelEl) {
        markerLabelEl.style.borderColor = colorTheme.color;
        markerLabelEl.innerText = `${currSign}${s.current_metric_pc.toFixed(4)}%`;
      }

      const targetLineEl = document.getElementById('tg-target-line');
      if (targetLineEl) {
        targetLineEl.style.left = `${targetPos}%`;
      }

      const detailEl = document.getElementById('tg-status-detail');
      if (detailEl) {
        detailEl.style.color = colorTheme.color;
        detailEl.innerText = statusDetailText;
      }

      return;
    }

    // Full template creation if not yet initialized
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
            <span class="trigger-chip-lbl">Flip Target Price:</span>
            <span id="tg-chip-target-price" class="trigger-chip-val" style="color: #a78bfa; font-weight: 700;">
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
            <span id="tg-chip-market-price" class="trigger-chip-val" style="color: #e2e8f0;">
              $${formatNum(s.current_price, decimals)}
            </span>
          </div>
        </div>

        <!-- Proximity to Flip Reversal Bar / Gauge -->
        <div class="trigger-bar-container">
          <div class="trigger-bar-labels">
            <span>[0.00% Base]</span>
            <span style="color: #94a3b8;">Proximidad al Giro (Flip Reversal)</span>
            <span>[+${maxVal.toFixed(2)}%]</span>
          </div>

          <div class="trigger-bar-track">
            <!-- Target Flip Line & Marker -->
            <div id="tg-target-line" class="trigger-target-line" style="left: ${targetPos}%;" title="Umbral de Giro: ${reqSign}${s.required_metric_pc.toFixed(4)}%">
              <div class="trigger-target-pin" style="color: #f59e0b; border-color: rgba(245,158,11,0.5);">⚡ Flip Target (${reqSign}${s.required_metric_pc.toFixed(3)}%)</div>
            </div>

            <!-- Metric Progress Fill -->
            <div id="tg-progress-fill" class="trigger-progress-fill" style="left: 0%; width: ${fillWidth}%; background: ${colorTheme.color};"></div>

            <!-- Current Metric Marker Bubble -->
            <div id="tg-current-marker" class="trigger-current-marker" style="left: ${currentPos}%; background: ${colorTheme.color};" title="Retroceso Actual: ${currSign}${s.current_metric_pc.toFixed(4)}%">
              <span class="trigger-marker-dot"></span>
              <span id="tg-marker-label" class="trigger-marker-label" style="border-color: ${colorTheme.color};">
                ${currSign}${s.current_metric_pc.toFixed(4)}%
              </span>
            </div>
          </div>
        </div>

        <!-- Footer status detail -->
        <div class="trigger-gauge-footer">
          <span style="color: #94a3b8;">Estado Operacional:</span>
          <strong id="tg-status-detail" style="color: ${colorTheme.color};">${statusDetailText}</strong>
        </div>
      </div>
    `;
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
