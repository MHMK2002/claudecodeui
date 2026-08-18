import type { AuthUser, RuntimeMode } from '../auth/types';
import type { LLMProvider } from '../../types/app';

export type DesktopFirstRunStep = 'provider' | 'connect' | 'voice' | 'summary';
export type ProviderSetupOutcome =
  | { status: 'skipped' }
  | {
      status: 'connected';
      provider: LLMProvider;
      method: 'interactive' | 'token';
      providerTitle?: string;
    };
export type VoiceSetupOutcome = 'skipped' | 'configured' | 'ready';

export const DESKTOP_FIRST_RUN_STEPS: DesktopFirstRunStep[] = [
  'provider',
  'connect',
  'voice',
  'summary',
];

export function shouldShowDesktopFirstRunSetup(input: {
  runtimeMode: RuntimeMode | null;
  user: AuthUser | null;
  hasCompletedOnboarding: boolean;
  localBootstrapReady: boolean;
}): boolean {
  return input.runtimeMode === 'desktop-local'
    && input.localBootstrapReady
    && input.user?.internal === true
    && !input.hasCompletedOnboarding;
}

export function supportsProviderToken(provider: LLMProvider | null): provider is 'claude' | 'codex' {
  return provider === 'claude' || provider === 'codex';
}
