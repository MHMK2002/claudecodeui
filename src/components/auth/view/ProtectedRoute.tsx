import type { ReactNode } from 'react';

import { IS_PLATFORM } from '../../../constants/config';
import Onboarding from '../../onboarding/view/Onboarding';
import { useAuth } from '../context/AuthContext';

import AuthLoadingScreen from './AuthLoadingScreen';
import LoginForm from './LoginForm';
import LocalSessionRecovery from './LocalSessionRecovery';
import SetupForm from './SetupForm';

type ProtectedRouteProps = {
  children: ReactNode;
};

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const {
    user,
    isLoading,
    needsSetup,
    hasCompletedOnboarding,
    refreshOnboardingStatus,
    runtimeMode,
    localBootstrapReady,
    retryLocalBootstrap,
    error,
  } = useAuth();

  if (isLoading) {
    return <AuthLoadingScreen />;
  }

  if (runtimeMode === 'desktop-local') {
    if (user && localBootstrapReady) {
      return <>{children}</>;
    }
    return (
      <LocalSessionRecovery
        message={error || 'The local Desktop session is not ready.'}
        onRetry={retryLocalBootstrap}
      />
    );
  }

  if (IS_PLATFORM) {
    if (!hasCompletedOnboarding) {
      return <Onboarding onComplete={refreshOnboardingStatus} />;
    }

    return <>{children}</>;
  }

  if (needsSetup) {
    return <SetupForm />;
  }

  if (!user) {
    return <LoginForm />;
  }

  if (!hasCompletedOnboarding) {
    return <Onboarding onComplete={refreshOnboardingStatus} />;
  }

  return <>{children}</>;
}
