import { ProcessRangeSpan, StrategyTriggerStatus, TacticalCluster, TacticalProcessGap } from '../types';
import { formatNum, getSymbolDecimals } from '../utils/formatters';
import { FRAME_BUDGET_MS } from '../utils/constants';
import { getConmutatorModeBadgeInfo, getMetricColor, getPoiVisualConfig, getProcessSpanTheme } from './triggerGaugeTheme';
import { calculateLogCoordinate, calculateProcessGaps, calculateViewportExtrema, projectAndAssignLanes } from './triggerGaugeMath';
import { tooltipManager } from './tooltipManager';

export class TriggerGaugeDomRenderer {
  private lastRenderTime: number = 0;
  private rafId: number | null = null;
  private needsRender: boolean = false;
  private currentHoveredSpanId: string | null = null;
  private currentHoveredGapId: string | null = null;
  private isHoveringFlipTarget: boolean = false;
  private currentSpans: ProcessRangeSpan[] = [];
  private currentGaps: TacticalProcessGap[] = [];
  private currentStatus: StrategyTriggerStatus | null = null;

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
      if (this.currentHoveredSpanId || this.isHoveringFlipTarget) {
        this.currentHoveredSpanId = null;
        this.isHoveringFlipTarget = false;
        tooltipManager.hide();
      }
      this.currentStatus = null;
      this.currentSpans = [];
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
    const gaps = calculateProcessGaps(spans, s.current_price, pMin, pMax);

    this.currentSpans = spans;
    this.currentGaps = gaps;
    this.currentStatus = s;

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
        this.attachTrackEvents(trackEl);
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

      const gapsContainerEl = document.getElementById('tg-gaps-container');
      if (gapsContainerEl) {
        this.syncGapsDom(gapsContainerEl, gaps, decimals, s.current_price);
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

      // Live in-place tooltip update if cursor is currently hovering over an element
      this.updateActiveTooltipInPlace(s, decimals);

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

            <!-- Inter-Process Distance Gaps Container -->
            <div id="tg-gaps-container" style="position: absolute; inset: 0; pointer-events: auto;"></div>

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

    const trackEl = document.getElementById('tg-spectrum-track');
    if (trackEl) {
      this.attachTrackEvents(trackEl);
    }

    const gapsContainerEl = document.getElementById('tg-gaps-container');
    if (gapsContainerEl) {
      this.syncGapsDom(gapsContainerEl, gaps, decimals, s.current_price);
    }

    const spansContainerEl = document.getElementById('tg-spans-container');
    if (spansContainerEl) {
      this.syncSpansDom(spansContainerEl, spans, decimals, s.current_price);
    }
  }

  /**
   * Event delegation on the spectrum track to drive floating tooltips without native title flickering
   */
  private attachTrackEvents(trackEl: HTMLElement): void {
    if (trackEl.getAttribute('data-events-attached') === 'true') return;
    trackEl.setAttribute('data-events-attached', 'true');

    trackEl.addEventListener('mousemove', (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      const spanEl = target.closest<HTMLElement>('.tactical-process-span');
      const gapEl = target.closest<HTMLElement>('.tactical-process-gap');
      const flipEl = target.closest<HTMLElement>('.tactical-flip-target-line, .tactical-flip-target-pill');

      if (spanEl) {
        const spanId = spanEl.getAttribute('data-span-id');
        if (spanId) {
          this.currentHoveredSpanId = spanId;
          this.currentHoveredGapId = null;
          this.isHoveringFlipTarget = false;
          const span = this.currentSpans.find((sp) => sp.id === spanId);
          if (span && this.currentStatus) {
            const decimals = getSymbolDecimals(this.currentStatus.symbol);
            const html = this.getSpanTooltipHtml(span, decimals, this.currentStatus.current_price);
            tooltipManager.showHtml(e.clientX, e.clientY, html);
            return;
          }
        }
      } else if (gapEl) {
        const gapId = gapEl.getAttribute('data-gap-id');
        if (gapId) {
          this.currentHoveredGapId = gapId;
          this.currentHoveredSpanId = null;
          this.isHoveringFlipTarget = false;
          const gap = this.currentGaps.find((g) => g.id === gapId);
          if (gap && this.currentStatus) {
            const decimals = getSymbolDecimals(this.currentStatus.symbol);
            const html = this.getGapTooltipHtml(gap, decimals, this.currentStatus.current_price);
            tooltipManager.showHtml(e.clientX, e.clientY, html);
            return;
          }
        }
      } else if (flipEl && this.currentStatus) {
        this.currentHoveredSpanId = null;
        this.currentHoveredGapId = null;
        this.isHoveringFlipTarget = true;
        const decimals = getSymbolDecimals(this.currentStatus.symbol);
        const html = this.getFlipTargetTooltipHtml(this.currentStatus, decimals);
        tooltipManager.showHtml(e.clientX, e.clientY, html);
        return;
      }

      if (this.currentHoveredSpanId || this.currentHoveredGapId || this.isHoveringFlipTarget) {
        this.currentHoveredSpanId = null;
        this.currentHoveredGapId = null;
        this.isHoveringFlipTarget = false;
        tooltipManager.hide();
      }
    });

    trackEl.addEventListener('mouseleave', () => {
      if (this.currentHoveredSpanId || this.currentHoveredGapId || this.isHoveringFlipTarget) {
        this.currentHoveredSpanId = null;
        this.currentHoveredGapId = null;
        this.isHoveringFlipTarget = false;
        tooltipManager.hide();
      }
    });
  }

