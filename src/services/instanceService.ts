import { BotInstanceData, InstanceTelemetry, StrategyTriggerStatus } from '../types';
import { getInstanceStatusColor } from '../utils/formatters';
import { strategyManifestService } from './strategyManifestService';
import { triggerGaugeManager } from './triggerGaugeManager';
import { instanceNavigationManager } from './instanceNavigationManager';
import { apiClient } from '../utils/apiClient';
import { addLog } from './logger';

export class InstanceService {
  private loadedInstances: BotInstanceData[] = [];
  private selectedInstanceId: number | null = null;
  private isCreatingNewInstance: boolean = false;
  private pendingStashInstanceId: number | null = null;

  public getLoadedInstances(): BotInstanceData[] {
    return this.loadedInstances;
  }

  public getSelectedInstanceId(): number | null {
    return this.selectedInstanceId;
  }

  public setSelectedInstanceId(id: number | null): void {
    this.selectedInstanceId = id;
    instanceNavigationManager.updateNavigationUI();
  }

  public findInstance(id: number | string): BotInstanceData | undefined {
    return this.loadedInstances.find((i) => String(i.id) === String(id));
  }

  public async fetchBotInstancesList(_parentPort?: string): Promise<BotInstanceData[]> {
    try {
      const res = await apiClient.get<BotInstanceData[]>('/api/grid/instances');
      if (!res.ok || !res.data) throw new Error(res.error || `HTTP ${res.status}`);
      this.loadedInstances = res.data;
      return this.loadedInstances;
    } catch (err: any) {
      console.error('Failed to fetch bot instances:', err);
      addLog(`[INSTANCES] Error cargando instancias: ${err.message}`, 'err');
      return [];
    }
  }

  public updateInstanceCapitalDisplay(usedCapital: number, allocatedCapital: number, availableCapital?: number): void {
    const instanceUsedCapValEl = document.getElementById('instance-used-cap-val');
    const instanceAllocCapValEl = document.getElementById('instance-alloc-cap-val');
    const instanceAvailCapValEl = document.getElementById('instance-avail-cap-val');

    const used = Math.max(0, usedCapital || 0);
    const alloc = Math.max(0, allocatedCapital || 0);
    const avail = availableCapital !== undefined ? availableCapital : Math.max(0, alloc - used);

    if (instanceUsedCapValEl) {
      instanceUsedCapValEl.innerText = `$${used.toFixed(2)}`;
      if (alloc > 0 && used / alloc >= 0.8) {
        instanceUsedCapValEl.style.color = '#f59e0b';
      } else if (alloc > 0 && used / alloc >= 0.95) {
        instanceUsedCapValEl.style.color = '#ef4444';
      } else {
        instanceUsedCapValEl.style.color = '#c084fc';
      }
    }

    if (instanceAllocCapValEl) {
      instanceAllocCapValEl.innerText = `$${alloc.toFixed(2)}`;
    }

    if (instanceAvailCapValEl) {
      instanceAvailCapValEl.innerText = `Avail: $${avail.toFixed(2)}`;
    }
  }

  public async fetchInstanceTelemetry(targetId: number | string, _parentPort?: string): Promise<InstanceTelemetry | null> {
    try {
      const res = await apiClient.get<InstanceTelemetry>(`/api/grid/instances/${targetId}/telemetry`);
      if (res.ok && res.data) {
        const telemetry: InstanceTelemetry = res.data;
        this.updateInstanceCapitalDisplay(
          telemetry.used_capital,
          telemetry.allocated_capital,
          telemetry.available_capital
        );
        if (telemetry.trigger_status) {
          triggerGaugeManager.updateFromTelemetry(Number(targetId), telemetry.trigger_status);
        }
        const match = this.loadedInstances.find((i) => String(i.id) === String(targetId));
        const pnlVal = telemetry.lifetime_pnl ?? (telemetry as any).total_pnl ?? telemetry.realized_pnl;
        if (match && pnlVal !== undefined) {
          match.lifetime_pnl = pnlVal;
        }
        return telemetry;
      } else {
        const match = this.loadedInstances.find((i) => String(i.id) === String(targetId));
        if (match) {
          this.updateInstanceCapitalDisplay(match.used_capital || 0, match.allocated_capital || 0);
        }
      }
    } catch (_) {
      const match = this.loadedInstances.find((i) => String(i.id) === String(targetId));
      if (match) {
        this.updateInstanceCapitalDisplay(match.used_capital || 0, match.allocated_capital || 0);
      }
    }
    return null;
  }

