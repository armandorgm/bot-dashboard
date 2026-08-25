import { StrategiesManifest, StrategyManifestItem } from '../types';

export const DEFAULT_STRATEGIES_MANIFEST: StrategiesManifest = {
  description: 'Registry defining modularity rules, component slots, and encapsulation contracts for strategies in StrategyFactory.',
  definitions: {
    modularity_modes: ['SEALED', 'COMPOSABLE'],
  },
  strategies: {
    GRID_POSITION_FLIPPER: {
      class: 'GridPositionFlipperStrategy',
      modularity: 'SEALED',
      allowed_slots: [],
      allowed_types: {},
      description: 'Atomic high-frequency position flipper strategy. Fully self-contained logic without external subcomponent composition.',
    },
    HYBRID_FIBONACCI_BALANCER: {
      class: 'HybridFibonacciBalancerStrategy',
      modularity: 'SEALED',
      allowed_slots: [],
      allowed_types: {},
      description: 'Hybrid Fibonacci balancer strategy. Self-contained sealed module.',
    },
    DYNAMIC_REDUCER: {
      class: 'DynamicReducerStrategy',
      modularity: 'SEALED',
      allowed_slots: [],
      allowed_types: {},
      description: 'Dynamic position reducer strategy. Self-contained sealed module.',
    },
  },
};

export const DEFAULT_SLOT_OPTIONS: Record<string, Array<{ value: string; label: string }>> = {
  side_strategy: [
    { value: 'GRID_POSITION_FLIPPER', label: 'GRID_POSITION_FLIPPER (Flipper Determinist - Default)' },
    { value: 'WEIGHTED_MAJORITY_2IN3', label: 'WEIGHTED_MAJORITY_2IN3 (Mayoría Abierta 2/3)' },
    { value: 'POSITION_CONTRACTS_BIAS', label: 'POSITION_CONTRACTS_BIAS (Sesgo por Contratos)' },
    { value: 'ANCHOR_PARITY', label: 'ANCHOR_PARITY (Precio Ancla + Paridad ID)' },
  ],
  execution_strategy: [
    { value: 'STATIC_LIMIT', label: 'STATIC_LIMIT (Orden Límite Estática GTX - Default)' },
    { value: 'CHASE_V2', label: 'CHASE_V2 (Persecución Reactiva Maker / Post-Only)' },
    { value: 'MARKET_DIRECT', label: 'MARKET_DIRECT (Ejecución Directa Mercado Taker)' },
  ],
  reduce_only_strategy: [
    { value: 'NEVER', label: 'NEVER (Jamás reduceOnly - Default)' },
    { value: 'DYNAMIC_POSITION_REDUCE', label: 'DYNAMIC_POSITION_REDUCE (Dinámico según Posición Previa)' },
    { value: 'ALWAYS', label: 'ALWAYS (Siempre reduceOnly)' },
  ],
};

import { apiClient } from '../utils/apiClient';

export class StrategyManifestService {
  private manifest: StrategiesManifest = DEFAULT_STRATEGIES_MANIFEST;

  public async fetchManifest(_parentPort?: string): Promise<StrategiesManifest> {
    const endpoints = ['/api/strategies/manifest', '/api/grid/strategies/manifest'];

    for (const ep of endpoints) {
      try {
        const res = await apiClient.get<StrategiesManifest>(ep);
        if (res.ok && res.data && res.data.strategies) {
          this.manifest = res.data;
          return this.manifest;
        }
      } catch (_) {
        // Fallback to next
      }
    }
    return this.manifest;
  }

  public getManifest(): StrategiesManifest {
    return this.manifest;
  }

  public getCanonicalStrategyName(stratName: string): string {
    const clean = (stratName || 'GRID_POSITION_FLIPPER').toUpperCase().trim();
    const canonicalMap: Record<string, string> = {
      GRID_POSITION_FLIPPER: 'GRID_POSITION_FLIPPER',
      GRID_FLIPPER: 'GRID_POSITION_FLIPPER',
      POSITION_FLIPPER: 'GRID_POSITION_FLIPPER',
      FLIPPER: 'GRID_POSITION_FLIPPER',
      HYBRID_FIBONACCI_BALANCER: 'HYBRID_FIBONACCI_BALANCER',
      HYBRID_FIBONACCI: 'HYBRID_FIBONACCI_BALANCER',
      FIBONACCI_BALANCER: 'HYBRID_FIBONACCI_BALANCER',
      GRID_STANDARD: 'HYBRID_FIBONACCI_BALANCER',
      GRID: 'HYBRID_FIBONACCI_BALANCER',
      DYNAMIC_REDUCER: 'DYNAMIC_REDUCER',
      DYNAMIC_POSITION_REDUCER: 'DYNAMIC_REDUCER',
      DYNAMIC: 'DYNAMIC_REDUCER',
    };
    return canonicalMap[clean] || clean;
  }

