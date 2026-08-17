import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const SIDEBAR_SESSION_ITEM =
  'src/components/sidebar/view/subcomponents/SidebarSessionItem.tsx';
const SIDEBAR_PROJECT_SESSIONS =
  'src/components/sidebar/view/subcomponents/SidebarProjectSessions.tsx';
const REALTIME_HANDLERS =
  'src/components/chat/hooks/useChatRealtimeHandlers.ts';

test('sidebar session status reflects runtime state instead of recent activity', () => {
  const source = readFileSync(SIDEBAR_SESSION_ITEM, 'utf8');

  assert.match(source, /const showWaitingIndicator = isWaitingForInput;/);
  assert.match(
    source,
    /const showRunningIndicator = isProcessing && !showWaitingIndicator;/,
  );
  assert.match(
    source,
    /const showAttentionIndicator = showWaitingIndicator \|\| \(!showRunningIndicator && needsAttention\);/,
  );
  assert.doesNotMatch(source, /showRecentIndicator/);
  assert.match(
    source,
    /showAttentionIndicator \? 'bg-amber-500' : 'bg-primary'/,
  );
});

test('pending permission lifecycle drives the sidebar waiting state', () => {
  const sessions = readFileSync(SIDEBAR_PROJECT_SESSIONS, 'utf8');
  const realtime = readFileSync(REALTIME_HANDLERS, 'utf8');

  assert.match(
    sessions,
    /isWaitingForInput=\{activeSessions\.get\(session\.id\)\?\.requiresUserInput === true\}/,
  );
  assert.match(realtime, /requiresUserInput: isActionablePermissionRequest\(/);
  assert.match(realtime, /requiresUserInput: false/);
});
