/**
 * Single Responsibility: Manage session-only realized PnL and calculate
 * unrealized PnL in-memory for processes belonging exclusively to the current session.
 */

export interface ActiveSessionPosition {
  processId: number;
  instanceId?: number;
  symbol?: string;
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
   * Clears active positions stored in memory (useful during hot-swaps).
   */
  public resetPositions(): void {
    this.activePositions.clear();
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
   * Helper to normalize symbol strings for robust comparison.
   * Converts CCXT '1000PEPE/USDC:USDC' and Binance '1000PEPEUSDC' both to '1000PEPEUSDC'.
   */
  private normalizeSymbol(sym?: string): string {
    if (!sym) return "";
    const base = sym.split(":")[0];
    return base.replace(/\//g, "").toUpperCase();
  }

  /**
   * Calculates the floating (unrealized) PnL for active positions of the current session
   * matching the specified target symbol and/or instance ID.
   */
  public calculateUnrealizedPnL(
    currentBid: number,
    currentAsk: number,
    targetSymbol?: string,
    targetInstanceId?: number
  ): number {
    let totalUnrealized = 0;
    const normTargetSymbol = this.normalizeSymbol(targetSymbol);

    this.activePositions.forEach((pos) => {
      // Filter by instance ID if both are present
      if (
        targetInstanceId !== undefined &&
        targetInstanceId !== null &&
        pos.instanceId !== undefined &&
        pos.instanceId !== null
      ) {
        if (String(pos.instanceId) !== String(targetInstanceId)) {
          return;
        }
      }

      // Filter by normalized symbol if targetSymbol is provided
      if (normTargetSymbol && pos.symbol) {
        const normPosSymbol = this.normalizeSymbol(pos.symbol);
        if (normPosSymbol !== normTargetSymbol) {
          return;
        }
      }

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
