import { expect, test } from '@playwright/test';

import { installDesktopLocalMocks } from './fixtures/desktopLocal';

async function installFirstRunVoiceMock(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const track = { stop: () => undefined };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        enumerateDevices: async () => [{
          deviceId: 'first-run-mic',
          groupId: 'first-run-group',
          kind: 'audioinput',
          label: 'Laptop microphone',
          toJSON: () => ({}),
        }],
        getUserMedia: async () => ({ getTracks: () => [track] }),
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

      start() { this.state = 'recording'; }

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

    const NativeWebSocket = window.WebSocket;
    class MockVoiceSocket {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSING = 2;
      static readonly CLOSED = 3;
      readyState = MockVoiceSocket.CONNECTING;
      binaryType: BinaryType = 'blob';
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onclose: ((event: CloseEvent) => void) | null = null;

      constructor() {
        window.setTimeout(() => {
          this.readyState = MockVoiceSocket.OPEN;
          this.onopen?.(new Event('open'));
        }, 0);
      }

      send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
        if (typeof data !== 'string') return;
        if (data) {
          window.setTimeout(() => this.onmessage?.(new MessageEvent('message', {
            data: JSON.stringify({ ready: true }),
          })), 0);
          return;
        }
        window.setTimeout(() => this.onmessage?.(new MessageEvent('message', {
          data: JSON.stringify({
            tokens: [{ text: 'First-run voice sample', is_final: true }],
            finished: true,
          }),
        })), 100);
      }

      close() {
        this.readyState = MockVoiceSocket.CLOSED;
      }
    }

    const WebSocketProxy = function WebSocketProxy(
      url: string | URL,
      protocols?: string | string[],
    ) {
      if (String(url).endsWith('/voice-stream')) return new MockVoiceSocket();
      return protocols === undefined
        ? new NativeWebSocket(url)
        : new NativeWebSocket(url, protocols);
    } as unknown as typeof WebSocket;
    Object.assign(WebSocketProxy, {
      CONNECTING: 0,
      OPEN: 1,
      CLOSING: 2,
      CLOSED: 3,
      prototype: NativeWebSocket.prototype,
    });
    Object.defineProperty(window, 'WebSocket', {
      configurable: true,
      value: WebSocketProxy,
    });
  });
}

test('fresh Desktop setup is responsive and Escape dismisses it permanently', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await installDesktopLocalMocks(page, { firstRun: true });
  await page.goto('/');

  const dialog = page.getByRole('dialog', { name: 'First-run setup' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Provider', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Soniox Voice', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  await page.reload();
  await expect(page.getByRole('dialog', { name: 'First-run setup' })).toBeHidden();
});

for (const actionName of ['Set up later', 'Close setup']) {
  test(`${actionName} permanently dismisses optional Desktop setup`, async ({ page }) => {
    await installDesktopLocalMocks(page, { firstRun: true });
    await page.goto('/');

    const dialog = page.getByRole('dialog', { name: 'First-run setup' });
    await dialog.getByRole('button', { name: actionName, exact: true }).click();
    await expect(dialog).toBeHidden();
    await page.reload();
    await expect(page.getByRole('dialog', { name: 'First-run setup' })).toBeHidden();
  });
}

test('token setup is offered only for Claude and Codex and saves Default Main', async ({ page }) => {
  await installDesktopLocalMocks(page, { firstRun: true });
  await page.goto('/');

  const dialog = page.getByRole('dialog', { name: 'First-run setup' });
  await dialog.getByRole('radio', { name: /Claude/ }).click();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog.getByRole('tab', { name: 'Use token' })).toBeVisible();
  await dialog.getByRole('tab', { name: 'Use token' }).click();
  await dialog.getByRole('textbox', { name: 'Provider token', exact: true }).fill('test-claude-token');
  await dialog.getByRole('button', { name: 'Verify & connect' }).click();

  await expect(dialog.getByText('Set up Soniox Voice')).toBeVisible();
  await dialog.getByRole('button', { name: 'Skip Voice' }).click();
  await expect(dialog.getByText(/Default Main/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Start working' }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => page.evaluate(() => ({
    provider: localStorage.getItem('selected-provider'),
    profile: localStorage.getItem('claude-provider-profile-id'),
  }))).toEqual({ provider: 'claude', profile: '9' });
});

