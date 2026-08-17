import { OpenOrdersManager } from './openOrdersManager';
import { OpenOrder } from '../types';

export function runOpenOrdersManagerVerification(): boolean {
  const manager = new OpenOrdersManager();

  // Create mock DOM elements
  const mockTitleEl = document.createElement('h2');
  mockTitleEl.id = 'open-orders-title';
  mockTitleEl.textContent = 'OPEN ORDERS';
  document.body.appendChild(mockTitleEl);

  const mockWrapperEl = document.createElement('div');
  mockWrapperEl.id = 'open-orders-wrapper';
  document.body.appendChild(mockWrapperEl);

  try {
    // 1. Initial init should set OPEN ORDERS(0)
    manager.init('open-orders-wrapper', 'open-orders-title');
    if ((mockTitleEl.textContent as string) !== 'OPEN ORDERS(0)') {
      throw new Error(`Init failed: expected 'OPEN ORDERS(0)', got '${mockTitleEl.textContent}'`);
    }

    // 2. Setting 3 orders should update title to OPEN ORDERS(3)
    const mockOrders: OpenOrder[] = [
      {
        id: '101',
        symbol: '1000PEPEUSDC',
        type: 'LIMIT',
        side: 'BUY',
        price: 0.0025,
        amount: 1000,
        filled: 0,
        remaining: 1000,
        status: 'NEW',
        datetime: '2026-08-17T12:00:00Z',
      },
      {
        id: '102',
        symbol: '1000PEPEUSDC',
        type: 'LIMIT',
        side: 'SELL',
        price: 0.0026,
        amount: 1000,
        filled: 0,
        remaining: 1000,
        status: 'NEW',
        datetime: '2026-08-17T12:01:00Z',
      },
      {
        id: '103',
        symbol: '1000PEPEUSDC',
        type: 'LIMIT',
        side: 'BUY',
        price: 0.0024,
        amount: 1000,
        filled: 0,
        remaining: 1000,
        status: 'NEW',
        datetime: '2026-08-17T12:02:00Z',
      },
    ];

    manager.setOrders(mockOrders);
    if ((mockTitleEl.textContent as string) !== 'OPEN ORDERS(3)') {
      throw new Error(`setOrders failed: expected 'OPEN ORDERS(3)', got '${mockTitleEl.textContent}'`);
    }

    // 3. Render should preserve / update title to OPEN ORDERS(3)
    manager.render('1000PEPEUSDC');
    if ((mockTitleEl.textContent as string) !== 'OPEN ORDERS(3)') {
      throw new Error(`render failed: expected 'OPEN ORDERS(3)', got '${mockTitleEl.textContent}'`);
    }

    // 4. Removing an order should update title to OPEN ORDERS(2)
    manager.removeOrder('102');
    if ((mockTitleEl.textContent as string) !== 'OPEN ORDERS(2)') {
      throw new Error(`removeOrder failed: expected 'OPEN ORDERS(2)', got '${mockTitleEl.textContent}'`);
    }

    // 5. Setting empty array should update title to OPEN ORDERS(0)
    manager.setOrders([]);
    if ((mockTitleEl.textContent as string) !== 'OPEN ORDERS(0)') {
      throw new Error(`Empty setOrders failed: expected 'OPEN ORDERS(0)', got '${mockTitleEl.textContent}'`);
    }

    // 6. Render empty should maintain OPEN ORDERS(0)
    manager.render('1000PEPEUSDC');
    if ((mockTitleEl.textContent as string) !== 'OPEN ORDERS(0)') {
      throw new Error(`Empty render failed: expected 'OPEN ORDERS(0)', got '${mockTitleEl.textContent}'`);
    }

    return true;
  } finally {
    // Cleanup mock DOM
    if (mockTitleEl.parentNode) mockTitleEl.parentNode.removeChild(mockTitleEl);
    if (mockWrapperEl.parentNode) mockWrapperEl.parentNode.removeChild(mockWrapperEl);
  }
}