  /**
   * Smooth in-place tooltip content updater during high-frequency price ticks
   */
  private updateActiveTooltipInPlace(s: StrategyTriggerStatus, decimals: number): void {
    if (this.currentHoveredSpanId) {
      const span = this.currentSpans.find((sp) => sp.id === this.currentHoveredSpanId);
      if (span && tooltipManager.isVisible()) {
        const html = this.getSpanTooltipHtml(span, decimals, s.current_price);
        tooltipManager.updateHtml(html);
      }
    } else if (this.currentHoveredGapId) {
      const gap = this.currentGaps.find((g) => g.id === this.currentHoveredGapId);
      if (gap && tooltipManager.isVisible()) {
        const html = this.getGapTooltipHtml(gap, decimals, s.current_price);
        tooltipManager.updateHtml(html);
      }
    } else if (this.isHoveringFlipTarget && tooltipManager.isVisible()) {
      const html = this.getFlipTargetTooltipHtml(s, decimals);
      tooltipManager.updateHtml(html);
    }
  }

  /**
   * High-performance in-place DOM synchronization for Process Gaps (Distance % between adjacent processes).
   */
  public syncGapsDom(
    container: HTMLElement,
    gaps: TacticalProcessGap[],
    _decimals?: number,
    _marketPrice?: number
  ): void {
    const existingElements = new Map<string, HTMLElement>();

    container.querySelectorAll<HTMLElement>('[data-gap-id]').forEach((el) => {
      const id = el.getAttribute('data-gap-id');
      if (id) existingElements.set(id, el);
    });

    const activeIds = new Set<string>();

    gaps.forEach((gap) => {
      activeIds.add(gap.id);
      const existingEl = existingElements.get(gap.id);
      const isOverlap = gap.isOverlap;
      const formattedPc = `${gap.gapPercent >= 0 ? '+' : ''}${gap.gapPercent.toFixed(2)}%`;
      const badgeText = isOverlap ? `⚡ Solape ${formattedPc}` : `↔ ${Math.abs(gap.gapPercent).toFixed(2)}%`;
      const isCompact = gap.widthPc < 2.8;

      if (existingEl) {
        existingEl.style.left = `${gap.xCenter}%`;
        existingEl.className = `tactical-process-gap ${isOverlap ? 'overlap' : 'spaced'} ${isCompact ? 'compact' : ''}`;
        const pillEl = existingEl.querySelector<HTMLElement>('.tactical-gap-val');
        if (pillEl) {
          pillEl.innerText = badgeText;
        }
      } else {
        const newEl = document.createElement('div');
        newEl.setAttribute('data-gap-id', gap.id);
        newEl.className = `tactical-process-gap ${isOverlap ? 'overlap' : 'spaced'} ${isCompact ? 'compact' : ''}`;
        newEl.style.left = `${gap.xCenter}%`;
        newEl.innerHTML = `
          <div class="tactical-gap-pill ${isOverlap ? 'overlap' : 'spaced'}">
            <span class="tactical-gap-val">${badgeText}</span>
          </div>
        `;
        container.appendChild(newEl);
      }
    });

    existingElements.forEach((el, id) => {
      if (!activeIds.has(id)) {
        el.remove();
      }
    });
  }

