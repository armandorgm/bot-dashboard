/**
 * Single Responsibility: Maintain a lifetime, in-memory registry mapping Binance/Rust orderIds
 * to their originating Chase Process ID (#proc.id) and role ('E' for Entry, 'X' for Exit).
 */

export interface ProcessOrderInfo {
  processId: number;
  role: 'E' | 'X';
  symbol?: string;
  status?: string;
}

export class OrderProcessRegistry {
  private registry: Map<string, ProcessOrderInfo> = new Map();

  /**
   * Registers a single orderId to its originating Process ID and Role permanently.
   */
  public registerOrder(orderId: string | undefined, processId: number, role: 'E' | 'X', symbol?: string, status?: string): void {
    if (!orderId) return;
    const key = String(orderId);
    const existing = this.registry.get(key);
    if (!existing || (status && existing.status !== status)) {
      this.registry.set(key, {
        processId,
        role,
        symbol,
        status,
      });
    }
  }

  /**
   * Registers both entry_order_id and exit_order_id from a ChasePipelineProcess permanently.
   */
  public registerProcess(proc: { id: number; symbol: string; entry_order_id?: string; exit_order_id?: string; status?: string }): void {
    if (proc.entry_order_id) {
      this.registerOrder(proc.entry_order_id, proc.id, 'E', proc.symbol, proc.status);
    }
    if (proc.exit_order_id) {
      this.registerOrder(proc.exit_order_id, proc.id, 'X', proc.symbol, proc.status);
    }
  }

  /**
   * Returns lifetime process information for a given orderId, even if the process has completed.
   */
  public getProcessInfo(orderId: string | undefined): ProcessOrderInfo | null {
    if (!orderId) return null;
    return this.registry.get(String(orderId)) || null;
  }
}

export const orderProcessRegistry = new OrderProcessRegistry();