test('token setup accepts a custom Agent Title and an Advanced Base URL', async ({ page }) => {
  await installDesktopLocalMocks(page, { firstRun: true });
  await page.goto('/');

  const dialog = page.getByRole('dialog', { name: 'First-run setup' });
  await dialog.getByRole('radio', { name: /Claude/ }).click();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await dialog.getByRole('tab', { name: 'Use token' }).click();

  const title = dialog.getByRole('textbox', { name: 'Agent Title', exact: true });
  const baseUrl = dialog.getByRole('textbox', { name: /Base URL/ });
  await expect(title).toHaveValue('Default Main');
  await expect(baseUrl).toHaveCount(0);
  await title.fill('Work Gateway');
  await dialog.getByRole('button', { name: 'Advanced' }).click();
  await baseUrl.fill('https://gateway.example/anthropic/v1');
  await dialog.getByRole('textbox', { name: 'Provider token', exact: true }).fill('test-claude-token');
  await dialog.getByRole('button', { name: 'Verify & connect' }).click();
  await dialog.getByRole('button', { name: 'Skip Voice' }).click();

  await expect(dialog.getByText('Claude connected with Work Gateway.')).toBeVisible();
});

test('Cursor connect step has no token method', async ({ page }) => {
  await installDesktopLocalMocks(page, { firstRun: true });
  await page.goto('/');

  const dialog = page.getByRole('dialog', { name: 'First-run setup' });
  await dialog.getByRole('radio', { name: /Cursor/ }).click();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog.getByRole('tab', { name: 'Use token' })).toHaveCount(0);
  await expect(dialog.getByText('Interactive sign-in')).toBeVisible();
});

