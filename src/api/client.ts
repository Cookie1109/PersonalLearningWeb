import axios, { AxiosHeaders } from 'axios';

import { firebaseAuth } from './firebase';

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

let authInterceptorConfigured = false;

export function createAuthHeaders(): Record<string, string> {
  // Authorization is attached centrally in the Axios request interceptor.
  return {};
}

export function createIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `idem-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function configureAuthInterceptor(): void {
  if (authInterceptorConfigured) return;

  apiClient.interceptors.request.use(async config => {
    const user = firebaseAuth.currentUser;
    if (!user) {
      return config;
    }

    const idToken = await user.getIdToken();
    const headers = AxiosHeaders.from(config.headers ?? {});
    headers.set('Authorization', `Bearer ${idToken}`);
    config.headers = headers;

    return config;
  });

  apiClient.interceptors.response.use(
    response => response,
    async error => {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        try {
          await firebaseAuth.signOut();
        } catch {
          // Best effort sign-out on unauthorized responses.
        }

        if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
          window.location.assign('/login');
        }
      }

      return Promise.reject(error);
    }
  );

  authInterceptorConfigured = true;
}
