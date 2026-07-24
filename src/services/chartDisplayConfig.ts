/**
 * Single Responsibility: Manage chart display configuration, including text/icon
 * scaling factors and Fullscreen API interactions without over-engineering.
 */

export class ChartDisplayConfig {
  private scale: number = 1.0;
  private readonly minScale: number = 0.7;
  private readonly maxScale: number = 2.0;
  private readonly step: number = 0.15;
  private onConfigChangeCallback?: () => void;

  constructor(onConfigChange?: () => void) {
    this.onConfigChangeCallback = onConfigChange;
  }

  public zoomIn(): number {
    this.scale = Math.min(this.maxScale, this.scale + this.step);
    this.notifyChange();
    return this.scale;
  }

  public zoomOut(): number {
    this.scale = Math.max(this.minScale, this.scale - this.step);
    this.notifyChange();
    return this.scale;
  }

  public resetZoom(): number {
    this.scale = 1.0;
    this.notifyChange();
    return this.scale;
  }

  public getScale(): number {
    return this.scale;
  }

  public getFormattedScale(): string {
    return `${Math.round(this.scale * 100)}%`;
  }

  /**
   * Returns a canvas font string with basePx scaled by the current scale factor.
   * e.g., getScaledFont(12) => "12px 'JetBrains Mono', monospace" (if scale is 1.0)
   */
  public getScaledFont(basePx: number, fontSpec: string = "'JetBrains Mono', monospace", bold: boolean = false): string {
    const scaledPx = Math.max(7, Math.round(basePx * this.scale));
    const prefix = bold ? 'bold ' : '';
    return `${prefix}${scaledPx}px ${fontSpec}`;
  }

  /**
   * Scales line widths, dot radii, or padding.
   */
  public getScaledSize(baseSize: number): number {
    return Math.max(1, baseSize * this.scale);
  }

  /**
   * Toggles native browser element Fullscreen mode.
   */
  public toggleFullscreen(containerEl: HTMLElement): boolean {
    if (!document.fullscreenElement) {
      if (containerEl.requestFullscreen) {
        containerEl.requestFullscreen().catch((err) => {
          console.warn('[ChartDisplayConfig] Fullscreen failed:', err);
        });
      }
      containerEl.classList.add('is-fullscreen');
      return true;
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch((err) => {
          console.warn('[ChartDisplayConfig] Exit fullscreen failed:', err);
        });
      }
      containerEl.classList.remove('is-fullscreen');
      return false;
    }
  }

  public isFullscreen(): boolean {
    return !!document.fullscreenElement;
  }

  private notifyChange(): void {
    if (this.onConfigChangeCallback) {
      this.onConfigChangeCallback();
    }
  }
}
