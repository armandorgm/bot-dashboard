import { addLog } from './logger';

/**
 * Single Responsibility: Manage data source flags and their UI control bindings.
 */

export interface DataSourceFlags {
  ticker: boolean;
  orders: boolean;
  queries: boolean;
  stats: boolean;
  mods: boolean;
  chart: boolean;
}

export type DataSourceKey = keyof DataSourceFlags;

export class DataSourceManager {
  private flags: DataSourceFlags = {
    ticker: true,
    orders: true,
    queries: true,
    stats: true,
    mods: true,
    chart: true,
  };

  public isEnabled(key: DataSourceKey): boolean {
    return this.flags[key];
  }

  public getFlags(): Readonly<DataSourceFlags> {
    return this.flags;
  }

  public setDataSource(key: DataSourceKey, enabled: boolean): void {
    this.flags[key] = enabled;
    const card = document.getElementById(`ds-card-${key}`);
    const dot = document.getElementById(`ds-dot-${key}`);
    const sw = document.getElementById(`ds-switch-${key}`) as HTMLInputElement | null;

    if (card) {
      card.classList.toggle('ds-active', enabled);
      card.classList.toggle('ds-inactive', !enabled);
    }
    if (dot) {
      dot.classList.toggle('active', enabled);
      dot.classList.toggle('paused', !enabled);
    }
    if (sw && sw.checked !== enabled) {
      sw.checked = enabled;
    }
  }

  public setAll(enabled: boolean): void {
    const keys: DataSourceKey[] = ['ticker', 'orders', 'queries', 'stats', 'mods', 'chart'];
    for (const key of keys) {
      this.setDataSource(key, enabled);
    }
  }

  public initControls(): void {
    const ALL_KEYS: DataSourceKey[] = ['ticker', 'orders', 'queries', 'stats', 'mods', 'chart'];

    for (const key of ALL_KEYS) {
      const card = document.getElementById(`ds-card-${key}`);
      if (card) card.classList.add('ds-active');
    }

    for (const key of ALL_KEYS) {
      const sw = document.getElementById(`ds-switch-${key}`) as HTMLInputElement | null;
      if (!sw) continue;
      sw.addEventListener('change', () => {
        this.setDataSource(key, sw.checked);
      });
    }

    const enableAllBtn = document.getElementById('ds-enable-all-btn');
    if (enableAllBtn) {
      enableAllBtn.addEventListener('click', () => {
        this.setAll(true);
        addLog('[DATA FEED] Todas las fuentes activadas.', 'success');
      });
    }

    const disableAllBtn = document.getElementById('ds-disable-all-btn');
    if (disableAllBtn) {
      disableAllBtn.addEventListener('click', () => {
        this.setAll(false);
        addLog('[DATA FEED] Todas las fuentes desactivadas.', 'warn');
      });
    }
  }
}

export const dataSourceManager = new DataSourceManager();
export const dataSourceFlags = dataSourceManager;
