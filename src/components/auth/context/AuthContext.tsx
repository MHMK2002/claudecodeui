import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { IS_PLATFORM } from '../../../constants/config';
import {
  api,
  AUTH_LOCAL_SESSION_UNAVAILABLE_EVENT,
  AUTH_SESSION_EXPIRED_EVENT,
  AUTH_TOKEN_REFRESHED_EVENT,
  getAuthTokenRefreshDelay,
  isValidRefreshedToken,
  setAuthRuntimeMode,
  storeAuthToken,
} from '../../../utils/api';
import { invalidateProviderAuthStatusCache } from '../../provider-auth/providerAuthStatusCache';
import { AUTH_ERROR_MESSAGES, AUTH_TOKEN_STORAGE_KEY } from '../constants';
import type {
  AuthContextValue,
  AuthProviderProps,
  AuthSessionPayload,
  AuthStatusPayload,
  AuthUser,
  AuthUserPayload,
  OnboardingStatusPayload,
  RuntimeMode,
} from '../types';
import { parseJsonSafely, resolveApiErrorMessage } from '../utils';

const AuthContext = createContext<AuthContextValue | null>(null);

const readStoredToken = (): string | null => localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);

const persistToken = (token: string) => {
  storeAuthToken(token);
};

const clearStoredToken = () => {
  localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
};