test('verified provider remains the mounted default when catalog and profile refresh fail', async ({ page }) => {
  await installDesktopLocalMocks(page, {
    firstRun: true,
    catalogRefreshAfterTokenFails: true,
    profileRefreshAfterTokenFails: true,
  });
  await page.goto('/');

  const dialog = page.getByRole('dialog', { name: 'First-run setup' });
  await dialog.getByRole('radio', { name: /Claude/ }).click();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await dialog.getByRole('tab', { name: 'Use token' }).click();
  await dialog.getByRole('textbox', { name: 'Provider token', exact: true }).fill('test-claude-token');
  await dialog.getByRole('button', { name: 'Verify & connect' }).click();
  await expect(dialog.getByText('Set up Soniox Voice')).toBeVisible();
  await expect.poll(() => page.evaluate(() => ({
    provider: localStorage.getItem('selected-provider'),
    profile: localStorage.getItem('claude-provider-profile-id'),
  }))).toEqual({ provider: 'claude', profile: '9' });
  await dialog.getByRole('button', { name: 'Close setup' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button').filter({ hasText: /^Claude\s*·/ })).toBeVisible();
});

test('the newest verified Provider wins over an older delayed profile refresh', async ({ page }) => {
  await installDesktopLocalMocks(page, {
    firstRun: true,
    claudeProfileRefreshDelayMs: 500,
  });
  await page.goto('/');

  const dialog = page.getByRole('dialog', { name: 'First-run setup' });
  await dialog.getByRole('radio', { name: /Claude/ }).click();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await dialog.getByRole('tab', { name: 'Use token' }).click();
  await dialog.getByRole('textbox', { name: 'Provider token', exact: true }).fill('test-claude-token');
  await dialog.getByRole('button', { name: 'Verify & connect' }).click();
  await dialog.getByRole('button', { name: 'Back' }).click();
  await dialog.getByRole('button', { name: 'Back' }).click();

  await dialog.getByRole('radio', { name: /Codex/ }).click();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await dialog.getByRole('tab', { name: 'Use token' }).click();
  await dialog.getByRole('textbox', { name: 'Provider token', exact: true }).fill('test-codex-token');
  await dialog.getByRole('button', { name: 'Verify & connect' }).click();
  await page.waitForTimeout(700);
  await dialog.getByRole('button', { name: 'Close setup' }).click();

  await expect.poll(() => page.evaluate(() => ({
    provider: localStorage.getItem('selected-provider'),
    profile: localStorage.getItem('codex-provider-profile-id'),
  }))).toEqual({ provider: 'codex', profile: '9' });
  await expect(page.getByRole('button').filter({ hasText: /^Codex\s*·/ })).toBeVisible();
});

test('a stale same-Provider profile response cannot clear Default Main', async ({ page }) => {
  await installDesktopLocalMocks(page, {
    firstRun: true,
    codexInitialProfileDelayMs: 700,
  });
  await page.goto('/');

  const dialog = page.getByRole('dialog', { name: 'First-run setup' });
  await dialog.getByRole('radio', { name: /Codex/ }).click();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await dialog.getByRole('tab', { name: 'Use token' }).click();
  await dialog.getByRole('textbox', { name: 'Provider token', exact: true }).fill('test-codex-token');
  await dialog.getByRole('button', { name: 'Verify & connect' }).click();
  await page.waitForTimeout(900);
  await dialog.getByRole('button', { name: 'Close setup' }).click();

  await expect.poll(() => page.evaluate(() => ({
    provider: localStorage.getItem('selected-provider'),
    profile: localStorage.getItem('codex-provider-profile-id'),
  }))).toEqual({ provider: 'codex', profile: '9' });
  await expect(page.getByRole('button').filter({ hasText: /^Codex - Default Main\s*·/ })).toBeVisible();
});

test('persisted dismissal closes optimistically when status refresh fails', async ({ page }) => {
  await installDesktopLocalMocks(page, {
    firstRun: true,
    onboardingStatusRefreshFails: true,
  });
  await page.goto('/');

  const dialog = page.getByRole('dialog', { name: 'First-run setup' });
  await dialog.getByRole('button', { name: 'Set up later' }).click();
  await expect(dialog).toBeHidden();
});

test('invalid provider token stays masked and available for retry without changing defaults', async ({ page }) => {
  await installDesktopLocalMocks(page, {
    firstRun: true,
    tokenVerification: 'invalid',
  });
  await page.goto('/');

  const dialog = page.getByRole('dialog', { name: 'First-run setup' });
  await dialog.getByRole('radio', { name: /Claude/ }).click();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await dialog.getByRole('tab', { name: 'Use token' }).click();
  const tokenInput = dialog.getByRole('textbox', { name: 'Provider token', exact: true });
  await tokenInput.fill('invalid-claude-token');
  await dialog.getByRole('button', { name: 'Verify & connect' }).click();

  await expect(dialog.getByText('The provider rejected this token.')).toBeVisible();
  await expect(tokenInput).toHaveAttribute('type', 'password');
  await expect(tokenInput).toHaveValue('invalid-claude-token');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('selected-provider'))).toBe('codex');
});

test('back-navigation cannot rewrite a completed provider connection as skipped', async ({ page }) => {
  await installDesktopLocalMocks(page, { firstRun: true });
  await page.goto('/');

  const dialog = page.getByRole('dialog', { name: 'First-run setup' });
  await dialog.getByRole('radio', { name: /Claude/ }).click();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await dialog.getByRole('tab', { name: 'Use token' }).click();
  await dialog.getByRole('textbox', { name: 'Provider token', exact: true }).fill('test-claude-token');
  await dialog.getByRole('button', { name: 'Verify & connect' }).click();
  await dialog.getByRole('button', { name: 'Back' }).click();
  await dialog.getByRole('button', { name: 'Back' }).click();
  await dialog.getByRole('button', { name: 'Skip provider' }).click();
  await dialog.getByRole('button', { name: 'Skip Voice' }).click();

  await expect(dialog.getByText('Claude connected with Default Main.')).toBeVisible();
});

