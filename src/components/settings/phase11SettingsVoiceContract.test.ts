import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { SETTINGS_GROUPS, SETTINGS_MAIN_TABS } from './constants/constants.js';

const read = (filePath: string) => readFile(filePath, 'utf8');

test('Settings information architecture has the four contracted groups with at most four items', () => {
  assert.deepEqual(
    SETTINGS_GROUPS.map((group) => group.label),
    ['General', 'AI & integrations', 'Project tools', 'System'],
  );
  assert.deepEqual(
    SETTINGS_GROUPS.map((group) => SETTINGS_MAIN_TABS
      .filter((tab) => tab.group === group.id)
      .map((tab) => tab.label)),
    [
      ['Appearance', 'Notifications', 'Voice'],
      ['Agents', 'API Tokens', 'Browser', 'Plugins'],
      ['Git', 'Tasks'],
      ['About'],
    ],
  );
  for (const group of SETTINGS_GROUPS) {
    assert.ok(SETTINGS_MAIN_TABS.filter((tab) => tab.group === group.id).length <= 4);
  }
});

test('Voice keeps Basic recoverable and defers provider catalogs to Advanced', async () => {
  const [voice, devices, preferences, controller] = await Promise.all([
    read('src/components/settings/view/tabs/VoiceSettingsTab.tsx'),
    read('src/hooks/useAudioInputDevices.ts'),
    read('src/hooks/useUiPreferences.ts'),
    read('src/components/settings/hooks/useSettingsController.ts'),
  ]);

  assert.match(controller, /'voice'/);
  assert.match(voice, /Test voice input/);
  assert.match(voice, /Listening/);
  assert.match(voice, /Transcribing/);
  assert.match(voice, /Sample result/);
  assert.match(voice, /Read aloud/);
  assert.match(voice, /Dictation language/);
  assert.match(voice, /if \(!advancedOpen\) return/);
  assert.match(voice, /cleanupProfilesError/);
  assert.match(voice, /cleanupModelsError/);
  assert.match(voice, /type="password"/);
  assert.match(voice, /Failed to save/);
  assert.match(voice, />\s*Retry\s*</);
  assert.match(devices, /permission-denied/);
  assert.match(devices, /missing/);
  assert.match(preferences, /voiceReadAloud: true/);
});
