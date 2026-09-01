/**
 * Single Responsibility: Store session and lifetime PnL metrics provided canonically by the backend.
 * Pure SSOT Store (No synthetic in-browser calculations or heuristics).
 */

export class SessionMetricsTracker {
  private sessionRealizedPnLMap: Map<number, number> = new Map();
  private instanceUnrealizedPnLMap: Map<number, number> = new Map();
  private sessionUnrealizedPnLMap: Map<number, number> = new Map();

  /**
   * Sets the session realized PnL for a specific instance.
   */
  public setRealizedPnL(amount: number, instanceId: number = 1): void {
    this.sessionRealizedPnLMap.set(instanceId, amount);
  }

  /**
   * Gets the session realized PnL for a specific instance.
   */
  public getRealizedPnL(instanceId: number = 1): number {
    return this.sessionRealizedPnLMap.get(instanceId) || 0;
  }

  /**
   * Sets the canonical unrealized PnL (lifetime and session) for a specific instance.
   */
  public setUnrealizedPnL(unrealized: number, sessionUnrealized: number = 0, instanceId: number = 1): void {
    this.instanceUnrealizedPnLMap.set(instanceId, unrealized);
    this.sessionUnrealizedPnLMap.set(instanceId, sessionUnrealized);
  }

  /**
   * Gets the canonical unrealized PnL for a specific instance.
   */
  public getUnrealizedPnL(instanceId: number = 1): number {
    return this.instanceUnrealizedPnLMap.get(instanceId) || 0;
  }

  /**
   * Gets the session-specific unrealized PnL for a specific instance.
   */
  public getSessionUnrealizedPnL(instanceId: number = 1): number {
    return this.sessionUnrealizedPnLMap.get(instanceId) || 0;
  }
}

export const sessionMetrics = new SessionMetricsTracker();

