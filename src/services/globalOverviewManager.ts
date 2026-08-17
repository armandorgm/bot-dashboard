import { GlobalOverviewResponse, AllInstancesTelemetryResponse } from '../types';
import { getInstanceStatusColor } from '../utils/formatters';
import { triggerGaugeManager } from './triggerGaugeManager';

export class GlobalOverviewManager {
  private viewMode: 'home' | 'dashboard' = 'home';

  public getViewMode(): 'home' | 'dashboard' {
    return this.viewMode;
  }

  public setViewMode(mode: 'home' | 'dashboard', onDashboardShown?: () => void, parentPort: string = '8000'): void {
    this.viewMode = mode;
    const overviewPage = document.getElementById('global-overview-page');
    const dashboardPage = document.getElementById('instance-dashboard-page');
    const btnNavHome = document.getElementById('btn-nav-home');

    if (mode === 'home') {
      if (overviewPage) overviewPage.style.display = 'flex';
      if (dashboardPage) dashboardPage.style.display = 'none';
      if (btnNavHome) {
        btnNavHome.style.background = '#10b981';
        btnNavHome.style.color = '#000000';
      }
      this.fetchGlobalOverview(parentPort);
    } else {
      if (overviewPage) overviewPage.style.display = 'none';
      if (dashboardPage) dashboardPage.style.display = 'flex';
      if (btnNavHome) {
        btnNavHome.style.background = '#1f2937';
        btnNavHome.style.color = '#d1d5db';
      }
      if (onDashboardShown) {
        setTimeout(onDashboardShown, 50);
      }
    }
  }