  public async fetchInstanceTriggerStatus(
    targetId: number | string,
    _parentPort?: string
  ): Promise<StrategyTriggerStatus | null> {
    try {
      const res = await apiClient.get<StrategyTriggerStatus>(`/api/grid/instances/${targetId}/trigger-status`);
      if (res.ok && res.data) {
        triggerGaugeManager.setStatus(res.data);
        return res.data;
      }
    } catch (_) {}
    return null;
  }

  public renderInstanceForm(inst: BotInstanceData): void {
    const nameEl = document.getElementById('inst-edit-name') as HTMLInputElement;
    const symbolEl = document.getElementById('inst-edit-symbol') as HTMLInputElement;
    const stratEl = document.getElementById('inst-edit-strategy') as HTMLSelectElement;
    const statusEl = document.getElementById('inst-edit-status') as HTMLSelectElement;
    const capEl = document.getElementById('inst-edit-capital') as HTMLInputElement;

    const profitEl = document.getElementById('inst-edit-profit-pc') as HTMLInputElement;
    const threshEl = document.getElementById('inst-edit-threshold-pc') as HTMLInputElement;
    const chaseEl = document.getElementById('inst-edit-chase') as HTMLSelectElement;
    const stratNameEl = document.getElementById('inst-edit-strategy-name') as HTMLSelectElement;
    const sideStratEl = document.getElementById('inst-edit-side-strategy') as HTMLSelectElement;
    const reduceOnlyStratEl = document.getElementById('inst-edit-reduce-only-strategy') as HTMLSelectElement;
    const execStratEl = document.getElementById('inst-edit-execution-strategy') as HTMLSelectElement;
    const entryTtlEl = document.getElementById('inst-edit-entry-ttl') as HTMLInputElement;
    const bypassEl = document.getElementById('inst-edit-bypass-guards') as HTMLInputElement;
    const disableScaleEl = document.getElementById('inst-edit-disable-scaling') as HTMLInputElement;

    const rawJsonEl = document.getElementById('inst-edit-raw-json') as HTMLTextAreaElement;

    if (nameEl) nameEl.value = inst.name || '';
    if (symbolEl) symbolEl.value = inst.symbol || '';
    if (stratEl) stratEl.value = inst.strategy_type || 'GRID';
    if (statusEl) statusEl.value = inst.status || 'ACTIVE';
    if (capEl) capEl.value = (inst.allocated_capital || 0).toString();

    const params = inst.params || {};
    if (profitEl) profitEl.value = ((params.profit_pc ?? 0.005) * 100).toFixed(3);
    if (threshEl) threshEl.value = ((params.threshold_pc ?? 0.01) * 100).toFixed(3);
    if (chaseEl) chaseEl.value = params.chase_behavior || 'flat';

    const rawStratName = params.strategy_name || inst.strategy_type || 'GRID_POSITION_FLIPPER';
    const canonicalStrat = strategyManifestService.getCanonicalStrategyName(rawStratName);
    if (stratNameEl) {
      stratNameEl.value = canonicalStrat;
      if (!stratNameEl.value) {
        stratNameEl.value = stratNameEl.options[0]?.value || 'GRID_POSITION_FLIPPER';
      }
    }
    if (sideStratEl && params.side_strategy) sideStratEl.value = params.side_strategy;
    if (reduceOnlyStratEl && params.reduce_only_strategy) reduceOnlyStratEl.value = params.reduce_only_strategy;
    if (execStratEl && params.execution_strategy) execStratEl.value = params.execution_strategy;
    if (entryTtlEl) entryTtlEl.value = (params.entry_ttl_seconds ?? 10).toString();
    if (bypassEl) bypassEl.checked = !!params.bypass_global_guards;
    if (disableScaleEl) disableScaleEl.checked = !!params.disable_balance_scaling;

    strategyManifestService.applyStrategyModularityUI(stratNameEl?.value || canonicalStrat);

    if (rawJsonEl) rawJsonEl.value = JSON.stringify(params, null, 2);
  }

