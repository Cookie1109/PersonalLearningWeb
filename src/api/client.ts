import axios, { AxiosHeaders } from 'axios';
import { onAuthStateChanged } from 'firebase/auth';

import { firebaseAuth } from './firebase';

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

let authInterceptorConfigured = false;
let authStateResolved = false;
let authStateResolutionPromise: Promise<void> | null = null;

function waitForAuthStateResolution(): Promise<void> {
  if (authStateResolved || firebaseAuth.currentUser) {
    authStateResolved = true;
    return Promise.resolve();
  }

  if (!authStateResolutionPromise) {
    authStateResolutionPromise = new Promise(resolve => {
      const unsubscribe = onAuthStateChanged(
        firebaseAuth,
        () => {
          authStateResolved = true;
          unsubscribe();
          resolve();
        },
        () => {
          authStateResolved = true;
          unsubscribe();
          resolve();
        }
      );
    });
  }

  return authStateResolutionPromise;
}

function hasAuthorizationHeader(headers: unknown): boolean {
  const normalizedHeaders = AxiosHeaders.from(headers ?? {});
  const authHeader = normalizedHeaders.get('Authorization');

  if (Array.isArray(authHeader)) {
    return authHeader.some(value => typeof value === 'string' && value.trim().length > 0);
  }

  if (typeof authHeader === 'string') {
    return authHeader.trim().length > 0;
  }

  return Boolean(authHeader);
}

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
    await waitForAuthStateResolution();

    const user = firebaseAuth.currentUser;
    if (!user) {
      return config;
    }

    let idToken: string | null = null;
    try {
      idToken = await user.getIdToken();
    } catch {
      try {
        idToken = await user.getIdToken(true);
      } catch {
        return config;
      }
    }

    if (!idToken) {
      return config;
    }

    const headers = AxiosHeaders.from(config.headers ?? {});
    headers.set('Authorization', `Bearer ${idToken}`);
    config.headers = headers;

    return config;
  });

  apiClient.interceptors.response.use(
    response => response,
    async error => {
      if (
        axios.isAxiosError(error)
        && error.response?.status === 401
        && hasAuthorizationHeader(error.config?.headers)
      ) {
        try {
          await firebaseAuth.signOut();
        } catch {
          // Best effort sign-out on unauthorized responses.
        }

        if (
          typeof window !== 'undefined'
          && window.location.pathname !== '/login'
          && window.location.pathname !== '/register'
        ) {
          window.location.assign('/login');
        }
      }

      return Promise.reject(error);
    }
  );

  authInterceptorConfigured = true;
}
