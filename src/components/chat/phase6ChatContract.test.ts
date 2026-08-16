import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path: string) => readFile(path, 'utf8');

test('Chat has one canonical header Export and no body implementation', async () => {
  const [title, pane] = await Promise.all([
    read('src/components/main-content/view/subcomponents/MainContentTitle.tsx'),
    read('src/components/chat/view/subcomponents/ChatMessagesPane.tsx'),
  ]);
  assert.equal((title.match(/ariaLabel="Export chat"/g) ?? []).length, 1);
  assert.doesNotMatch(pane, /Export chat|ChatExportMenu/);
  await assert.rejects(access('src/components/chat/view/subcomponents/ChatExportMenu.tsx'));
});

test('session actions reset on session switch and scoped Chat flows contain no alert calls', async () => {
  const paths = [
    'src/components/main-content/view/subcomponents/MainContentTitle.tsx',
    'src/components/chat/view/ChatInterface.tsx',
    'src/components/chat/utils/chatExport.ts',
  ];
  const sources = await Promise.all(paths.map(read));
  assert.match(sources[0], /<SessionActions\s+key=\{selectedSession\.id\}/);
  for (const source of sources) {
    assert.doesNotMatch(source, /window\.alert|\balert\s*\(/);
  }
});

test('MainContent owns the only Chat session-store hook instance', async () => {
  const sources = await Promise.all([
    read('src/components/main-content/view/MainContent.tsx'),
    read('src/components/main-content/view/subcomponents/MainContentTitle.tsx'),
    read('src/components/chat/view/ChatInterface.tsx'),
  ]);
  assert.equal(sources.reduce(
    (count, source) => count + (source.match(/useSessionStore\(\)/g) ?? []).length,
    0,
  ), 1);
});

test('embedded task actions are explicitly neutral on every empty Chat branch', async () => {
  const source = await read('src/components/chat/view/subcomponents/ProviderSelectionEmptyState.tsx');
  assert.equal((source.match(/actionEmphasis="neutral"/g) ?? []).length, 2);
});

test('permission delivery is serialized and never adds another primary action', async () => {
  const [banner, questionPanel] = await Promise.all([
    read('src/components/chat/view/subcomponents/PermissionRequestsBanner.tsx'),
    read('src/components/chat/tools/components/InteractiveRenderers/AskUserQuestionPanel.tsx'),
  ]);
  assert.match(banner, /const activeRequest = filteredRequests\[0\]/);
  assert.doesNotMatch(banner, /variant="default"/);
  assert.doesNotMatch(questionPanel, /from-blue-600 to-blue-500/);
});

test('user message bubbles use a dedicated readable color pair', async () => {
  const [message, copyControl, theme, tailwind, tokens, contrastCheck] = await Promise.all([
    read('src/components/chat/view/subcomponents/MessageComponent.tsx'),
    read('src/components/chat/view/subcomponents/MessageCopyControl.tsx'),
    read('src/index.css'),
    read('tailwind.config.js'),
    read('tokens.json'),
    read('scripts/contrast-check.mjs'),
  ]);

  assert.match(message, /bg-message-user/);
  assert.match(message, /text-message-user-foreground/);
  assert.match(copyControl, /text-message-user-foreground/);
  assert.match(theme, /--message-user:/);
  assert.match(tailwind, /["']message-user["']:/);
  assert.match(tokens, /"messageUser"/);
  assert.match(contrastCheck, /\['messageUserForeground', 'messageUser'\]/);
});

test('user message actions keep large hit targets without painting the full target', async () => {
  const [message, copyControl] = await Promise.all([
    read('src/components/chat/view/subcomponents/MessageComponent.tsx'),
    read('src/components/chat/view/subcomponents/MessageCopyControl.tsx'),
  ]);

  assert.equal((message.match(/data-message-action-visual/g) ?? []).length, 2);
  assert.equal((copyControl.match(/data-message-action-visual/g) ?? []).length, 1);
  assert.match(message, /min-h-11 min-w-11/);
  assert.match(copyControl, /min-h-11 min-w-11/);
  assert.doesNotMatch(
    message,
    /min-h-11 min-w-11[^"\n]*hover:bg-message-user-foreground\/10/,
  );
  assert.doesNotMatch(
    copyControl,
    /min-h-11 min-w-11[^`"\n]*hover:bg-message-user-foreground\/10/,
  );
});