  public updateInstanceStatusToggleUI(status: string): void {
    const statusLed = document.getElementById('instance-status-led');
    const statusText = document.getElementById('instance-status-text');
    const toggleBadge = document.getElementById('instance-status-toggle');

    if (!statusText || !statusLed || !toggleBadge) return;

    const upperStatus = (status || 'STOPPED').toUpperCase();
    statusText.innerText = upperStatus;

    if (upperStatus === 'ACTIVE') {
      statusLed.className = 'led led-green';
      toggleBadge.style.border = '1px solid #10b981';
      toggleBadge.style.background = 'rgba(16, 185, 129, 0.15)';
      statusText.style.color = '#10b981';
    } else if (upperStatus === 'PAUSED') {
      statusLed.className = 'led led-yellow';
      toggleBadge.style.border = '1px solid #f59e0b';
      toggleBadge.style.background = 'rgba(245, 158, 11, 0.15)';
      statusText.style.color = '#f59e0b';
    } else if (upperStatus === 'STASHED') {
      statusLed.className = 'led led-purple';
      toggleBadge.style.border = '1px solid #a855f7';
      toggleBadge.style.background = 'rgba(168, 85, 247, 0.15)';
      statusText.style.color = '#c084fc';
    } else {
      statusLed.className = 'led led-red';
      toggleBadge.style.border = '1px solid #ef4444';
      toggleBadge.style.background = 'rgba(239, 68, 68, 0.15)';
      statusText.style.color = '#ef4444';
    }

    const currentInstId = this.selectedInstanceId || 1;
    this.renderHeaderStashAction(upperStatus, currentInstId);
  }

  public openStashConfirmModal(instanceId: number, instanceName: string): void {
    this.pendingStashInstanceId = instanceId;
    const modal = document.getElementById('stash-confirm-modal');
    const nameEl = document.getElementById('stash-modal-inst-name');
    if (nameEl) nameEl.innerText = `#${instanceId} - ${instanceName}`;
    if (modal) modal.style.display = 'flex';
  }

  public closeStashConfirmModal(): void {
    this.pendingStashInstanceId = null;
    const modal = document.getElementById('stash-confirm-modal');
    if (modal) modal.style.display = 'none';
  }

  public async executeStash(instanceId: number, _parentPort?: string, onFinished?: () => void): Promise<void> {
    const currentInst = this.loadedInstances.find((i) => i.id === instanceId);
    const previousStatus = currentInst ? currentInst.status : 'ACTIVE';

    // 1. Optimistic UI update
    if (this.selectedInstanceId === instanceId) {
      this.updateInstanceStatusToggleUI('STASHED');
    }
    if (currentInst) currentInst.status = 'STASHED';

    addLog(`[STASH] Congelando Instancia #${instanceId} y aplanando posición a 0...`, 'info');
    try {
      const res = await apiClient.post<any>(`/api/grid/instances/${instanceId}/stash`);
      if (res.ok && res.data && res.data.success) {
        const data = res.data;
        addLog(
          `[STASH ÉXITO] Instancia #${instanceId} congelada. Posición: ${data.position_amount} ${data.position_side} cerrada a 0. Snapshot #${data.snapshot_id}`,
          'info'
        );
        await this.refreshInstanceModalDropdown();
        if (onFinished) onFinished();
      } else {
        // Rollback
        if (currentInst) currentInst.status = previousStatus;
        if (this.selectedInstanceId === instanceId) {
          this.updateInstanceStatusToggleUI(previousStatus);
        }
        addLog(`[STASH ERROR] Fallo al congelar Instancia #${instanceId}: ${res.error || 'Error'}. Estado revertido.`, 'err');
      }
    } catch (err: any) {
      // Rollback
      if (currentInst) currentInst.status = previousStatus;
      if (this.selectedInstanceId === instanceId) {
        this.updateInstanceStatusToggleUI(previousStatus);
      }
      addLog(`[STASH ERROR] Fallo de conexión: ${err.message}. Estado revertido.`, 'err');
    }
  }