test('Soniox first-run test uses an unpersisted draft and saves only on confirmation', async ({ page }) => {
  await installFirstRunVoiceMock(page);
  await installDesktopLocalMocks(page, { firstRun: true });
  await page.goto('/');

  const dialog = page.getByRole('dialog', { name: 'First-run setup' });
  await dialog.getByRole('button', { name: 'Skip provider' }).click();
  await dialog.getByRole('textbox', { name: 'Soniox API key', exact: true }).fill('soniox-first-run-key');
  await dialog.getByRole('button', { name: 'Test voice input' }).click();
  await expect(dialog.getByText('Listening', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Stop and transcribe' }).click();
  await expect(dialog.getByText('Transcribing', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Sample result', { exact: true })).toBeVisible();
  await expect(dialog.getByText('First-run voice sample', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(async () => (
    (await window.cloudcliDesktopVoiceSecrets?.get())?.sonioxApiKey ?? null
  ))).toBe('');

  await dialog.getByRole('button', { name: 'Save and continue' }).click();
  await expect.poll(() => page.evaluate(async () => (
    (await window.cloudcliDesktopVoiceSecrets?.get())?.sonioxApiKey ?? null
  ))).toBe('soniox-first-run-key');
  await expect(dialog.getByText('Ready — secure settings saved and a sample was transcribed.')).toBeVisible();
});

test('Voice Back navigation resets an unsaved key and masks remounted secret inputs', async ({ page }) => {
  await installDesktopLocalMocks(page, { firstRun: true });
  await page.goto('/');

  const dialog = page.getByRole('dialog', { name: 'First-run setup' });
  await dialog.getByRole('radio', { name: /Claude/ }).click();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await dialog.getByRole('tab', { name: 'Use token' }).click();
  const providerToken = dialog.getByRole('textbox', { name: 'Provider token', exact: true });
  await dialog.getByRole('button', { name: 'Show provider token' }).click();
  await expect(providerToken).toHaveAttribute('type', 'text');
  await dialog.getByRole('button', { name: 'Back' }).click();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await dialog.getByRole('tab', { name: 'Use token' }).click();
  const remountedProviderToken = dialog.getByRole('textbox', { name: 'Provider token', exact: true });
  await expect(remountedProviderToken).toHaveAttribute('type', 'password');
  await remountedProviderToken.fill('test-claude-token');
  await dialog.getByRole('button', { name: 'Verify & connect' }).click();

  const voiceKey = dialog.getByRole('textbox', { name: 'Soniox API key', exact: true });
  await voiceKey.fill('unsaved-soniox-key');
  await dialog.getByRole('button', { name: 'Show Soniox key' }).click();
  await expect(voiceKey).toHaveAttribute('type', 'text');
  await dialog.getByRole('button', { name: 'Back' }).click();
  const retryProviderToken = dialog.getByRole('textbox', { name: 'Provider token', exact: true });
  await expect(retryProviderToken).toHaveAttribute('type', 'password');
  await retryProviderToken.fill('test-claude-token');
  await dialog.getByRole('button', { name: 'Verify & connect' }).click();

  const remountedVoiceKey = dialog.getByRole('textbox', { name: 'Soniox API key', exact: true });
  await expect(remountedVoiceKey).toHaveAttribute('type', 'password');
  await expect(remountedVoiceKey).toHaveValue('');
  await expect(dialog.getByRole('button', { name: 'Save and continue' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Test voice input' })).toBeDisabled();
});
