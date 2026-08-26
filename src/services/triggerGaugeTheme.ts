import { ConmutatorMode, POICategory, StrategyTriggerStatus, TriggerState } from '../types';

export interface MetricColorTheme {
  color: string;
  bg: string;
  border: string;
  ledClass: string;
}

export interface ConmutatorBadgeInfo {
  label: string;
  subLabel: string;
}

export interface PoiVisualConfig {
  color: string;
  bg: string;
  border: string;
  icon: string;
}

/**
 * Determine color theme based on v2.2.0 Conmutator Mode & State
 */
export function getMetricColor(
  currentMetric: number,
  requiredMetric: number,
  state: string,
  conmutatorMode?: string
): MetricColorTheme {
  if (conmutatorMode === 'TREND_BUY') {
    return {
      color: '#10b981', // Emerald Green (Trend Buy)
      bg: 'rgba(16, 185, 129, 0.12)',
      border: 'rgba(16, 185, 129, 0.4)',
      ledClass: 'led-green',
    };
  }
  if (conmutatorMode === 'TREND_SELL') {
    return {
      color: '#ef4444', // Red/Orange (Trend Sell)
      bg: 'rgba(239, 68, 68, 0.12)',
      border: 'rgba(239, 68, 68, 0.4)',
      ledClass: 'led-red',
    };
  }
  if (conmutatorMode === 'FLIP_SELL') {
    return {
      color: '#f59e0b', // Amber / Warning Gold (Flip to Short)
      bg: 'rgba(245, 158, 11, 0.12)',
      border: 'rgba(245, 158, 11, 0.4)',
      ledClass: 'led-yellow',
    };
  }
  if (conmutatorMode === 'FLIP_BUY') {
    return {
      color: '#3b82f6', // Blue / Bright Azure (Flip to Long)
      bg: 'rgba(59, 130, 246, 0.12)',
      border: 'rgba(59, 130, 246, 0.4)',
      ledClass: 'led-blue',
    };
  }
  if (conmutatorMode === 'SEED' || state === 'READY') {
    return {
      color: '#06b6d4', // Cyan (Seed Mode)
      bg: 'rgba(6, 182, 212, 0.12)',
      border: 'rgba(6, 182, 212, 0.4)',
      ledClass: 'led-cyan',
    };
  }

  // Fallback based on metric & state
  if (state === 'FLIP_CONMUTATED' || state === 'PASSED' || currentMetric >= requiredMetric) {
    return {
      color: '#10b981',
      bg: 'rgba(16, 185, 129, 0.12)',
      border: 'rgba(16, 185, 129, 0.4)',
      ledClass: 'led-green',
    };
  }
  if (currentMetric > 0) {
    return {
      color: '#f59e0b',
      bg: 'rgba(245, 158, 11, 0.12)',
      border: 'rgba(245, 158, 11, 0.4)',
      ledClass: 'led-yellow',
    };
  }
  return {
    color: '#ef4444',
    bg: 'rgba(239, 68, 68, 0.12)',
    border: 'rgba(239, 68, 68, 0.4)',
    ledClass: 'led-red',
  };
}

/**
 * Get human readable label and icon for a Conmutator Mode
 */
export function getConmutatorModeBadgeInfo(
  mode?: ConmutatorMode,
  state?: TriggerState
): ConmutatorBadgeInfo {
  switch (mode) {
    case 'TREND_BUY':
      return {
        label: '🟢 TENDENCIA: COMPRANDO (BUY)',
        subLabel: 'Seguimiento de tendencia activa en Long. Recomprando retrocesos del grid.',
      };
    case 'TREND_SELL':
      return {
        label: '🔴 TENDENCIA: VENDIENDO (SELL)',
        subLabel: 'Seguimiento de tendencia activa en Short. Revendiendo retrocesos del grid.',
      };
    case 'FLIP_SELL':
      return {
        label: '⚡ GIRO A SHORT (SELL)',
        subLabel: 'Umbral alcanzado. Conmutador invierte polaridad para girar a SHORT con 2x.',
      };
    case 'FLIP_BUY':
      return {
        label: '⚡ GIRO A LONG (BUY)',
        subLabel: 'Umbral alcanzado. Conmutador invierte polaridad para girar a LONG con 2x.',
      };
    case 'SEED':
      return {
        label: '🌱 INICIAL: MODO SEMILLA',
        subLabel: 'Sin posición activa. Listo para lanzar la primera orden semilla.',
      };
    default:
      if (state === 'FLIP_CONMUTATED') {
        return { label: '⚡ GIRO CONMUTADO', subLabel: 'Umbral de reversión alcanzado.' };
      }
      return { label: '⚪ CONMUTADOR LISTO', subLabel: 'Evaluando condiciones de disparo.' };
  }
}