  public async executePop(instanceId: number, mode: 'NOW' | 'NO_FEES', _parentPort?: string, onFinished?: () => void): Promise<void> {
    const currentInst = this.loadedInstances.find((i) => i.id === instanceId);
    const previousStatus = currentInst ? currentInst.status : 'STASHED';

    // 1. Optimistic UI update
    if (this.selectedInstanceId === instanceId) {
      this.updateInstanceStatusToggleUI('ACTIVE');
    }
    if (currentInst) currentInst.status = 'ACTIVE';

    addLog(`[POP] Reanudando Instancia #${instanceId} en modo ${mode}...`, 'info');
    try {
      const res = await apiClient.post<any>(`/api/grid/instances/${instanceId}/stash/pop`, { mode });
      if (res.ok && res.data && res.data.success) {
        const data = res.data;
        addLog(
          `[POP ÉXITO] Instancia #${instanceId} reanudada en modo ${mode}. Entrada: #${data.pop_entry_order_id}. Procesos reconstruidos: ${data.reconstructed_processes_count}`,
          'info'
        );
        await this.refreshInstanceModalDropdown();
        if (onFinished) onFinished();
      } else {
        // Rollback
        if (currentInst) currentInst.status = previousStatus;
        if (this.selectedInstanceId === instanceId) {
          this.updateInstanceStatusToggleUI(previousStatus);
        }
        addLog(`[POP ERROR] Fallo al reanudar Instancia #${instanceId}: ${res.error || 'Error'}. Estado revertido.`, 'err');
      }
    } catch (err: any) {
      // Rollback
      if (currentInst) currentInst.status = previousStatus;
      if (this.selectedInstanceId === instanceId) {
        this.updateInstanceStatusToggleUI(previousStatus);
      }
      addLog(`[POP ERROR] Fallo de conexión: ${err.message}. Estado revertido.`, 'err');
    }
  }

  public renderHeaderStashAction(status: string, instanceId: number, _parentPort?: string, onMatrixRefresh?: () => void): void {
    const container = document.getElementById('instance-stash-action-container');
    if (!container) return;

    const upperStatus = (status || '').toUpperCase();
    const currentInst = this.loadedInstances.find((i) => i.id === instanceId);
    const instName = currentInst ? currentInst.name : `Bot #${instanceId}`;

    if (upperStatus === 'STASHED') {
      container.innerHTML = `
        <div class="pop-action-container" id="header-pop-dropdown-wrapper">
          <div class="btn-pop-group">
            <button class="btn-pop-main" id="btn-header-pop-now" title="Reanudar inmediatamente a mercado (Taker)">
              ⚡ Pop NOW
            </button>
            <button class="btn-pop-toggle" id="btn-header-pop-toggle" title="Más opciones de reanudación">
              ▼
            </button>
          </div>
          <div class="pop-dropdown-menu" id="header-pop-menu" style="display: none;">
            <button class="pop-dropdown-item" id="btn-header-pop-opt-now">
              <div class="pop-title">⚡ Inmediato (Taker)</div>
              <div class="pop-desc">Abre posición de entrada al precio de mercado actual.</div>
            </button>
            <button class="pop-dropdown-item" id="btn-header-pop-opt-nofees">
              <div class="pop-title">🎯 Sin Comisiones (Maker)</div>
              <div class="pop-desc">Coloca orden límite en el precio de liquidación del snapshot.</div>
            </button>
          </div>
        </div>
      `;

      const btnPopNow = document.getElementById('btn-header-pop-now');
      const btnToggle = document.getElementById('btn-header-pop-toggle');
      const popMenu = document.getElementById('header-pop-menu');
      const optNow = document.getElementById('btn-header-pop-opt-now');
      const optNoFees = document.getElementById('btn-header-pop-opt-nofees');

      if (btnToggle && popMenu) {
        btnToggle.addEventListener('click', (e) => {
          e.stopPropagation();
          popMenu.style.display = popMenu.style.display === 'none' ? 'flex' : 'none';
        });
        document.addEventListener('click', () => {
          if (popMenu) popMenu.style.display = 'none';
        });
      }

      if (btnPopNow) {
        btnPopNow.addEventListener('click', () => this.executePop(instanceId, 'NOW', undefined, onMatrixRefresh));
      }
      if (optNow) {
        optNow.addEventListener('click', () => {
          if (popMenu) popMenu.style.display = 'none';
          this.executePop(instanceId, 'NOW', undefined, onMatrixRefresh);
        });
      }
      if (optNoFees) {
        optNoFees.addEventListener('click', () => {
          if (popMenu) popMenu.style.display = 'none';
          this.executePop(instanceId, 'NO_FEES', undefined, onMatrixRefresh);
        });
      }
    } else {
      container.innerHTML = `
        <button class="btn-stash-header" id="btn-header-stash" title="Congelar grilla y aplanar posición a 0">
          📦 STASH
        </button>
      `;
      const btnStash = document.getElementById('btn-header-stash');
      if (btnStash) {
        btnStash.addEventListener('click', () => {
          this.openStashConfirmModal(instanceId, instName);
        });
      }
    }
  }

