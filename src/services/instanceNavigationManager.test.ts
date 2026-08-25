import { InstanceNavigationManager } from './instanceNavigationManager';
import { BotInstanceData } from '../types';

export function runInstanceNavigationManagerVerification(): boolean {
  const manager = new InstanceNavigationManager();

  const mockInstances: BotInstanceData[] = [
    { id: 1, name: 'Bot 1', symbol: 'BTCUSDT', strategy_type: 'GRID', allocated_capital: 100, used_capital: 0, status: 'ACTIVE', params: {} },
    { id: 2, name: 'Bot 2', symbol: 'ETHUSDT', strategy_type: 'GRID', allocated_capital: 100, used_capital: 0, status: 'PAUSED', params: {} },
    { id: 3, name: 'Bot 3', symbol: 'SOLUSDT', strategy_type: 'GRID', allocated_capital: 100, used_capital: 0, status: 'ACTIVE', params: {} },
  ];

  let selectedId: number | null = 1;
  let switchedId: number | string | null = null;

  manager.setCallbacks({
    getLoadedInstances: () => mockInstances,
    getSelectedInstanceId: () => selectedId,
    onSwitchInstance: (id) => {
      switchedId = id;
      selectedId = Number(id);
    },
  });

  // 1. Next Instance Navigation (Normal / All)
  const next1 = manager.getNextInstance(false);
  if (!next1 || next1.id !== 2) {
    throw new Error(`Expected next instance to be 2, got ${next1?.id}`);
  }

  // 2. Prev Instance Navigation with Circular Wrap (From 1 -> 3)
  const prev1 = manager.getPrevInstance(false);
  if (!prev1 || prev1.id !== 3) {
    throw new Error(`Expected prev instance with wrap to be 3, got ${prev1?.id}`);
  }

  // 3. Filter Active Instances Navigation
  const nextActive = manager.getNextInstance(true);
  if (!nextActive || nextActive.id !== 3) {
    throw new Error(`Expected next ACTIVE instance after 1 to be 3, got ${nextActive?.id}`);
  }

  // 4. Perform navigateNext
  selectedId = 3;
  manager.navigateNext(false);
  if (switchedId !== 1) {
    throw new Error(`Expected switchedId after wrap to be 1, got ${switchedId}`);
  }

  // 5. Test empty instances resilience
  const emptyManager = new InstanceNavigationManager();
  emptyManager.setCallbacks({
    getLoadedInstances: () => [],
    getSelectedInstanceId: () => null,
    onSwitchInstance: () => {},
  });
  if (emptyManager.getNextInstance() !== null || emptyManager.getPrevInstance() !== null) {
    throw new Error('Expected null for empty instances');
  }

  // 6. Test editable element check
  const inputEl = document.createElement('input');
  const divEl = document.createElement('div');
  if (!manager.isEditableElement(inputEl)) {
    throw new Error('Expected inputEl to be identified as editable element');
  }
  if (manager.isEditableElement(divEl)) {
    throw new Error('Expected plain div not to be identified as editable element');
  }

  return true;
}
