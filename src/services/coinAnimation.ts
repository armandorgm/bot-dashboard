/**
 * Single Responsibility: Manage coin animations on the Canvas chart when a closing trade completes.
 * Handles exact 10-second lifecycle, floating motion, particle sparks, and rendering badges.
 */

export interface ClosedTradeAnimation {
  id: string; // processId or UUID
  processId: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  pnlPercentage: number;
  startTime: number;
  durationMs: number; // 10000 ms (10s)
  x: number; // Anchor canvas X coordinate
  y: number; // Anchor canvas Y coordinate
}

export class CoinAnimationManager {
  private activeAnimations: ClosedTradeAnimation[] = [];
  private readonly defaultDurationMs = 10000; // 10 seconds

  /**
   * Spawns a new coin animation for a completed process.
   */
  public triggerCoinAnimation(
    processId: number,
    entryPrice: number,
    exitPrice: number,
    amount: number,
    side: string,
    x: number,
    y: number
  ): void {
    const isLong = side.toUpperCase() === 'BUY' || side.toUpperCase() === 'LONG';
    const priceDiff = isLong ? (exitPrice - entryPrice) : (entryPrice - exitPrice);
    const pnl = priceDiff * amount;
    const pnlPercentage = entryPrice > 0 ? (priceDiff / entryPrice) * 100 : 0;

    const anim: ClosedTradeAnimation = {
      id: `${processId}_${Date.now()}`,
      processId,
      entryPrice,
      exitPrice,
      pnl,
      pnlPercentage,
      startTime: Date.now(),
      durationMs: this.defaultDurationMs,
      x,
      y
    };

    this.activeAnimations.push(anim);
  }

  /**
   * Updates state and removes expired animations (older than 10 seconds).
   */
  public update(now: number = Date.now()): void {
    this.activeAnimations = this.activeAnimations.filter(
      (anim) => now - anim.startTime < anim.durationMs
    );
  }

  /**
   * Renders active 10-second coin animations onto the HTML5 Canvas context.
   */
  public render(ctx: CanvasRenderingContext2D, decimals: number, now: number = Date.now()): void {
    this.update(now);

    for (const anim of this.activeAnimations) {
      const elapsed = now - anim.startTime;
      const progress = Math.min(1, elapsed / anim.durationMs);

      // Phase 1 (0s - 2s): Rise & Expand scale
      // Phase 2 (2s - 8s): Smooth vertical oscillation
      // Phase 3 (8s - 10s): Fade out & upward drift
      let opacity = 1.0;
      if (progress > 0.8) {
        opacity = 1.0 - (progress - 0.8) / 0.2; // Fade out in last 2 seconds
      }

      // Vertical float offset
      const floatY = anim.y - (progress * 35) + Math.sin(elapsed * 0.005) * 4;

      ctx.save();
      ctx.globalAlpha = Math.max(0, opacity);

      // ── 1. Draw Golden Coin Icon ──────────────────────────────────────────
      const coinRadius = 14;
      const coinX = anim.x;
      const coinY = floatY;

      // Glow halo
      ctx.beginPath();
      ctx.arc(coinX, coinY, coinRadius + 5, 0, Math.PI * 2);
      ctx.fillStyle = anim.pnl >= 0 ? 'rgba(234, 179, 8, 0.35)' : 'rgba(239, 68, 68, 0.35)';
      ctx.fill();

      // Outer Metallic Ring
      ctx.beginPath();
      ctx.arc(coinX, coinY, coinRadius, 0, Math.PI * 2);
      const coinGrad = ctx.createLinearGradient(coinX - coinRadius, coinY - coinRadius, coinX + coinRadius, coinY + coinRadius);
      if (anim.pnl >= 0) {
        coinGrad.addColorStop(0, '#fef08a');
        coinGrad.addColorStop(0.5, '#eab308');
        coinGrad.addColorStop(1, '#854d0e');
      } else {
        coinGrad.addColorStop(0, '#fca5a5');
        coinGrad.addColorStop(0.5, '#ef4444');
        coinGrad.addColorStop(1, '#991b1b');
      }
      ctx.fillStyle = coinGrad;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Inner Coin Symbol ($ / 🪙)
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('$', coinX, coinY + 1);

      // ── 2. Floating Info Badge (Entry, Exit & Process PnL) ───────────────
      const badgeY = coinY - 24;
      const isWin = anim.pnl >= 0;
      const pnlSign = isWin ? '+' : '';
      const pnlText = `${pnlSign}$${anim.pnl.toFixed(decimals)} (${pnlSign}${anim.pnlPercentage.toFixed(2)}%)`;
      const detailText = `E: $${anim.entryPrice.toFixed(decimals)} ➔ X: $${anim.exitPrice.toFixed(decimals)}`;
      const titleText = `CLOSED PROC #${anim.processId}`;

      ctx.font = 'bold 9px "JetBrains Mono", monospace';
      const w1 = ctx.measureText(titleText).width;
      const w2 = ctx.measureText(pnlText).width;
      const w3 = ctx.measureText(detailText).width;
      const badgeWidth = Math.max(w1, w2, w3) + 16;
      const badgeHeight = 40;

      // Badge Container Box
      ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
      ctx.strokeStyle = isWin ? '#10b981' : '#ef4444';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.roundRect(coinX - badgeWidth / 2, badgeY - badgeHeight, badgeWidth, badgeHeight, 6);
      ctx.fill();
      ctx.stroke();

      // Badge Content Lines
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Line 1: Title & Process ID
      ctx.fillStyle = '#94a3b8';
      ctx.font = '8px "JetBrains Mono", monospace';
      ctx.fillText(titleText, coinX, badgeY - badgeHeight + 8);

      // Line 2: PnL Result
      ctx.fillStyle = isWin ? '#10b981' : '#ef4444';
      ctx.font = 'bold 10px "JetBrains Mono", monospace';
      ctx.fillText(pnlText, coinX, badgeY - badgeHeight + 20);

      // Line 3: Entry & Exit Prices
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '8px "JetBrains Mono", monospace';
      ctx.fillText(detailText, coinX, badgeY - badgeHeight + 32);

      ctx.restore();
    }
  }

  public getActiveCount(): number {
    return this.activeAnimations.length;
  }
}