  public async toggleInstanceStatus(_parentPort?: string): Promise<void> {
    const currentInstId = this.selectedInstanceId || 1;
    const currentInst = this.loadedInstances.find((i) => i.id === currentInstId);
    const currentStatus = (currentInst?.status || 'STOPPED').toUpperCase();

    if (currentStatus === 'STASHED') {
      addLog(`[INSTANCE STATUS] La Instancia #${currentInstId} está congelada (STASHED). Use los botones 'Pop' para reanudarla.`, 'warn');
      return;
    }

    const newStatus = currentStatus === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    const headerSelector = document.getElementById('header-instance-selector') as HTMLSelectElement | null;

    // 1. Optimistic visual transition
    if (currentInst) currentInst.status = newStatus;
    this.updateInstanceStatusToggleUI(newStatus);
    if (headerSelector) headerSelector.style.color = getInstanceStatusColor(newStatus);

    try {
      addLog(`[INSTANCE STATUS] Solicitando cambio de estado para Instancia #${currentInstId}: ${currentStatus} -> ${newStatus}...`, 'info');
      const res = await apiClient.post(`/api/grid/instances/${currentInstId}/status`, { status: newStatus });

      if (res.ok) {
        addLog(`[INSTANCE STATUS] Estado cambiado exitosamente a: ${newStatus}`, 'info');
      } else {
        // Rollback on server error
        if (currentInst) currentInst.status = currentStatus;
        this.updateInstanceStatusToggleUI(currentStatus);
        if (headerSelector) headerSelector.style.color = getInstanceStatusColor(currentStatus);
        addLog(`[INSTANCE STATUS ERROR] Error en API al cambiar estado (HTTP ${res.status}). Revertido a ${currentStatus}`, 'err');
      }
    } catch (err: any) {
      // Rollback on network failure
      if (currentInst) currentInst.status = currentStatus;
      this.updateInstanceStatusToggleUI(currentStatus);
      if (headerSelector) headerSelector.style.color = getInstanceStatusColor(currentStatus);
      addLog(`[INSTANCE STATUS ERROR] Fallo de red: ${err.message}. Revertido a ${currentStatus}`, 'err');
    }
  }

  public prepareNewInstanceForm(): void {
    this.isCreatingNewInstance = true;
    this.selectedInstanceId = null;

    const saveBtn = document.getElementById('btn-save-instance-modal');
    const feedbackEl = document.getElementById('instance-status-feedback');
    if (saveBtn) {
      saveBtn.innerHTML = '➕ Crear Instancia';
      (saveBtn as HTMLElement).style.background = '#2563eb';
    }
    if (feedbackEl) feedbackEl.innerText = 'Modo: Nueva Instancia. Complete el formulario y guarde.';

    const defaultNewInstance: BotInstanceData = {
      id: 0,
      name: 'NUEVA INSTANCIA',
      symbol: '1000PEPEUSDC',
      strategy_type: 'GRID',
      allocated_capital: 50.0,
      used_capital: 0.0,
      status: 'PAUSED',
      params: {
        profit_pc: 0.005,
        threshold_pc: 0.01,
        chase_behavior: 'flat',
        strategy_name: 'GRID_POSITION_FLIPPER',
        entry_ttl_seconds: 10,
        bypass_global_guards: false,
        disable_balance_scaling: true,
      },
    };

    this.renderInstanceForm(defaultNewInstance);
  }