const initialRuntimeMode = (): RuntimeMode | null => {
  if (IS_PLATFORM) return 'platform';
  return window.cloudcliDesktopLocalSession ? 'desktop-local' : null;
};

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(() => readStoredToken());
  const [isLoading, setIsLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(true);
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode | null>(initialRuntimeMode);
  const [localBootstrapReady, setLocalBootstrapReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setSession = useCallback((nextUser: AuthUser, nextToken: string) => {
    invalidateProviderAuthStatusCache();
    setUser(nextUser);
    setToken(nextToken);
    persistToken(nextToken);
  }, []);

  const clearSession = useCallback(() => {
    invalidateProviderAuthStatusCache();
    setUser(null);
    setToken(null);
    clearStoredToken();
  }, []);

  const checkOnboardingStatus = useCallback(async () => {
    try {
      const response = await api.user.onboardingStatus();
      if (!response.ok) {
        return;
      }

      const payload = await parseJsonSafely<OnboardingStatusPayload>(response);
      setHasCompletedOnboarding(Boolean(payload?.hasCompletedOnboarding));
    } catch (caughtError) {
      console.error('Error checking onboarding status:', caughtError);
      // Fail open to avoid blocking access on transient onboarding status errors.
      setHasCompletedOnboarding(true);
    }
  }, []);

  const refreshOnboardingStatus = useCallback(async () => {
    await checkOnboardingStatus();
  }, [checkOnboardingStatus]);

  const refreshSession = useCallback(async () => {
    if (IS_PLATFORM || runtimeMode === 'desktop-local' || !token || !user) {
      return;
    }

    try {
      const response = await api.auth.refresh();
      if (!response.ok) {
        return;
      }

      const payload = await parseJsonSafely<AuthSessionPayload>(response);
      if (isValidRefreshedToken(payload?.token)) {
        setToken(payload.token);
        persistToken(payload.token);
      }
    } catch (caughtError) {
      // A transient network failure must not sign the user out. Focus/visibility
      // and the next scheduled refresh will retry while the token remains valid.
      console.warn('[Auth] Session refresh failed:', caughtError);
    }
  }, [runtimeMode, token, user]);

  useEffect(() => {
    const handleTokenRefreshed = (event: Event) => {
      const nextToken = (event as CustomEvent<unknown>).detail;
      if (isValidRefreshedToken(nextToken)) {
        setToken(nextToken);
      }
    };
    const handleSessionExpired = () => {
      clearSession();
      setError(AUTH_ERROR_MESSAGES.sessionExpired);
    };
    const handleLocalSessionUnavailable = () => {
      setUser(null);
      setLocalBootstrapReady(false);
      setError(AUTH_ERROR_MESSAGES.localSessionUnavailable);
    };

    window.addEventListener(AUTH_TOKEN_REFRESHED_EVENT, handleTokenRefreshed);
    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);
    window.addEventListener(AUTH_LOCAL_SESSION_UNAVAILABLE_EVENT, handleLocalSessionUnavailable);
    return () => {
      window.removeEventListener(AUTH_TOKEN_REFRESHED_EVENT, handleTokenRefreshed);
      window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);
      window.removeEventListener(AUTH_LOCAL_SESSION_UNAVAILABLE_EVENT, handleLocalSessionUnavailable);
    };
  }, [clearSession]);

  const checkAuthStatus = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const statusResponse = await api.auth.status();
      const statusPayload = await parseJsonSafely<AuthStatusPayload>(statusResponse);
      if (!statusResponse.ok || !statusPayload?.runtimeMode) {
        throw new Error('Authentication status returned an invalid response.');
      }
      const nextRuntimeMode = statusPayload.runtimeMode;
      setRuntimeMode(nextRuntimeMode);
      setAuthRuntimeMode(nextRuntimeMode);

      if (nextRuntimeMode === 'desktop-local') {
        setNeedsSetup(false);
        const userResponse = await api.auth.user();
        if (!userResponse.ok) {
          setUser(null);
          setLocalBootstrapReady(false);
          setError(AUTH_ERROR_MESSAGES.localSessionUnavailable);
          return;
        }
        const userPayload = await parseJsonSafely<AuthUserPayload>(userResponse);
        if (!userPayload?.user) {
          setUser(null);
          setLocalBootstrapReady(false);
          setError(AUTH_ERROR_MESSAGES.localSessionUnavailable);
          return;
        }
        invalidateProviderAuthStatusCache();
        setUser(userPayload.user);
        setToken(null);
        clearStoredToken();
        await checkOnboardingStatus();
        setLocalBootstrapReady(true);
        return;
      }

      setLocalBootstrapReady(false);

      if (statusPayload?.needsSetup) {
        setNeedsSetup(true);
        return;
      }

      setNeedsSetup(false);

      const userResponse = await api.auth.user();
      if (!userResponse.ok) {
        clearSession();
        return;
      }

      const userPayload = await parseJsonSafely<AuthUserPayload>(userResponse);
      if (!userPayload?.user) {
        clearSession();
        return;
      }

      setUser(userPayload.user);
      await checkOnboardingStatus();
    } catch (caughtError) {
      console.error('[Auth] Auth status check failed:', caughtError);
      setError(AUTH_ERROR_MESSAGES.authStatusCheckFailed);
    } finally {
      setIsLoading(false);
    }
  }, [checkOnboardingStatus, clearSession]);

  useEffect(() => {
    if (IS_PLATFORM) {
      setUser({ username: 'platform-user' });
      setRuntimeMode('platform');
      setAuthRuntimeMode('platform');
      setNeedsSetup(false);
      void checkOnboardingStatus().finally(() => {
        setIsLoading(false);
      });
      return;
    }

    void checkAuthStatus();
  }, [checkAuthStatus, checkOnboardingStatus]);

  useEffect(() => {
    if (IS_PLATFORM || !token || !user) {
      return undefined;
    }

    const refreshIfNeeded = () => {
      const refreshDelay = getAuthTokenRefreshDelay(token);
      if (refreshDelay !== null && refreshDelay <= 0) {
        void refreshSession();
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshIfNeeded();
      }
    };

    const refreshDelay = getAuthTokenRefreshDelay(token);
    const refreshTimer = refreshDelay === null
      ? null
      : window.setTimeout(() => void refreshSession(), refreshDelay);

    window.addEventListener('focus', refreshIfNeeded);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
      }
      window.removeEventListener('focus', refreshIfNeeded);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refreshSession, token, user]);

  const login = useCallback<AuthContextValue['login']>(
    async (username, password) => {
      try {
        setError(null);
        const response = await api.auth.login(username, password);
        const payload = await parseJsonSafely<AuthSessionPayload>(response);

        if (!response.ok || !payload?.token || !payload.user) {
          const message = resolveApiErrorMessage(payload, AUTH_ERROR_MESSAGES.loginFailed);
          setError(message);
          return { success: false, error: message };
        }

        setSession(payload.user, payload.token);
        setNeedsSetup(false);
        await checkOnboardingStatus();
        return { success: true };
      } catch (caughtError) {
        console.error('Login error:', caughtError);
        setError(AUTH_ERROR_MESSAGES.networkError);
        return { success: false, error: AUTH_ERROR_MESSAGES.networkError };
      }
    },
    [checkOnboardingStatus, setSession],
  );

  const register = useCallback<AuthContextValue['register']>(
    async (username, password) => {
      try {
        setError(null);
        const response = await api.auth.register(username, password);
        const payload = await parseJsonSafely<AuthSessionPayload>(response);

        if (!response.ok || !payload?.token || !payload.user) {
          const message = resolveApiErrorMessage(payload, AUTH_ERROR_MESSAGES.registrationFailed);
          setError(message);
          return { success: false, error: message };
        }

        setSession(payload.user, payload.token);
        setNeedsSetup(false);
        await checkOnboardingStatus();
        return { success: true };
      } catch (caughtError) {
        console.error('Registration error:', caughtError);
        setError(AUTH_ERROR_MESSAGES.networkError);
        return { success: false, error: AUTH_ERROR_MESSAGES.networkError };
      }
    },
    [checkOnboardingStatus, setSession],
  );

  const logout = useCallback<AuthContextValue['logout']>(async () => {
    try {
      const response = await api.auth.logout();
      if (!response.ok && !response.headers.get('X-Auth-Error')) {
        setError('Logout failed. Please try again.');
        return { success: false, error: 'Logout failed. Please try again.' };
      }
      clearSession();
      return { success: true };
    } catch (caughtError) {
      console.warn('[Auth] Logout failed:', caughtError);
      setError(AUTH_ERROR_MESSAGES.networkError);
      return { success: false, error: AUTH_ERROR_MESSAGES.networkError };
    }
  }, [clearSession]);

  const retryLocalBootstrap = useCallback(async () => {
    await checkAuthStatus();
  }, [checkAuthStatus]);

  const contextValue = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      isLoading,
      needsSetup,
      hasCompletedOnboarding,
      error,
      runtimeMode,
      localBootstrapReady,
      login,
      register,
      logout,
      refreshOnboardingStatus,
      retryLocalBootstrap,
    }),
    [
      error,
      hasCompletedOnboarding,
      isLoading,
      login,
      localBootstrapReady,
      logout,
      needsSetup,
      refreshOnboardingStatus,
      retryLocalBootstrap,
      register,
      runtimeMode,
      token,
      user,
    ],
  );

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
}
