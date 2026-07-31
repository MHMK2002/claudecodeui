import { useState } from 'react';

/**
 * Default system prompt for the transcript cleanup step. Lightly polishes the
 * STT output (punctuation, filler words, obvious errors) without changing
 * meaning or language. Exposed so the settings UI can pre-fill the textarea and
 * the client fallback can use it when the user clears the field.
 */
export const DEFAULT_CLEANUP_PROMPT =
  'Lightly clean up the transcribed speech. Fix punctuation and capitalization, remove filler words and false starts (um, uh, repeats), and fix obvious recognition errors. Preserve the original language and meaning. Do not translate, expand, or rewrite the content. Output only the cleaned text with no commentary.';

export type VoiceSttProvider = 'openai' | 'soniox';

export type VoiceConfig = {
  baseUrl: string;
  apiKey: string;
  sttProvider: VoiceSttProvider;
  sttModel: string;
  ttsModel: string;
  ttsVoice: string;
  ttsFormat: string;
  sonioxApiKey: string;
  cleanupEnabled: boolean;
  cleanupModel: string;
  cleanupPrompt: string;
};

const STORAGE_KEY = 'voiceConfig';
export const VOICE_CONFIG_SYNC_EVENT = 'voice-config:sync';
const DEFAULTS: VoiceConfig = {
  baseUrl: '',
  apiKey: '',
  sttProvider: 'openai',
  sttModel: '',
  ttsModel: '',
  ttsVoice: '',
  ttsFormat: '',
  sonioxApiKey: '',
  cleanupEnabled: false,
  cleanupModel: 'gpt-4o-mini',
  cleanupPrompt: DEFAULT_CLEANUP_PROMPT,
};

const STT_PROVIDERS: VoiceSttProvider[] = ['openai', 'soniox'];

export function readVoiceConfig(): VoiceConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...DEFAULTS };
    const config = { ...DEFAULTS } as Record<keyof VoiceConfig, string | boolean>;
    const src = parsed as Record<string, unknown>;
    for (const key of Object.keys(DEFAULTS) as (keyof VoiceConfig)[]) {
      const def = DEFAULTS[key];
      const v = src[key as string];
      if (typeof def === 'boolean') {
        if (typeof v === 'boolean') config[key] = v;
      } else if (key === 'sttProvider') {
        if (typeof v === 'string' && STT_PROVIDERS.includes(v as VoiceSttProvider)) {
          config[key] = v as VoiceSttProvider;
        }
      } else if (typeof v === 'string') {
        config[key] = v;
      }
    }
    return config as VoiceConfig;
  } catch {
    return { ...DEFAULTS };
  }
}

// Headers the voice proxy reads to target a per-user OpenAI-compatible backend.
// Empty fields are omitted so the server's env defaults apply.
export function voiceConfigHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const c = readVoiceConfig();
  const h: Record<string, string> = {};
  if (c.apiKey) h['x-voice-api-key'] = c.apiKey;
  if (c.sttModel) h['x-voice-stt-model'] = c.sttModel;
  if (c.ttsModel) h['x-voice-tts-model'] = c.ttsModel;
  if (c.ttsVoice) h['x-voice-tts-voice'] = c.ttsVoice;
  if (c.ttsFormat.trim()) h['x-voice-tts-format'] = c.ttsFormat.trim();
  if (c.sttProvider !== 'openai') h['x-voice-stt-provider'] = c.sttProvider;
  if (c.sonioxApiKey) h['x-soniox-api-key'] = c.sonioxApiKey;
  if (c.cleanupEnabled) {
    h['x-voice-cleanup'] = '1';
    if (c.cleanupModel.trim()) h['x-voice-cleanup-model'] = c.cleanupModel.trim();
    if (c.cleanupPrompt.trim()) h['x-voice-cleanup-prompt'] = c.cleanupPrompt;
  }
  return h;
}

export function useVoiceConfig() {
  const [config, setConfig] = useState<VoiceConfig>(() =>
    typeof window === 'undefined' ? { ...DEFAULTS } : readVoiceConfig(),
  );

  const update = (patch: Partial<VoiceConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...patch };
      try {
        const stored: Partial<VoiceConfig> = { ...next };
        if (next.ttsFormat.trim()) stored.ttsFormat = next.ttsFormat.trim();
        else delete stored.ttsFormat;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
        window.dispatchEvent(new Event(VOICE_CONFIG_SYNC_EVENT));
      } catch {
        /* ignore persistence errors */
      }
      return next;
    });
  };

  return { config, update };
}