  public async saveInstanceConfigHot(_parentPort?: string): Promise<void> {
    const saveBtn = document.getElementById('btn-save-instance-modal');
    const feedbackEl = document.getElementById('instance-status-feedback');

    if (!this.isCreatingNewInstance && !this.selectedInstanceId) return;

    if (feedbackEl) {
      feedbackEl.innerText = this.isCreatingNewInstance ? 'Creando nueva instancia...' : 'Guardando cambios en caliente...';
    }

    const nameEl = document.getElementById('inst-edit-name') as HTMLInputElement;
    const symbolEl = document.getElementById('inst-edit-symbol') as HTMLInputElement;
    const stratEl = document.getElementById('inst-edit-strategy') as HTMLSelectElement;
    const statusEl = document.getElementById('inst-edit-status') as HTMLSelectElement;
    const capEl = document.getElementById('inst-edit-capital') as HTMLInputElement;

    const profitEl = document.getElementById('inst-edit-profit-pc') as HTMLInputElement;
    const threshEl = document.getElementById('inst-edit-threshold-pc') as HTMLInputElement;
    const chaseEl = document.getElementById('inst-edit-chase') as HTMLSelectElement;
    const stratNameEl = document.getElementById('inst-edit-strategy-name') as HTMLSelectElement;
    const sideStratEl = document.getElementById('inst-edit-side-strategy') as HTMLSelectElement;
    const reduceOnlyStratEl = document.getElementById('inst-edit-reduce-only-strategy') as HTMLSelectElement;
    const execStratEl = document.getElementById('inst-edit-execution-strategy') as HTMLSelectElement;
    const entryTtlEl = document.getElementById('inst-edit-entry-ttl') as HTMLInputElement;
    const bypassEl = document.getElementById('inst-edit-bypass-guards') as HTMLInputElement;
    const disableScaleEl = document.getElementById('inst-edit-disable-scaling') as HTMLInputElement;

    const rawJsonEl = document.getElementById('inst-edit-raw-json') as HTMLTextAreaElement;

    let updatedParams: Record<string, any> = {};
    try {
      if (rawJsonEl && rawJsonEl.value.trim()) {
        updatedParams = JSON.parse(rawJsonEl.value);
      }
    } catch (e) {
      if (feedbackEl) feedbackEl.innerText = '❌ Error sintáctico en JSON raw. Corrija la sintaxis.';
      return;
    }

    if (profitEl) updatedParams['profit_pc'] = parseFloat(profitEl.value) / 100.0;
    if (threshEl) updatedParams['threshold_pc'] = parseFloat(threshEl.value) / 100.0;
    if (chaseEl) updatedParams['chase_behavior'] = chaseEl.value;

    const chosenStrategy = (stratNameEl?.value || 'GRID_POSITION_FLIPPER').toUpperCase().trim();
    const canonicalStrat = strategyManifestService.getCanonicalStrategyName(chosenStrategy);
    updatedParams['strategy_name'] = chosenStrategy;

    if (entryTtlEl) updatedParams['entry_ttl_seconds'] = parseInt(entryTtlEl.value, 10) || 10;
    if (bypassEl) updatedParams['bypass_global_guards'] = bypassEl.checked;
    if (disableScaleEl) updatedParams['disable_balance_scaling'] = disableScaleEl.checked;

    const manifestEntry = strategyManifestService.getManifestEntry(canonicalStrat);
    if (manifestEntry.modularity === 'COMPOSABLE') {
      const allowedSlots = new Set(manifestEntry.allowed_slots || []);
      if (allowedSlots.has('side_strategy') && sideStratEl) {
        updatedParams['side_strategy'] = sideStratEl.value;
      }
      if (allowedSlots.has('reduce_only_strategy') && reduceOnlyStratEl) {
        updatedParams['reduce_only_strategy'] = reduceOnlyStratEl.value;
      }
      if (allowedSlots.has('execution_strategy') && execStratEl) {
        updatedParams['execution_strategy'] = execStratEl.value;
      }
    }

    updatedParams = strategyManifestService.sanitizeStrategyParams(updatedParams, chosenStrategy);

    if (rawJsonEl) rawJsonEl.value = JSON.stringify(updatedParams, null, 2);

    const payload = {
      name: nameEl?.value || 'Instance',
      symbol: symbolEl?.value || '1000PEPEUSDC',
      strategy_type: stratEl?.value || 'GRID',
      status: statusEl?.value || 'ACTIVE',
      allocated_capital: parseFloat(capEl?.value || '50'),
      params: updatedParams,
    };

    try {
      const endpoint = this.isCreatingNewInstance
        ? '/api/grid/instances'
        : `/api/grid/instances/${this.selectedInstanceId}`;

      const res = this.isCreatingNewInstance
        ? await apiClient.post<any>(endpoint, payload)
        : await apiClient.put<any>(endpoint, payload);

      if (!res.ok) {
        throw new Error(res.error || (this.isCreatingNewInstance ? 'Error creando instancia' : 'Error actualizando instancia'));
      }

      const resData = res.data;
      const createdOrUpdatedId = resData?.instance?.id || this.selectedInstanceId;

      if (feedbackEl) {
        feedbackEl.innerText = this.isCreatingNewInstance
          ? '✅ Instancia creada exitosamente.'
          : '✅ Configuración actualizada y sincronizada en caliente.';
      }
      addLog(
        `[INSTANCES] Instancia #${createdOrUpdatedId} ${this.isCreatingNewInstance ? 'creada' : 'guardada'} exitosamente. Status: ${payload.status}`,
        'success'
      );

      this.isCreatingNewInstance = false;
      this.selectedInstanceId = createdOrUpdatedId;
      if (saveBtn) {
        saveBtn.innerHTML = '💾 Guardar en Caliente';
        (saveBtn as HTMLElement).style.background = '#10b981';
      }

      setTimeout(() => {
        this.refreshInstanceModalDropdown();
      }, 500);
    } catch (err: any) {
      console.error('Failed to save/create instance config:', err);
      if (feedbackEl) feedbackEl.innerText = `❌ Error: ${err.message}`;
      addLog(`[INSTANCES] Error en la operación de instancia: ${err.message}`, 'err');
    }
  }

