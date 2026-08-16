/**
 * Single Responsibility: Manage UI logs and console output.
 */

export type LogType = 'info' | 'warn' | 'err' | 'success';

export class LoggerService {
  private logConsoleEl: HTMLElement | null = null;
  private maxLogs: number = 100;

  public init(elementId: string = 'log-console'): void {
    this.logConsoleEl = document.getElementById(elementId);
  }

  public log(text: string, type: LogType = 'info'): void {
    if (!this.logConsoleEl) {
      this.logConsoleEl = document.getElementById('log-console');
      if (!this.logConsoleEl) {
        console.log(`[${type.toUpperCase()}] ${text}`);
        return;
      }
    }

    const time = new Date().toLocaleTimeString();
    const row = document.createElement('div');
    row.className = `log-row ${type}`;

    const timeSpan = document.createElement('span');
    timeSpan.style.color = '#4b5563';
    timeSpan.textContent = `[${time}]`;

    const textSpan = document.createElement('span');
    textSpan.textContent = text;

    row.appendChild(timeSpan);
    row.appendChild(textSpan);

    this.logConsoleEl.appendChild(row);
    this.logConsoleEl.scrollTop = this.logConsoleEl.scrollHeight;

    // Prune rows if too many
    while (this.logConsoleEl.children.length > this.maxLogs) {
      this.logConsoleEl.removeChild(this.logConsoleEl.firstChild!);
    }
  }

  public clear(): void {
    if (this.logConsoleEl) {
      this.logConsoleEl.innerHTML = '';
    }
  }
}

export const logger = new LoggerService();
export const addLog = (text: string, type: LogType = 'info') => logger.log(text, type);
