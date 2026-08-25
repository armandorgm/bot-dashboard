import { invoke } from '@tauri-apps/api/core';
import { apiClient } from '../utils/apiClient';
import { addLog } from './logger';

export interface AddonItem {
  name: string;
  title: string;
  description: string;
  is_running: boolean;
  is_persisted_enabled: boolean;
  auto_start: boolean;
  has_ui: boolean;
  ui_route: string;
  keep_alive_on_close: boolean;
  window_width: number;
  window_height: number;
}

export class AddonUiManager {
  private addons: AddonItem[] = [];
  private isDelegationInitialized = false;

  public async fetchAddons(): Promise<AddonItem[]> {
    try {
      const res = await apiClient.get<AddonItem[]>('/api/addons');
      if (res.ok && Array.isArray(res.data)) {
        this.addons = res.data;
        this.renderAddonsList();
        return this.addons;
      }
      return [];
    } catch (e: any) {
      console.error('Error fetching addons:', e);
      return [];
    }
  }

  public async toggleAddon(name: string, shouldEnable: boolean): Promise<void> {
    const endpoint = shouldEnable ? 'start' : 'stop';
    try {
      addLog(`[ADDON] Solicitando ${shouldEnable ? 'encendido' : 'apagado'} de '${name}'...`, 'info');
      const res = await apiClient.post(`/api/addons/${name}/${endpoint}`, { context: {} });
      if (!res.ok) throw new Error(res.error || `HTTP ${res.status}`);

      addLog(`[ADDON] '${name}' ${shouldEnable ? 'activado' : 'desactivado'} con éxito.`, 'info');

      // If enabled and has UI, open dedicated native Tauri window
      if (shouldEnable) {
        const addon = this.addons.find((a) => a.name === name);
        if (addon && addon.has_ui && addon.ui_route) {
          await this.openAddonWindow(addon);
        }
      } else {
        // If disabled, close window
        await this.closeAddonWindow(name);
      }

      await this.fetchAddons();
    } catch (e: any) {
      addLog(`[ADDON] Error en conmutación de '${name}': ${e.message}`, 'err');
    }
  }

  public async openAddonWindow(addon: AddonItem): Promise<void> {
    try {
      await invoke('open_addon_window', {
        addonId: addon.name,
        title: `${addon.title} (Addon)`,
        route: addon.ui_route,
        width: addon.window_width || 520.0,
        height: addon.window_height || 680.0,
      });
    } catch (e: any) {
      console.warn(`[ADDON] No se pudo invocar Tauri window (¿Modo navegador?): ${e}`);
    }
  }

  public async closeAddonWindow(name: string): Promise<void> {
    try {
      await invoke('close_addon_window', { addonId: name });
    } catch (e: any) {
      console.warn(`[ADDON] Error cerrando ventana Tauri: ${e}`);
    }
  }

  public renderAddonsList(): void {
    const container = document.getElementById('addons-list-container');
    if (!container) return;

    if (!this.isDelegationInitialized) {
      container.addEventListener('click', (e) => {
        const toggleBtn = (e.target as HTMLElement).closest('.btn-addon-toggle') as HTMLElement | null;
        if (toggleBtn) {
          const name = toggleBtn.getAttribute('data-addon-name');
          const action = toggleBtn.getAttribute('data-action');
          if (name) {
            this.toggleAddon(name, action === 'start');
          }
          return;
        }

        const windowBtn = (e.target as HTMLElement).closest('.btn-addon-window') as HTMLElement | null;
        if (windowBtn) {
          const name = windowBtn.getAttribute('data-addon-name');
          const addon = this.addons.find((a) => a.name === name);
          if (addon) {
            this.openAddonWindow(addon);
          }
        }
      });
      this.isDelegationInitialized = true;
    }

    if (this.addons.length === 0) {
      container.innerHTML = `<div style="color: #6b7280; font-size: 11px; padding: 8px;">No hay addons registrados.</div>`;
      return;
    }

    container.innerHTML = this.addons
      .map((addon) => {
        const isRunning = addon.is_running;
        return `
          <div style="background: #161b22; border: 1px solid ${isRunning ? '#10b981' : '#30363d'}; border-radius: 8px; padding: 10px 14px; display: flex; align-items: center; justify-content: space-between; gap: 10px;">
            <div style="display: flex; flex-direction: column; gap: 2px;">
              <div style="display: flex; align-items: center; gap: 6px;">
                <span class="led ${isRunning ? 'led-green' : 'led-red'}"></span>
                <span style="font-weight: bold; color: #f3f4f6; font-size: 12px;">${addon.title || addon.name}</span>
                <span style="font-size: 9px; padding: 1px 5px; border-radius: 4px; background: rgba(255,255,255,0.06); color: #9ca3af;">${addon.name}</span>
              </div>
              <span style="font-size: 11px; color: #8b949e;">${addon.description}</span>
            </div>
            
            <div style="display: flex; align-items: center; gap: 8px;">
              ${
                addon.has_ui
                  ? `<button class="btn-addon-window" data-addon-name="${addon.name}" style="background: #1f2937; color: #60a5fa; border: 1px solid #3b82f6; border-radius: 4px; padding: 4px 8px; font-size: 11px; font-weight: bold; cursor: pointer;" title="Abrir ventana dedicada">🪟 Ventana</button>`
                  : ''
              }
              <button class="btn-addon-toggle" data-addon-name="${addon.name}" data-action="${isRunning ? 'stop' : 'start'}" style="background: ${isRunning ? '#ef4444' : '#10b981'}; color: #000000; border: none; border-radius: 4px; padding: 4px 12px; font-size: 11px; font-weight: bold; cursor: pointer;">
                ${isRunning ? 'APAGAR' : 'ENCENDER'}
              </button>
            </div>
          </div>
        `;
      })
      .join('');
  }
}

export const addonUiManager = new AddonUiManager();