  public async refreshInstanceModalDropdown(_parentPort?: string, currentConfigInstId?: string): Promise<void> {
    const selectDropdown = document.getElementById('instance-select-dropdown') as HTMLSelectElement;
    const headerSelector = document.getElementById('header-instance-selector') as HTMLSelectElement;

    if (selectDropdown) selectDropdown.innerHTML = `<option value="">Cargando instancias...</option>`;
    if (headerSelector) headerSelector.innerHTML = `<option value="">Cargando bots...</option>`;

    this.loadedInstances = await this.fetchBotInstancesList();

    if (this.loadedInstances.length === 0) {
      if (selectDropdown) selectDropdown.innerHTML = `<option value="">No hay instancias registradas</option>`;
      if (headerSelector) headerSelector.innerHTML = `<option value="">No hay bots</option>`;
      return;
    }

    const modalOptions = this.loadedInstances
      .map((inst) => {
        const color = getInstanceStatusColor(inst.status);
        return `<option value="${inst.id}" style="color: ${color}; background: #111827;">[ID: ${inst.id}] ${inst.name} (${inst.symbol} - ${inst.strategy_type} - ${inst.status})</option>`;
      })
      .join('');

    const activeIdStr = currentConfigInstId || String(this.selectedInstanceId || '1');
    const headerOptions = this.loadedInstances
      .map((inst) => {
        const isSelected = String(inst.id) === activeIdStr;
        const color = getInstanceStatusColor(inst.status);
        const portStr = inst.params?.port ? `:${inst.params.port}` : '';
        return `<option value="${inst.id}" ${isSelected ? 'selected' : ''} style="color: ${color}; background: #111827;">● #${inst.id} | ${inst.name} [${inst.symbol}${portStr}] (${inst.status})</option>`;
      })
      .join('');

    if (selectDropdown) selectDropdown.innerHTML = modalOptions;
    if (headerSelector) {
      headerSelector.innerHTML = headerOptions;
      const selectedInst =
        this.loadedInstances.find((i) => String(i.id) === activeIdStr) || this.loadedInstances[0];
      if (selectedInst) {
        headerSelector.style.color = getInstanceStatusColor(selectedInst.status);
      }
    }

    const match =
      this.loadedInstances.find((i) => i.id === (this.selectedInstanceId || parseInt(activeIdStr, 10))) ||
      this.loadedInstances[0];

    if (match && !this.isCreatingNewInstance) {
      this.selectedInstanceId = match.id;
      if (selectDropdown) selectDropdown.value = match.id.toString();
      this.renderInstanceForm(match);
      this.updateInstanceStatusToggleUI(match.status);
    }

    instanceNavigationManager.updateNavigationUI();
  }

