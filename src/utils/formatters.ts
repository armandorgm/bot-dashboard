/**
 * Formatting and normalization utilities.
 */

export function formatNum(num: number | null | undefined, decimals: number = 6): string {
  if (num === null || num === undefined || isNaN(num)) return '--';
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function getSymbolDecimals(symbol?: string): number {
  return (symbol || '').toLowerCase().includes('pepe') ? 8 : 4;
}

export function normalizeSymbol(symbol?: string): string {
  if (!symbol) return '';
  return symbol.split(':')[0].replace('/', '').replace(':', '').toUpperCase();
}

export function cleanPublicWsSymbol(symbol?: string): string {
  if (!symbol) return '';
  const baseSymbol = symbol.split(':')[0];
  return baseSymbol.replace('/', '').toLowerCase();
}

export function getInstanceStatusColor(status?: string): string {
  switch ((status || '').toUpperCase()) {
    case 'ACTIVE':
    case 'RUNNING':
      return '#10b981'; // Verde
    case 'PAUSED':
    case 'IDLE':
    case 'WAITING':
      return '#f59e0b'; // Amarillo / Naranja
    case 'STASHED':
      return '#a855f7'; // Violeta / Púrpura
    case 'STOPPED':
    case 'ABORTED':
    case 'ERROR':
      return '#ef4444'; // Rojo
    default:
      return '#9ca3af'; // Gris
  }
}
