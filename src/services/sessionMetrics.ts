/**
 * Single Responsibility: Manage session-only realized PnL and calculate
 * unrealized PnL in-memory for processes belonging exclusively to the current session.
 */

export interface ActiveSessionPosition {
  processId: number;
  entryPrice: number;
  amount: number;
  side: string; // 'BUY' or 'SELL' (or 'LONG' / 'SHORT')
  createdAt: number;
}

export class SessionMetricsTracker {
  private sessionRealizedPnL: number = 0;
  private activePositions: Map<number, ActiveSessionPosition> = new Map();

  /**
   * Registers or updates an active position created during the current session.
   */
  public registerPosition(position: ActiveSessionPosition): void {
    this.activePositions.set(position.processId, position);
  }

  /**
   * Removes a position when it is completed/closed and returns the position data.
   */
  public closePosition(processId: number): ActiveSessionPosition | undefined {
    const pos = this.activePositions.get(processId);
    if (pos) {
      this.activePositions.delete(processId);
    }
    return pos;
  }

  /**
   * Adds realized profit/loss from a closed trade to the session accumulator.
   */
  public addRealizedPnL(amount: number): void {
    this.sessionRealizedPnL += amount;
  }

  /**
   * Gets the total realized PnL accumulated in memory for this session.
   */
  public getRealizedPnL(): number {
    return this.sessionRealizedPnL;
  }

  /**
   * Calculates the floating (unrealized) PnL for all active positions of the current session
   * based on the latest bid/ask prices.
   */
  public calculateUnrealizedPnL(currentBid: number, currentAsk: number): number {
    let totalUnrealized = 0;

    this.activePositions.forEach((pos) => {
      const isLong = pos.side.toUpperCase() === 'BUY' || pos.side.toUpperCase() === 'LONG';
      // For a LONG position, liquidating price is current BID.
      // For a SHORT position, liquidating price is current ASK.
      const currentPrice = isLong ? currentBid : currentAsk;
      const priceDiff = isLong ? (currentPrice - pos.entryPrice) : (pos.entryPrice - currentPrice);

      totalUnrealized += priceDiff * pos.amount;
    });

    return totalUnrealized;
  }

  /**
   * Returns active positions in memory.
   */
  public getActivePositionsCount(): number {
    return this.activePositions.size;
  }
}
