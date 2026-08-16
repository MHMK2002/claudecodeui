import { useCallback, useEffect, useRef, useState } from 'react';

import {
  DEFAULT_CODEX_CLEANUP_MODEL,
  DEFAULT_CLEANUP_GUIDANCE,
  normalizeCleanupInstructions,
  normalizeCleanupModel,
} from '../../shared/voice-cleanup-contract';

/**
 * Compact cleanup guidance sent with the transcript as the only Responses API
 * input. It can be edited in Voice Settings.
 */
export const DEFAULT_CLEANUP_PROMPT =
  DEFAULT_CLEANUP_GUIDANCE;
export { DEFAULT_CODEX_CLEANUP_MODEL };

export type VoiceSttProvider = 'openai' | 'soniox';

export type VoiceConfig = {
  baseUrl: string;
  apiKey: string;
  sttProvider: VoiceSttProvider;
  sttModel: string;
  /** Free-form context sent only to transcription providers that support it. */
  sttPrompt: string;
  /** Expected ISO language codes, capped at two to avoid over-biasing recognition. */
  sttLanguages: string[];
  /** Literal technical terms that the transcription provider should prefer. */
  sttTerms: string[];
  ttsModel: string;
  ttsVoice: string;
  ttsFormat: string;
  sonioxApiKey: string;
  cleanupEnabled: boolean;
  cleanupProviderProfileId: number | null;
  cleanupModel: string;
  cleanupPrompt: string;
  /**
   * Preferred microphone (MediaDeviceInfo.deviceId) for dictation. '' = system
   * default. Used client-side only, as a getUserMedia constraint in useVoiceInput;
   * not sent to the voice proxy.
   */
  micDeviceId: string;
};

const STORAGE_KEY = 'voiceConfig';
export const VOICE_CONFIG_SYNC_EVENT = 'voice-config:sync';
export type VoiceConfigSaveStatus = 'idle' | 'saving' | 'saved' | 'failed';
type VoiceSecrets = Pick<VoiceConfig, 'apiKey' | 'sonioxApiKey'>;
let secureSecrets: VoiceSecrets = { apiKey: '', sonioxApiKey: '' };
let voiceSecretsInitialization: Promise<boolean> | null = null;
const DEFAULTS: VoiceConfig = {
  baseUrl: '',
  apiKey: '',
  sttProvider: 'openai',
  sttModel: '',
  sttPrompt: '',
  sttLanguages: [],
  sttTerms: [],
  ttsModel: '',
  ttsVoice: '',
  ttsFormat: '',
  sonioxApiKey: '',
  cleanupEnabled: false,
  cleanupProviderProfileId: null,
  cleanupModel: DEFAULT_CODEX_CLEANUP_MODEL,
  cleanupPrompt: DEFAULT_CLEANUP_PROMPT,
  micDeviceId: '',
};

const STT_PROVIDERS: VoiceSttProvider[] = ['openai', 'soniox'];
const LANGUAGE_HINT_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/i;

export const VOICE_STT_PROMPT_MAX_CHARS = 4000;
export const VOICE_STT_LANGUAGE_MAX_ITEMS = 2;
export const VOICE_STT_TERM_MAX_ITEMS = 100;
export const VOICE_STT_TERM_MAX_CHARS = 128;

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function normalizeCleanupProviderProfileId(value: unknown): number | null {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d+$/.test(value.trim())
      ? Number(value)
      : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function readCleanupModel(value: unknown): string {
  const normalized = normalizeCleanupModel(value, DEFAULT_CODEX_CLEANUP_MODEL);
  return normalized === 'gpt-4o-mini' ? DEFAULT_CODEX_CLEANUP_MODEL : normalized;
}

export function normalizeSttPrompt(value: unknown): string {
  return readString(value).trim().slice(0, VOICE_STT_PROMPT_MAX_CHARS);
}

export function normalizeSttLanguages(value: unknown): string[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\s,]+/)
      : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of values) {
    if (typeof candidate !== 'string') continue;
    const normalized = candidate.trim().toLowerCase();
    if (!LANGUAGE_HINT_PATTERN.test(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= VOICE_STT_LANGUAGE_MAX_ITEMS) break;
  }
  return result;
}

export function normalizeSttTerms(value: unknown): string[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/\r?\n/)
      : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of values) {
    if (typeof candidate !== 'string') continue;
    const normalized = candidate.trim();
    if (
      !normalized ||
      normalized.length > VOICE_STT_TERM_MAX_CHARS ||
      /[<>\r\n]/.test(normalized) ||
      seen.has(normalized)
    ) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= VOICE_STT_TERM_MAX_ITEMS) break;
  }
  return result;
}