  public async fetchGlobalOverview(
    parentPort: string = '8000',
    callbacks?: {
      onMonitor: (id: string) => void;
      onStash: (id: number, name: string) => void;
      onPop: (id: number, mode: 'NOW' | 'NO_FEES') => void;
    }
  ): Promise<GlobalOverviewResponse | null> {
    const tbody = document.getElementById('overview-instances-tbody');
    try {
      const [overviewRes, telemetryRes] = await Promise.allSettled([
        fetch(`http://127.0.0.1:${parentPort}/api/instances/overview`),
        fetch(`http://127.0.0.1:${parentPort}/api/grid/instances/telemetry`),
      ]);

      if (overviewRes.status === 'fulfilled' && overviewRes.value.ok) {
        const data: GlobalOverviewResponse = await overviewRes.value.json();

        // Hydrate each instance row with real-time telemetry if available
        if (telemetryRes.status === 'fulfilled' && telemetryRes.value.ok) {
          try {
            const telemetryMap: AllInstancesTelemetryResponse = await telemetryRes.value.json();
            if (telemetryMap && typeof telemetryMap === 'object') {
              data.instances = data.instances.map((inst) => {
                const liveTele = telemetryMap[inst.id] || telemetryMap[String(inst.id)];
                if (liveTele) {
                  return {
                    ...inst,
                    used_capital: typeof liveTele.used_capital === 'number' ? liveTele.used_capital : inst.used_capital,
                    allocated_capital: typeof liveTele.allocated_capital === 'number' ? liveTele.allocated_capital : inst.allocated_capital,
                    unrealized_pnl: typeof liveTele.unrealized_pnl === 'number' ? liveTele.unrealized_pnl : inst.unrealized_pnl,
                    status: liveTele.status || inst.status,
                  };
                }
                return inst;
              });
            }
          } catch (_) {}
        }

        this.renderGlobalOverview(data, callbacks);
        return data;
      } else {
        if (tbody) {
          tbody.innerHTML = `<tr><td colspan="11" style="padding: 24px; text-align: center; color: #ef4444;">Error al cargar la matriz de instancias</td></tr>`;
        }
      }
    } catch (_) {
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="11" style="padding: 24px; text-align: center; color: #ef4444;">Fallo de conexión al backend maestro</td></tr>`;
      }
    }
    return null;
  }

  public renderGlobalOverview(
    data: GlobalOverviewResponse,
    callbacks?: {
      onMonitor: (id: string) => void;
      onStash: (id: number, name: string) => void;
      onPop: (id: number, mode: 'NOW' | 'NO_FEES') => void;
    }
  ): void {
    const summary = data.portfolio_summary;
    const instances = data.instances;

    // Header Cards
    const pnlEl = document.getElementById('ov-lifetime-pnl-val');
    const unrealizedEl = document.getElementById('ov-unrealized-pnl-val');
    const tradesEl = document.getElementById('ov-total-trades-val');
    const activeEl = document.getElementById('ov-active-bots-val');
    const winrateEl = document.getElementById('ov-winrate-val');

    if (pnlEl) {
      const sign = summary.total_lifetime_pnl > 0 ? '+' : '';
      pnlEl.innerText = `$${sign}${summary.total_lifetime_pnl.toFixed(4)}`;
      pnlEl.style.color =
        summary.total_lifetime_pnl > 0 ? '#10b981' : summary.total_lifetime_pnl < 0 ? '#ef4444' : '#9ca3af';
    }

    if (unrealizedEl) {
      const globalUnrealized = summary.total_unrealized_pnl ?? 0;
      const uSign = globalUnrealized > 0 ? '+' : '';
      unrealizedEl.innerText = `$${uSign}${globalUnrealized.toFixed(4)}`;
      unrealizedEl.style.color =
        globalUnrealized > 0 ? '#10b981' : globalUnrealized < 0 ? '#ef4444' : '#06b6d4';
    }

    // Portfolio Net Total PnL
    const sessNetEl = document.getElementById('ov-session-net-total-val');
    const lifeNetEl = document.getElementById('ov-lifetime-net-total-val');

    const totalSessPnl = summary.total_session_pnl ?? 0;
    const totalSessUnrealized = summary.total_session_unrealized_pnl ?? 0;
    const portfolioSessionNet = totalSessPnl + totalSessUnrealized;
    const portfolioLifetimeNet = summary.total_lifetime_pnl + (summary.total_unrealized_pnl ?? 0);

    if (sessNetEl) {
      const sSign = portfolioSessionNet > 0 ? '+' : '';
      sessNetEl.innerText = `$${sSign}${portfolioSessionNet.toFixed(4)}`;
      sessNetEl.style.color =
        portfolioSessionNet > 0 ? '#10b981' : portfolioSessionNet < 0 ? '#ef4444' : '#60a5fa';
    }

    if (lifeNetEl) {
      const lSign = portfolioLifetimeNet > 0 ? '+' : '';
      lifeNetEl.innerText = `$${lSign}${portfolioLifetimeNet.toFixed(4)}`;
      lifeNetEl.style.color =
        portfolioLifetimeNet > 0 ? '#10b981' : portfolioLifetimeNet < 0 ? '#ef4444' : '#93c5fd';
    }
    if (tradesEl) tradesEl.innerText = summary.total_trades.toString();
    if (activeEl) activeEl.innerText = `${summary.active_instances} / ${summary.total_instances}`;

    if (winrateEl) {
      const totalWinTrades = instances.reduce((acc, inst) => acc + inst.winning_trades, 0);
      const overallWinRate = summary.total_trades > 0 ? (totalWinTrades / summary.total_trades) * 100 : 0;
      winrateEl.innerText = `${overallWinRate.toFixed(2)}%`;
    }

    // Render Matrix Rows
    const tbody = document.getElementById('overview-instances-tbody');
    if (!tbody) return;

    if (instances.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="padding: 24px; text-align: center; color: #64748b;">No hay instancias configuradas en el sistema.</td></tr>`;
      return;
    }

    // Dynamic sorting:
    // 1) Status Priority (ACTIVE=0, PAUSED=1, STOPPED=2)
    // 2) NET Session PnL (descending)
    // 3) NET Lifetime PnL (descending)
    const statusPriority: Record<string, number> = { ACTIVE: 0, PAUSED: 1, STOPPED: 2 };
    const sortedInstances = [...instances].sort((a, b) => {
      const pA = statusPriority[a.status.toUpperCase()] ?? 99;
      const pB = statusPriority[b.status.toUpperCase()] ?? 99;
      if (pA !== pB) return pA - pB;

      const isAActiveOrPaused = a.status.toUpperCase() === 'ACTIVE' || a.status.toUpperCase() === 'PAUSED';
      const isBActiveOrPaused = b.status.toUpperCase() === 'ACTIVE' || b.status.toUpperCase() === 'PAUSED';

      const netSessA = isAActiveOrPaused ? (a.session_pnl || 0) + (a.session_unrealized_pnl || 0) : -999999;
      const netSessB = isBActiveOrPaused ? (b.session_pnl || 0) + (b.session_unrealized_pnl || 0) : -999999;
      if (netSessA !== netSessB) return netSessB - netSessA;

      const netLifeA = a.lifetime_pnl + (a.unrealized_pnl || 0);
      const netLifeB = b.lifetime_pnl + (b.unrealized_pnl || 0);
      return netLifeB - netLifeA;
    });

    tbody.innerHTML = sortedInstances
      .map((inst) => {
        const statusColor = getInstanceStatusColor(inst.status);
        const pnlSign = inst.lifetime_pnl > 0 ? '+' : '';
        const pnlColor = inst.lifetime_pnl > 0 ? '#10b981' : inst.lifetime_pnl < 0 ? '#ef4444' : '#9ca3af';

        const instTrigger = inst.trigger_status || triggerGaugeManager.getStatusForInstance(inst.id);
        const triggerBadge = triggerGaugeManager.getCompactStatusBadgeHtml(instTrigger);

        return `
          <tr style="border-bottom: 1px solid #1f2937; transition: background 0.15s ease;" onmouseover="this.style.background='#1f2937'" onmouseout="this.style.background='transparent'">
            <td style="padding: 14px 16px;">
              <div style="font-weight: bold; color: #f8fafc;">#${inst.id} - ${inst.name}</div>
              <div style="font-size: 11px; color: #64748b; margin-bottom: 4px;">${inst.symbol} · ${inst.strategy_type}</div>
              <div>${triggerBadge}</div>
            </td>
            <td style="padding: 14px 16px;">
              <span style="display: inline-flex; align-items: center; gap: 6px; color: ${statusColor}; font-weight: bold; font-size: 11px; background: rgba(15,23,42,0.8); padding: 3px 8px; border-radius: 4px; border: 1px solid ${statusColor}44;">
                <span style="width: 6px; height: 6px; border-radius: 50%; background: ${statusColor};"></span>
                ${inst.status}
              </span>
            </td>

            <td style="padding: 14px 16px; text-align: right;">
              ${
                inst.session_pnl !== undefined && inst.session_pnl !== null
                  ? `
                <div style="font-size: 11px; color: ${inst.session_pnl > 0 ? '#10b981' : inst.session_pnl < 0 ? '#ef4444' : '#94a3b8'};">
                  Sess: $${inst.session_pnl > 0 ? '+' : ''}${inst.session_pnl.toFixed(4)}
                </div>
              `
                  : `
                <div style="font-size: 10px; color: #475569; font-style: italic;">Sess: N/A</div>
              `
              }
              <div style="font-weight: bold; font-size: 13px; color: ${pnlColor}; margin-top: 2px;">$${pnlSign}${inst.lifetime_pnl.toFixed(4)}</div>
            </td>
            <td style="padding: 14px 16px; text-align: right;">
              ${
                inst.session_unrealized_pnl !== undefined && inst.session_unrealized_pnl !== null
                  ? `
                <div style="font-size: 11px; color: ${inst.session_unrealized_pnl > 0 ? '#10b981' : inst.session_unrealized_pnl < 0 ? '#ef4444' : '#06b6d4'};">
                  Sess: $${inst.session_unrealized_pnl > 0 ? '+' : ''}${inst.session_unrealized_pnl.toFixed(4)}
                </div>
              `
                  : `
                <div style="font-size: 10px; color: #475569; font-style: italic;">Sess: N/A</div>
              `
              }
              <div style="font-weight: bold; font-size: 13px; color: ${(inst.unrealized_pnl || 0) > 0 ? '#10b981' : (inst.unrealized_pnl || 0) < 0 ? '#ef4444' : '#64748b'}; margin-top: 2px;">
                $${(inst.unrealized_pnl || 0) > 0 ? '+' : ''}${(inst.unrealized_pnl || 0).toFixed(4)}
              </div>
            </td>
            <td style="padding: 14px 16px; text-align: right; background: rgba(59, 130, 246, 0.04);">
              ${(() => {
                const lifetimeNet = inst.lifetime_pnl + (inst.unrealized_pnl || 0);
                const netColor = lifetimeNet > 0 ? '#10b981' : lifetimeNet < 0 ? '#ef4444' : '#9ca3af';
                const netSign = lifetimeNet > 0 ? '+' : '';

                let sessNetStr = '<div style="font-size: 10px; color: #475569; font-style: italic;">Sess: N/A</div>';
                if (
                  inst.session_pnl !== undefined &&
                  inst.session_pnl !== null &&
                  inst.session_unrealized_pnl !== undefined &&
                  inst.session_unrealized_pnl !== null
                ) {
                  const sessNet = inst.session_pnl + inst.session_unrealized_pnl;
                  const sColor = sessNet > 0 ? '#10b981' : sessNet < 0 ? '#ef4444' : '#60a5fa';
                  const sSign = sessNet > 0 ? '+' : '';
                  sessNetStr = `<div style="font-size: 11px; color: ${sColor};">Sess: $${sSign}${sessNet.toFixed(4)}</div>`;
                }

                return `
                  ${sessNetStr}
                  <div style="font-weight: bold; font-size: 13px; color: ${netColor}; margin-top: 2px;">$${netSign}${lifetimeNet.toFixed(4)}</div>
                `;
              })()}
            </td>
            <td style="padding: 14px 16px; text-align: right;">
              ${
                inst.session_trades !== undefined && inst.session_trades !== null
                  ? `
                <div style="font-size: 11px; color: #94a3b8;">Sess: ${inst.session_trades}</div>
              `
                  : `
                <div style="font-size: 10px; color: #475569; font-style: italic;">Sess: N/A</div>
              `
              }
              <div style="font-weight: bold; font-size: 13px; color: #3b82f6; margin-top: 2px;">${inst.total_trades}</div>
            </td>
            <td style="padding: 14px 16px; text-align: right;">
              ${(() => {
                const instCreatedTs = inst.created_at ? new Date(inst.created_at).getTime() : Date.now();
                const totalElapsedHours = Math.max(0.0166, (Date.now() - instCreatedTs) / (1000 * 3600));
                const totalTradesPerHour = (inst.total_trades / totalElapsedHours).toFixed(1);

                let sessionTradesPerHour = 'N/A';
                if (inst.session_trades !== undefined && inst.session_trades !== null && inst.session_start_time) {
                  const sessStartTs = new Date(inst.session_start_time).getTime();
                  const sessElapsedHours = Math.max(0.0166, (Date.now() - sessStartTs) / (1000 * 3600));
                  sessionTradesPerHour = (inst.session_trades / sessElapsedHours).toFixed(1);
                }

                return `
                  <div style="font-size: 11px; color: ${sessionTradesPerHour !== 'N/A' ? '#c084fc' : '#475569'};">
                    ${sessionTradesPerHour !== 'N/A' ? `Sess: ${sessionTradesPerHour} /h` : 'Sess: N/A'}
                  </div>
                  <div style="font-weight: bold; font-size: 13px; color: #8b5cf6; margin-top: 2px;">${totalTradesPerHour} /h</div>
                `;
              })()}
            </td>
            <td style="padding: 14px 16px; text-align: right; font-weight: bold; color: #f59e0b;">
              ${inst.win_rate_pc.toFixed(2)}%
            </td>
            <td style="padding: 14px 16px; text-align: right; color: #cbd5e1;">
              $${inst.traded_volume.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </td>
            <td style="padding: 14px 16px; text-align: right; font-family: var(--font-mono);">
              ${(() => {
                const alloc = Math.max(0, inst.allocated_capital || 0);
                const used = Math.max(0, inst.used_capital || 0);
                const usagePc = alloc > 0 ? (used / alloc) * 100 : 0;
                const usedColor = usagePc >= 95 ? '#ef4444' : usagePc >= 80 ? '#f59e0b' : '#c084fc';
                return `
                  <div style="font-size: 11px; color: ${usedColor};">
                    Usado: <span style="font-weight: bold;">$${used.toFixed(2)}</span> (${usagePc.toFixed(0)}%)
                  </div>
                  <div style="font-weight: bold; font-size: 13px; color: #f1f5f9; margin-top: 2px;">
                    Asig: $${alloc.toFixed(2)}
                  </div>
                `;
              })()}
            </td>
            <td style="padding: 14px 16px; text-align: center;">
              <div style="display: flex; align-items: center; justify-content: center; gap: 6px;">
                <button class="btn-monitor-instance" data-id="${inst.id}" style="background: #3b82f6; color: #ffffff; border: none; border-radius: 4px; padding: 4px 8px; font-family: inherit; font-size: 10px; font-weight: bold; cursor: pointer; transition: transform 0.1s ease;" title="Monitorear esta instancia en el Dashboard">
                  📊 VER
                </button>
                ${
                  inst.status.toUpperCase() === 'STASHED'
                    ? `
                  <button class="btn-matrix-pop-now" data-id="${inst.id}" style="background: rgba(168, 85, 247, 0.2); color: #c084fc; border: 1px solid #a855f7; border-radius: 4px; padding: 4px 6px; font-family: inherit; font-size: 10px; font-weight: bold; cursor: pointer;" title="Reanudar Pop NOW (Taker Instant)">
                    ⚡ NOW
                  </button>
                  <button class="btn-matrix-pop-nofees" data-id="${inst.id}" style="background: rgba(16, 185, 129, 0.2); color: #10b981; border: 1px solid #10b981; border-radius: 4px; padding: 4px 6px; font-family: inherit; font-size: 10px; font-weight: bold; cursor: pointer;" title="Reanudar Pop noFees (Maker Post-Only)">
                    🎯 noFees
                  </button>
                `
                    : `
                  <button class="btn-matrix-stash" data-id="${inst.id}" data-name="${inst.name}" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid #f59e0b; border-radius: 4px; padding: 4px 6px; font-family: inherit; font-size: 10px; font-weight: bold; cursor: pointer;" title="Congelar grilla y aplanar posición a 0">
                    📦 STASH
                  </button>
                `
                }
              </div>
            </td>
          </tr>
        `;
      })
      .join('');

    // Attach listeners
    if (callbacks?.onMonitor) {
      document.querySelectorAll('.btn-monitor-instance').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const instId = (e.currentTarget as HTMLButtonElement).getAttribute('data-id');
          if (instId) callbacks.onMonitor(instId);
        });
      });
    }

    if (callbacks?.onStash) {
      document.querySelectorAll('.btn-matrix-stash').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const targetBtn = e.currentTarget as HTMLButtonElement;
          const instId = targetBtn.getAttribute('data-id');
          const instName = targetBtn.getAttribute('data-name') || 'Instancia';
          if (instId) callbacks.onStash(parseInt(instId, 10), instName);
        });
      });
    }

    if (callbacks?.onPop) {
      document.querySelectorAll('.btn-matrix-pop-now').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const instId = (e.currentTarget as HTMLButtonElement).getAttribute('data-id');
          if (instId) callbacks.onPop(parseInt(instId, 10), 'NOW');
        });
      });

      document.querySelectorAll('.btn-matrix-pop-nofees').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const instId = (e.currentTarget as HTMLButtonElement).getAttribute('data-id');
          if (instId) callbacks.onPop(parseInt(instId, 10), 'NO_FEES');
        });
      });
    }
  }
}

export const globalOverviewManager = new GlobalOverviewManager();
