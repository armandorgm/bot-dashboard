import { VisualMarker } from '../types';
import { getSymbolDecimals } from '../utils/formatters';
import { orderProcessRegistry } from './orderProcessRegistry';
import { ChasePipelineProcess } from '../types';

/**
 * Single Responsibility: Manage tooltip display and marker interaction over the canvas chart.
 */
export class TooltipManager {
  private tooltipEl: HTMLElement | null = null;
  private mouseX: number | null = null;
  private mouseY: number | null = null;

  public init(tooltipId: string = 'chart-tooltip'): void {
    this.tooltipEl = document.getElementById(tooltipId);
  }

  public setMousePosition(x: number | null, y: number | null): void {
    this.mouseX = x;
    this.mouseY = y;
  }

  public getMousePosition(): { x: number | null; y: number | null } {
    return { x: this.mouseX, y: this.mouseY };
  }

  public isVisible(): boolean {
    return !!this.tooltipEl && this.tooltipEl.style.display !== 'none';
  }

  public hide(): void {
    if (this.tooltipEl) {
      this.tooltipEl.style.display = 'none';
    }
  }

  public showHtml(clientX: number, clientY: number, htmlContent: string): void {
    if (!this.tooltipEl) {
      this.tooltipEl = document.getElementById('chart-tooltip');
      if (!this.tooltipEl) return;
    }

    this.tooltipEl.innerHTML = htmlContent;
    this.tooltipEl.style.display = 'block';

    const tooltipWidth = this.tooltipEl.offsetWidth || 260;
    const tooltipHeight = this.tooltipEl.offsetHeight || 120;

    let leftPos = clientX + 15;
    let topPos = clientY + 15;

    if (clientX + tooltipWidth + 15 > window.innerWidth) {
      leftPos = clientX - tooltipWidth - 15;
    }
    if (clientY + tooltipHeight + 15 > window.innerHeight) {
      topPos = clientY - tooltipHeight - 15;
    }

    if (leftPos < 10) leftPos = 10;
    if (topPos < 10) topPos = 10;

    this.tooltipEl.style.left = `${leftPos}px`;
    this.tooltipEl.style.top = `${topPos}px`;
  }

  public updateHtml(htmlContent: string): void {
    if (!this.tooltipEl || this.tooltipEl.style.display === 'none') return;
    this.tooltipEl.innerHTML = htmlContent;
  }