export function readVoiceConfig(): VoiceConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS, sttLanguages: [], sttTerms: [] };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ...DEFAULTS, sttLanguages: [], sttTerms: [] };
    }
    const src = parsed as Record<string, unknown>;
    const sttProvider =
      typeof src.sttProvider === 'string' && STT_PROVIDERS.includes(src.sttProvider as VoiceSttProvider)
        ? (src.sttProvider as VoiceSttProvider)
        : DEFAULTS.sttProvider;
    return {
      baseUrl: readString(src.baseUrl, DEFAULTS.baseUrl),
      apiKey: secureSecrets.apiKey || readString(src.apiKey, DEFAULTS.apiKey),
      sttProvider,
      sttModel: readString(src.sttModel, DEFAULTS.sttModel),
      sttPrompt: normalizeSttPrompt(src.sttPrompt),
      sttLanguages: normalizeSttLanguages(src.sttLanguages),
      sttTerms: normalizeSttTerms(src.sttTerms),
      ttsModel: readString(src.ttsModel, DEFAULTS.ttsModel),
      ttsVoice: readString(src.ttsVoice, DEFAULTS.ttsVoice),
      ttsFormat: readString(src.ttsFormat, DEFAULTS.ttsFormat),
      sonioxApiKey: secureSecrets.sonioxApiKey || readString(src.sonioxApiKey, DEFAULTS.sonioxApiKey),
      cleanupEnabled:
        typeof src.cleanupEnabled === 'boolean' ? src.cleanupEnabled : DEFAULTS.cleanupEnabled,
      cleanupProviderProfileId: normalizeCleanupProviderProfileId(src.cleanupProviderProfileId),
      cleanupModel: readCleanupModel(src.cleanupModel),
      cleanupPrompt: normalizeCleanupInstructions(src.cleanupPrompt, DEFAULTS.cleanupPrompt),
      micDeviceId: readString(src.micDeviceId, DEFAULTS.micDeviceId),
    };
  } catch {
    return { ...DEFAULTS, sttLanguages: [], sttTerms: [] };
  }
}

function readStoredVoiceRecord(): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function publicVoiceConfig(config: VoiceConfig): Omit<VoiceConfig, 'apiKey' | 'sonioxApiKey'> {
  const { apiKey: _apiKey, sonioxApiKey: _sonioxApiKey, ...publicConfig } = config;
  if (publicConfig.ttsFormat.trim()) publicConfig.ttsFormat = publicConfig.ttsFormat.trim();
  return publicConfig;
}

function writePublicVoiceConfig(config: VoiceConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(publicVoiceConfig(config)));
}

/**
 * Loads OS-encrypted Desktop Voice secrets and migrates legacy localStorage
 * values. Legacy fields are removed only after the bridge writes and reads
 * back the exact values successfully.
 */
export function initializeVoiceSecrets(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (voiceSecretsInitialization) return voiceSecretsInitialization;
  voiceSecretsInitialization = (async () => {
    const bridge = window.cloudcliDesktopVoiceSecrets;
    if (!bridge) return false;
    const legacyRecord = readStoredVoiceRecord();
    const legacySecrets: Partial<VoiceSecrets> = {};
    if (legacyRecord && typeof legacyRecord.apiKey === 'string' && legacyRecord.apiKey) {
      legacySecrets.apiKey = legacyRecord.apiKey;
    }
    if (legacyRecord && typeof legacyRecord.sonioxApiKey === 'string' && legacyRecord.sonioxApiKey) {
      legacySecrets.sonioxApiKey = legacyRecord.sonioxApiKey;
    }
    let readBack = await bridge.get();
    if (Object.keys(legacySecrets).length > 0) {
      await bridge.set(legacySecrets);
      readBack = await bridge.get();
      const verified = Object.entries(legacySecrets).every(
        ([key, value]) => readBack[key as keyof VoiceSecrets] === value,
      );
      if (!verified) throw new Error('Voice secret migration read-back failed.');
    }
    secureSecrets = { apiKey: readBack.apiKey || '', sonioxApiKey: readBack.sonioxApiKey || '' };
    const current = readVoiceConfig();
    writePublicVoiceConfig(current);
    window.dispatchEvent(new Event(VOICE_CONFIG_SYNC_EVENT));
    return true;
  })().catch((error) => {
    voiceSecretsInitialization = null;
    throw error;
  });
  return voiceSecretsInitialization;
}

