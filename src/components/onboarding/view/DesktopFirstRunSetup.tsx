import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  CheckCircle2,
  ChevronLeft,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Mic,
  RefreshCw,
  TerminalSquare,
  X,
} from 'lucide-react';

import { DEFAULT_PROJECT_FOR_EMPTY_SHELL } from '../../../constants/config';
import { useAudioInputDevices } from '../../../hooks/useAudioInputDevices';
import {
  initializeVoiceSecrets,
  readVoiceConfig,
  saveVoiceConfigPatch,
  type VoiceConfig,
} from '../../../hooks/useVoiceConfig';
import { useUiPreferences } from '../../../hooks/useUiPreferences';
import {
  invalidateProviderSelectionCatalog,
  useProviderSelectionCatalog,
} from '../../../shared/hooks/useProviderSelectionCatalog';
import {
  markDefaultProviderSelectionPendingCatalog,
  notifyDefaultProviderSelection,
  persistDefaultProviderSelection,
} from '../../../shared/providerSelectionCatalog';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
} from '../../../shared/view/ui';
import type {
  LLMProvider,
  ProviderProfilePublic,
  ProviderSelectionCatalogEntry,
} from '../../../types/app';
import { api, authenticatedFetch } from '../../../utils/api';
import { useAuth } from '../../auth/context/AuthContext';
import { useVoiceInput } from '../../chat/hooks/useVoiceInput';
import SessionProviderLogo from '../../llm-logo-provider/SessionProviderLogo';
import {
  invalidateProviderAuthStatusCache,
} from '../../provider-auth/providerAuthStatusCache';
import {
  getProviderLoginCommand,
} from '../../provider-auth/view/ProviderLoginModal';
import StandaloneShell from '../../standalone-shell/view/StandaloneShell';
import {
  DESKTOP_FIRST_RUN_STEPS,
  supportsProviderToken,
  type DesktopFirstRunStep,
  type ProviderSetupOutcome,
  type VoiceSetupOutcome,
} from '../desktopFirstRunModel';

const PROVIDER_LABELS: Record<LLMProvider, string> = {
  claude: 'Claude',
  codex: 'Codex',
  cursor: 'Cursor',
  opencode: 'OpenCode',
};

const STEP_LABELS: Record<DesktopFirstRunStep, string> = {
  provider: 'Provider',
  connect: 'Connect',
  voice: 'Soniox Voice',
  summary: 'Summary',
};

const LANGUAGE_OPTIONS = [
  { value: '', label: 'Auto-detect' },
  { value: 'en', label: 'English' },
  { value: 'fa', label: 'Persian' },
  { value: 'de', label: 'German' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'tr', label: 'Turkish' },
];

const fieldClass =
  'min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

type ProviderTokenResponse = {
  success?: boolean;
  data?: { profile?: ProviderProfilePublic };
  error?: string | { message?: string };
};

type ProviderStatusResponse = {
  success?: boolean;
  data?: { authenticated?: boolean; error?: string | null };
  error?: string | { message?: string };
};

function apiErrorMessage(payload: ProviderTokenResponse | ProviderStatusResponse | null, fallback: string) {
  if (typeof payload?.error === 'string' && payload.error.trim()) return payload.error;
  if (payload?.error && typeof payload.error === 'object' && payload.error.message) {
    return payload.error.message;
  }
  return fallback;
}

function providerStatus(entry: ProviderSelectionCatalogEntry): string {
  if (entry.connectionAvailable) return 'CLI connected on this device';
  if (entry.profiles.length > 0) return `${entry.profiles.length} active profile${entry.profiles.length === 1 ? '' : 's'}`;
  return entry.unavailableReason ?? 'Not connected yet';
}

