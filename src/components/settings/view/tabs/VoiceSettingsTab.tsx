import { useEffect, useState, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';

import SettingsSection from '../SettingsSection';
import SettingsToggle from '../SettingsToggle';
import { useUiPreferences } from '../../../../hooks/useUiPreferences';
import {
  DEFAULT_CLEANUP_PROMPT,
  normalizeSttLanguages,
  normalizeSttTerms,
  useVoiceConfig,
  VOICE_STT_PROMPT_MAX_CHARS,
} from '../../../../hooks/useVoiceConfig';
import { useAudioInputDevices } from '../../../../hooks/useAudioInputDevices';

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring';

function Field({ label, ...props }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <input className={inputClass} {...props} />
    </label>
  );
}

function Area({ label, ...props }: { label: string } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <textarea className={`${inputClass} min-h-[96px] resize-y font-normal leading-relaxed`} {...props} />
    </label>
  );
}

export default function VoiceSettingsTab() {
  const { t } = useTranslation('settings');
  const { preferences, setPreference } = useUiPreferences();
  const { config, update } = useVoiceConfig();
  const mic = useAudioInputDevices();
  const [promptDraft, setPromptDraft] = useState(config.sttPrompt);
  const [languageHintsDraft, setLanguageHintsDraft] = useState(() => config.sttLanguages.join(', '));
  const [termsDraft, setTermsDraft] = useState(() => config.sttTerms.join('\n'));
  const voiceEnabled = preferences.voiceEnabled;
  const savedMicMissing =
    !!config.micDeviceId && !mic.devices.some((device) => device.deviceId === config.micDeviceId);

  useEffect(() => {
    setPromptDraft(config.sttPrompt);
  }, [config.sttPrompt]);

  useEffect(() => {
    setLanguageHintsDraft(config.sttLanguages.join(', '));
  }, [config.sttLanguages]);

  useEffect(() => {
    setTermsDraft(config.sttTerms.join('\n'));
  }, [config.sttTerms]);

  return (
    <div className="space-y-8">
      <SettingsSection title={t('voiceSettings.title')} description={t('voiceSettings.description')}>
        <div className="flex items-center justify-between rounded-lg border border-border p-3">
          <div className="pr-3">
            <div className="text-sm font-medium text-foreground">{t('voiceSettings.enable')}</div>
            <div className="text-xs text-muted-foreground">{t('voiceSettings.enableDescription')}</div>
          </div>
          <SettingsToggle
            checked={voiceEnabled}
            onChange={(v) => setPreference('voiceEnabled', v)}
            ariaLabel={t('voiceSettings.enable')}
          />
        </div>
      </SettingsSection>

      {voiceEnabled && (
        <>
        <SettingsSection title={t('voiceSettings.backendTitle')} description={t('voiceSettings.backendDescription')}>
          <div className="space-y-4">
            <label className="block space-y-1">
              <span className="text-sm font-medium text-foreground">{t('voiceSettings.sttProvider')}</span>
              <select
                className={inputClass}
                value={config.sttProvider}
                onChange={(e) => update({ sttProvider: e.target.value as 'openai' | 'soniox' })}
              >
                <option value="openai">{t('voiceSettings.sttProviderOpenai')}</option>
                <option value="soniox">{t('voiceSettings.sttProviderSonix')}</option>
              </select>
            </label>

            {config.sttProvider === 'soniox' && (
              <>
                <Field
                  label={t('voiceSettings.sonixApiKey')}
                  type="password"
                  autoComplete="off"
                  placeholder="soniox-…"
                  value={config.sonioxApiKey}
                  onChange={(e) => update({ sonioxApiKey: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">{t('voiceSettings.sonixNote')}</p>
              </>
            )}

            <Field
              label={t('voiceSettings.baseUrl')}
              placeholder="https://api.openai.com/v1"
              value={config.baseUrl}
              onChange={(e) => update({ baseUrl: e.target.value })}
            />
            <Field
              label={t('voiceSettings.apiKey')}
              type="password"
              autoComplete="off"
              placeholder="sk-…"
              value={config.apiKey}
              onChange={(e) => update({ apiKey: e.target.value })}
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
              <Field
                label={t('voiceSettings.sttModel')}
                placeholder="whisper-1"
                value={config.sttModel}
                onChange={(e) => update({ sttModel: e.target.value })}
              />
              <Field
                label={t('voiceSettings.ttsModel')}
                placeholder="tts-1"
                value={config.ttsModel}
                onChange={(e) => update({ ttsModel: e.target.value })}
              />
              <Field
                label={t('voiceSettings.voice')}
                placeholder="alloy"
                value={config.ttsVoice}
                onChange={(e) => update({ ttsVoice: e.target.value })}
              />
              <Field
                label={t('voiceSettings.format')}
                placeholder="mp3"
                value={config.ttsFormat}
                onChange={(e) => update({ ttsFormat: e.target.value })}
              />
            </div>
            <p className="text-xs text-muted-foreground">{t('voiceSettings.note')}</p>
          </div>
        </SettingsSection>

        <SettingsSection
          title={t('voiceSettings.contextTitle')}
          description={t('voiceSettings.contextDescription')}
        >
          <div className="space-y-4">
            {config.sttProvider === 'openai' && (
              <Area
                label={t('voiceSettings.contextPrompt')}
                maxLength={VOICE_STT_PROMPT_MAX_CHARS}
                placeholder={t('voiceSettings.contextPromptPlaceholder')}
                value={promptDraft}
                onChange={(e) => setPromptDraft(e.target.value)}
                onBlur={() => update({ sttPrompt: promptDraft })}
              />
            )}
            <Field
              label={t('voiceSettings.contextLanguages')}
              placeholder="fa, en"
              value={languageHintsDraft}
              onChange={(e) => setLanguageHintsDraft(e.target.value)}
              onBlur={() => update({ sttLanguages: normalizeSttLanguages(languageHintsDraft) })}
            />
            <Area
              label={t('voiceSettings.contextTerms')}
              placeholder={'useVoiceInput\ngpt-transcribe\n--force'}
              value={termsDraft}
              onChange={(e) => setTermsDraft(e.target.value)}
              onBlur={() => update({ sttTerms: normalizeSttTerms(termsDraft) })}
            />
            <p className="text-xs text-muted-foreground">{t('voiceSettings.contextNote')}</p>
          </div>
        </SettingsSection>

        <SettingsSection
          title={t('voiceSettings.microphoneTitle', { defaultValue: 'Microphone' })}
          description={t('voiceSettings.microphoneDescription', {
            defaultValue: 'Choose which input device dictation records from.',
          })}
        >
          {mic.supported ? (
            <div className="space-y-2">
              <select
                className={inputClass}
                value={config.micDeviceId}
                onChange={(e) => update({ micDeviceId: e.target.value })}
                aria-label={t('voiceSettings.microphoneTitle', { defaultValue: 'Microphone' })}
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
              {mic.needsPermission && (
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  onClick={() => {
                    void mic.requestPermission();
                  }}
                >
                  {t('voiceSettings.micGrantAccess', {
                    defaultValue: 'Allow microphone access to show device names',
                  })}
                </button>
              )}
              <p className="text-xs text-muted-foreground">
                {t('voiceSettings.micNote', {
                  defaultValue:
                    'If the selected microphone is unavailable, recording falls back to the system default.',
                })}
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t('voiceSettings.micUnsupported', {
                defaultValue: 'Microphone selection is not supported in this browser.',
              })}
            </p>
          )}
        </SettingsSection>

        <SettingsSection title={t('voiceSettings.holdToTalkTitle')} description={t('voiceSettings.holdToTalkDescription')}>
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div className="pr-3">
              <div className="text-sm font-medium text-foreground">{t('voiceSettings.holdToTalk')}</div>
              <div className="text-xs text-muted-foreground">{t('voiceSettings.holdToTalkHint')}</div>
            </div>
            <SettingsToggle
              checked={preferences.voiceHoldToTalk}
              onChange={(v) => setPreference('voiceHoldToTalk', v)}
              ariaLabel={t('voiceSettings.holdToTalk')}
            />
          </div>
        </SettingsSection>

        <SettingsSection title={t('voiceSettings.cleanupTitle')} description={t('voiceSettings.cleanupDescription')}>
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div className="pr-3">
                <div className="text-sm font-medium text-foreground">{t('voiceSettings.cleanupEnable')}</div>
                <div className="text-xs text-muted-foreground">{t('voiceSettings.cleanupEnableDescription')}</div>
              </div>
              <SettingsToggle
                checked={config.cleanupEnabled}
                onChange={(v) => update({ cleanupEnabled: v })}
                ariaLabel={t('voiceSettings.cleanupEnable')}
              />
            </div>
            {config.cleanupEnabled && (
              <>
                <Field
                  label={t('voiceSettings.cleanupModel')}
                  placeholder="gpt-4o-mini"
                  value={config.cleanupModel}
                  onChange={(e) => update({ cleanupModel: e.target.value })}
                />
                <Area
                  label={t('voiceSettings.cleanupPrompt')}
                  placeholder={DEFAULT_CLEANUP_PROMPT}
                  value={config.cleanupPrompt}
                  onChange={(e) => update({ cleanupPrompt: e.target.value })}
                />
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  onClick={() => update({ cleanupPrompt: DEFAULT_CLEANUP_PROMPT })}
                >
                  {t('voiceSettings.cleanupReset')}
                </button>
                <p className="text-xs text-muted-foreground">{t('voiceSettings.cleanupNote')}</p>
              </>
            )}
          </div>
        </SettingsSection>
        </>
      )}
    </div>
  );
}
