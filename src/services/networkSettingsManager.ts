import { addLog } from './logger';

export type NetworkMode = 'MAINNET' | 'TESTNET' | 'CUSTOM';

export interface NetworkConfig {
  mode: NetworkMode;
  host: string;
  port: string;
}

export interface ConnectionTestResult {
  success: boolean;
  latencyMs: number;
  message: string;
  details?: any;
}

const STORAGE_KEY = 'bot_dashboard_network_config';

export class NetworkSettingsManager {
  private currentConfig: NetworkConfig;
  private listeners: Array<(config: NetworkConfig) => void> = [];

  constructor() {
    this.currentConfig = this.loadInitialConfig();
  }

  private loadInitialConfig(): NetworkConfig {
    try {
      // 1. Check URL parameters first (highest precedence for dev/debug)
      if (typeof window !== 'undefined' && window.location) {
        const urlParams = new URLSearchParams(window.location.search);
        const qPort = urlParams.get('port');
        const qHost = urlParams.get('host');
        const qMode = urlParams.get('mode') as NetworkMode | null;

        if (qPort || qHost || qMode) {
          const mode: NetworkMode = qMode || (qPort === '8002' ? 'TESTNET' : qPort === '8000' ? 'MAINNET' : 'CUSTOM');
          return {
            mode,
            host: qHost || '127.0.0.1',
            port: qPort || (mode === 'TESTNET' ? '8002' : '8000'),
          };
        }

        // 2. Check localStorage
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed && typeof parsed.port === 'string' && typeof parsed.host === 'string') {
            return {
              mode: parsed.mode || (parsed.port === '8002' ? 'TESTNET' : parsed.port === '8000' ? 'MAINNET' : 'CUSTOM'),
              host: parsed.host || '127.0.0.1',
              port: parsed.port || '8000',
            };
          }
        }
      }
    } catch (e) {
      console.warn('[NETWORK] Could not read stored network configuration, using default:', e);
    }

    // Default: Mainnet Production (8000)
    return {
      mode: 'MAINNET',
      host: '127.0.0.1',
      port: '8000',
    };
  }

  public getConfig(): Readonly<NetworkConfig> {
    return this.currentConfig;
  }

  public getApiBaseUrl(): string {
    const host = this.currentConfig.host.trim() || '127.0.0.1';
    const port = this.currentConfig.port.trim() || '8000';
    return `http://${host}:${port}`;
  }

  public getWsUrl(path: string = '/ws/notifications'): string {
    const host = this.currentConfig.host.trim() || '127.0.0.1';
    const port = this.currentConfig.port.trim() || '8000';
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `ws://${host}:${port}${cleanPath}`;
  }

  public getEffectivePort(): string {
    return this.currentConfig.port.trim() || '8000';
  }

  public setConfig(newConfig: Partial<NetworkConfig>): void {
    this.currentConfig = {
      ...this.currentConfig,
      ...newConfig,
    };

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.currentConfig));
    } catch (e) {
      console.warn('[NETWORK] Failed to persist network config:', e);
    }

    this.updateHeaderBadge();
    this.notifyListeners();
  }

  public onConfigChanged(listener: (config: NetworkConfig) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.currentConfig);
      } catch (err) {
        console.error('[NETWORK] Error in config listener:', err);
      }
    }
  }

  public async testConnection(host: string, port: string): Promise<ConnectionTestResult> {
    const cleanHost = host.trim() || '127.0.0.1';
    const cleanPort = port.trim() || '8000';
    const targetUrl = `http://${cleanHost}:${cleanPort}/health`;

    const start = performance.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const res = await fetch(targetUrl, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const latencyMs = Math.round(performance.now() - start);

      if (res.ok) {
        let details: any = null;
        try {
          details = await res.json();
        } catch (_) {}

        return {
          success: true,
          latencyMs,
          message: `Conectado exitosamente (${latencyMs}ms)`,
          details,
        };
      } else {
        return {
          success: false,
          latencyMs,
          message: `Error HTTP ${res.status}: ${res.statusText}`,
        };
      }
    } catch (err: any) {
      const latencyMs = Math.round(performance.now() - start);
      const isAbort = err.name === 'AbortError';
      return {
        success: false,
        latencyMs,
        message: isAbort ? 'Tiempo de espera agotado (Timeout 4s)' : `Fallo de conexión: ${err.message || 'Host inalcanzable'}`,
      };
    }
  }

  public updateHeaderBadge(): void {
    const badge = document.getElementById('header-network-badge');
    const textEl = document.getElementById('header-network-text');
    const ledEl = document.getElementById('header-network-led');

    if (!badge || !textEl || !ledEl) return;

    const { mode, port } = this.currentConfig;
    if (mode === 'MAINNET') {
      ledEl.className = 'led led-green';
      badge.style.border = '1px solid rgba(16, 185, 129, 0.4)';
      badge.style.background = 'rgba(16, 185, 129, 0.12)';
      textEl.style.color = '#10b981';
      textEl.innerText = `PROD :${port}`;
    } else if (mode === 'TESTNET') {
      ledEl.className = 'led led-yellow';
      badge.style.border = '1px solid rgba(245, 158, 11, 0.4)';
      badge.style.background = 'rgba(245, 158, 11, 0.12)';
      textEl.style.color = '#f59e0b';
      textEl.innerText = `TESTNET :${port}`;
    } else {
      ledEl.className = 'led led-purple';
      badge.style.border = '1px solid rgba(168, 85, 247, 0.4)';
      badge.style.background = 'rgba(168, 85, 247, 0.12)';
      textEl.style.color = '#c084fc';
      textEl.innerText = `CUSTOM :${port}`;
    }
  }

  public populateModalForm(): void {
    const hostInput = document.getElementById('net-input-host') as HTMLInputElement | null;
    const portInput = document.getElementById('net-input-port') as HTMLInputElement | null;
    const modeSelect = document.getElementById('net-select-mode') as HTMLSelectElement | null;
    const testResultBox = document.getElementById('net-test-result');

    if (hostInput) hostInput.value = this.currentConfig.host;
    if (portInput) portInput.value = this.currentConfig.port;
    if (modeSelect) modeSelect.value = this.currentConfig.mode;
    if (testResultBox) {
      testResultBox.style.display = 'none';
      testResultBox.innerHTML = '';
    }
  }

  public initModalListeners(): void {
    const modalEl = document.getElementById('network-settings-modal');
    const openBtn = document.getElementById('btn-open-network-settings');
    const closeBtn = document.getElementById('btn-close-network-modal');
    const cancelBtn = document.getElementById('btn-cancel-network-modal');
    const saveBtn = document.getElementById('btn-save-network-modal');
    const testBtn = document.getElementById('btn-test-network-conn');

    const hostInput = document.getElementById('net-input-host') as HTMLInputElement | null;
    const portInput = document.getElementById('net-input-port') as HTMLInputElement | null;
    const modeSelect = document.getElementById('net-select-mode') as HTMLSelectElement | null;
    const testResultBox = document.getElementById('net-test-result');

    // Preset buttons
    const btnPresetMainnet = document.getElementById('btn-preset-mainnet');
    const btnPresetTestnet = document.getElementById('btn-preset-testnet');

    this.updateHeaderBadge();

    const openModal = () => {
      this.populateModalForm();
      if (modalEl) modalEl.style.display = 'flex';
    };

    const closeModal = () => {
      if (modalEl) modalEl.style.display = 'none';
    };

    if (openBtn) openBtn.addEventListener('click', openModal);
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

    const badge = document.getElementById('header-network-badge');
    if (badge) badge.addEventListener('click', openModal);

    if (btnPresetMainnet) {
      btnPresetMainnet.addEventListener('click', () => {
        if (modeSelect) modeSelect.value = 'MAINNET';
        if (hostInput) hostInput.value = '127.0.0.1';
        if (portInput) portInput.value = '8000';
      });
    }

    if (btnPresetTestnet) {
      btnPresetTestnet.addEventListener('click', () => {
        if (modeSelect) modeSelect.value = 'TESTNET';
        if (hostInput) hostInput.value = '127.0.0.1';
        if (portInput) portInput.value = '8002';
      });
    }

    if (modeSelect) {
      modeSelect.addEventListener('change', () => {
        if (modeSelect.value === 'MAINNET') {
          if (portInput) portInput.value = '8000';
        } else if (modeSelect.value === 'TESTNET') {
          if (portInput) portInput.value = '8002';
        }
      });
    }

    if (testBtn) {
      testBtn.addEventListener('click', async () => {
        const host = hostInput?.value || '127.0.0.1';
        const port = portInput?.value || '8000';

        if (testResultBox) {
          testResultBox.style.display = 'block';
          testResultBox.className = 'net-result-box checking';
          testResultBox.innerHTML = `<span>⏳</span> Probando conexión a http://${host}:${port}/health...`;
        }

        testBtn.setAttribute('disabled', 'true');

        const result = await this.testConnection(host, port);
        testBtn.removeAttribute('disabled');

        if (testResultBox) {
          testResultBox.style.display = 'block';
          if (result.success) {
            testResultBox.className = 'net-result-box success';
            testResultBox.innerHTML = `
              <div style="display: flex; align-items: center; justify-content: space-between;">
                <span>🟢 <strong>ONLINE</strong> — ${result.message}</span>
                <span style="font-size: 10px; color: #94a3b8;">${result.latencyMs} ms</span>
              </div>
              ${result.details ? `<div style="font-size: 10px; margin-top: 4px; color: #a7f3d0;">Entorno detectado: ${JSON.stringify(result.details)}</div>` : ''}
            `;
          } else {
            testResultBox.className = 'net-result-box error';
            testResultBox.innerHTML = `
              <div style="display: flex; align-items: center; justify-content: space-between;">
                <span>🔴 <strong>OFFLINE</strong> — ${result.message}</span>
                <span style="font-size: 10px; color: #fca5a5;">${result.latencyMs} ms</span>
              </div>
            `;
          }
        }
      });
    }

    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        const host = hostInput?.value.trim() || '127.0.0.1';
        const port = portInput?.value.trim() || '8000';
        const mode = (modeSelect?.value as NetworkMode) || 'MAINNET';

        this.setConfig({
          mode,
          host,
          port,
        });

        addLog(`[NETWORK] Configuración aplicada: Modo ${mode}, Host ${host}:${port}. Reconectando servicios...`, 'success');
        closeModal();
      });
    }
  }
}

export const networkSettingsManager = new NetworkSettingsManager();