  public getManifestEntry(stratName: string): StrategyManifestItem {
    const key = this.getCanonicalStrategyName(stratName);
    const strats = this.manifest?.strategies || DEFAULT_STRATEGIES_MANIFEST.strategies;
    return (
      strats[key] || {
        modularity: 'SEALED',
        allowed_slots: [],
        allowed_types: {},
        description: 'Atomic strategy. Fully self-contained logic.',
      }
    );
  }

  public sanitizeStrategyParams(params: Record<string, any>, strategyName: string): Record<string, any> {
    const canonical = this.getCanonicalStrategyName(strategyName);
    const entry = this.getManifestEntry(canonical);
    const isSealed = (entry.modularity || 'SEALED').toUpperCase() === 'SEALED';
    const cleaned: Record<string, any> = { ...params };

    const prohibitedKeys = [
      'side_strategy',
      'reduce_only_strategy',
      'execution_strategy',
      'submodules',
      'sub_modules',
      'custom_submodule',
      'side_policy',
      'execution_policy',
      'reduce_only_policy',
    ];

    if (isSealed) {
      for (const key of prohibitedKeys) {
        delete cleaned[key];
      }
    } else if (entry.modularity === 'COMPOSABLE') {
      const allowedSlots = new Set(entry.allowed_slots || []);

      if (!allowedSlots.has('side_strategy')) {
        delete cleaned['side_strategy'];
        delete cleaned['side_policy'];
      }
      if (!allowedSlots.has('reduce_only_strategy')) {
        delete cleaned['reduce_only_strategy'];
        delete cleaned['reduce_only_policy'];
      }
      if (!allowedSlots.has('execution_strategy')) {
        delete cleaned['execution_strategy'];
        delete cleaned['execution_policy'];
      }

      delete cleaned['custom_submodule'];
      delete cleaned['sub_modules'];

      const pruneSubmoduleTree = (obj: any): any => {
        if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
          return obj;
        }
        const result: Record<string, any> = {};
        for (const [key, val] of Object.entries(obj)) {
          if (allowedSlots.has(key)) {
            if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
              const prunedChild = pruneSubmoduleTree(val);
              if (Object.keys(prunedChild).length > 0) {
                result[key] = prunedChild;
              }
            } else if (val !== undefined && val !== null) {
              result[key] = val;
            }
          }
        }
        return result;
      };

