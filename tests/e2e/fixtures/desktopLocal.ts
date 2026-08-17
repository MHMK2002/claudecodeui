import type { Page, Route } from '@playwright/test';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';

import {
  serializeSessionExportMarkdownV1,
  serializeTranscriptCanonicalV1,
} from '../../../shared/session-export-contract.js';
import { productConfig } from '../../../shared/product-config.js';

type CatalogMode = 'json' | 'html';
type HistoryMode = 'json' | 'empty' | 'error' | 'malformed';
type ZipMode = 'valid' | 'html' | 'empty' | 'invalid' | 'truncated';
type TasksMode = 'disabled' | 'empty' | 'next';

type DesktopLocalMockOptions = {
  catalogMode?: CatalogMode;
  historyMode?: HistoryMode;
  historyDelayMs?: number;
  zipMode?: ZipMode;
  tasksMode?: TasksMode;
  updateAvailable?: boolean;
  firstRun?: boolean;
  catalogRefreshAfterTokenFails?: boolean;
  profileRefreshAfterTokenFails?: boolean;
  claudeProfileRefreshDelayMs?: number;
  codexInitialProfileDelayMs?: number;
  onboardingStatusRefreshFails?: boolean;
  tokenVerification?: 'success' | 'invalid' | 'unavailable';
};

const modelDefinition = {
  OPTIONS: [{
    value: 'gpt-test',
    label: 'GPT Test',
    effort: { default: 'high', values: [{ value: 'low' }, { value: 'high' }] },
  }],
  DEFAULT: 'gpt-test',
};

const catalog = {
  providers: [
    {
      provider: 'codex',
      available: true,
      connectionAvailable: false,
      unavailableReason: null,
      profiles: [{ id: 1, title: 'Local Codex', isDefault: true }],
      models: modelDefinition,
    },
    {
      provider: 'claude',
      available: false,
      connectionAvailable: false,
      unavailableReason: 'Claude is not connected.',
      profiles: [],
      models: modelDefinition,
    },
    {
      provider: 'cursor',
      available: false,
      connectionAvailable: false,
      unavailableReason: 'Cursor is not connected.',
      profiles: [],
      models: modelDefinition,
    },
    {
      provider: 'opencode',
      available: false,
      connectionAvailable: false,
      unavailableReason: 'OpenCode is not connected.',
      profiles: [],
      models: modelDefinition,
    },
  ],
};

const session = {
  id: 'session-1',
  summary: 'A deliberately long local session title that must truncate before the fixed action rail',
  __provider: 'codex',
  __providerProfileId: 1,
};

const project = {
  projectId: 'project-1',
  displayName: 'Local Project',
  fullPath: '/workspace/local-project',
  path: '/workspace/local-project',
  isStarred: false,
  sessions: [session],
  sessionMeta: { total: 1, hasMore: false },
};

const history = [{
  id: 'history-user',
  sessionId: 'session-1',
  timestamp: '2026-08-16T00:00:00.000Z',
  provider: 'codex',
  kind: 'text',
  role: 'user',
  content: 'Existing local message',
}, {
  id: 'history-assistant',
  sessionId: 'session-1',
  timestamp: '2026-08-16T00:00:01.000Z',
  provider: 'codex',
  kind: 'text',
  role: 'assistant',
  content: 'Existing local response',
}];

async function createValidZipBody(): Promise<Buffer> {
  const zip = new JSZip();
  const transcriptDigest = createHash('sha256')
    .update(serializeTranscriptCanonicalV1(history))
    .digest('hex');
  const payload = {
    version: 1,
    exportedAt: '2026-08-16T00:02:00.000Z',
    transcriptDigest,
    metadata: {
      sessionId: session.id,
      provider: 'codex',
      customName: session.summary,
      projectPath: project.fullPath,
      createdAt: '2026-08-16T00:00:00.000Z',
      updatedAt: '2026-08-16T00:01:00.000Z',
    },
    messageCount: history.length,
    messages: history,
    attachments: [],
  };
  const markdown = serializeSessionExportMarkdownV1(payload);
  const jsonBody = JSON.stringify(payload, null, 2);
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  const manifest = {
    version: 1,
    transcriptDigest,
    files: [
      { path: 'chat.json', size: Buffer.byteLength(jsonBody), sha256: hash(jsonBody) },
      { path: 'chat.md', size: Buffer.byteLength(markdown), sha256: hash(markdown) },
    ],
  };
  zip.file('chat.md', markdown);
  zip.file('chat.json', jsonBody);
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
}