/**
 * Visual styling and iconography for Tactical POI categories.
 */
export function getPoiVisualConfig(category: POICategory, side?: string): PoiVisualConfig {
  switch (category) {
    case 'FLIP_TRIGGER':
      return {
        color: '#f59e0b',
        bg: 'rgba(245, 158, 11, 0.25)',
        border: '#f59e0b',
        icon: '⚡',
      };
    case 'ENTRY_REF':
      return {
        color: '#38bdf8',
        bg: 'rgba(56, 189, 248, 0.25)',
        border: '#38bdf8',
        icon: '🎯',
      };
    case 'REAL_ORDER':
      if (side === 'BUY') {
        return {
          color: '#10b981',
          bg: 'rgba(16, 185, 129, 0.25)',
          border: '#10b981',
          icon: '🟢',
        };
      }
      return {
        color: '#ef4444',
        bg: 'rgba(239, 68, 68, 0.25)',
        border: '#ef4444',
        icon: '🔴',
      };
    case 'EXECUTED_PENDING':
      return {
        color: '#a855f7',
        bg: 'rgba(168, 85, 247, 0.25)',
        border: '#a855f7',
        icon: '🔄',
      };
    case 'VIRTUAL_ORDER':
    case 'NEW_PROCESS':
    default:
      return {
        color: '#06b6d4',
        bg: 'rgba(6, 182, 212, 0.25)',
        border: '#06b6d4',
        icon: '🔷',
      };
  }
}

/**
 * Helper for rendering compact badge in global matrix table per v2.2.0
 */
export function getCompactStatusBadgeHtml(
  s?: StrategyTriggerStatus,
  sanitized?: StrategyTriggerStatus
): string {
  if (!s && !sanitized) return '<span style="color: #64748b;">--</span>';
  const data = sanitized || s!;
  const theme = getMetricColor(
    data.current_metric_pc,
    data.required_metric_pc,
    data.state,
    data.conmutator_mode
  );

  let modeIcon = '🟢';
  let modeText = 'TREND';
  if (data.conmutator_mode === 'TREND_BUY') {
    modeIcon = '🟢';
    modeText = 'TREND BUY';
  } else if (data.conmutator_mode === 'TREND_SELL') {
    modeIcon = '🔴';
    modeText = 'TREND SELL';
  } else if (data.conmutator_mode === 'FLIP_SELL') {
    modeIcon = '⚡';
    modeText = 'FLIP SELL';
  } else if (data.conmutator_mode === 'FLIP_BUY') {
    modeIcon = '⚡';
    modeText = 'FLIP BUY';
  } else if (data.conmutator_mode === 'SEED' || data.state === 'READY') {
    modeIcon = '🌱';
    modeText = 'SEED';
  }

  const currSign = data.current_metric_pc > 0 ? '+' : '';
  const isFlip = data.state === 'FLIP_CONMUTATED' || data.conmutator_mode?.startsWith('FLIP_');
  const deltaText = isFlip ? 'FLIP' : `-${data.delta_remaining_pc.toFixed(2)}%`;

  return `
    <div style="display: inline-flex; align-items: center; gap: 4px; background: ${theme.bg}; color: ${theme.color}; border: 1px solid ${theme.border}; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-family: monospace; font-weight: bold;" title="Modo: ${data.conmutator_mode} (${data.resolved_side}) | Retroceso: ${currSign}${data.current_metric_pc.toFixed(4)}% | Umbral: ${data.required_metric_pc}%">
      <span>${modeIcon}</span>
      <span>${modeText}</span>
      <span style="opacity: 0.85; font-size: 9.5px;">${currSign}${data.current_metric_pc.toFixed(2)}%</span>
      <span style="opacity: 0.65; font-size: 9px;">(${deltaText})</span>
    </div>
  `;
}
