import assert from 'node:assert/strict';
import test from 'node:test';

import { getRecentProjectsWithSessions } from '@/modules/projects/services/projects-with-sessions-fetch.service.js';
import { AppError } from '@/shared/utils.js';

const projectRows = [
  {
    project_id: 'project-alpha',
    project_path: '/workspace/alpha',
    custom_project_name: 'Alpha',
    isStarred: 0,
  },
  {
    project_id: 'project-beta',
    project_path: '/workspace/beta',
    custom_project_name: 'Beta',
    isStarred: 1,
  },
  {
    project_id: 'project-without-recent-sessions',
    project_path: '/workspace/old',
    custom_project_name: 'Old',
    isStarred: 0,
  },
];

const sessionRows = [
  {
    session_id: 'alpha-cutoff',
    provider: 'codex',
    project_path: '/workspace/alpha',
    custom_name: 'Alpha cutoff',
    created_at: '2026-07-23T11:00:00.000Z',
    updated_at: '2026-07-23T11:00:00.000Z',
  },
  {
    session_id: 'beta-newest',
    provider: 'cursor',
    project_path: '/workspace/beta',
    custom_name: 'Beta newest',
    created_at: '2026-07-23T11:55:00.000Z',
    updated_at: '2026-07-23T11:55:00.000Z',
  },
  {
    session_id: 'alpha-newest',
    provider: 'claude',
    project_path: '/workspace/alpha',
    custom_name: 'Alpha newest',
    created_at: '2026-07-23T11:45:00.000Z',
    updated_at: '2026-07-23T11:45:00.000Z',
  },
  {
    // The active-project query does not include this path, so even a recent
    // session from an archived project must not leak into the result.
    session_id: 'archived-project-session',
    provider: 'claude',
    project_path: '/workspace/archived',
    custom_name: 'Hidden with project',
    created_at: '2026-07-23T11:58:00.000Z',
    updated_at: '2026-07-23T11:58:00.000Z',
  },
];

test('recent projects are grouped and sorted without per-project pagination', async () => {
  let capturedSince = '';
  let synchronizationCalls = 0;

  const projects = await getRecentProjectsWithSessions(
    {
      skipSynchronization: true,
      windowMinutes: 60,
      now: new Date('2026-07-23T12:00:00.000Z'),
    },
    {
      synchronizeSessions: async () => {
        synchronizationCalls += 1;
      },
      readProjectRows: () => projectRows,
      readSessionRows: (since) => {
        capturedSince = since;
        return sessionRows;
      },
      resolveDisplayName: async (projectName) => projectName,
    },
  );

  assert.equal(synchronizationCalls, 0);
  assert.equal(capturedSince, '2026-07-23T11:00:00.000Z');
  assert.deepEqual(projects.map((project) => project.displayName), ['Beta', 'Alpha']);
  assert.deepEqual(projects[0]?.sessions.map((session) => session.id), ['beta-newest']);
  assert.deepEqual(
    projects[1]?.sessions.map((session) => session.id),
    ['alpha-newest', 'alpha-cutoff'],
  );
  assert.deepEqual(projects[1]?.sessionMeta, { hasMore: false, total: 2 });
});

test('recent project window rejects values outside the supported range', async () => {
  await assert.rejects(
    () => getRecentProjectsWithSessions({ skipSynchronization: true, windowMinutes: 0 }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'INVALID_RECENT_SESSIONS_WINDOW');
      assert.equal(error.statusCode, 400);
      return true;
    },
  );
});
