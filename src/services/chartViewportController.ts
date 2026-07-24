/**
 * Single Responsibility: Encapsulate chart viewport coordinates (Y-center, Y-range, X time/sample offset)
 * and mouse interactions (2D panning, right-margin Y-zooming, cursor management).
 */

export interface ViewportState {
  yCenter: number | null;
  yRange: number | null;
  sampleOffset: number; // 0 = live tracking, >0 = tick offset back into history
  xOffsetMs: number;    // 0 = live tracking, >0 = ms offset back into history
}

export class ChartViewportController {
  private state: ViewportState = {
    yCenter: null,
    yRange: null,
    sampleOffset: 0,
    xOffsetMs: 0,
  };

  // Mouse drag tracking state
  private isPanning: boolean = false;
  private isYZooming: boolean = false;

  private dragStartX: number = 0;
  private dragStartY: number = 0;
  private dragStartCenter: number = 0;
  private dragStartRange: number = 0;
  private dragStartSampleOffset: number = 0;
  private dragStartOffsetMs: number = 0;

  private renderCallback?: () => void;
  private rightMarginWidth: number = 110;

  constructor(rightMarginWidth: number = 110) {
    this.rightMarginWidth = rightMarginWidth;
  }

  public getState(): ViewportState {
    return this.state;
  }

  public isZooming(): boolean {
    return this.isYZooming;
  }

  public resetViewport(): void {
    this.state.yCenter = null;
    this.state.yRange = null;
    this.state.sampleOffset = 0;
    this.state.xOffsetMs = 0;
    this.requestRender();
  }

  public resetYZoom(): void {
    this.state.yCenter = null;
    this.state.yRange = null;
    this.requestRender();
  }

  public attach(
    canvasEl: HTMLCanvasElement,
    renderCallback: () => void,
    getCurrentPriceLimits?: () => { min: number; max: number },
    getMaxPoints?: () => number
  ): void {
    this.renderCallback = renderCallback;

    const getRightMarginStart = () => canvasEl.width - this.rightMarginWidth;

    // Hover cursor feedback
    canvasEl.addEventListener('mousemove', (e: MouseEvent) => {
      if (this.isPanning || this.isYZooming) return;
      const rect = canvasEl.getBoundingClientRect();
      const cx = e.clientX - rect.left;

      if (cx >= getRightMarginStart()) {
        canvasEl.style.cursor = 'ns-resize';
      } else {
        canvasEl.style.cursor = 'grab';
      }
    });

    // Mouse Down - Start Drag (Panning or Y-Zoom)
    canvasEl.addEventListener('mousedown', (eDown: MouseEvent) => {
      const rect = canvasEl.getBoundingClientRect();
      const cx = eDown.clientX - rect.left;

      this.dragStartX = eDown.clientX;
      this.dragStartY = eDown.clientY;

      if (cx >= getRightMarginStart()) {
        // Right margin Y-Zoom drag
        this.isYZooming = true;
        const limits = getCurrentPriceLimits ? getCurrentPriceLimits() : { min: 0, max: 1 };
        const autoHalf = (limits.max - limits.min) * 0.6 || limits.min * 0.05 || 0.0001;
        const autoCenter = (limits.max + limits.min) / 2;

        this.dragStartRange = this.state.yRange !== null ? this.state.yRange : autoHalf;
        if (this.state.yCenter === null) this.state.yCenter = autoCenter;
        canvasEl.style.cursor = 'ns-resize';
      } else {
        // Main Chart Area 2D Pan Drag
        this.isPanning = true;
        const limits = getCurrentPriceLimits ? getCurrentPriceLimits() : { min: 0, max: 1 };
        const autoHalf = (limits.max - limits.min) * 0.6 || limits.min * 0.05 || 0.0001;
        const autoCenter = (limits.max + limits.min) / 2;

        this.dragStartCenter = this.state.yCenter !== null ? this.state.yCenter : autoCenter;
        this.dragStartRange = this.state.yRange !== null ? this.state.yRange : autoHalf;
        if (this.state.yCenter === null) this.state.yCenter = autoCenter;
        if (this.state.yRange === null) this.state.yRange = autoHalf;
        this.dragStartSampleOffset = this.state.sampleOffset;
        this.dragStartOffsetMs = this.state.xOffsetMs;

        canvasEl.style.cursor = 'grabbing';
      }

      eDown.preventDefault();
    });

    // Window Mouse Move - Perform Drag Motion
    window.addEventListener('mousemove', (eMov: MouseEvent) => {
      if (!this.isPanning && !this.isYZooming) return;

      if (this.isYZooming) {
        const dy = eMov.clientY - this.dragStartY;
        const scaleFactor = 1 + dy * 0.008;
        this.state.yRange = Math.max(this.dragStartRange * 0.0001, this.dragStartRange * scaleFactor);
        this.requestRender();
      } else if (this.isPanning) {
        const dx = eMov.clientX - this.dragStartX;
        const dy = eMov.clientY - this.dragStartY;

        // 1. Vertical Shift (Price Y)
        const chartHeight = canvasEl.height - 50; // approximate drawable height
        const pricePerPx = (this.state.yRange! * 2) / Math.max(1, chartHeight);
        this.state.yCenter = this.dragStartCenter + dy * pricePerPx;

        // 2. Horizontal Shift (Sample/Time X)
        const maxPoints = getMaxPoints ? getMaxPoints() : 150;
        const chartWidth = canvasEl.width - this.rightMarginWidth;

        // Dragging right (dx > 0) pulls past data from the left into view (increases offset)
        // Dragging left (dx < 0) pulls present data from the right into view (decreases offset)
        const timeWindowMs = maxPoints * 1000;
        const msPerPx = timeWindowMs / Math.max(1, chartWidth);
        this.state.xOffsetMs = Math.max(0, this.dragStartOffsetMs + dx * msPerPx);

        const pxPerSample = Math.max(1, chartWidth / maxPoints);
        const sampleDelta = Math.round(dx / pxPerSample);
        this.state.sampleOffset = Math.max(0, this.dragStartSampleOffset + sampleDelta);

        this.requestRender();
      }
    });

    // Window Mouse Up - End Drag Motion
    window.addEventListener('mouseup', () => {
      if (this.isPanning || this.isYZooming) {
        this.isPanning = false;
        this.isYZooming = false;
        if (canvasEl) canvasEl.style.cursor = 'grab';
        this.requestRender();
      }
    });

    // Double Click - Reset Viewport (Auto-fit & Live Sync)
    canvasEl.addEventListener('dblclick', () => {
      this.resetViewport();
    });
  }

  private requestRender(): void {
    if (this.renderCallback) {
      this.renderCallback();
    }
  }
}
