import { FRAME_BUDGET_MS } from '../utils/constants';

/**
 * Single Responsibility: Manage UI logs and console output.
 * Throttles DOM insertion bursts via DocumentFragment and Alpha frame budget (250ms / 4 FPS).
 */

export type LogType = 'info' | 'warn' | 'err' | 'success';

interface QueuedLog {
  text: string;
  type: LogType;
  time: string;
}

export class LoggerService {
  private logConsoleEl: HTMLElement | null = null;
  private maxLogs: number = 100;
  private pendingLogs: QueuedLog[] = [];
  private flushTimerId: number | null = null;

  public init(elementId: string = 'log-console'): void {
    this.logConsoleEl = document.getElementById(elementId);
  }

  public log(text: string, type: LogType = 'info'): void {
    const time = new Date().toLocaleTimeString();
    this.pendingLogs.push({ text, type, time });

    if (this.flushTimerId === null) {
      this.flushTimerId = window.setTimeout(() => this.flush(), FRAME_BUDGET_MS);
    }
  }

  public flush(): void {
    this.flushTimerId = null;
    if (this.pendingLogs.length === 0) return;

    if (!this.logConsoleEl) {
      this.logConsoleEl = document.getElementById('log-console');
      if (!this.logConsoleEl) {
        this.pendingLogs.forEach((l) => console.log(`[${l.type.toUpperCase()}] ${l.text}`));
        this.pendingLogs = [];
        return;
      }
    }

    const fragment = document.createDocumentFragment();
    for (const item of this.pendingLogs) {
      const row = document.createElement('div');
      row.className = `log-row ${item.type}`;

      const timeSpan = document.createElement('span');
      timeSpan.style.color = '#4b5563';
      timeSpan.textContent = `[${item.time}]`;

      const textSpan = document.createElement('span');
      textSpan.textContent = item.text;

      row.appendChild(timeSpan);
      row.appendChild(textSpan);
      fragment.appendChild(row);
    }

    this.pendingLogs = [];
    this.logConsoleEl.appendChild(fragment);
    this.logConsoleEl.scrollTop = this.logConsoleEl.scrollHeight;

    // Prune rows if too many
    while (this.logConsoleEl.children.length > this.maxLogs) {
      this.logConsoleEl.removeChild(this.logConsoleEl.firstChild!);
    }
  }

  public clear(): void {
    this.pendingLogs = [];
    if (this.flushTimerId !== null) {
      clearTimeout(this.flushTimerId);
      this.flushTimerId = null;
    }
    if (this.logConsoleEl) {
      this.logConsoleEl.innerHTML = '';
    }
  }
}

export const logger = new LoggerService();
export const addLog = (text: string, type: LogType = 'info') => logger.log(text, type);

