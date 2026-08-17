import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

test('ordinary messages own their footer timestamp while tools own header metadata', () => {
  const message = read('src/components/chat/view/subcomponents/MessageComponent.tsx');

  assert.match(message, /shouldShowRowTimestamp = !message\.isToolUse && !message\.isTaskNotification/);
  assert.match(message, /<MessageTimestamp timestamp=\{message\.timestamp\} className="ml-auto" \/>/);
  assert.match(message, /mode="input"\s+timestamp=\{message\.timestamp\}/);
  assert.doesNotMatch(message, /toLocaleTimeString/);
});

test('all specialized tool surfaces accept shared timestamp metadata', () => {
  const renderer = read('src/components/chat/tools/ToolRenderer.tsx');
  const oneLine = read('src/components/chat/tools/components/OneLineDisplay.tsx');
  const bash = read('src/components/chat/tools/components/BashCommandDisplay.tsx');
  const plan = read('src/components/chat/tools/components/PlanDisplay.tsx');
  const subagent = read('src/components/chat/tools/components/SubagentContainer.tsx');
  const group = read('src/components/chat/view/subcomponents/ToolGroupContainer.tsx');

  assert.match(renderer, /executionTimestamp = mode === 'input' \? timestamp : undefined/);
  for (const source of [oneLine, bash, plan, subagent, group]) {
    assert.match(source, /ToolExecutionMeta/);
  }
});

test('tool metadata can wrap without removing compact desktop alignment', () => {
  const oneLine = read('src/components/chat/tools/components/OneLineDisplay.tsx');
  const section = read('src/components/chat/tools/components/CollapsibleSection.tsx');
  const group = read('src/components/chat/view/subcomponents/ToolGroupContainer.tsx');

  assert.match(oneLine, /flex flex-wrap items-center/);
  assert.match(section, /className="[^"]*flex[^"]*w-full[^"]*flex-wrap/);
  assert.match(group, /group flex w-full flex-wrap/);
  assert.match(group, /min-w-0 flex-1 truncate font-mono/);
  assert.doesNotMatch(read('src/components/chat/tools/components/ToolExecutionMeta.tsx'), /elapsed|duration/i);
});

test('streaming text keeps the first delta timestamp while content updates', () => {
  const store = read('src/stores/useSessionStore.ts');

  assert.match(store, /startedAt = idx >= 0 \? slot\.realtimeMessages\[idx\]\?\.timestamp : undefined/);
  assert.match(store, /timestamp: startedAt \?\? new Date\(\)\.toISOString\(\)/);
});
