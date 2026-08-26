import { ProcessRangeSpan, StrategyTriggerStatus, TacticalCluster } from '../types';
import { formatNum, getSymbolDecimals } from '../utils/formatters';
import { FRAME_BUDGET_MS } from '../utils/constants';
import { getConmutatorModeBadgeInfo, getMetricColor, getPoiVisualConfig } from './triggerGaugeTheme';
import { calculateLogCoordinate, calculateViewportExtrema, projectAndAssignLanes } from './triggerGaugeMath';

export class TriggerGaugeDomRenderer {
  private lastRenderTime: number = 0;
  private rafId: number | null = null;
  private needsRender: boolean = false;

  public requestRender(renderFn: () => void): void {
    this.needsRender = true;
    if (this.rafId === null) {
      if (typeof requestAnimationFrame !== 'undefined') {
        this.rafId = requestAnimationFrame((timestamp) => this.renderLoop(timestamp, renderFn));
      } else {
        renderFn();
      }
    }
  }

  private renderLoop = (timestamp: DOMHighResTimeStamp, renderFn: () => void): void => {
    this.rafId = null;
    if (!this.needsRender) return;

    const elapsed = timestamp - this.lastRenderTime;
    if (elapsed >= FRAME_BUDGET_MS) {
      this.lastRenderTime = timestamp;
      this.needsRender = false;
      renderFn();
    } else {
      this.rafId = requestAnimationFrame((ts) => this.renderLoop(ts, renderFn));
    }
  };

  /**
   * Render the visual Tactical Price Spectrum Bar inside the target DOM container
   */
  public render(
    containerId: string,
    s: StrategyTriggerStatus | null,
    rawSpans: ProcessRangeSpan[]
  ): void {
    if (typeof document === 'undefined') return;

    const container = document.getElementById(containerId);
    if (!container) return;

    if (!s) {
      container.style.display = 'none';
      return;
    }

    container.style.display = 'flex';
    const decimals = getSymbolDecimals(s.symbol);

    const isFlip = s.state === 'FLIP_CONMUTATED' || (s.conmutator_mode && s.conmutator_mode.startsWith('FLIP_'));
    const isReady = s.state === 'READY' || s.position_side === 'FLAT' || s.conmutator_mode === 'SEED';
    const colorTheme = getMetricColor(s.current_metric_pc, s.required_metric_pc, s.state, s.conmutator_mode);
    const badgeInfo = getConmutatorModeBadgeInfo(s.conmutator_mode, s.state);

    // 1. Calculate Viewport Extrema & Project Spans
    const { pMin, pMax } = calculateViewportExtrema(s.current_price, s.trigger_price, rawSpans);
    const { spans, totalLanes } = projectAndAssignLanes(rawSpans, s.current_price, pMin, pMax);

    // Flip Target X-coordinate
    let xFlip: number | null = null;
    if (s.trigger_price && s.trigger_price > 0) {
      xFlip = calculateLogCoordinate(s.trigger_price, s.current_price, pMin, pMax);
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

        <!-- Tactical Price Spectrum Bar -->
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
   * Synchronize tactical POI pins in-place (Anti-Flickering).
   */
  public syncPinsDom(
    container: HTMLElement,
    clusters: TacticalCluster[],
    _decimals?: number
  ): void {
    const existingElements = new Map<string, HTMLElement>();

    container.querySelectorAll<HTMLElement>('[data-pin-id]').forEach((el) => {
      const id = el.getAttribute('data-pin-id');
      if (id) existingElements.set(id, el);
    });

    const activeIds = new Set<string>();

    clusters.forEach((cluster, idx) => {
      const clusterId = cluster.pois.map((p) => p.id).join('__') || `cluster-${idx}`;
      activeIds.add(clusterId);
      const existingEl = existingElements.get(clusterId);
      const primaryPoi = cluster.pois[0];
      const visual = getPoiVisualConfig(primaryPoi.category, primaryPoi.side);

      if (existingEl) {
        existingEl.style.left = `${cluster.x}%`;
      } else {
        const newEl = document.createElement('div');
        newEl.setAttribute('data-pin-id', clusterId);
        newEl.className = 'tactical-poi-pin';
        newEl.style.left = `${cluster.x}%`;
        newEl.style.borderColor = visual.border;
        newEl.innerHTML = `<span>${visual.icon}</span>`;
        container.appendChild(newEl);
      }
    });

    existingElements.forEach((el, id) => {
      if (!activeIds.has(id)) {
        el.remove();
      }
    });
  }

  public getSpanTooltipText(span: ProcessRangeSpan, decimals: number, marketPrice: number): string {
    const startDistPc = (((span.startPrice - marketPrice) / marketPrice) * 100).toFixed(2);
    const endDistPc = (((span.endPrice - marketPrice) / marketPrice) * 100).toFixed(2);
    return `Proceso #${span.processId} (${span.side})\nEstado: ${span.status}\nInicio: $${formatNum(span.startPrice, decimals)} (${startDistPc}% vs Market)\nDestino: $${formatNum(span.endPrice, decimals)} (${endDistPc}% vs Market)\nCantidad: ${span.amount}`;
  }
}
