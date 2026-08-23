import { NetworkSettingsManager, NetworkConfig } from './networkSettingsManager';

export function runNetworkSettingsManagerVerification(): boolean {
  const manager = new NetworkSettingsManager();

  // 1. Initial default configuration test
  const initial = manager.getConfig();
  if (!initial.host || !initial.port || !initial.mode) {
    throw new Error(`Default config incomplete: ${JSON.stringify(initial)}`);
  }

  // 2. Set Testnet mode and verify URLs
  manager.setConfig({
    mode: 'TESTNET',
    host: '127.0.0.1',
    port: '8002',
  });

  if (manager.getEffectivePort() !== '8002') {
    throw new Error(`Expected port 8002, got ${manager.getEffectivePort()}`);
  }

  if (manager.getApiBaseUrl() !== 'http://127.0.0.1:8002') {
    throw new Error(`Expected http://127.0.0.1:8002, got ${manager.getApiBaseUrl()}`);
  }

  if (manager.getWsUrl('/ws/notifications') !== 'ws://127.0.0.1:8002/ws/notifications') {
    throw new Error(`Expected ws://127.0.0.1:8002/ws/notifications, got ${manager.getWsUrl('/ws/notifications')}`);
  }

  // 3. Listener event notification test
  let notifiedConfig: NetworkConfig | null = null;
  const unsubscribe = manager.onConfigChanged((cfg) => {
    notifiedConfig = cfg;
  });

  manager.setConfig({
    mode: 'MAINNET',
    host: '127.0.0.1',
    port: '8000',
  });

  if (!notifiedConfig || (notifiedConfig as NetworkConfig).port !== '8000') {
    throw new Error('Config change listener was not called correctly');
  }

  unsubscribe();

  return true;
}
