import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const sourceUrls = {
  api: new URL('../../src/utils/api.js', import.meta.url),
  authContext: new URL('../../src/components/auth/context/AuthContext.tsx', import.meta.url),
  protectedRoute: new URL('../../src/components/auth/view/ProtectedRoute.tsx', import.meta.url),
  webSocket: new URL('../../src/contexts/WebSocketContext.tsx', import.meta.url),
  shellSocket: new URL('../../src/components/shell/utils/socket.ts', import.meta.url),
  voiceApi: new URL('../../src/lib/voiceApi.ts', import.meta.url),
  cloneApi: new URL('../../src/components/project-creation-wizard/data/workspaceApi.ts', import.meta.url),
  serverAuth: new URL('../../server/modules/auth/auth.middleware.ts', import.meta.url),
  webSocketAuth: new URL('../../server/modules/websocket/services/websocket-auth.service.ts', import.meta.url),
  electronMain: new URL('../../electron/main.js', import.meta.url),
  preload: new URL('../../electron/preload.cjs', import.meta.url),
  taskMaster: new URL('../../src/components/task-master/context/TaskMasterContext.tsx', import.meta.url),
  upload: new URL('../../src/components/file-tree/hooks/useFileTreeUpload.ts', import.meta.url),
  voiceInput: new URL('../../src/components/chat/hooks/useVoiceInput.ts', import.meta.url),
  shellConnection: new URL('../../src/components/shell/hooks/useShellConnection.ts', import.meta.url),
};

const sources = Object.fromEntries(await Promise.all(
  Object.entries(sourceUrls).map(async ([name, url]) => [name, await readFile(url, 'utf8')]),
));

test('renderer transports never put a session token in URLs', () => {
  for (const name of ['webSocket', 'shellSocket', 'voiceApi', 'cloneApi', 'api']) {
    assert.doesNotMatch(
      sources[name],
      /[?&](?:token|access_token)=|searchParams\.(?:set|get)\(['"]token|query\.token/,
      `${name} must use the shared cookie boundary`,
    );
  }
  assert.match(sources.webSocket, /\/ws`/);
  assert.match(sources.shellSocket, /['"]\/shell['"]/);
  assert.match(sources.voiceApi, /\/voice-stream`/);
});

test('Desktop renderer persistence and IPC never expose a JWT', async () => {
  assert.doesNotMatch(sources.preload, /localStorage|auth-token|get-local-auth-token|update-local-auth-token/);
  assert.match(sources.preload, /renew-local-session/);
  assert.doesNotMatch(sources.electronMain, /LocalAuthStore|get-local-auth-token|update-local-auth-token/);
  await assert.rejects(access(new URL('../../electron/localAuth.js', import.meta.url)));
});

test('Electron completes local bootstrap before opening the workspace target', () => {
  const openLocalStart = sources.electronMain.indexOf('async function openLocalInDesktop');
  const openLocalEnd = sources.electronMain.indexOf('async function openEnvironmentInDesktop');
  const openLocalSource = sources.electronMain.slice(openLocalStart, openLocalEnd);
  const bootstrapIndex = openLocalSource.lastIndexOf('bootstrapLocalSession');
  const showTargetIndex = openLocalSource.lastIndexOf('showTarget(target)');

  assert.ok(bootstrapIndex >= 0);
  assert.ok(showTargetIndex > bootstrapIndex);
});

test('ProtectedRoute cannot render product Login or Setup in desktop-local mode', () => {
  const localBoundary = sources.protectedRoute.indexOf("runtimeMode === 'desktop-local'");
  const setupBoundary = sources.protectedRoute.indexOf('if (needsSetup)');
  const loginBoundary = sources.protectedRoute.indexOf('if (!user)');

  assert.ok(localBoundary >= 0);
  assert.ok(setupBoundary > localBoundary);
  assert.ok(loginBoundary > localBoundary);
  assert.match(sources.authContext, /clearStoredToken\(\)/);
  assert.match(sources.authContext, /setLocalBootstrapReady\(true\)/);
  assert.match(sources.authContext, /window\.cloudcliDesktopLocalSession \? 'desktop-local'/);
  assert.match(sources.authContext, /Authentication status returned an invalid response/);
});

test('server WebSocket and REST boundaries are cookie-first and reject query credentials', () => {
  assert.match(sources.serverAuth, /desktop-local/);
  assert.match(sources.serverAuth, /SESSION_COOKIE_NAME/);
  assert.doesNotMatch(sources.serverAuth, /req\.query\.token/);
  assert.match(sources.webSocketAuth, /searchParams\.has\('token'\)/);
  assert.match(sources.webSocketAuth, /Shell WebSocket is disabled outside a loopback local runtime/);
});

test('cookie-authenticated feature contexts do not require a renderer JWT', () => {
  assert.doesNotMatch(sources.taskMaster, /!token|user\s*&&\s*token|useAuth\(\).*token/);
  assert.match(sources.upload, /renewDesktopLocalSession\(\)/);
  assert.match(sources.upload, /withCredentials = true/);
});

test('WebSocket, Shell, and Voice renew the tokenless Desktop session before connecting', () => {
  for (const name of ['webSocket', 'shellConnection', 'voiceInput']) {
    assert.match(sources[name], /renewDesktopLocalSession\(\)/);
  }
  assert.match(sources.authContext, /await api\.auth\.logout\(\)/);
});

test('chat WebSocket renewal ignores stale StrictMode effect continuations', () => {
  assert.match(sources.webSocket, /const connectionGenerationRef = useRef\(0\)/);
  assert.match(
    sources.webSocket,
    /const connectionGeneration = \+\+connectionGenerationRef\.current/,
  );
  assert.match(
    sources.webSocket,
    /connectionGenerationRef\.current !== connectionGeneration/,
  );
  assert.match(sources.webSocket, /connectionGenerationRef\.current \+= 1/);

  const renewalIndex = sources.webSocket.indexOf('await renewDesktopLocalSession()');
  const staleGuardIndex = sources.webSocket.indexOf(
    'connectionGenerationRef.current !== connectionGeneration',
  );
  const socketIndex = sources.webSocket.indexOf('new WebSocket(wsUrl)');
  assert.ok(renewalIndex >= 0);
  assert.ok(staleGuardIndex > renewalIndex);
  assert.ok(socketIndex > staleGuardIndex);
});
