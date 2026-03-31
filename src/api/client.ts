import axios from 'axios';

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

const ACCESS_TOKEN_STORAGE_KEY = 'pl_access_token';
const AUTH_EXPIRED_NOTICE_KEY = 'pl_auth_expired_notice';

let authInterceptorConfigured = false;

export function setAccessToken(token: string | null): void {
  if (typeof window === 'undefined') return;

  if (!token) {
    window.localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, token);
}

export function clearClientAuthState(): void {
  setAccessToken(null);
}

export function markAuthExpiredNotice(): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(AUTH_EXPIRED_NOTICE_KEY, '1');
}

export function consumeAuthExpiredNotice(): boolean {
  if (typeof window === 'undefined') return false;
  const value = window.sessionStorage.getItem(AUTH_EXPIRED_NOTICE_KEY);
  if (!value) return false;
  window.sessionStorage.removeItem(AUTH_EXPIRED_NOTICE_KEY);
  return true;
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

export function configureAuthInterceptor(): void {
  if (authInterceptorConfigured) return;

  apiClient.interceptors.response.use(
    response => response,
    error => {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        const requestUrl = String(error.config?.url ?? '');
        const hasAuthHeader = Boolean(error.config?.headers && 'Authorization' in error.config.headers);
        const isLoginRequest = requestUrl.includes('/auth/login') || requestUrl.includes('/auth/register');

        if (hasAuthHeader && !isLoginRequest) {
          clearClientAuthState();
          markAuthExpiredNotice();

          if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
            window.location.assign('/login');
          }
        }
      }

      return Promise.reject(error);
    }
  );

  authInterceptorConfigured = true;
}
