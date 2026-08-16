import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canRetryTaskStartForProject,
  isTaskStartAttemptCurrent,
  resolveChatPrimaryAction,
  resolveChatPrimaryVisual,
  resolveChatRunControls,
} from './chatRunControls';

test('running with a draft keeps exactly one Stop and exposes Queue separately', () => {
  assert.deepEqual(resolveChatRunControls({
    isRunning: true,
    canInterrupt: true,
    hasDraft: true,
  }), {
    mainAction: 'stop',
    mainDisabled: false,
    queueVisible: true,
    stopExplanation: null,
  });
});

test('noninterruptible activity keeps Stop visible but disabled with an explanation', () => {
  assert.deepEqual(resolveChatRunControls({
    isRunning: true,
    canInterrupt: false,
    hasDraft: false,
  }), {
    mainAction: 'stop',
    mainDisabled: true,
    queueVisible: false,
    stopExplanation: 'This provider cannot be interrupted during the current step.',
  });
});

test('a disconnected run keeps Stop disabled with connection recovery context', () => {
  assert.deepEqual(resolveChatRunControls({
    isRunning: true,
    canInterrupt: true,
    hasDraft: false,
    connectionAvailable: false,
  }), {
    mainAction: 'stop',
    mainDisabled: true,
    queueVisible: false,
    stopExplanation: 'Reconnect Chat before stopping this run.',
  });
});

test('page-wide recovery precedence exposes one primary Chat action', () => {
  assert.equal(resolveChatPrimaryAction({
    isRunning: false,
    hasCatalogError: true,
    hasHistoryError: true,
    connectionUnavailable: true,
  }), 'retry-catalog');
  assert.equal(resolveChatPrimaryAction({
    isRunning: true,
    hasCatalogError: true,
    hasHistoryError: true,
    connectionUnavailable: false,
  }), 'stop');
  assert.equal(resolveChatPrimaryAction({
    isRunning: true,
    hasCatalogError: false,
    hasHistoryError: false,
    connectionUnavailable: true,
  }), 'retry-connection');
});

test('idle state returns to Send', () => {
  assert.equal(resolveChatRunControls({
    isRunning: false,
    canInterrupt: false,
    hasDraft: true,
  }).mainAction, 'send');
});

test('task-start Retry cannot cross the originating project boundary', () => {
  assert.equal(canRetryTaskStartForProject('project-a', 'project-a'), true);
  assert.equal(canRetryTaskStartForProject('project-a', 'project-b'), false);
  assert.equal(canRetryTaskStartForProject('project-a', null), false);
});

test('task-start outcomes are ignored after a new attempt or view navigation', () => {
  const origin = { projectId: 'project-a', sessionId: 'session-a' };
  assert.equal(isTaskStartAttemptCurrent(3, 3, origin, origin), true);
  assert.equal(isTaskStartAttemptCurrent(3, 4, origin, origin), false);
  assert.equal(isTaskStartAttemptCurrent(3, 3, origin, {
    projectId: 'project-b',
    sessionId: 'session-a',
  }), false);
  assert.equal(isTaskStartAttemptCurrent(3, 3, origin, {
    projectId: 'project-a',
    sessionId: 'session-b',
  }), false);
});

test('running Stop visual wins over simultaneous voice transcription', () => {
  assert.equal(resolveChatPrimaryVisual(true, true), 'stop');
  assert.equal(resolveChatPrimaryVisual(false, true), 'transcribing');
});