const json = (route: Route, payload: unknown, status = 200) => route.fulfill({
  status,
  contentType: 'application/json',
  body: JSON.stringify(payload),
});

export async function installDesktopLocalMocks(
  page: Page,
  options: DesktopLocalMockOptions = {},
) {
  let catalogMode = options.catalogMode ?? 'json';
  let historyMode = options.historyMode ?? 'json';
  let zipMode = options.zipMode ?? 'valid';
  const tasksMode = options.tasksMode ?? 'disabled';
  const updateAvailable = options.updateAvailable ?? false;
  let onboardingCompleted = options.firstRun !== true;
  let onboardingProfile: { provider: 'claude' | 'codex'; id: number } | null = null;
  let delayedInitialCodexProfile = false;
  const historyDelayMs = options.historyDelayMs ?? 0;
  const validZipBody = await createValidZipBody();

  await page.addInitScript(({ tasksEnabled }) => {
    window.cloudcliDesktopLocalSession = {
      renew: async () => ({ success: true }),
    };
    let voiceSecrets = { apiKey: '', sonioxApiKey: '' };
    window.cloudcliDesktopVoiceSecrets = {
      get: async () => ({ ...voiceSecrets }),
      set: async (patch) => {
        voiceSecrets = { ...voiceSecrets, ...patch };
        return { ...voiceSecrets };
      },
    };
    localStorage.setItem('selected-provider', 'codex');
    localStorage.setItem('codex-provider-profile-id', '1');
    localStorage.setItem('codex-model', 'gpt-test');
    localStorage.setItem('tasks-enabled', String(tasksEnabled));
  }, { tasksEnabled: tasksMode !== 'disabled' });

  await page.route(productConfig.updateFeedUrl, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      tag_name: updateAvailable ? 'v999.0.0' : 'v0.0.0',
      name: updateAvailable ? 'CloudCLI test update' : 'CloudCLI baseline',
      body: '',
      html_url: `${productConfig.repositoryUrl}/releases/latest`,
      published_at: '2026-08-16T00:00:00.000Z',
    }),
  }));

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path === '/api/auth/status') {
      await json(route, { runtimeMode: 'desktop-local', needsSetup: false });
      return;
    }
    if (path === '/api/auth/user') {
      await json(route, options.firstRun
        ? { user: { id: 1, username: '__cloudcli_desktop_local__', internal: true } }
        : { user: { id: 1, username: 'local-user', internal: false } });
      return;
    }
    if (path === '/api/user/onboarding-status') {
      if (onboardingCompleted && options.onboardingStatusRefreshFails) {
        await json(route, { success: false, error: 'Onboarding status unavailable.' }, 503);
        return;
      }
      await json(route, { success: true, hasCompletedOnboarding: onboardingCompleted });
      return;
    }
    if (path === '/api/user/complete-onboarding') {
      onboardingCompleted = true;
      await json(route, { success: true });
      return;
    }
    if (path === '/api/projects') {
      await json(route, tasksMode === 'next'
        ? [{
          ...project,
          taskmaster: {
            hasTaskmaster: true,
            status: 'ready',
            metadata: { taskCount: 1, completed: 0 },
          },
        }]
        : [project]);
      return;
    }
    if (path === '/api/plugins') {
      await json(route, { plugins: [] });
      return;
    }
    if (path === '/api/taskmaster/installation-status') {
      await json(route, {
        installation: { isInstalled: tasksMode === 'next' },
        isReady: tasksMode === 'next',
      });
      return;
    }
    if (path === '/api/projects/project-1/taskmaster') {
      await json(route, {
        taskmaster: tasksMode === 'next'
          ? { hasTaskmaster: true, status: 'ready', metadata: { taskCount: 1, completed: 0 } }
          : null,
      });
      return;
    }
    if (path === '/api/taskmaster/tasks/project-1') {
      await json(route, {
        tasks: tasksMode === 'next'
          ? [{ id: 'task-1', title: 'Verify the next local task', status: 'pending', priority: 'high' }]
          : [],
      });
      return;
    }
    if (path === '/api/providers/sessions/running') {
      await json(route, { success: true, data: { sessions: [] } });
      return;
    }
    if (path === '/api/browser-use/settings') {
      await json(route, { success: true, data: { settings: { enabled: false } } });
      return;
    }
    if (path === '/api/user/git-config') {
      await json(route, {
        success: true,
        gitName: 'Local User',
        gitEmail: 'local@example.com',
        commitMessage: {
          provider: 'codex',
          providerProfileId: 1,
          model: 'gpt-test',
          effort: 'low',
          basePrompt: 'Write one concise Conventional Commit message.',
        },
        defaultCommitMessageBasePrompt: 'Write one concise Conventional Commit message.',
        commitMessageBasePromptMaxLength: 800,
      });
      return;
    }
    if (path === '/api/providers/selection-catalog') {
      if (onboardingProfile && options.catalogRefreshAfterTokenFails) {
        await json(route, { success: false, error: 'Provider catalog unavailable.' }, 503);
        return;
      }
      if (catalogMode === 'html') {
        await route.fulfill({
          status: 502,
          contentType: 'text/html',
          body: '<!doctype html><title>Proxy failure</title>',
        });
      } else {
        const savedProfile = onboardingProfile;
        await json(route, {
          success: true,
          data: {
            providers: catalog.providers.map((entry) => (
              entry.provider === savedProfile?.provider
                ? {
                    ...entry,
                    available: true,
                    unavailableReason: null,
                    profiles: [{
                      id: savedProfile.id,
                      title: 'Default Main',
                      isDefault: true,
                    }],
                  }
                : entry
            )),
          },
        });
      }
      return;
    }
    if (/\/api\/providers\/(claude|codex)\/onboarding-token$/.test(path)) {
      const provider = path.includes('/claude/') ? 'claude' : 'codex';
      if (options.tokenVerification === 'invalid') {
        await json(route, {
          success: false,
          error: { code: 'INVALID_PROVIDER_TOKEN', message: 'The provider rejected this token.' },
        }, 400);
        return;
      }
      if (options.tokenVerification === 'unavailable') {
        await json(route, {
          success: false,
          error: {
            code: 'PROVIDER_VERIFICATION_UNAVAILABLE',
            message: 'The provider could not be reached. Check your connection and retry.',
          },
        }, 503);
        return;
      }
      onboardingProfile = { provider, id: 9 };
      await json(route, {
        success: true,
        data: {
          provider,
          profile: {
            id: 9,
            provider,
            title: 'Default Main',
            baseUrl: provider === 'codex' ? 'https://api.openai.com/v1' : null,
            authType: 'api_key',
            isDefault: true,
            isActive: true,
            hasSecret: true,
            createdAt: '2026-08-17T00:00:00.000Z',
            updatedAt: '2026-08-17T00:00:00.000Z',
          },
        },
      });
      return;
    }
    if (/\/api\/providers\/(claude|codex|cursor|opencode)\/auth\/status$/.test(path)) {
      await json(route, {
        success: true,
        data: { authenticated: true, installed: true, error: null },
      });
      return;
    }
    if (/\/api\/providers\/sessions\/session-1\/messages$/.test(path)) {
      if (historyDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, historyDelayMs));
      }
      if (historyMode === 'error') {
        await json(route, {
          success: false,
          error: { code: 'HISTORY_UNAVAILABLE', message: 'History service unavailable.' },
        }, 503);
        return;
      }
      if (historyMode === 'malformed') {
        await json(route, {
          success: true,
          data: { messages: 'not-an-array', total: history.length, hasMore: false },
        });
        return;
      }
      if (historyMode === 'empty') {
        await json(route, {
          success: true,
          data: { messages: [], total: 0, hasMore: false, tokenUsage: null },
        });
        return;
      }
      await json(route, {
        success: true,
        data: { messages: history, total: history.length, hasMore: false, tokenUsage: null },
      });
      return;
    }
    if (/\/api\/providers\/sessions\/session-1\/export$/.test(path)) {
      if (zipMode === 'html') {
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<!doctype html><title>Proxy failure</title>',
        });
        return;
      }
      if (zipMode === 'empty') {
        await route.fulfill({
          status: 200,
          contentType: 'application/zip',
          body: Buffer.alloc(0),
        });
        return;
      }
      if (zipMode === 'invalid') {
        await route.fulfill({
          status: 200,
          contentType: 'application/zip',
          body: Buffer.from('This is not a ZIP archive.'),
        });
        return;
      }
      if (zipMode === 'truncated') {
        await route.fulfill({
          status: 200,
          contentType: 'application/zip',
          body: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x01]),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/zip',
        headers: {
          'content-disposition': 'attachment; filename="local-session.zip"',
        },
        body: validZipBody,
      });
      return;
    }
    if (/\/api\/providers\/(claude|codex)\/profiles$/.test(path)) {
      const provider = path.includes('/claude/') ? 'claude' : 'codex';
      const refreshesOnboardingProfile = onboardingProfile?.provider === provider;
      const savedProfileAtRequest = refreshesOnboardingProfile
        ? { ...onboardingProfile }
        : null;
      if (refreshesOnboardingProfile && options.profileRefreshAfterTokenFails) {
        await json(route, { success: false, error: 'Provider profiles unavailable.' }, 503);
        return;
      }
      if (
        provider === 'codex'
        && !savedProfileAtRequest
        && !delayedInitialCodexProfile
        && options.codexInitialProfileDelayMs
      ) {
        delayedInitialCodexProfile = true;
        await new Promise((resolve) => setTimeout(resolve, options.codexInitialProfileDelayMs));
      }
      if (
        refreshesOnboardingProfile
        && provider === 'claude'
        && options.claudeProfileRefreshDelayMs
      ) {
        await new Promise((resolve) => setTimeout(resolve, options.claudeProfileRefreshDelayMs));
      }
      const savedProfile = savedProfileAtRequest
        ? [{
            id: savedProfileAtRequest.id,
            provider,
            title: 'Default Main',
            baseUrl: provider === 'codex' ? 'https://api.openai.com/v1' : null,
            authType: 'api_key',
            isDefault: true,
            isActive: true,
            hasSecret: true,
            createdAt: '2026-08-17T00:00:00.000Z',
            updatedAt: '2026-08-17T00:00:00.000Z',
          }]
        : null;
      await json(route, {
        success: true,
        data: {
          provider,
          profiles: savedProfile
            ?? (provider === 'codex'
              ? [{ id: 1, title: 'Local Codex', isDefault: true, isActive: true }]
              : []),
        },
      });
      return;
    }
    if (/\/api\/providers\/(claude|codex|cursor|opencode)\/models$/.test(path)) {
      await json(route, {
        success: true,
        data: {
          models: modelDefinition,
          cache: {
            updatedAt: '2026-08-16T00:00:00.000Z',
            expiresAt: '2026-08-16T01:00:00.000Z',
            source: 'fresh',
          },
        },
      });
      return;
    }
    if (path === '/api/providers/capabilities') {
      await json(route, { success: true, data: { providers: [] } });
      return;
    }
    if (/\/api\/providers\/codex\/sessions\/session-1\/active-model$/.test(path)) {
      await json(route, { success: true, data: { model: 'gpt-test', source: 'session' } });
      return;
    }
    if (path === '/api/providers/sessions/session-1') {
      await json(route, {
        success: true,
        data: {
          sessionId: 'session-1',
          provider: 'codex',
          summary: session.summary,
          createdAt: '2026-08-16T00:00:00.000Z',
          lastActivity: '2026-08-16T00:01:00.000Z',
          project: {
            projectId: project.projectId,
            path: project.path,
            fullPath: project.fullPath,
            displayName: project.displayName,
            isStarred: false,
          },
          session: {
            sessionId: 'session-1',
            provider: 'codex',
            providerProfileId: 1,
            projectId: project.projectId,
            projectPath: project.fullPath,
            title: session.summary,
          },
        },
      });
      return;
    }

    await json(route, { success: true, data: {} });
  });

  return {
    useJsonCatalog: () => { catalogMode = 'json'; },
    useHtmlCatalog: () => { catalogMode = 'html'; },
    useJsonHistory: () => { historyMode = 'json'; },
    useEmptyHistory: () => { historyMode = 'empty'; },
    useHistoryFailure: () => { historyMode = 'error'; },
    useMalformedHistory: () => { historyMode = 'malformed'; },
    useValidZip: () => { zipMode = 'valid'; },
    useHtmlZip: () => { zipMode = 'html'; },
    useEmptyZip: () => { zipMode = 'empty'; },
    useInvalidZip: () => { zipMode = 'invalid'; },
    useTruncatedZip: () => { zipMode = 'truncated'; },
  };
}
