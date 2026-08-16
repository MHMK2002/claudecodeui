import { expect, test, type Page, type Route } from '@playwright/test';

import { installDesktopLocalMocks } from './fixtures/desktopLocal';

const json = (route: Route, payload: unknown, status = 200) => route.fulfill({
  status,
  contentType: 'application/json',
  body: JSON.stringify(payload),
});

async function installMicrophoneMock(page: Page, mode: 'ready' | 'denied' = 'ready') {
  await page.addInitScript(({ microphoneMode }) => {
    const track = { stop: () => undefined };
    const stream = { getTracks: () => [track] };
    let voiceSecrets = { apiKey: '', sonioxApiKey: '' };
    window.cloudcliDesktopVoiceSecrets = {
      get: async () => ({ ...voiceSecrets }),
      set: async (patch) => {
        voiceSecrets = { ...voiceSecrets, ...patch };
        return { ...voiceSecrets };
      },
    };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        enumerateDevices: async () => [{
          deviceId: 'test-mic',
          groupId: 'test-group',
          kind: 'audioinput',
          label: microphoneMode === 'ready' ? 'Laptop microphone' : '',
          toJSON: () => ({}),
        }],
        getUserMedia: async () => {
          if (microphoneMode === 'denied') {
            throw new DOMException('Permission denied', 'NotAllowedError');
          }
          return stream;
        },
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      },
    });

    class MockMediaRecorder {
      state: RecordingState = 'inactive';
      mimeType = 'audio/webm';
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;

      constructor(_stream: unknown, _options?: unknown) {}

      start() {
        this.state = 'recording';
      }

      stop() {
        this.state = 'inactive';
        this.ondataavailable?.({
          data: new Blob([new Uint8Array(1200)], { type: this.mimeType }),
        });
        window.setTimeout(() => this.onstop?.(), 0);
      }
    }

    Object.defineProperty(window, 'MediaRecorder', {
      configurable: true,
      value: MockMediaRecorder,
    });
  }, { microphoneMode: mode });
}

async function openVoiceSettings(page: Page) {
  await page.goto('/session/session-1');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Voice', exact: true }).click();
}

test('Settings groups Voice Basic and loads cleanup catalogs only after Advanced opens', async ({ page }) => {
  await installMicrophoneMock(page);
  await installDesktopLocalMocks(page);
  const catalogRequests: string[] = [];
  page.on('request', (request) => {
    if (/\/api\/providers\/codex\/(profiles|models)$/.test(new URL(request.url()).pathname)) {
      catalogRequests.push(request.url());
    }
  });

  await page.goto('/session/session-1');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'General', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'AI & integrations', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Project tools', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'System', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Appearance', exact: true })).toHaveAttribute('aria-current', 'page');

  const beforeVoice = catalogRequests.length;
  await page.getByRole('button', { name: 'Voice', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Enable voice' })).toBeVisible();
  await expect(page.getByLabel('Microphone')).toHaveValue('');
  await expect(page.getByRole('switch', { name: 'Enable Option+Space hold-to-talk' })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Read aloud' })).toBeVisible();
  await expect(page.getByLabel('Dictation language')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Test voice input' })).toHaveClass(/bg-primary/);
  await expect(page.getByLabel('Speech-to-text provider')).toHaveCount(0);
  expect(catalogRequests).toHaveLength(beforeVoice);

  await page.getByRole('button', { name: /Advanced/ }).click();
  const advanced = page.getByRole('region', { name: 'Advanced voice settings' });
  await expect(advanced).toContainText('Changes save automatically');
  await expect(advanced.getByRole('region', { name: 'Speech-to-text' })).toBeVisible();
  await expect(advanced.getByRole('region', { name: 'Recognition context' })).toBeVisible();
  await expect(advanced.getByRole('region', { name: 'Transcript cleanup' })).toBeVisible();
  await expect(page.getByLabel('Speech-to-text provider')).toBeVisible();
  await expect.poll(() => catalogRequests.length).toBeGreaterThan(beforeVoice);
  await expect(page.getByLabel('API key')).toHaveAttribute('type', 'password');
  await page.getByLabel('Speech-to-text model').fill('gpt-transcribe');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.getByLabel('Speech-to-text provider').selectOption('soniox');
  await expect(page.getByLabel('Soniox API key')).toHaveAttribute('type', 'password');
  await expect(page.getByLabel('Speech-to-text model')).toHaveCount(0);
});

test('Voice test shows Listening, Transcribing, and a sample result', async ({ page }) => {
  await installMicrophoneMock(page);
  await installDesktopLocalMocks(page);
  await page.route('**/api/voice/transcribe', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await json(route, { text: 'Voice test sample' });
  });

  await openVoiceSettings(page);
  await page.getByRole('button', { name: 'Test voice input' }).click();
  await expect(page.getByText('Listening', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stop and transcribe' }).click();
  await expect(page.getByText('Transcribing', { exact: true })).toBeVisible();
  await expect(page.getByText('Sample result', { exact: true })).toBeVisible();
  await expect(page.getByText('Voice test sample', { exact: true })).toBeVisible();
});

test('cleanup catalog failures are visible and retryable', async ({ page }) => {
  await installMicrophoneMock(page);
  await installDesktopLocalMocks(page);
  await page.route('**/api/providers/codex/profiles', (route) => json(route, {
    success: false,
    error: 'Profiles unavailable',
  }, 503));
  await page.route('**/api/providers/codex/models', (route) => json(route, {
    success: false,
    error: 'Models unavailable',
  }, 503));

  await openVoiceSettings(page);
  await page.getByRole('button', { name: /Advanced/ }).click();
  await expect(page.getByRole('alert')).toContainText('Cleanup catalog unavailable');
  await expect(page.getByRole('button', { name: 'Retry profiles' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry models' })).toBeVisible();
});

test('denied microphone permission explains recovery in context', async ({ page }) => {
  await installMicrophoneMock(page, 'denied');
  await installDesktopLocalMocks(page);

  await openVoiceSettings(page);
  await page.getByRole('button', { name: 'Check microphone permission' }).click();
  await expect(page.getByText(/Microphone access is blocked/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check microphone permission' })).toBeVisible();
});
