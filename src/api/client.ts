import axios from 'axios';

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

const ACCESS_TOKEN_STORAGE_KEY = 'pl_access_token';

export function setAccessToken(token: string | null): void {
  if (typeof window === 'undefined') return;

  if (!token) {
    window.localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, token);
}

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
}

export function createAuthHeaders(): Record<string, string> {
  const token = getAccessToken();
  if (!token) {
    throw new Error('Missing access token. Please login again.');
  }

  return {
    Authorization: `Bearer ${token}`,
  };
}

export function createIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `idem-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}
