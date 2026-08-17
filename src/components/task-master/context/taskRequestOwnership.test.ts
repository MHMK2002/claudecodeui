import assert from 'node:assert/strict';
import test from 'node:test';

import { hasTaskProjectChanged, ownsTaskRequest } from './taskRequestOwnership';

test('task state resets only when the selected project scope changes', () => {
  assert.equal(hasTaskProjectChanged('project-a', 'project-a'), false);
  assert.equal(hasTaskProjectChanged('project-a', 'project-b'), true);
  assert.equal(hasTaskProjectChanged('project-a', null), true);
  assert.equal(hasTaskProjectChanged(null, 'project-a'), true);
  assert.equal(hasTaskProjectChanged(null, null), false);
});

test('task request applies only to the latest generation of the same project', () => {
  assert.equal(ownsTaskRequest(3, 3, 'project-a', 'project-a'), true);
  assert.equal(ownsTaskRequest(2, 3, 'project-a', 'project-a'), false);
  assert.equal(ownsTaskRequest(3, 3, 'project-a', 'project-b'), false);
  assert.equal(ownsTaskRequest(3, 3, 'project-a', null), false);
});

test('a deferred project A response cannot own project B after selection changes', async () => {
  let resolveRequest!: () => void;
  const deferred = new Promise<void>((resolve) => { resolveRequest = resolve; });
  let currentSequence = 1;
  let currentProjectId: string | null = 'project-a';
  const requestSequence = currentSequence;
  const requestProjectId = currentProjectId;

  const completion = deferred.then(() => ownsTaskRequest(
    requestSequence,
    currentSequence,
    requestProjectId!,
    currentProjectId,
  ));
  currentSequence += 1;
  currentProjectId = 'project-b';
  resolveRequest();

  assert.equal(await completion, false);
});