  public initModalListeners(_parentPort?: string, onSwitchInstance?: (id: string | number) => void): void {
    const modalEl = document.getElementById('instances-modal');
    const openBtn = document.getElementById('btn-open-instance-config');
    const closeBtn = document.getElementById('btn-close-instance-modal');
    const cancelBtn = document.getElementById('btn-cancel-instance-modal');
    const refreshBtn = document.getElementById('btn-refresh-instances');
    const newInstBtn = document.getElementById('btn-new-instance');
    const saveBtn = document.getElementById('btn-save-instance-modal');
    const selectDropdown = document.getElementById('instance-select-dropdown') as HTMLSelectElement;
    const headerSelector = document.getElementById('header-instance-selector') as HTMLSelectElement;
    const stratNameEl = document.getElementById('inst-edit-strategy-name') as HTMLSelectElement | null;

    if (stratNameEl) {
      stratNameEl.addEventListener('change', () => {
        strategyManifestService.applyStrategyModularityUI(stratNameEl.value);
        const rawJsonEl = document.getElementById('inst-edit-raw-json') as HTMLTextAreaElement | null;
        if (rawJsonEl && rawJsonEl.value.trim()) {
          try {
            const parsed = JSON.parse(rawJsonEl.value);
            parsed.strategy_name = stratNameEl.value;
            const sanitized = strategyManifestService.sanitizeStrategyParams(parsed, stratNameEl.value);
            rawJsonEl.value = JSON.stringify(sanitized, null, 2);
          } catch (_) {}
        }
      });
    }

    if (headerSelector) {
      headerSelector.addEventListener('change', () => {
        if (headerSelector.value && onSwitchInstance) {
          onSwitchInstance(headerSelector.value);
        }
      });
    }

    if (openBtn) {
      openBtn.addEventListener('click', async () => {
        this.isCreatingNewInstance = false;
        if (saveBtn) {
          saveBtn.innerHTML = '💾 Guardar en Caliente';
          (saveBtn as HTMLElement).style.background = '#10b981';
        }
        if (modalEl) modalEl.style.display = 'flex';
        await strategyManifestService.fetchManifest();
        strategyManifestService.syncStrategySelectorOptions();
        this.refreshInstanceModalDropdown();
      });
    }

    const closeModal = () => {
      this.isCreatingNewInstance = false;
      if (modalEl) modalEl.style.display = 'none';
    };

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        this.isCreatingNewInstance = false;
        if (saveBtn) {
          saveBtn.innerHTML = '💾 Guardar en Caliente';
          (saveBtn as HTMLElement).style.background = '#10b981';
        }
        await strategyManifestService.fetchManifest();
        strategyManifestService.syncStrategySelectorOptions();
        this.refreshInstanceModalDropdown();
      });
    }

    if (newInstBtn) {
      newInstBtn.addEventListener('click', () => this.prepareNewInstanceForm());
    }

    if (selectDropdown) {
      selectDropdown.addEventListener('change', () => {
        this.isCreatingNewInstance = false;
        if (saveBtn) {
          saveBtn.innerHTML = '💾 Guardar en Caliente';
          (saveBtn as HTMLElement).style.background = '#10b981';
        }
        const selectedIdNum = parseInt(selectDropdown.value, 10);
        const match = this.loadedInstances.find((i) => i.id === selectedIdNum);
        if (match) {
          this.selectedInstanceId = match.id;
          this.renderInstanceForm(match);
        }
      });
    }

    if (saveBtn) {
      saveBtn.addEventListener('click', () => this.saveInstanceConfigHot());
    }

    // Stash confirmation modal bindings
    const cancelStashModalBtn = document.getElementById('btn-cancel-stash-modal');
    const confirmStashModalBtn = document.getElementById('btn-confirm-stash-modal');
    const stashModalOverlay = document.getElementById('stash-confirm-modal');

    if (cancelStashModalBtn) {
      cancelStashModalBtn.addEventListener('click', () => this.closeStashConfirmModal());
    }

    if (stashModalOverlay) {
      stashModalOverlay.addEventListener('click', (e) => {
        if (e.target === stashModalOverlay) this.closeStashConfirmModal();
      });
    }

    if (confirmStashModalBtn) {
      confirmStashModalBtn.addEventListener('click', async () => {
        if (this.pendingStashInstanceId !== null) {
          const idToStash = this.pendingStashInstanceId;
          this.closeStashConfirmModal();
          await this.executeStash(idToStash);
        }
      });
    }
  }
}

export const instanceService = new InstanceService();
