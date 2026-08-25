import { networkSettingsManager } from '../services/networkSettingsManager';

/**
 * Single Responsibility: Centralize HTTP communication with the backend API.
 * Adheres to DRY by sourcing host, port, and protocol from networkSettingsManager.
 */

export class ApiClient {
  public getBaseUrl(): string {
    return networkSettingsManager.getApiBaseUrl();
  }

  public getWsUrl(path: string = '/ws/notifications'): string {
    return networkSettingsManager.getWsUrl(path);
  }

  public getUrl(endpoint: string): string {
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    return `${this.getBaseUrl()}${cleanEndpoint}`;
  }

  public async get<T = any>(endpoint: string, options?: RequestInit): Promise<{ ok: boolean; status: number; data: T | null; error?: string }> {
    try {
      const res = await fetch(this.getUrl(endpoint), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(options?.headers || {}),
        },
        ...options,
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => res.statusText);
        return { ok: false, status: res.status, data: null, error: errorText };
      }

      const data = await res.json().catch(() => null);
      return { ok: true, status: res.status, data };
    } catch (err: any) {
      return { ok: false, status: 0, data: null, error: err?.message || 'Network error' };
    }
  }

  public async post<T = any>(endpoint: string, body?: any, options?: RequestInit): Promise<{ ok: boolean; status: number; data: T | null; error?: string }> {
    try {
      const res = await fetch(this.getUrl(endpoint), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(options?.headers || {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        ...options,
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => res.statusText);
        return { ok: false, status: res.status, data: null, error: errorText };
      }

      const data = await res.json().catch(() => null);
      return { ok: true, status: res.status, data };
    } catch (err: any) {
      return { ok: false, status: 0, data: null, error: err?.message || 'Network error' };
    }
  }

  public async put<T = any>(endpoint: string, body?: any, options?: RequestInit): Promise<{ ok: boolean; status: number; data: T | null; error?: string }> {
    try {
      const res = await fetch(this.getUrl(endpoint), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(options?.headers || {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        ...options,
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => res.statusText);
        return { ok: false, status: res.status, data: null, error: errorText };
      }

      const data = await res.json().catch(() => null);
      return { ok: true, status: res.status, data };
    } catch (err: any) {
      return { ok: false, status: 0, data: null, error: err?.message || 'Network error' };
    }
  }

  public async delete<T = any>(endpoint: string, options?: RequestInit): Promise<{ ok: boolean; status: number; data: T | null; error?: string }> {
    try {
      const res = await fetch(this.getUrl(endpoint), {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...(options?.headers || {}),
        },
        ...options,
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => res.statusText);
        return { ok: false, status: res.status, data: null, error: errorText };
      }

      const data = await res.json().catch(() => null);
      return { ok: true, status: res.status, data };
    } catch (err: any) {
      return { ok: false, status: 0, data: null, error: err?.message || 'Network error' };
    }
  }
}

export const apiClient = new ApiClient();
