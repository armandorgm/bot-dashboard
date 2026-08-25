import { OpenOrder, HftEvent } from '../types';
import { getSymbolDecimals, normalizeSymbol } from '../utils/formatters';
import { apiClient } from '../utils/apiClient';
import { addLog } from './logger';

/**
 * Single Responsibility: Manage open orders retrieval, table rendering, and cancellation requests.
 * Uses ApiClient for centralized communication and Event Delegation for rock-solid button clicks.
 */
export class OpenOrdersManager {
  private openOrders: OpenOrder[] = [];
  private openOrdersWrapperEl: HTMLElement | null = null;
  private openOrdersTitleEl: HTMLElement | null = null;
  private isDelegationInitialized = false;

  public init(wrapperId: string = 'open-orders-wrapper', titleId: string = 'open-orders-title'): void {
    this.openOrdersWrapperEl = document.getElementById(wrapperId);
    this.openOrdersTitleEl = document.getElementById(titleId);
    this.updateTitle();

    if (this.openOrdersWrapperEl && !this.isDelegationInitialized) {
      this.openOrdersWrapperEl.addEventListener('click', async (e) => {
        const target = (e.target as HTMLElement).closest('.btn-cancel-order') as HTMLButtonElement | null;
        if (!target) return;
        const orderId = target.getAttribute('data-id');
        const orderSym = target.getAttribute('data-symbol');
        if (orderId && orderSym) {
          await this.cancelOrder(orderId, orderSym);
        }
      });
      this.isDelegationInitialized = true;
    }
  }

  public updateTitle(): void {
    if (!this.openOrdersTitleEl) {
      this.openOrdersTitleEl =
        document.getElementById('open-orders-title') ||
        document.querySelector('.open-orders-section .section-header h2');
    }
    if (this.openOrdersTitleEl) {
      this.openOrdersTitleEl.textContent = `OPEN ORDERS(${this.openOrders.length})`;
    }
  }

  public getOrders(): OpenOrder[] {
    return this.openOrders;
  }

  public setOrders(orders: OpenOrder[]): void {
    this.openOrders = orders;
    this.updateTitle();
  }

  public removeOrder(orderId: string): void {
    this.openOrders = this.openOrders.filter((o) => String(o.id) !== String(orderId));
    this.updateTitle();
  }

  public async fetchOpenOrders(_parentPort?: string, activeSymbol: string = '1000PEPEUSDC'): Promise<OpenOrder[]> {
    try {
      const res = await apiClient.get<any[]>('/api/orders/open');
      if (res.ok && Array.isArray(res.data)) {
        const normActiveSymbol = normalizeSymbol(activeSymbol);
        this.openOrders = res.data
          .filter((o: any) => {
            const oSym = normalizeSymbol(o.symbol);
            return oSym === normActiveSymbol;
          })
          .map((o: any) => ({
            id: String(o.id),
            symbol: o.symbol,
            type: o.type,
            side: o.side,
            price: Number(o.price || 0),
            amount: Number(o.amount || 0),
            filled: Number(o.filled || 0),
            remaining: Number(o.remaining || 0),
            status: o.status,
            datetime: o.datetime,
          }));
        this.render(activeSymbol);
        return this.openOrders;
      }
    } catch (err: any) {
      addLog(`[OPEN ORDERS] Fallo al sincronizar órdenes abiertas: ${err?.message || err}`, 'warn');
    }
    return this.openOrders;
  }

  public render(activeSymbol: string): void {
    this.updateTitle();

    if (!this.openOrdersWrapperEl) {
      this.openOrdersWrapperEl = document.getElementById('open-orders-wrapper');
      if (!this.openOrdersWrapperEl) return;
    }

    if (this.openOrders.length === 0) {
      this.openOrdersWrapperEl.innerHTML = `
        <div class="open-orders-empty">
          <span>📭</span>
          <span>No open orders on the grid.</span>
        </div>
      `;
      return;
    }

    const decimals = getSymbolDecimals(activeSymbol);

    let html = `
      <table class="open-orders-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>SYMBOL</th>
            <th>SIDE</th>
            <th>PRICE</th>
            <th>AMOUNT</th>
            <th>FILLED</th>
            <th>REMAINING</th>
            <th>TYPE</th>
            <th style="text-align: center;">ACTION</th>
          </tr>
        </thead>
        <tbody>
    `;

    for (const order of this.openOrders) {
      const isBuy = order.side.toUpperCase() === 'BUY';
      const sideClass = isBuy ? 'buy' : 'sell';
      const sideText = order.side.toUpperCase();
      const formattedPrice = Number(order.price).toFixed(decimals);
      const formattedAmount = Number(order.amount).toFixed(2);
      const formattedFilled = Number(order.filled).toFixed(2);
      const formattedRemaining = Number(order.remaining).toFixed(2);

      html += `
        <tr>
          <td style="color: var(--text-secondary);">#${order.id}</td>
          <td style="font-weight: 700;">${order.symbol}</td>
          <td>
            <span class="open-orders-side ${sideClass}">${sideText}</span>
          </td>
          <td style="font-weight: 700;">$${formattedPrice}</td>
          <td style="color: #e5e7eb;">${formattedAmount}</td>
          <td style="color: var(--text-secondary);">${formattedFilled}</td>
          <td style="color: #f3f4f6;">${formattedRemaining}</td>
          <td style="color: var(--text-secondary);">${order.type}</td>
          <td style="text-align: center;">
            <button class="btn-cancel-order" data-id="${order.id}" data-symbol="${order.symbol}">CANCEL</button>
          </td>
        </tr>
      `;
    }

    html += `
        </tbody>
      </table>
    `;

    this.openOrdersWrapperEl.innerHTML = html;
  }

  public async cancelOrder(
    orderId: string,
    symbol: string,
    onCancelFailed?: (evt: HftEvent) => void
  ): Promise<void> {
    const orderObj = this.openOrders.find((o) => String(o.id) === String(orderId));
    try {
      addLog(`Sending cancellation request for order #${orderId}...`, 'info');
      const binanceSymbol = normalizeSymbol(symbol);
      const res = await apiClient.delete(`/fapi/v1/order?symbol=${binanceSymbol}&orderId=${orderId}`);
      if (!res.ok) {
        throw new Error(res.error || 'Error processing cancellation');
      }
      addLog(`Order #${orderId} cancelled successfully on exchange.`, 'success');
      this.removeOrder(orderId);
      this.render(symbol);
    } catch (err: any) {
      addLog(`Error cancelling order #${orderId}: ${err.message}`, 'err');
      if (orderObj && onCancelFailed) {
        const isBuy = orderObj.side.toUpperCase() === 'BUY';
        onCancelFailed({
          e: 'HFT_EVENT',
          type: isBuy ? 'cancel_buy_failed' : 'cancel_sell_failed',
          time: Date.now(),
          price: orderObj.price,
          qty: orderObj.amount,
          symbol: symbol,
          orderId: orderId,
          detail: `Cancellation failed: ${err.message}`,
        });
      }
    }
  }
}

export const openOrdersManager = new OpenOrdersManager();