  public update(
    clientX: number,
    clientY: number,
    hoverMarker: VisualMarker | null,
    symbol: string,
    activeChaseProcesses: ChasePipelineProcess[]
  ): void {
    if (!this.tooltipEl) {
      this.tooltipEl = document.getElementById('chart-tooltip');
      if (!this.tooltipEl) return;
    }

    if (!hoverMarker) {
      this.tooltipEl.style.display = 'none';
      return;
    }

    const isCluster = hoverMarker.events.length > 1;
    let content = `<div style="font-weight: 700; border-bottom: 1px solid rgba(255,255,255,0.15); padding-bottom: 5px; margin-bottom: 6px; color: #60a5fa; font-size: 11px; display: flex; justify-content: space-between; align-items: center;">`;
    content += `<span>${isCluster ? `CLUSTER (${hoverMarker.events.length} Eventos)` : 'DETALLE DEL EVENTO'}</span>`;
    content += `<span style="color: #94a3b8; font-weight: normal; font-size: 10px;">${symbol}</span></div>`;

    content += `<div style="max-height: 240px; overflow-y: auto; padding-right: 2px;">`;

    const decimals = getSymbolDecimals(symbol);

    hoverMarker.events.forEach((evt, idx) => {
      const timeStr =
        new Date(evt.time).toLocaleTimeString('es-ES', { hour12: false }) +
        '.' +
        String(evt.time % 1000).padStart(3, '0');
      const typeUpper = evt.type.toUpperCase();
      const priceStr = evt.price !== undefined ? evt.price.toFixed(decimals) : '--';
      const qtyStr = evt.qty !== undefined ? evt.qty.toString() : '--';

      let typeColor = '#60a5fa';
      if (typeUpper.includes('BUY')) typeColor = '#10b981';
      else if (typeUpper.includes('SELL')) typeColor = '#ef4444';
      else if (typeUpper.includes('CANCEL')) typeColor = '#f59e0b';
      else if (evt.type === 'trigger_rejected') typeColor = '#ef4444';
      else if (evt.type === 'trigger_passed') typeColor = '#10b981';

      let chaseBadgeHtml = '';
      if (evt.orderId) {
        const procInfo = orderProcessRegistry.getProcessInfo(evt.orderId);
        const chaseProc = procInfo
          ? null
          : activeChaseProcesses.find(
              (p) =>
                p.status !== 'COMPLETED' &&
                p.status !== 'ABORTED' &&
                (String(p.entry_order_id) === String(evt.orderId) || String(p.exit_order_id) === String(evt.orderId))
            );

        const procId = procInfo ? procInfo.processId : chaseProc ? chaseProc.id : null;
        const role = procInfo
          ? procInfo.role
          : chaseProc
          ? String(chaseProc.entry_order_id) === String(evt.orderId)
            ? 'E'
            : 'X'
          : null;

        if (procId !== null && role !== null) {
          const roleLbl = role === 'E' ? 'ENTRY [E]' : 'EXIT [X]';
          const roleColor = role === 'E' ? '#06b6d4' : '#10b981';
          chaseBadgeHtml = `<span style="background: ${roleColor}22; color: ${roleColor}; border: 1px solid ${roleColor}66; padding: 1px 5px; border-radius: 3px; font-size: 9px; font-weight: bold;">CHASE #${procId} (${roleLbl})</span>`;
        }
      } else if (evt.type === 'trigger_rejected' || evt.type === 'trigger_passed') {
        const isFlip = evt.type === 'trigger_passed' || evt.triggerData?.state === 'FLIP_CONMUTATED';
        const badgeBg = isFlip ? 'rgba(245, 158, 11, 0.2)' : 'rgba(16, 185, 129, 0.2)';
        const badgeBorder = isFlip ? '#f59e0b' : '#10b981';
        const badgeLbl = isFlip ? '⚡ CONMUTACIÓN A FLIP' : '🟢 TENDENCIA: ACCUMULATION';
        chaseBadgeHtml = `<span style="background: ${badgeBg}; color: ${isFlip ? '#f59e0b' : '#10b981'}; border: 1px solid ${badgeBorder}; padding: 2px 6px; border-radius: 4px; font-size: 9.5px; font-weight: 800;">${badgeLbl}</span>`;
      }

      const borderTop =
        idx > 0
          ? 'border-top: 1px dashed rgba(255,255,255,0.08); margin-top: 6px; padding-top: 6px;'
          : '';

      const isTriggerEvt = evt.type === 'trigger_rejected' || evt.type === 'trigger_passed';
      const trg = evt.triggerData;

      content += `
        <div style="${borderTop} font-size: 11px; line-height: 1.4;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
            <span style="color: ${typeColor}; font-weight: bold;">${isTriggerEvt ? (evt.type === 'trigger_passed' ? '⚡ CONMUTADOR: FLIP' : '🟢 CONMUTADOR: TENDENCIA') : typeUpper}</span>
            <span style="color: #94a3b8; font-size: 10px;">${timeStr}</span>
          </div>
          ${chaseBadgeHtml ? `<div style="margin-bottom: 3px;">${chaseBadgeHtml}</div>` : ''}
          <table style="width: 100%; border-collapse: collapse; font-size: 10px; margin-top: 2px; color: #cbd5e1;">
            ${
              isTriggerEvt && trg
                ? `
                  <tr><td style="color: #64748b; padding-right: 6px;">Modo Actual:</td><td style="color: #60a5fa; font-weight: 700;">${trg.conmutator_mode || trg.state} (${trg.resolved_side || (trg.position_side === 'LONG' ? 'BUY' : 'SELL')})</td></tr>
                  <tr><td style="color: #64748b; padding-right: 6px;">Retroceso:</td><td style="color: ${trg.state === 'FLIP_CONMUTATED' ? '#f59e0b' : '#10b981'}; font-weight: 700;">${trg.current_metric_pc > 0 ? '+' : ''}${trg.current_metric_pc.toFixed(4)}% <span style="color: #94a3b8; font-weight: normal;">(Umbral: +${trg.required_metric_pc.toFixed(4)}%)</span></td></tr>
                  <tr><td style="color: #64748b; padding-right: 6px;">Target Flip:</td><td style="color: #a78bfa; font-weight: 600;">$${trg.trigger_price ? trg.trigger_price.toFixed(decimals) : '--'}</td></tr>
                  ${trg.entry_price > 0 ? `<tr><td style="color: #64748b; padding-right: 6px;">Entry Ref:</td><td style="color: #94a3b8;">$${trg.entry_price.toFixed(decimals)}</td></tr>` : ''}
                  <tr><td style="color: #64748b; padding-right: 6px;">Distancia al Giro:</td><td style="color: ${trg.state === 'FLIP_CONMUTATED' ? '#10b981' : '#38bdf8'}; font-weight: 700;">${trg.state === 'FLIP_CONMUTATED' ? '0.0000% (Conmutado)' : `+${trg.delta_remaining_pc.toFixed(4)}%`}</td></tr>
                `
                : `
                  ${
                    evt.orderId
                      ? `<tr><td style="color: #64748b; padding-right: 6px; width: 60px;">Order ID:</td><td style="font-weight: 600; font-family: monospace; color: #f1f5f9;">${evt.orderId}</td></tr>`
                      : ''
                  }
                  <tr><td style="color: #64748b; padding-right: 6px; width: 60px;">Precio:</td><td style="color: #38bdf8; font-weight: 600;">$${priceStr}</td></tr>
                  <tr><td style="color: #64748b; padding-right: 6px; width: 60px;">Cantidad:</td><td style="color: #f1f5f9;">${qtyStr}</td></tr>
                  ${
                    evt.detail
                      ? `<tr><td style="color: #64748b; padding-right: 6px; vertical-align: top; width: 60px;">Detalle:</td><td style="color: #94a3b8; word-break: break-word;">${evt.detail}</td></tr>`
                      : ''
                  }
                `
            }
          </table>
        </div>
      `;
    });


    content += `</div>`;
    this.tooltipEl.innerHTML = content;
    this.tooltipEl.style.display = 'block';

    const tooltipWidth = this.tooltipEl.offsetWidth || 260;
    const tooltipHeight = this.tooltipEl.offsetHeight || 120;

    let leftPos = clientX + 15;
    let topPos = clientY + 15;

    if (clientX + tooltipWidth + 15 > window.innerWidth) {
      leftPos = clientX - tooltipWidth - 15;
    }
    if (clientY + tooltipHeight + 15 > window.innerHeight) {
      topPos = clientY - tooltipHeight - 15;
    }

    if (leftPos < 10) leftPos = 10;
    if (topPos < 10) topPos = 10;

    this.tooltipEl.style.left = `${leftPos}px`;
    this.tooltipEl.style.top = `${topPos}px`;
  }
}

export const tooltipManager = new TooltipManager();