      if (cleaned.submodules && typeof cleaned.submodules === 'object') {
        const pruned = pruneSubmoduleTree(cleaned.submodules);
        if (Object.keys(pruned).length > 0) {
          cleaned.submodules = pruned;
        } else {
          delete cleaned.submodules;
        }
      }
    }

    return cleaned;
  }

  public syncStrategySelectorOptions(): void {
    const stratNameEl = document.getElementById('inst-edit-strategy-name') as HTMLSelectElement | null;
    if (!stratNameEl || !this.manifest?.strategies) return;

    const currentVal = (stratNameEl.value || 'GRID_POSITION_FLIPPER').toUpperCase().trim();
    const canonicalVal = this.getCanonicalStrategyName(currentVal);
    const strats = this.manifest.strategies;

    const optionsHtml = Object.keys(strats)
      .map((key) => {
        const item = strats[key];
        const isDefault = key === 'GRID_POSITION_FLIPPER' ? ' (Default)' : '';
        const badgeLabel = (item.modularity || 'SEALED').toUpperCase() === 'SEALED' ? ' [🔒 ATÓMICO]' : ' [🧩 COMPOSABLE]';
        return `<option value="${key}">${key}${badgeLabel}${isDefault}</option>`;
      })
      .join('');

    stratNameEl.innerHTML = optionsHtml;
    if (strats[canonicalVal]) {
      stratNameEl.value = canonicalVal;
    } else if (strats[currentVal]) {
      stratNameEl.value = currentVal;
    } else {
      stratNameEl.value = Object.keys(strats)[0] || 'GRID_POSITION_FLIPPER';
    }
  }

  public applyStrategyModularityUI(stratName: string): void {
    const entry = this.getManifestEntry(stratName);
    const isSealed = (entry.modularity || 'SEALED').toUpperCase() === 'SEALED';

    const engineBadge = document.getElementById('strategy-engine-badge');
    const engineDesc = document.getElementById('strategy-engine-desc');
    const block3Banner = document.getElementById('block3-sealed-banner');

    const sideStratEl = document.getElementById('inst-edit-side-strategy') as HTMLSelectElement | null;
    const sideBadge = document.getElementById('badge-side-strategy-status');
    const sideNote = document.getElementById('note-side-strategy');

    const execStratEl = document.getElementById('inst-edit-execution-strategy') as HTMLSelectElement | null;
    const execBadge = document.getElementById('badge-execution-strategy-status');
    const execNote = document.getElementById('note-execution-strategy');

    const reduceOnlyStratEl = document.getElementById('inst-edit-reduce-only-strategy') as HTMLSelectElement | null;
    const reduceBadge = document.getElementById('badge-reduce-only-strategy-status');
    const reduceNote = document.getElementById('note-reduce-only-strategy');

    if (engineBadge) {
      if (isSealed) {
        engineBadge.className = 'engine-modularity-badge engine-badge-sealed';
        engineBadge.innerHTML = '🔒 MOTOR ATÓMICO SELLADO';
      } else {
        engineBadge.className = 'engine-modularity-badge engine-badge-composable';
        engineBadge.innerHTML = '🧩 MOTOR COMPOSABLE';
      }
    }

    if (engineDesc) {
      engineDesc.textContent =
        entry.description ||
        (isSealed
          ? 'Atomic high-frequency position flipper strategy. Fully self-contained logic without external subcomponent composition.'
          : 'Composable modular strategy permitting decoupled sub-policy slot assembly.');
    }

    if (block3Banner) {
      if (isSealed) {
        block3Banner.style.display = 'flex';
        block3Banner.className = 'sealed-engine-notice-banner';
        block3Banner.style.borderColor = 'rgba(59, 130, 246, 0.25)';
        block3Banner.style.background =
          'linear-gradient(135deg, rgba(30, 41, 59, 0.7) 0%, rgba(15, 23, 42, 0.9) 100%)';
        block3Banner.innerHTML = `
          <span style="font-size: 14px;">🔒</span>
          <span><strong>MOTOR ATÓMICO SELLADO:</strong> Las políticas de lado, reducción y ejecución están encapsuladas dentro del núcleo de la estrategia. Los selectores de submódulos externos permanecen bloqueados y no serán transmitidos a la API.</span>
        `;
      } else {
        block3Banner.style.display = 'flex';
        block3Banner.className = 'sealed-engine-notice-banner';
        block3Banner.style.borderColor = 'rgba(168, 85, 247, 0.4)';
        block3Banner.style.background =
          'linear-gradient(135deg, rgba(30, 27, 75, 0.7) 0%, rgba(15, 23, 42, 0.9) 100%)';
        const allowedStr =
          entry.allowed_slots && entry.allowed_slots.length > 0 ? entry.allowed_slots.join(', ') : 'Ninguno';
        block3Banner.innerHTML = `
          <span style="font-size: 14px;">🧩</span>
          <span><strong>MOTOR COMPOSABLE ACTIVO:</strong> Se habilitan los slots modulares autorizados en el manifest (<span style="color: #c084fc;">${allowedStr}</span>).</span>
        `;
      }
    }

    const allowedSlots = new Set(entry.allowed_slots || []);

    // 1. Side Strategy
    if (sideStratEl) {
      const isAllowed = !isSealed && allowedSlots.has('side_strategy');
      sideStratEl.disabled = !isAllowed;
      if (isAllowed) {
        sideStratEl.classList.remove('subpolicy-muted-input');
        sideStratEl.classList.add('subpolicy-active-input');
        if (sideBadge) {
          sideBadge.className = 'submodule-slot-badge is-active-badge';
          sideBadge.textContent = '🧩 SLOT HABILITADO';
        }
        if (sideNote) sideNote.textContent = '🧩 Selector de lado composable habilitado.';
        if (entry.allowed_types?.side_strategy && Array.isArray(entry.allowed_types.side_strategy)) {
          this.populateSlotOptions('side_strategy', sideStratEl, entry.allowed_types.side_strategy);
        } else {
          this.restoreSlotDefaultOptions('side_strategy', sideStratEl);
        }
      } else {
        sideStratEl.classList.add('subpolicy-muted-input');
        sideStratEl.classList.remove('subpolicy-active-input');
        this.restoreSlotDefaultOptions('side_strategy', sideStratEl);
        if (sideBadge) {
          sideBadge.className = 'submodule-slot-badge is-muted-badge';
          sideBadge.textContent = isSealed ? '🔒 AUTO-RESUELTO' : '🔒 SLOT NO PERMITIDO';
        }
        if (sideNote) {
          sideNote.textContent = isSealed
            ? '🔒 Gestionado internamente por el motor sellado.'
            : '🔒 Slot no habilitado para esta estrategia.';
        }
      }
    }

    // 2. Execution Strategy
    if (execStratEl) {
      const isAllowed = !isSealed && allowedSlots.has('execution_strategy');
      execStratEl.disabled = !isAllowed;
      if (isAllowed) {
        execStratEl.classList.remove('subpolicy-muted-input');
        execStratEl.classList.add('subpolicy-active-input');
        if (execBadge) {
          execBadge.className = 'submodule-slot-badge is-active-badge';
          execBadge.textContent = '🧩 SLOT HABILITADO';
        }
        if (execNote) execNote.textContent = '🧩 Estrategia de ejecución composable habilitada.';
        if (entry.allowed_types?.execution_strategy && Array.isArray(entry.allowed_types.execution_strategy)) {
          this.populateSlotOptions('execution_strategy', execStratEl, entry.allowed_types.execution_strategy);
        } else {
          this.restoreSlotDefaultOptions('execution_strategy', execStratEl);
        }
      } else {
        execStratEl.classList.add('subpolicy-muted-input');
        execStratEl.classList.remove('subpolicy-active-input');
        this.restoreSlotDefaultOptions('execution_strategy', execStratEl);
        if (execBadge) {
          execBadge.className = 'submodule-slot-badge is-muted-badge';
          execBadge.textContent = isSealed ? '🔒 AUTO-INCLUIDO' : '🔒 SLOT NO PERMITIDO';
        }
        if (execNote) {
          execNote.textContent = isSealed
            ? '🔒 Persecución y colocación gobernadas por el motor nuclear.'
            : '🔒 Slot no habilitado para esta estrategia.';
        }
      }
    }

    // 3. Reduce-Only Strategy
    if (reduceOnlyStratEl) {
      const isAllowed = !isSealed && allowedSlots.has('reduce_only_strategy');
      reduceOnlyStratEl.disabled = !isAllowed;
      if (isAllowed) {
        reduceOnlyStratEl.classList.remove('subpolicy-muted-input');
        reduceOnlyStratEl.classList.add('subpolicy-active-input');
        if (reduceBadge) {
          reduceBadge.className = 'submodule-slot-badge is-active-badge';
          reduceBadge.textContent = '🧩 SLOT HABILITADO';
        }
        if (reduceNote) reduceNote.textContent = '🧩 Política reduce-only composable habilitada.';
        if (entry.allowed_types?.reduce_only_strategy && Array.isArray(entry.allowed_types.reduce_only_strategy)) {
          this.populateSlotOptions('reduce_only_strategy', reduceOnlyStratEl, entry.allowed_types.reduce_only_strategy);
        } else {
          this.restoreSlotDefaultOptions('reduce_only_strategy', reduceOnlyStratEl);
        }
      } else {
        reduceOnlyStratEl.classList.add('subpolicy-muted-input');
        reduceOnlyStratEl.classList.remove('subpolicy-active-input');
        this.restoreSlotDefaultOptions('reduce_only_strategy', reduceOnlyStratEl);
        if (reduceBadge) {
          reduceBadge.className = 'submodule-slot-badge is-muted-badge';
          reduceBadge.textContent = isSealed ? '🔒 AUTO-INCLUIDO' : '🔒 SLOT NO PERMITIDO';
        }
        if (reduceNote) {
          reduceNote.textContent = isSealed
            ? '🔒 Reglas de reduce_only calculadas internamente según estado de posición.'
            : '🔒 Slot no habilitado para esta estrategia.';
        }
      }
    }
  }

  private restoreSlotDefaultOptions(slotName: string, selectEl: HTMLSelectElement): void {
    const defaultOpts = DEFAULT_SLOT_OPTIONS[slotName];
    if (!defaultOpts) return;
    const currentVal = selectEl.value;
    selectEl.innerHTML = defaultOpts.map((o) => `<option value="${o.value}">${o.label}</option>`).join('');
    if (defaultOpts.some((o) => o.value === currentVal)) {
      selectEl.value = currentVal;
    } else {
      selectEl.value = defaultOpts[0].value;
    }
  }

  private populateSlotOptions(slotName: string, selectEl: HTMLSelectElement, allowedTypes: string[]): void {
    if (!allowedTypes || allowedTypes.length === 0) {
      this.restoreSlotDefaultOptions(slotName, selectEl);
      return;
    }
    const currentVal = selectEl.value;
    const defaultOpts = DEFAULT_SLOT_OPTIONS[slotName] || [];
    selectEl.innerHTML = allowedTypes
      .map((t) => {
        const match = defaultOpts.find((o) => o.value === t);
        const label = match ? match.label : t;
        return `<option value="${t}">${label}</option>`;
      })
      .join('');

    if (allowedTypes.includes(currentVal)) {
      selectEl.value = currentVal;
    } else if (allowedTypes[0]) {
      selectEl.value = allowedTypes[0];
    }
  }
}

export const strategyManifestService = new StrategyManifestService();
