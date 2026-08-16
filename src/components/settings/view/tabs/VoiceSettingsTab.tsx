import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import {
  AudioLines,
  BookOpenText,
  CheckCircle2,
  ChevronDown,
  Loader2,
  Mic,
  RefreshCw,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Volume2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { CLEANUP_INSTRUCTIONS_MAX_CHARS } from '../../../../../shared/voice-cleanup-contract';
import SettingsSection from '../SettingsSection';
import SettingsToggle from '../SettingsToggle';
import { useUiPreferences } from '../../../../hooks/useUiPreferences';
import {
  DEFAULT_CODEX_CLEANUP_MODEL,
  DEFAULT_CLEANUP_PROMPT,
  normalizeSttTerms,
  useVoiceConfig,
  VOICE_STT_PROMPT_MAX_CHARS,
} from '../../../../hooks/useVoiceConfig';
import { useAudioInputDevices } from '../../../../hooks/useAudioInputDevices';
import { useVoiceInput } from '../../../chat/hooks/useVoiceInput';
import type { CodexProviderProfilePublic, ProviderModelsDefinition } from '../../../../types/app';
import { authenticatedFetch } from '../../../../utils/api';
import { getTextDirection } from '../../../../utils/textDirection';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../../../shared/view/ui';

const inputClass =
  'min-h-11 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const LANGUAGE_OPTIONS = [
  { value: '', label: 'Auto-detect' },
  { value: 'en', label: 'English' },
  { value: 'fa', label: 'Persian' },
  { value: 'de', label: 'German' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'it', label: 'Italian' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'tr', label: 'Turkish' },
  { value: 'zh', label: 'Chinese' },
];

function Field({ label, value, dir, ...props }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  const resolvedDir = dir ?? (value != null ? getTextDirection(value) : undefined);
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <input className={inputClass} dir={resolvedDir} value={value} {...props} />
    </label>
  );
}

function Area({ label, value, dir, ...props }: { label: string } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const resolvedDir = dir ?? (value != null ? getTextDirection(value) : undefined);
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <textarea
        className={`${inputClass} min-h-[96px] resize-y font-normal leading-relaxed`}
        dir={resolvedDir}
        value={value}
        {...props}
      />
    </label>
  );
}

type CodexProfilesResponse = {
  success?: boolean;
  data?: { profiles?: CodexProviderProfilePublic[] };
};

type CodexModelsResponse = {
  success?: boolean;
  data?: { models?: ProviderModelsDefinition };
};

async function readJsonResponse<T>(response: Response, label: string): Promise<T> {
  if (!response.ok) throw new Error(`${label} failed (${response.status}).`);
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error(`${label} returned an unexpected response.`);
  }
  return response.json() as Promise<T>;
}

function ToggleRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-4 rounded-lg border border-border p-3">
      <div>
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className="text-sm text-muted-foreground">{description}</div>
      </div>
      <SettingsToggle checked={checked} onChange={onChange} ariaLabel={title} />
    </div>
  );
}