  /**
   * High-performance in-place DOM synchronization for Process Spans (Anti-Flickering & No Merging).
   */
  public syncSpansDom(
    container: HTMLElement,
    spans: ProcessRangeSpan[],
    decimals: number,
    _marketPrice: number
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
      const spanTheme = getProcessSpanTheme(span.side, span.status, span.isVirtualExit);

      if (existingEl) {
        existingEl.style.left = `${span.xLeft}%`;
        existingEl.style.width = `${span.widthPc}%`;
        existingEl.style.top = `${topPx}px`;
        if (existingEl.className !== spanTheme.className) {
          existingEl.className = spanTheme.className;
        }
      } else {
        const newEl = document.createElement('div');
        newEl.setAttribute('data-span-id', span.id);
        newEl.className = spanTheme.className;
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

  public getSpanTooltipHtml(span: ProcessRangeSpan, decimals: number, _marketPrice?: number): string {
    const spanTheme = getProcessSpanTheme(span.side, span.status, span.isVirtualExit);
    const sideColor = spanTheme.color;
    const sideBg = spanTheme.isVirtual ? 'rgba(14, 165, 233, 0.2)' : span.side === 'BUY' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)';
    const sideBorder = spanTheme.border;
    const statusLabel = spanTheme.isVirtual ? 'ESPERANDO SALIDA VIRTUAL' : span.status;

    return `
      <div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; line-height: 1.4;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.15); padding-bottom: 4px; margin-bottom: 6px;">
          <span style="font-weight: 800; color: ${sideColor};">PROCESO #${span.processId} (${span.side})</span>
          <span style="background: ${sideBg}; color: ${sideColor}; border: 1px solid ${sideBorder}; padding: 1px 5px; border-radius: 3px; font-size: 9px; font-weight: bold;">${statusLabel}</span>
        </div>
        <table style="width: 100%; border-collapse: collapse; font-size: 10px; color: #cbd5e1;">
          <tr>
            <td style="color: #64748b; padding-right: 6px; width: 65px;">Estado:</td>
            <td style="color: #f1f5f9; font-weight: 600;">${span.status}</td>
          </tr>
          <tr>
            <td style="color: #64748b; padding-right: 6px; width: 65px;">Inicio:</td>
            <td style="color: #38bdf8; font-weight: 600;">$${formatNum(span.startPrice, decimals)}</td>
          </tr>
          <tr>
            <td style="color: #64748b; padding-right: 6px; width: 65px;">Destino (TP):</td>
            <td style="color: ${sideColor}; font-weight: 600;">$${formatNum(span.endPrice, decimals)}</td>
          </tr>
          <tr>
            <td style="color: #64748b; padding-right: 6px; width: 65px;">Cantidad:</td>
            <td style="color: #f1f5f9; font-weight: 600;">${span.amount}</td>
          </tr>
        </table>
      </div>
    `;
  }

  public getFlipTargetTooltipHtml(s: StrategyTriggerStatus, decimals: number): string {
    const reqSign = s.required_metric_pc > 0 ? '+' : '';
    const currSign = s.current_metric_pc > 0 ? '+' : '';
    const isFlip = s.state === 'FLIP_CONMUTATED';
    const targetStr = s.trigger_price !== null ? `$${formatNum(s.trigger_price, decimals)}` : '--';

    return `
      <div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; line-height: 1.4;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.15); padding-bottom: 4px; margin-bottom: 6px;">
          <span style="font-weight: 800; color: #f59e0b;">⚡ FLIP TARGET (Conmutador)</span>
          <span style="background: rgba(245, 158, 11, 0.2); color: #f59e0b; border: 1px solid #f59e0b; padding: 1px 5px; border-radius: 3px; font-size: 9px; font-weight: bold;">${s.conmutator_mode || s.state}</span>
        </div>
        <table style="width: 100%; border-collapse: collapse; font-size: 10px; color: #cbd5e1;">
          <tr>
            <td style="color: #64748b; padding-right: 6px; width: 85px;">Target Price:</td>
            <td style="color: #f59e0b; font-weight: 700;">${targetStr}</td>
          </tr>
          <tr>
            <td style="color: #64748b; padding-right: 6px; width: 85px;">Retroceso Actual:</td>
            <td style="color: #38bdf8; font-weight: 600;">${currSign}${s.current_metric_pc.toFixed(4)}% <span style="color: #94a3b8; font-weight: normal;">(Umbral: ${reqSign}${s.required_metric_pc.toFixed(4)}%)</span></td>
          </tr>
          <tr>
            <td style="color: #64748b; padding-right: 6px; width: 85px;">Distancia al Giro:</td>
            <td style="color: ${isFlip ? '#10b981' : '#38bdf8'}; font-weight: 700;">${isFlip ? '0.0000% (Conmutado)' : `+${s.delta_remaining_pc.toFixed(4)}%`}</td>
          </tr>
          <tr>
            <td style="color: #64748b; padding-right: 6px; width: 85px;">Giro Hacia:</td>
            <td style="color: #10b981; font-weight: 700;">${s.resolved_side}</td>
          </tr>
        </table>
      </div>
    `;
  }

  public getSpanTooltipText(span: ProcessRangeSpan, decimals: number, _marketPrice?: number): string {
    return `Proceso #${span.processId} (${span.side})\nEstado: ${span.status}\nInicio: $${formatNum(span.startPrice, decimals)}\nDestino: $${formatNum(span.endPrice, decimals)}\nCantidad: ${span.amount}`;
  }

  public getGapTooltipHtml(gap: TacticalProcessGap, decimals: number, marketPrice?: number): string {
    const isOverlap = gap.isOverlap;
    const themeColor = isOverlap ? '#f59e0b' : '#38bdf8';
    const themeBg = isOverlap ? 'rgba(245, 158, 11, 0.2)' : 'rgba(56, 189, 248, 0.2)';
    const themeBorder = isOverlap ? '#f59e0b' : '#38bdf8';
    const statusLabel = isOverlap ? 'SOLAPAMIENTO' : 'ESPACIO LIBRE';
    const sign = gap.gapPercent >= 0 ? '+' : '';

    return `
      <div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; line-height: 1.4;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.15); padding-bottom: 4px; margin-bottom: 6px;">
          <span style="font-weight: 800; color: ${themeColor};">DISTANCIA: #${gap.leftProcessId} ➔ #${gap.rightProcessId}</span>
          <span style="background: ${themeBg}; color: ${themeColor}; border: 1px solid ${themeBorder}; padding: 1px 5px; border-radius: 3px; font-size: 9px; font-weight: bold;">${statusLabel}</span>
        </div>
        <table style="width: 100%; border-collapse: collapse; font-size: 10px; color: #cbd5e1;">
          <tr>
            <td style="color: #64748b; padding-right: 6px; width: 110px;">Borde Izquierdo:</td>
            <td style="color: #cbd5e1; font-weight: 600;">$${formatNum(gap.leftEdgePrice, decimals)} <span style="color: #64748b;">(#${gap.leftProcessId})</span></td>
          </tr>
          <tr>
            <td style="color: #64748b; padding-right: 6px; width: 110px;">Borde Derecho:</td>
            <td style="color: #cbd5e1; font-weight: 600;">$${formatNum(gap.rightEdgePrice, decimals)} <span style="color: #64748b;">(#${gap.rightProcessId})</span></td>
          </tr>
          <tr>
            <td style="color: #64748b; padding-right: 6px; width: 110px;">Brecha Precio (ΔP):</td>
            <td style="color: ${themeColor}; font-weight: 700;">${sign}$${formatNum(gap.priceGap, decimals)}</td>
          </tr>
          <tr>
            <td style="color: #64748b; padding-right: 6px; width: 110px;">Proceso Referencia:</td>
            <td style="color: #a78bfa; font-weight: 700;">#${gap.referenceProcessId} <span style="color: #94a3b8; font-weight: normal;">(más cercano al centro)</span></td>
          </tr>
          <tr>
            <td style="color: #64748b; padding-right: 6px; width: 110px;">Base Divisora (Ref):</td>
            <td style="color: #f1f5f9; font-weight: 600;">$${formatNum(gap.referencePrice, decimals)}</td>
          </tr>
          <tr>
            <td style="color: #64748b; padding-right: 6px; width: 110px;">Distancia Porcentual:</td>
            <td style="color: ${themeColor}; font-weight: 800; font-size: 11px;">${sign}${gap.gapPercent.toFixed(4)}%</td>
          </tr>
          ${
            marketPrice && marketPrice > 0
              ? `
          <tr>
            <td style="color: #64748b; padding-right: 6px; width: 110px;">Distancia a Centro:</td>
            <td style="color: #94a3b8; font-size: 9.5px;">#${gap.leftProcessId}: $${formatNum(gap.leftDistToCenter, decimals)} | #${gap.rightProcessId}: $${formatNum(gap.rightDistToCenter, decimals)}</td>
          </tr>`
              : ''
          }
        </table>
      </div>
    `;
  }
}