async function persistVoiceConfig(config: VoiceConfig): Promise<void> {
  writePublicVoiceConfig(config);
  const secretsChanged = config.apiKey !== secureSecrets.apiKey
    || config.sonioxApiKey !== secureSecrets.sonioxApiKey;
  if (secretsChanged) {
    const bridge = window.cloudcliDesktopVoiceSecrets;
    if (!bridge) throw new Error('Secure Voice storage is available in Desktop only.');
    const readBack = await bridge.set({
      apiKey: config.apiKey,
      sonioxApiKey: config.sonioxApiKey,
    });
    if (readBack.apiKey !== config.apiKey || readBack.sonioxApiKey !== config.sonioxApiKey) {
      throw new Error('Secure Voice storage read-back failed.');
    }
    secureSecrets = readBack;
  }
  window.dispatchEvent(new Event(VOICE_CONFIG_SYNC_EVENT));
}

// Headers the voice proxy reads to target a per-user OpenAI-compatible backend.
// Empty fields are omitted so the server's env defaults apply. Soniox fields
// (sttProvider, sonioxApiKey) aren't included — that provider streams over the
// /voice-stream WebSocket relay instead, which resolves its own key.
export function voiceConfigHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const c = readVoiceConfig();
  const h: Record<string, string> = {};
  if (c.apiKey) h['x-voice-api-key'] = c.apiKey;
  if (c.sttModel) h['x-voice-stt-model'] = c.sttModel;
  if (c.ttsModel) h['x-voice-tts-model'] = c.ttsModel;
  if (c.ttsVoice) h['x-voice-tts-voice'] = c.ttsVoice;
  if (c.ttsFormat.trim()) h['x-voice-tts-format'] = c.ttsFormat.trim();
  return h;
}

export function useVoiceConfig() {
  const [config, setConfig] = useState<VoiceConfig>(() =>
    typeof window === 'undefined' ? { ...DEFAULTS, sttLanguages: [], sttTerms: [] } : readVoiceConfig(),
  );
  const [saveStatus, setSaveStatus] = useState<VoiceConfigSaveStatus>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const configRef = useRef(config);
  const saveSequenceRef = useRef(0);
  const persistenceQueueRef = useRef(Promise.resolve());

  useEffect(() => {
    const sync = () => {
      const next = readVoiceConfig();
      configRef.current = next;
      setConfig(next);
    };
    window.addEventListener(VOICE_CONFIG_SYNC_EVENT, sync);
    void initializeVoiceSecrets().then(sync).catch((error) => {
      setSaveStatus('failed');
      setSaveError(error instanceof Error ? error.message : 'Secure Voice storage failed to load.');
    });
    return () => window.removeEventListener(VOICE_CONFIG_SYNC_EVENT, sync);
  }, []);

  const saveSnapshot = useCallback((snapshot: VoiceConfig) => {
    const sequence = ++saveSequenceRef.current;
    setSaveStatus('saving');
    setSaveError(null);
    persistenceQueueRef.current = persistenceQueueRef.current
      .catch(() => undefined)
      .then(() => persistVoiceConfig(snapshot));
    void persistenceQueueRef.current.then(() => {
      if (saveSequenceRef.current !== sequence) return;
      setSaveStatus('saved');
    }).catch((error) => {
      if (saveSequenceRef.current !== sequence) return;
      setSaveStatus('failed');
      setSaveError(error instanceof Error ? error.message : 'Voice settings could not be saved.');
    });
  }, []);

  const update = useCallback((patch: Partial<VoiceConfig>) => {
      const next: VoiceConfig = {
        ...configRef.current,
        ...patch,
        ...(patch.sttPrompt !== undefined ? { sttPrompt: normalizeSttPrompt(patch.sttPrompt) } : {}),
        ...(patch.sttLanguages !== undefined
          ? { sttLanguages: normalizeSttLanguages(patch.sttLanguages) }
          : {}),
        ...(patch.sttTerms !== undefined ? { sttTerms: normalizeSttTerms(patch.sttTerms) } : {}),
        ...(patch.cleanupProviderProfileId !== undefined
          ? { cleanupProviderProfileId: normalizeCleanupProviderProfileId(patch.cleanupProviderProfileId) }
          : {}),
        ...(patch.cleanupModel !== undefined ? { cleanupModel: readCleanupModel(patch.cleanupModel) } : {}),
        ...(patch.cleanupPrompt !== undefined
          ? { cleanupPrompt: normalizeCleanupInstructions(patch.cleanupPrompt, DEFAULT_CLEANUP_PROMPT) }
          : {}),
      };
      configRef.current = next;
      setConfig(next);
      saveSnapshot(next);
  }, [saveSnapshot]);

  const retry = useCallback(() => saveSnapshot(configRef.current), [saveSnapshot]);

  return { config, update, saveStatus, saveError, retry };
}

/** Test-only reset for isolated migration and secure-persistence contracts. */
export function resetVoiceSecretStateForTests(): void {
  secureSecrets = { apiKey: '', sonioxApiKey: '' };
  voiceSecretsInitialization = null;
}