function AdvancedGroup({
  id,
  title,
  description,
  status,
  icon,
  children,
}: {
  id: string;
  title: string;
  description: string;
  status: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  const headingId = `${id}-heading`;

  return (
    <section
      aria-labelledby={headingId}
      className="overflow-hidden rounded-xl border border-border bg-card shadow-sm"
    >
      <div className="flex items-start justify-between gap-4 border-b border-border bg-muted/30 p-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-foreground">
            {icon}
          </span>
          <div className="min-w-0">
            <h4 id={headingId} className="text-sm font-semibold text-foreground">{title}</h4>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">{description}</p>
          </div>
        </div>
        <span className="shrink-0 rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground">
          {status}
        </span>
      </div>
      <div className="space-y-5 p-4">{children}</div>
    </section>
  );
}

export default function VoiceSettingsTab() {
  const { t } = useTranslation('settings');
  const { preferences, setPreference } = useUiPreferences();
  const { config, update, saveStatus, saveError, retry } = useVoiceConfig();
  const mic = useAudioInputDevices();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [promptDraft, setPromptDraft] = useState(config.sttPrompt);
  const [termsDraft, setTermsDraft] = useState(() => config.sttTerms.join('\n'));
  const [cleanupProfiles, setCleanupProfiles] = useState<CodexProviderProfilePublic[]>([]);
  const [cleanupProfilesLoaded, setCleanupProfilesLoaded] = useState(false);
  const [cleanupProfilesLoading, setCleanupProfilesLoading] = useState(false);
  const [cleanupProfilesError, setCleanupProfilesError] = useState<string | null>(null);
  const [cleanupModels, setCleanupModels] = useState<ProviderModelsDefinition | null>(null);
  const [cleanupModelsLoaded, setCleanupModelsLoaded] = useState(false);
  const [cleanupModelsLoading, setCleanupModelsLoading] = useState(false);
  const [cleanupModelsError, setCleanupModelsError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const onTestTranscript = useCallback((text: string) => {
    setTestError(null);
    setTestResult(text);
  }, []);
  const onTestError = useCallback((message: string) => {
    setTestResult(null);
    setTestError(message);
  }, []);
  const voiceTest = useVoiceInput(onTestTranscript, onTestError);

  const savedMicMissing =
    !!config.micDeviceId && !mic.devices.some((device) => device.deviceId === config.micDeviceId);
  const selectedLanguage = config.sttLanguages[0] ?? '';
  const knownLanguage = LANGUAGE_OPTIONS.some((option) => option.value === selectedLanguage);
  const testStage = voiceTest.state === 'recording'
    ? 'Listening'
    : voiceTest.state === 'transcribing'
      ? 'Transcribing'
      : testResult
        ? 'Sample result'
        : null;

  useEffect(() => {
    setPromptDraft(config.sttPrompt);
  }, [config.sttPrompt]);

  useEffect(() => {
    setTermsDraft(config.sttTerms.join('\n'));
  }, [config.sttTerms]);

  const loadCleanupProfiles = useCallback(async () => {
    setCleanupProfilesLoading(true);
    setCleanupProfilesError(null);
    try {
      const response = await authenticatedFetch('/api/providers/codex/profiles');
      const body = await readJsonResponse<CodexProfilesResponse>(response, 'Cleanup profiles');
      if (!body.success) throw new Error('Cleanup profiles are unavailable.');
      setCleanupProfiles((body.data?.profiles ?? []).filter((profile) => profile.isActive));
      setCleanupProfilesLoaded(true);
    } catch (error) {
      setCleanupProfilesError(error instanceof Error ? error.message : 'Cleanup profiles could not be loaded.');
    } finally {
      setCleanupProfilesLoading(false);
    }
  }, []);

  const loadCleanupModels = useCallback(async () => {
    setCleanupModelsLoading(true);
    setCleanupModelsError(null);
    try {
      const response = await authenticatedFetch('/api/providers/codex/models');
      const body = await readJsonResponse<CodexModelsResponse>(response, 'Cleanup models');
      if (!body.success || !body.data?.models) throw new Error('Cleanup models are unavailable.');
      setCleanupModels(body.data.models);
      setCleanupModelsLoaded(true);
    } catch (error) {
      setCleanupModelsError(error instanceof Error ? error.message : 'Cleanup models could not be loaded.');
    } finally {
      setCleanupModelsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!advancedOpen) return;
    if (!cleanupProfilesLoaded && !cleanupProfilesLoading && !cleanupProfilesError) {
      void loadCleanupProfiles();
    }
    if (!cleanupModelsLoaded && !cleanupModelsLoading && !cleanupModelsError) {
      void loadCleanupModels();
    }
  }, [
    advancedOpen,
    cleanupModelsLoaded,
    cleanupModelsLoading,
    cleanupModelsError,
    cleanupProfilesLoaded,
    cleanupProfilesLoading,
    cleanupProfilesError,
    loadCleanupModels,
    loadCleanupProfiles,
  ]);

  useEffect(() => {
    if (!advancedOpen) return undefined;
    const handleProfilesUpdated = () => {
      void loadCleanupProfiles();
    };
    window.addEventListener('codex-provider-profiles-updated', handleProfilesUpdated);
    return () => window.removeEventListener('codex-provider-profiles-updated', handleProfilesUpdated);
  }, [advancedOpen, loadCleanupProfiles]);

  useEffect(() => {
    if (!cleanupProfilesLoaded || cleanupProfilesLoading) return;
    const selectedProfileIsValid = config.cleanupProviderProfileId !== null
      && cleanupProfiles.some((profile) => profile.id === config.cleanupProviderProfileId);
    if (selectedProfileIsValid) return;

    const fallbackProfile = cleanupProfiles.find((profile) => profile.isDefault) ?? cleanupProfiles[0];
    const fallbackProfileId = fallbackProfile?.id ?? null;
    if (fallbackProfileId !== config.cleanupProviderProfileId) {
      update({ cleanupProviderProfileId: fallbackProfileId });
    }
  }, [
    cleanupProfiles,
    cleanupProfilesLoaded,
    cleanupProfilesLoading,
    config.cleanupProviderProfileId,
    update,
  ]);

  useEffect(() => {
    if (
      !cleanupModelsLoaded
      || cleanupModelsLoading
      || !cleanupModels
      || cleanupModels.OPTIONS.some((option) => option.value === config.cleanupModel)
    ) {
      return;
    }
    const fallback = cleanupModels.OPTIONS.find(
      (option) => option.value === DEFAULT_CODEX_CLEANUP_MODEL,
    )?.value ?? cleanupModels.OPTIONS.find(
      (option) => option.value === cleanupModels.DEFAULT,
    )?.value ?? cleanupModels.OPTIONS[0]?.value;
    if (fallback) update({ cleanupModel: fallback });
  }, [cleanupModels, cleanupModelsLoaded, cleanupModelsLoading, config.cleanupModel, update]);

  const microphoneStatus = useMemo(() => {
    switch (mic.status) {
      case 'checking':
        return 'Checking microphone access…';
      case 'ready':
        return 'Microphone access is ready.';
      case 'permission-required':
        return 'Allow access to identify and test available microphones.';
      case 'permission-denied':
        return 'Microphone access is blocked. Allow it in system or browser settings, then check again.';
      case 'missing':
        return 'No microphone was found. Connect one, then refresh devices.';
      case 'unsupported':
        return 'Microphone selection is not supported in this browser.';
      default:
        return mic.error ?? 'Microphone devices could not be checked.';
    }
  }, [mic.error, mic.status]);

  const startOrStopTest = () => {
    if (voiceTest.state === 'recording') {
      voiceTest.stop();
      return;
    }
    setTestResult(null);
    setTestError(null);
    void voiceTest.start();
  };

  return (
    <div className="space-y-8">
      <div className="flex min-h-6 items-center justify-end" aria-live="polite">
        {saveStatus === 'saving' && (
          <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Saving
          </span>
        )}
        {saveStatus === 'saved' && (
          <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Saved
          </span>
        )}
        {saveStatus === 'failed' && (
          <span className="inline-flex flex-wrap items-center justify-end gap-2 text-sm text-destructive">
            Failed to save{saveError ? `: ${saveError}` : '.'}
            <Button type="button" variant="link" size="sm" onClick={retry} className="h-auto p-0 text-destructive">
              Retry
            </Button>
          </span>
        )}
      </div>

      <SettingsSection
        title={t('voiceSettings.title')}
        description={t('voiceSettings.description')}
      >
        <div className="space-y-4">
          <ToggleRow
            title={t('voiceSettings.enable')}
            description={t('voiceSettings.enableDescription')}
            checked={preferences.voiceEnabled}
            onChange={(value) => setPreference('voiceEnabled', value)}
          />

          <div className="space-y-3 rounded-lg border border-border p-3">
            <label className="block space-y-1">
              <span className="text-sm font-medium text-foreground">
                {t('voiceSettings.microphoneTitle', { defaultValue: 'Microphone' })}
              </span>
              <select
                className={inputClass}
                value={config.micDeviceId}
                disabled={!mic.supported || mic.status === 'missing'}
                onChange={(event) => update({ micDeviceId: event.target.value })}
              >
                <option value="">{t('voiceSettings.micDefault', { defaultValue: 'System default' })}</option>
                {mic.devices.map((device, index) => (
                  <option key={device.deviceId || index} value={device.deviceId}>
                    {device.label || `Microphone ${index + 1}`}
                  </option>
                ))}
                {savedMicMissing && (
                  <option value={config.micDeviceId}>
                    {t('voiceSettings.micUnavailable', { defaultValue: 'Saved microphone (unavailable)' })}
                  </option>
                )}
              </select>
            </label>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground" role="status">{microphoneStatus}</p>
              {(mic.status === 'permission-required' || mic.status === 'permission-denied') && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => { void mic.requestPermission(); }}
                >
                  <Mic aria-hidden="true" /> Check microphone permission
                </Button>
              )}
              {(mic.status === 'missing' || mic.status === 'error') && (
                <Button type="button" variant="outline" size="sm" onClick={mic.refresh}>
                  <RefreshCw aria-hidden="true" /> Refresh devices
                </Button>
              )}
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <ToggleRow
              title={t('voiceSettings.holdToTalk', { defaultValue: 'Hold-to-talk' })}
              description={t('voiceSettings.holdToTalkHint')}
              checked={preferences.voiceHoldToTalk}
              onChange={(value) => setPreference('voiceHoldToTalk', value)}
            />
            <ToggleRow
              title={t('voiceSettings.readAloud', { defaultValue: 'Read aloud' })}
              description={t('voiceSettings.readAloudDescription', {
                defaultValue: 'Show speech controls on assistant messages.',
              })}
              checked={preferences.voiceReadAloud}
              onChange={(value) => setPreference('voiceReadAloud', value)}
            />
          </div>

          <label className="block space-y-1">
            <span className="text-sm font-medium text-foreground">
              {t('voiceSettings.language', { defaultValue: 'Dictation language' })}
            </span>
            <select
              className={inputClass}
              value={selectedLanguage}
              onChange={(event) => update({ sttLanguages: event.target.value ? [event.target.value] : [] })}
            >
              {!knownLanguage && <option value={selectedLanguage}>{selectedLanguage}</option>}
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value || 'auto'} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
            <div>
              <h4 className="text-sm font-semibold text-foreground">Test voice input</h4>
              <p className="text-sm text-muted-foreground">
                Record a short sample to verify the microphone and transcription provider.
              </p>
            </div>
            {testStage && (
              <div className="rounded-md border border-border bg-background p-3" role="status" aria-live="polite">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  {voiceTest.state !== 'idle'
                    ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
                  {testStage}
                </div>
                {testResult && <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{testResult}</p>}
              </div>
            )}
            {testError && (
              <Alert variant="destructive">
                <ShieldAlert aria-hidden="true" />
                <AlertTitle>Voice test failed</AlertTitle>
                <AlertDescription>{testError}</AlertDescription>
              </Alert>
            )}
            <Button
              type="button"
              onClick={startOrStopTest}
              disabled={voiceTest.state === 'transcribing'}
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
      </SettingsSection>

      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger
          className={`group flex min-h-16 w-full items-center justify-between gap-4 rounded-xl border border-border p-4 text-left text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${advancedOpen ? 'bg-accent/40' : 'bg-card'}`}
        >
          <span className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background">
              <SlidersHorizontal className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">Advanced voice</span>
              <span className="mt-0.5 block text-sm font-normal text-muted-foreground">
                Providers, recognition context, output, and transcript cleanup
              </span>
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <span className="hidden text-xs font-medium text-muted-foreground sm:inline">
              {advancedOpen ? 'Hide settings' : 'Configure'}
            </span>
            <ChevronDown
              className={`h-4 w-4 transition-transform ${advancedOpen ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {advancedOpen ? (
            <div
              role="region"
              aria-label="Advanced voice settings"
              className="space-y-4 pt-4"
            >
              <div className="flex flex-col gap-2 rounded-xl border border-border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-foreground">Tune only what your voice workflow needs</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Provider-specific fields stay hidden until they apply.
                  </p>
                </div>
                <span className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  Changes save automatically
                </span>
              </div>

              <AdvancedGroup
                id="voice-stt"
                title="Speech-to-text"
                description="Choose the service that turns microphone audio into a draft."
                status={config.sttProvider === 'openai' ? 'OpenAI-compatible' : 'Soniox'}
                icon={<AudioLines className="h-5 w-5" aria-hidden="true" />}
              >
                <label className="block space-y-1">
                  <span className="text-sm font-medium text-foreground">{t('voiceSettings.sttProvider')}</span>
                  <select
                    className={inputClass}
                    value={config.sttProvider}
                    onChange={(event) => update({ sttProvider: event.target.value as 'openai' | 'soniox' })}
                  >
                    <option value="openai">{t('voiceSettings.sttProviderOpenai')}</option>
                    <option value="soniox">Soniox</option>
                  </select>
                </label>

                {config.sttProvider === 'openai' ? (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field
                        label={t('voiceSettings.baseUrl')}
                        placeholder="https://api.openai.com/v1"
                        value={config.baseUrl}
                        onChange={(event) => update({ baseUrl: event.target.value })}
                      />
                      <Field
                        label={t('voiceSettings.apiKey')}
                        type="password"
                        autoComplete="off"
                        placeholder="sk-…"
                        value={config.apiKey}
                        onChange={(event) => update({ apiKey: event.target.value })}
                      />
                    </div>
                    <div className="max-w-sm">
                      <Field
                        label={t('voiceSettings.sttModel')}
                        placeholder="whisper-1"
                        value={config.sttModel}
                        onChange={(event) => update({ sttModel: event.target.value })}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <Field
                      label="Soniox API key"
                      type="password"
                      autoComplete="off"
                      placeholder="soniox-…"
                      value={config.sonioxApiKey}
                      onChange={(event) => update({ sonioxApiKey: event.target.value })}
                    />
                    <p className="text-sm text-muted-foreground">
                      Soniox receives live audio for transcription. OpenAI-only transcription fields are hidden.
                    </p>
                  </>
                )}
              </AdvancedGroup>

              <AdvancedGroup
                id="voice-context"
                title="Recognition context"
                description="Help transcription recognize your language, project vocabulary, and command-line terms."
                status={config.sttProvider === 'openai' ? 'Prompt + terms' : 'Terms'}
                icon={<BookOpenText className="h-5 w-5" aria-hidden="true" />}
              >
                <div className={`grid gap-4 ${config.sttProvider === 'openai' ? 'md:grid-cols-2' : ''}`}>
                  {config.sttProvider === 'openai' && (
                    <Area
                      label={t('voiceSettings.contextPrompt')}
                      maxLength={VOICE_STT_PROMPT_MAX_CHARS}
                      placeholder={t('voiceSettings.contextPromptPlaceholder')}
                      value={promptDraft}
                      onChange={(event) => setPromptDraft(event.target.value)}
                      onBlur={() => update({ sttPrompt: promptDraft })}
                    />
                  )}
                  <Area
                    label={t('voiceSettings.contextTerms')}
                    placeholder={'useVoiceInput\ngpt-transcribe\n--force'}
                    value={termsDraft}
                    onChange={(event) => setTermsDraft(event.target.value)}
                    onBlur={() => update({ sttTerms: normalizeSttTerms(termsDraft) })}
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  Keep hints short and specific. They are sent only to the active transcription provider.
                </p>
              </AdvancedGroup>

              {preferences.voiceReadAloud && (
                <AdvancedGroup
                  id="voice-output"
                  title="Read aloud output"
                description={t('voiceSettings.readAloudAdvancedDescription', {
                  defaultValue: 'Configure the OpenAI-compatible text-to-speech backend.',
                })}
                  status="Enabled"
                  icon={<Volume2 className="h-5 w-5" aria-hidden="true" />}
                >
                  {config.sttProvider === 'soniox' && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field
                        label={t('voiceSettings.baseUrl')}
                        placeholder="https://api.openai.com/v1"
                        value={config.baseUrl}
                        onChange={(event) => update({ baseUrl: event.target.value })}
                      />
                      <Field
                        label={t('voiceSettings.apiKey')}
                        type="password"
                        autoComplete="off"
                        placeholder="sk-…"
                        value={config.apiKey}
                        onChange={(event) => update({ apiKey: event.target.value })}
                      />
                    </div>
                  )}
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field
                      label={t('voiceSettings.ttsModel')}
                      placeholder="tts-1"
                      value={config.ttsModel}
                      onChange={(event) => update({ ttsModel: event.target.value })}
                    />
                    <Field
                      label={t('voiceSettings.voice')}
                      placeholder="alloy"
                      value={config.ttsVoice}
                      onChange={(event) => update({ ttsVoice: event.target.value })}
                    />
                    <Field
                      label={t('voiceSettings.format')}
                      placeholder="mp3"
                      value={config.ttsFormat}
                      onChange={(event) => update({ ttsFormat: event.target.value })}
                    />
                  </div>
                </AdvancedGroup>
              )}

              <AdvancedGroup
                id="voice-cleanup"
                title={t('voiceSettings.cleanupTitle')}
                description={t('voiceSettings.cleanupDescription')}
                status={config.cleanupEnabled ? 'Enabled' : 'Off'}
                icon={<Sparkles className="h-5 w-5" aria-hidden="true" />}
              >
                <ToggleRow
                  title={t('voiceSettings.cleanupEnable')}
                  description={t('voiceSettings.cleanupEnableDescription')}
                  checked={config.cleanupEnabled}
                  onChange={(value) => update({ cleanupEnabled: value })}
                />

                {(cleanupProfilesError || cleanupModelsError) && (
                  <Alert variant="destructive">
                    <ShieldAlert aria-hidden="true" />
                    <AlertTitle>Cleanup catalog unavailable</AlertTitle>
                    <AlertDescription>
                      <p>{[cleanupProfilesError, cleanupModelsError].filter(Boolean).join(' ')}</p>
                      <div className="flex flex-wrap gap-2 pt-1">
                        {cleanupProfilesError && (
                          <Button type="button" variant="outline" size="sm" onClick={() => { void loadCleanupProfiles(); }}>
                            Retry profiles
                          </Button>
                        )}
                        {cleanupModelsError && (
                          <Button type="button" variant="outline" size="sm" onClick={() => { void loadCleanupModels(); }}>
                            Retry models
                          </Button>
                        )}
                      </div>
                    </AlertDescription>
                  </Alert>
                )}

                {config.cleanupEnabled && (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="block space-y-1">
                        <span className="text-sm font-medium text-foreground">{t('voiceSettings.cleanupProvider')}</span>
                        <select
                          className={inputClass}
                          value={config.cleanupProviderProfileId === null ? '' : String(config.cleanupProviderProfileId)}
                          disabled={cleanupProfilesLoading || Boolean(cleanupProfilesError)}
                          onChange={(event) => update({
                            cleanupProviderProfileId: event.target.value === '' ? null : Number(event.target.value),
                          })}
                        >
                          {(cleanupProfilesLoading || cleanupProfiles.length === 0) && <option value="">—</option>}
                          {cleanupProfiles.map((profile) => (
                            <option key={profile.id} value={profile.id}>{profile.title}</option>
                          ))}
                        </select>
                      </label>
                      <label className="block space-y-1">
                        <span className="text-sm font-medium text-foreground">{t('voiceSettings.cleanupModel')}</span>
                        <select
                          className={inputClass}
                          value={config.cleanupModel}
                          disabled={cleanupModelsLoading || Boolean(cleanupModelsError) || cleanupModels?.OPTIONS.length === 0}
                          onChange={(event) => update({ cleanupModel: event.target.value })}
                        >
                          {!cleanupModels && <option value={config.cleanupModel}>{config.cleanupModel}</option>}
                          {cleanupModels?.OPTIONS.map((model) => (
                            <option key={model.value} value={model.value}>{model.label}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <Area
                      label={t('voiceSettings.cleanupPrompt')}
                      maxLength={CLEANUP_INSTRUCTIONS_MAX_CHARS}
                      placeholder={DEFAULT_CLEANUP_PROMPT}
                      value={config.cleanupPrompt}
                      onChange={(event) => update({ cleanupPrompt: event.target.value })}
                    />
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto p-0"
                      onClick={() => update({ cleanupPrompt: DEFAULT_CLEANUP_PROMPT })}
                    >
                      {t('voiceSettings.cleanupReset')}
                    </Button>
                  </>
                )}
              </AdvancedGroup>
            </div>
          ) : null}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
