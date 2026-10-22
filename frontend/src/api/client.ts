/**
 * HTTP API Client
 * 
 * Fetch wrapper with timeout, JSON handling, and error normalization.
 * During development, requests go through Vite's proxy to Apache.
 * In production, the API is at the same origin.
 */

import { generateUUID } from '../utils/uuid';

const API_BASE = '/api';
const DEFAULT_GET_TIMEOUT = 3500; // 3.5s for GET queries so offline fallback is fast
const DEFAULT_POST_TIMEOUT = 12000; // 12s for writes/batch operations

export class ApiError extends Error {
  status: number;
  errors?: string[];

  constructor(message: string, status: number, errors?: string[]) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errors = errors;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  timeout?: number;
  headers?: Record<string, string>;
}

/**
 * Get the device ID (or generate one)
 */
function getDeviceId(): string {
  let deviceId = localStorage.getItem('pos_device_id');
  if (!deviceId) {
    deviceId = `device-${generateUUID().slice(0, 8)}`;
    localStorage.setItem('pos_device_id', deviceId);
  }
  return deviceId;
}

/**
 * Core fetch wrapper
 */
async function request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  // If browser is known to be offline, fail fast immediately
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new ApiError('Device is offline', 0);
  }

  const {
    method = 'GET',
    body,
    timeout = method === 'GET' ? DEFAULT_GET_TIMEOUT : DEFAULT_POST_TIMEOUT,
    headers = {},
  } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  const config: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Device-ID': getDeviceId(),
      ...headers,
    },
    signal: controller.signal,
  };

  if (body && method !== 'GET') {
    config.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(`${API_BASE}${endpoint}`, config);
    clearTimeout(timeoutId);

    const data = await response.json();

    if (!response.ok) {
      throw new ApiError(
        data.error || `Request failed with status ${response.status}`,
        response.status,
        data.errors
      );
    }

    return data as T;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof ApiError) throw error;

    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError('Request timed out. Is the server reachable?', 408);
    }

    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new ApiError(
        'Cannot reach the server. Check your network connection and ensure the laptop server is running.',
        0
      );
    }

    throw new ApiError(
      error instanceof Error ? error.message : 'An unexpected error occurred',
      0
    );
  }
}

// Convenience methods
export const api = {
  get: <T>(endpoint: string, timeout?: number) => 
    request<T>(endpoint, { timeout }),

  post: <T>(endpoint: string, body: unknown, timeout?: number) => 
    request<T>(endpoint, { method: 'POST', body, timeout }),

  put: <T>(endpoint: string, body: unknown, timeout?: number) => 
    request<T>(endpoint, { method: 'PUT', body, timeout }),

  delete: <T>(endpoint: string, timeout?: number) => 
    request<T>(endpoint, { method: 'DELETE', timeout }),
};

/**
 * Check if the server is reachable
 */
export async function checkServerHealth(): Promise<boolean> {
  try {
    await request('/health', { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the configured API base URL (for display purposes)
 */
export function getApiBaseUrl(): string {
  return window.location.origin + API_BASE;
}