export default function DesktopFirstRunSetup() {
  const { refreshOnboardingStatus } = useAuth();
  const catalog = useProviderSelectionCatalog();
  const mic = useAudioInputDevices();
  const { setPreference } = useUiPreferences();
  const [step, setStep] = useState<DesktopFirstRunStep>('provider');
  const [selectedProvider, setSelectedProvider] = useState<LLMProvider | null>(null);
  const [connectMethod, setConnectMethod] = useState<'interactive' | 'token'>('interactive');
  const [showTerminal, setShowTerminal] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const providerTokenRef = useRef<HTMLInputElement>(null);
  const [hasProviderToken, setHasProviderToken] = useState(false);
  const [connectBusy, setConnectBusy] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [providerOutcome, setProviderOutcome] = useState<ProviderSetupOutcome>({ status: 'skipped' });
  const [voiceOutcome, setVoiceOutcome] = useState<VoiceSetupOutcome>('skipped');
  const [voiceLoading, setVoiceLoading] = useState(true);
  const voiceKeyInputRef = useRef<HTMLInputElement>(null);
  const [hasVoiceKey, setHasVoiceKey] = useState(false);
  const [hasExistingVoiceKey, setHasExistingVoiceKey] = useState(false);
  const [showVoiceKey, setShowVoiceKey] = useState(false);
  const [micDeviceId, setMicDeviceId] = useState('');
  const [language, setLanguage] = useState('');
  const [voiceSaving, setVoiceSaving] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [dismissBusy, setDismissBusy] = useState(false);
  const [dismissError, setDismissError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const selectedEntry = useMemo(
    () => selectedProvider ? catalog.getEntry(selectedProvider) : null,
    [catalog, selectedProvider],
  );
  const stepIndex = DESKTOP_FIRST_RUN_STEPS.indexOf(step);

  useEffect(() => {
    let cancelled = false;
    void initializeVoiceSecrets()
      .then(() => {
        if (cancelled) return;
        const current = readVoiceConfig();
        const existingVoiceKey = Boolean(current.sonioxApiKey.trim());
        setHasExistingVoiceKey(existingVoiceKey);
        setHasVoiceKey(existingVoiceKey);
        setMicDeviceId(current.micDeviceId);
        setLanguage(current.sttLanguages[0] ?? '');
        setVoiceLoading(false);
      })
      .catch((error) => {
        if (cancelled) return;
        setVoiceError(error instanceof Error ? error.message : 'Secure Voice storage could not be loaded.');
        setVoiceLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const readDraftVoiceKey = useCallback((): string => (
    voiceKeyInputRef.current?.value.trim() || readVoiceConfig().sonioxApiKey
  ), []);

  const voiceTestConfig = useCallback((): VoiceConfig => ({
    ...readVoiceConfig(),
    sttProvider: 'soniox',
    sonioxApiKey: readDraftVoiceKey(),
    micDeviceId,
    sttLanguages: language ? [language] : [],
  }), [language, micDeviceId, readDraftVoiceKey]);

  const voiceTest = useVoiceInput(
    (text) => {
      setVoiceError(null);
      setTestResult(text);
    },
    (message) => {
      setTestResult(null);
      setVoiceError(message);
    },
    undefined,
    { getConfig: voiceTestConfig },
  );

  const dismiss = useCallback(async () => {
    if (dismissBusy) return;
    setDismissBusy(true);
    setDismissError(null);
    try {
      const response = await api.user.completeOnboarding();
      if (!response.ok) throw new Error('Setup could not be dismissed. Try again.');
      setDismissed(true);
      void refreshOnboardingStatus();
    } catch (error) {
      setDismissError(error instanceof Error ? error.message : 'Setup could not be dismissed.');
      setDismissBusy(false);
    }
  }, [dismissBusy, refreshOnboardingStatus]);

  const moveToConnect = () => {
    if (!selectedProvider) return;
    setConnectMethod('interactive');
    setHasProviderToken(false);
    setShowToken(false);
    setConnectError(null);
    setShowTerminal(false);
    setStep('connect');
  };

  const skipProvider = () => {
    setProviderOutcome((current) => (
      current.status === 'connected' ? current : { status: 'skipped' }
    ));
    setSelectedProvider(null);
    setHasProviderToken(false);
    setShowToken(false);
    setStep('voice');
  };

  const finishProviderConnection = (
    provider: LLMProvider,
    method: 'interactive' | 'token',
    profileId: number | null,
  ) => {
    if (profileId !== null) {
      markDefaultProviderSelectionPendingCatalog(provider, profileId);
    }
    persistDefaultProviderSelection(provider, profileId);
    notifyDefaultProviderSelection(provider, profileId);
    invalidateProviderAuthStatusCache(provider);
    invalidateProviderSelectionCatalog();
    setHasProviderToken(false);
    setShowToken(false);
    setProviderOutcome({ status: 'connected', provider, method });
    setStep('voice');
  };

  const verifyToken = async () => {
    const token = providerTokenRef.current?.value.trim() ?? '';
    if (!supportsProviderToken(selectedProvider) || !token) return;
    setConnectBusy(true);
    setConnectError(null);
    try {
      const response = await authenticatedFetch(
        `/api/providers/${selectedProvider}/onboarding-token`,
        { method: 'POST', body: JSON.stringify({ token }) },
      );
      const payload = await response.json().catch(() => null) as ProviderTokenResponse | null;
      const profile = payload?.data?.profile;
      if (!response.ok || !payload?.success || !profile) {
        throw new Error(apiErrorMessage(payload, 'The token could not be verified. Try again.'));
      }
      if (providerTokenRef.current) providerTokenRef.current.value = '';
      setHasProviderToken(false);
      finishProviderConnection(selectedProvider, 'token', profile.id);
      window.dispatchEvent(new CustomEvent(`${selectedProvider}-provider-profiles-updated`, {
        detail: { preferredProfileId: profile.id },
      }));
      window.dispatchEvent(new CustomEvent('provider-profiles-updated', {
        detail: { provider: selectedProvider },
      }));
    } catch (error) {
      setConnectError(error instanceof Error ? error.message : 'The token could not be verified.');
    } finally {
      setConnectBusy(false);
    }
  };

  const checkInteractiveConnection = async () => {
    if (!selectedProvider) return;
    setConnectBusy(true);
    setConnectError(null);
    try {
      const response = await authenticatedFetch(
        `/api/providers/${selectedProvider}/auth/status?force=1&connectionOnly=true`,
      );
      const payload = await response.json().catch(() => null) as ProviderStatusResponse | null;
      if (!response.ok || !payload?.success || !payload.data?.authenticated) {
        throw new Error(apiErrorMessage(
          payload,
          payload?.data?.error || 'Sign-in is not complete yet. Finish it in the terminal and retry.',
        ));
      }
      finishProviderConnection(selectedProvider, 'interactive', null);
    } catch (error) {
      setConnectError(error instanceof Error ? error.message : 'The connection could not be checked.');
    } finally {
      setConnectBusy(false);
    }
  };

  const startVoiceTest = () => {
    if (voiceTest.state === 'recording') {
      voiceTest.stop();
      return;
    }
    if (!readDraftVoiceKey()) {
      setVoiceError('Enter a Soniox API key before testing.');
      return;
    }
    setTestResult(null);
    setVoiceError(null);
    void voiceTest.start();
  };

  const saveVoice = async () => {
    if (!readDraftVoiceKey()) return;
    setVoiceSaving(true);
    setVoiceError(null);
    try {
      const enteredVoiceKey = voiceKeyInputRef.current?.value.trim() ?? '';
      await saveVoiceConfigPatch({
        sttProvider: 'soniox',
        ...(enteredVoiceKey ? { sonioxApiKey: enteredVoiceKey } : {}),
        micDeviceId,
        sttLanguages: language ? [language] : [],
      });
      setPreference('voiceEnabled', true);
      setVoiceOutcome(testResult ? 'ready' : 'configured');
      setStep('summary');
    } catch (error) {
      setVoiceError(error instanceof Error ? error.message : 'Voice settings could not be saved.');
    } finally {
      setVoiceSaving(false);
    }
  };

  const skipVoice = () => {
    setVoiceOutcome('skipped');
    setStep('summary');
  };

  const resetVoiceTest = () => {
    setTestResult(null);
    setVoiceError(null);
  };

  const returnToConnect = () => {
    if (voiceKeyInputRef.current) voiceKeyInputRef.current.value = '';
    setHasVoiceKey(hasExistingVoiceKey);
    setShowVoiceKey(false);
    resetVoiceTest();
    setStep('connect');
  };

  const renderProviderStep = () => (
    <>
      <div>
        <h3 className="text-xl font-semibold text-foreground">Choose an AI provider</h3>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          Optional. Connect one now, or keep working and configure it later in Settings.
        </p>
      </div>
      {catalog.loading && !catalog.catalog ? (
        <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          Loading providers…
        </div>
      ) : catalog.error && !catalog.catalog ? (
        <Alert variant="destructive">
          <AlertTitle>Providers could not be loaded</AlertTitle>
          <AlertDescription>
            <p>{catalog.error}</p>
            <Button type="button" className="mt-3 min-h-11" onClick={catalog.reload}>
              <RefreshCw aria-hidden="true" /> Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="AI provider">
          {catalog.catalog?.providers.map((entry) => {
            const selected = selectedProvider === entry.provider;
            return (
              <button
                key={entry.provider}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setSelectedProvider(entry.provider)}
                className={`min-h-20 rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? 'border-primary bg-primary/10' : 'border-border bg-card hover:bg-accent'}`}
              >
                <span className="flex items-center gap-3">
                  <SessionProviderLogo provider={entry.provider} className="h-7 w-7" />
                  <span className="font-semibold text-foreground">{PROVIDER_LABELS[entry.provider]}</span>
                  {selected && <Check className="ml-auto h-5 w-5 text-primary" aria-hidden="true" />}
                </span>
                <span className="mt-2 block text-sm leading-5 text-muted-foreground">
                  {providerStatus(entry)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );

  const renderConnectStep = () => {
    if (!selectedProvider) return null;
    const tokenSupported = supportsProviderToken(selectedProvider);
    const loginCommand = getProviderLoginCommand({
      provider: selectedProvider,
      isAuthenticated: selectedEntry?.connectionAvailable === true,
    });
    return (
      <>
        <div>
          <h3 className="text-xl font-semibold text-foreground">
            Connect {PROVIDER_LABELS[selectedProvider]}
          </h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Credentials are provider-specific and separate from your local Desktop session.
          </p>
        </div>
        {tokenSupported && (
          <div className="grid grid-cols-2 rounded-xl border border-border bg-muted/30 p-1" role="tablist" aria-label="Connection method">
            {(['interactive', 'token'] as const).map((method) => (
              <button
                key={method}
                type="button"
                role="tab"
                aria-selected={connectMethod === method}
                onClick={() => {
                  setConnectMethod(method);
                  setHasProviderToken(false);
                  setShowToken(false);
                  setConnectError(null);
                }}
                className={`min-h-11 rounded-lg px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${connectMethod === method ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {method === 'interactive' ? 'Sign in' : 'Use token'}
              </button>
            ))}
          </div>
        )}

        {connectMethod === 'token' && tokenSupported ? (
          <div className="space-y-3 rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-primary" aria-hidden="true" />
              <p className="font-medium text-foreground">Encrypted provider profile</p>
            </div>
            <p className="text-sm text-muted-foreground">
              After verification this is stored in the existing encrypted profile vault as <strong className="text-foreground">Default Main</strong>.
            </p>
            <div className="block space-y-1">
              <label htmlFor="desktop-provider-token" className="text-sm font-medium text-foreground">Provider token</label>
              <span className="relative block">
                <input
                  id="desktop-provider-token"
                  ref={providerTokenRef}
                  type={showToken ? 'text' : 'password'}
                  autoComplete="off"
                  onChange={(event) => {
                    setHasProviderToken(Boolean(event.target.value.trim()));
                    setConnectError(null);
                  }}
                  className={`${fieldClass} pr-12`}
                  placeholder={selectedProvider === 'claude' ? 'Claude API or auth token' : 'OpenAI API key'}
                />
                <button
                  type="button"
                  onClick={() => setShowToken((value) => !value)}
                  className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={showToken ? 'Hide provider token' : 'Show provider token'}
                >
                  {showToken ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </span>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {!showTerminal ? (
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start gap-3">
                  <TerminalSquare className="mt-0.5 h-5 w-5 text-primary" aria-hidden="true" />
                  <div>
                    <p className="font-medium text-foreground">
                      {selectedEntry?.connectionAvailable ? 'Already connected' : 'Interactive sign-in'}
                    </p>
                    <p className="mt-1 text-sm leading-5 text-muted-foreground">
                      {selectedEntry?.connectionAvailable
                        ? 'Use the current CLI connection, or sign in again to change accounts.'
                        : 'A terminal opens inside this step and runs the provider’s normal login flow.'}
                    </p>
                    {selectedEntry?.connectionAvailable && (
                      <Button type="button" variant="outline" className="mt-3 min-h-11" onClick={() => setShowTerminal(true)}>
                        Sign in again
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-64 overflow-hidden rounded-xl border border-border bg-background">
                <StandaloneShell
                  key={`${selectedProvider}-${loginCommand}`}
                  project={DEFAULT_PROJECT_FOR_EMPTY_SHELL}
                  command={loginCommand}
                  onComplete={(exitCode) => {
                    if (exitCode === 0) void checkInteractiveConnection();
                  }}
                  minimal
                />
              </div>
            )}
          </div>
        )}
        {connectError && (
          <Alert variant="destructive">
            <AlertTitle>Connection not ready</AlertTitle>
            <AlertDescription>{connectError}</AlertDescription>
          </Alert>
        )}
      </>
    );
  };

  const renderVoiceStep = () => {
    const testStage = voiceTest.state === 'recording'
      ? 'Listening'
      : voiceTest.state === 'transcribing'
        ? 'Transcribing'
        : testResult
          ? 'Sample result'
          : null;
    return (
      <>
        <div>
          <h3 className="text-xl font-semibold text-foreground">Set up Soniox Voice</h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Optional. Your key is stored through Desktop’s existing secure Voice storage.
          </p>
        </div>
        {voiceLoading ? (
          <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            Loading secure Voice settings…
          </div>
        ) : (
          <div className="space-y-4">
            <div className="block space-y-1">
              <label htmlFor="desktop-soniox-api-key" className="text-sm font-medium text-foreground">Soniox API key</label>
              <span className="relative block">
                <input
                  id="desktop-soniox-api-key"
                  ref={voiceKeyInputRef}
                  type={showVoiceKey ? 'text' : 'password'}
                  autoComplete="off"
                  onChange={(event) => {
                    setHasVoiceKey(Boolean(event.target.value.trim()) || hasExistingVoiceKey);
                    resetVoiceTest();
                  }}
                  className={`${fieldClass} pr-12`}
                  placeholder={hasExistingVoiceKey ? 'Existing secure key will be kept' : 'Enter your Soniox API key'}
                />
                <button
                  type="button"
                  onClick={() => setShowVoiceKey((value) => !value)}
                  className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={showVoiceKey ? 'Hide Soniox key' : 'Show Soniox key'}
                >
                  {showVoiceKey ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1">
                <span className="text-sm font-medium text-foreground">Microphone</span>
                <select
                  value={micDeviceId}
                  onChange={(event) => {
                    setMicDeviceId(event.target.value);
                    resetVoiceTest();
                  }}
                  className={fieldClass}
                  disabled={!mic.supported || mic.status === 'missing'}
                >
                  <option value="">System default</option>
                  {mic.devices.map((device, index) => (
                    <option key={device.deviceId || index} value={device.deviceId}>
                      {device.label || `Microphone ${index + 1}`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-sm font-medium text-foreground">Language</span>
                <select
                  value={language}
                  onChange={(event) => {
                    setLanguage(event.target.value);
                    resetVoiceTest();
                  }}
                  className={fieldClass}
                >
                  {LANGUAGE_OPTIONS.map((option) => (
                    <option key={option.value || 'auto'} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            </div>
            {(mic.status === 'permission-required' || mic.status === 'permission-denied') && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
                <p className="text-sm text-muted-foreground">
                  {mic.status === 'permission-denied'
                    ? 'Microphone access is blocked. Allow it in system settings, then retry.'
                    : 'Allow microphone access to show device names and run the test.'}
                </p>
                <Button type="button" variant="outline" className="min-h-11" onClick={() => { void mic.requestPermission(); }}>
                  <Mic aria-hidden="true" /> Check permission
                </Button>
              </div>
            )}
            {mic.status === 'missing' && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
                <p className="text-sm text-muted-foreground">No microphone was found.</p>
                <Button type="button" variant="outline" className="min-h-11" onClick={mic.refresh}>
                  <RefreshCw aria-hidden="true" /> Refresh devices
                </Button>
              </div>
            )}
            <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
              <div>
                <p className="font-medium text-foreground">Test voice input</p>
                <p className="mt-1 text-sm text-muted-foreground">Record a short sample using this unpersisted draft.</p>
              </div>
              {testStage && (
                <div className="rounded-lg border border-border bg-background p-3" role="status" aria-live="polite">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    {voiceTest.state !== 'idle'
                      ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                      : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
                    {testStage}
                  </div>
                  {testResult && <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{testResult}</p>}
                </div>
              )}
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={startVoiceTest}
                disabled={voiceTest.state === 'transcribing' || !hasVoiceKey}
              >
                <Mic aria-hidden="true" />
                {voiceTest.state === 'recording'
                  ? 'Stop and transcribe'
                  : voiceTest.state === 'transcribing'
                    ? 'Transcribing…'
                    : 'Test voice input'}
              </Button>
            </div>
          </div>
        )}
        {voiceError && (
          <Alert variant="destructive">
            <AlertTitle>Voice setup needs attention</AlertTitle>
            <AlertDescription>{voiceError}</AlertDescription>
          </Alert>
        )}
      </>
    );
  };

  const renderSummaryStep = () => (
    <>
      <div>
        <h3 className="text-xl font-semibold text-foreground">You’re ready to work</h3>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          These choices remain editable in Settings at any time.
        </p>
      </div>
      <div className="space-y-3">
        <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
          <CheckCircle2 className="mt-0.5 h-5 w-5 text-primary" aria-hidden="true" />
          <div>
            <p className="font-medium text-foreground">Provider</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {providerOutcome.status === 'connected'
                ? `${PROVIDER_LABELS[providerOutcome.provider]} connected with ${providerOutcome.method === 'token' ? 'Default Main' : 'the local CLI'}.`
                : 'Skipped — choose a provider when you need one.'}
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
          <CheckCircle2 className="mt-0.5 h-5 w-5 text-primary" aria-hidden="true" />
          <div>
            <p className="font-medium text-foreground">Soniox Voice</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {voiceOutcome === 'ready'
                ? 'Ready — secure settings saved and a sample was transcribed.'
                : voiceOutcome === 'configured'
                  ? 'Configured — secure settings saved, but not tested.'
                  : 'Skipped — existing Voice settings were left unchanged.'}
            </p>
          </div>
        </div>
      </div>
    </>
  );

  const renderFooter = () => {
    if (step === 'provider') {
      return (
        <>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" className="min-h-11" onClick={() => { void dismiss(); }} disabled={dismissBusy}>Set up later</Button>
            {catalog.catalog && <Button type="button" variant="outline" className="min-h-11" onClick={skipProvider}>Skip provider</Button>}
          </div>
          {catalog.catalog && (
            <div className="text-right">
              <Button type="button" className="min-h-11" onClick={moveToConnect} disabled={!selectedProvider}>Continue</Button>
              {!selectedProvider && <p className="mt-1 text-xs text-muted-foreground">Choose a provider to continue.</p>}
            </div>
          )}
        </>
      );
    }
    if (step === 'connect') {
      const interactiveLabel = selectedEntry?.connectionAvailable && !showTerminal
        ? 'Use current connection'
        : showTerminal
          ? 'Check connection'
          : 'Start sign in';
      const primaryDisabled = connectBusy
        || (connectMethod === 'token' && !hasProviderToken);
      return (
        <>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="ghost"
              className="min-h-11"
              onClick={() => {
                setHasProviderToken(false);
                setShowToken(false);
                setStep('provider');
              }}
              disabled={connectBusy}
            >
              <ChevronLeft aria-hidden="true" /> Back
            </Button>
            <Button type="button" variant="outline" className="min-h-11" onClick={skipProvider} disabled={connectBusy}>Skip provider</Button>
          </div>
          <Button
            type="button"
            className="min-h-11"
            disabled={primaryDisabled}
            onClick={() => {
              if (connectMethod === 'token') {
                void verifyToken();
              } else if (!showTerminal && !selectedEntry?.connectionAvailable) {
                setShowTerminal(true);
              } else {
                void checkInteractiveConnection();
              }
            }}
          >
            {connectBusy && <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
            {connectMethod === 'token' ? 'Verify & connect' : interactiveLabel}
          </Button>
        </>
      );
    }
    if (step === 'voice') {
      return (
        <>
          <div className="flex flex-wrap gap-2">
            {selectedProvider && (
              <Button type="button" variant="ghost" className="min-h-11" onClick={returnToConnect} disabled={voiceSaving || voiceTest.state !== 'idle'}>
                <ChevronLeft aria-hidden="true" /> Back
              </Button>
            )}
            <Button type="button" variant="outline" className="min-h-11" onClick={skipVoice} disabled={voiceSaving || voiceTest.state !== 'idle'}>Skip Voice</Button>
          </div>
          <div className="text-right">
            <Button type="button" className="min-h-11" onClick={() => { void saveVoice(); }} disabled={voiceSaving || voiceLoading || voiceTest.state !== 'idle' || !hasVoiceKey}>
              {voiceSaving && <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
              Save and continue
            </Button>
            {!hasVoiceKey && !voiceLoading && <p className="mt-1 text-xs text-muted-foreground">Enter a key, or skip Voice.</p>}
          </div>
        </>
      );
    }
    return (
      <span className="ml-auto">
        <Button type="button" className="min-h-11" onClick={() => { void dismiss(); }} disabled={dismissBusy}>
          {dismissBusy && <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
          Start working
        </Button>
      </span>
    );
  };

  if (dismissed) return null;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) void dismiss(); }}>
      <DialogContent
        className="flex max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-3xl flex-col overflow-hidden p-0 sm:max-h-[min(760px,calc(100dvh-2rem))]"
        aria-labelledby="desktop-first-run-title"
        onPointerDownOutside={() => undefined}
      >
        <DialogTitle id="desktop-first-run-title">First-run setup</DialogTitle>
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-6">
          <div>
            <p className="text-sm font-semibold text-foreground">Quick setup</p>
            <p className="text-xs text-muted-foreground">Optional · about two minutes</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-11 w-11"
            onClick={() => { void dismiss(); }}
            disabled={dismissBusy}
            aria-label="Close setup"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </Button>
        </header>

        <ol className="grid grid-cols-4 gap-1 border-b border-border bg-muted/20 px-3 py-3 sm:px-6" aria-label="Setup progress">
          {DESKTOP_FIRST_RUN_STEPS.map((item, index) => {
            const current = item === step;
            const complete = index < stepIndex;
            return (
              <li key={item} aria-current={current ? 'step' : undefined} className="min-w-0 text-center">
                <span className={`mx-auto flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold ${current ? 'border-primary bg-primary text-primary-foreground' : complete ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background text-muted-foreground'}`}>
                  {complete ? <Check className="h-4 w-4" aria-hidden="true" /> : index + 1}
                </span>
                <span className={`mt-1 block truncate text-[10px] sm:text-xs ${current ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>{STEP_LABELS[item]}</span>
              </li>
            );
          })}
        </ol>

        <main className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-6">
          {step === 'provider' && renderProviderStep()}
          {step === 'connect' && renderConnectStep()}
          {step === 'voice' && renderVoiceStep()}
          {step === 'summary' && renderSummaryStep()}
          {dismissError && (
            <Alert variant="destructive">
              <AlertTitle>Could not close setup</AlertTitle>
              <AlertDescription>{dismissError}</AlertDescription>
            </Alert>
          )}
        </main>

        <footer className="flex flex-wrap items-start justify-between gap-3 border-t border-border bg-card px-4 py-3 sm:px-6">
          {renderFooter()}
        </footer>
      </DialogContent>
    </Dialog>
  );
}
