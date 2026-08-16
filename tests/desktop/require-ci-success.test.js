import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectWorkflowRunPages,
  createCiGateTitle,
  createGitHubWorkflowClient,
  evaluateWorkflowRun,
  selectEligibleWorkflowRun,
  waitForWorkflowSuccess,
} from '../../scripts/release/require-ci-success.mjs';

const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const CREATED_AT = '2026-08-16T12:00:00.000Z';

function run(overrides = {}) {
  return {
    id: 100,
    head_sha: SHA,
    event: 'workflow_dispatch',
    display_title: 'CI gate release-100-1',
    created_at: CREATED_AT,
    status: 'completed',
    conclusion: 'success',
    ...overrides,
  };
}

const criteria = {
  expectedSha: SHA,
  events: ['workflow_dispatch'],
  expectedTitle: 'CI gate release-100-1',
  notBefore: CREATED_AT,
};

test('pure CI evaluation accepts only the exact successful dispatch identity', () => {
  assert.deepEqual(evaluateWorkflowRun(null, criteria), { outcome: 'pending', reason: 'no-run' });
  assert.equal(evaluateWorkflowRun(run(), criteria).outcome, 'success');
  assert.deepEqual(evaluateWorkflowRun(run({ head_sha: OTHER_SHA }), criteria), {
    outcome: 'rejected',
    reason: 'sha-mismatch',
  });
  assert.deepEqual(evaluateWorkflowRun(run({ event: 'pull_request' }), criteria), {
    outcome: 'rejected',
    reason: 'event-mismatch',
  });
  assert.deepEqual(evaluateWorkflowRun(run({ display_title: 'CI gate wrong' }), criteria), {
    outcome: 'rejected',
    reason: 'title-mismatch',
  });
  assert.deepEqual(evaluateWorkflowRun(run({ created_at: '2026-08-16T11:59:59.000Z' }), criteria), {
    outcome: 'rejected',
    reason: 'stale-run',
  });
});

test('pure CI selection ignores mismatches and chooses the newest exact run', () => {
  const selected = selectEligibleWorkflowRun([
    run({ id: 201, head_sha: OTHER_SHA }),
    run({ id: 202, display_title: 'CI gate stale-title' }),
    run({ id: 203, status: 'queued', conclusion: null }),
    run({ id: 204, created_at: '2026-08-16T12:00:01.000Z' }),
  ], criteria);
  assert.equal(selected.id, 204);
});

test('workflow run collection follows pagination and remains page-bounded', async () => {
  const requestedPages = [];
  const runs = await collectWorkflowRunPages({
    perPage: 2,
    maxPages: 2,
    async listPage({ page, perPage }) {
      requestedPages.push({ page, perPage });
      return page === 1 ? [run({ id: 1 }), run({ id: 2 })] : [run({ id: 3 }), run({ id: 4 })];
    },
  });
  assert.deepEqual(requestedPages, [{ page: 1, perPage: 2 }, { page: 2, perPage: 2 }]);
  assert.deepEqual(runs.map(({ id }) => id), [1, 2, 3, 4]);
});

test('bounded polling observes queued to success without accepting unrelated runs', async () => {
  let clock = 0;
  let polls = 0;
  const result = await waitForWorkflowSuccess({
    ...criteria,
    timeoutMs: 100,
    pollIntervalMs: 10,
    now: () => clock,
    sleep: async (delay) => { clock += delay; },
    async listPage() {
      polls += 1;
      return polls === 1
        ? [run({ status: 'queued', conclusion: null }), run({ id: 90, head_sha: OTHER_SHA })]
        : [run({ id: 101 })];
    },
  });
  assert.equal(result.id, 101);
  assert.equal(polls, 2);
});

test('completed failure, cancellation, and skip are terminal CI gate failures', async () => {
  for (const conclusion of ['failure', 'cancelled', 'skipped']) {
    await assert.rejects(
      waitForWorkflowSuccess({
        ...criteria,
        timeoutMs: 10,
        pollIntervalMs: 5,
        listPage: async () => [run({ conclusion })],
      }),
      new RegExp(conclusion),
    );
  }
});

test('no eligible run reaches a bounded timeout', async () => {
  let clock = 0;
  let polls = 0;
  await assert.rejects(
    waitForWorkflowSuccess({
      ...criteria,
      timeoutMs: 20,
      pollIntervalMs: 10,
      now: () => clock,
      sleep: async (delay) => { clock += delay; },
      async listPage() {
        polls += 1;
        return [run({ head_sha: OTHER_SHA })];
      },
    }),
    /timed out/i,
  );
  assert.equal(polls, 3);
});

test('dispatch verifies an immutable tag and sends exact SHA plus unique gate ID', async () => {
  const requests = [];
  const client = createGitHubWorkflowClient({
    token: 'test-token-never-printed',
    repository: 'MHMK2002/claudecodeui',
    fetchFn: async (url, options) => {
      requests.push({ url, options });
      if (options.method === 'POST') return { ok: true, status: 204 };
      return {
        ok: true,
        status: 200,
        async json() {
          return { object: { type: 'commit', sha: SHA } };
        },
      };
    },
  });

  const title = await client.dispatch({
    ref: 'v1.2.3',
    expectedSha: SHA,
    gateId: 'release-100-1',
  });
  assert.equal(title, createCiGateTitle('release-100-1'));
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /\/git\/ref\/tags\/v1\.2\.3$/);
  assert.match(requests[1].url, /\/actions\/workflows\/ci\.yml\/dispatches$/);
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    ref: 'v1.2.3',
    inputs: { expected_sha: SHA, gate_id: 'release-100-1' },
  });
});

test('dispatch rejects a tag resolving to a different commit before mutation', async () => {
  let postCount = 0;
  const client = createGitHubWorkflowClient({
    token: 'test-token-never-printed',
    repository: 'MHMK2002/claudecodeui',
    fetchFn: async (_url, options) => {
      if (options.method === 'POST') postCount += 1;
      return {
        ok: true,
        status: 200,
        async json() {
          return { object: { type: 'commit', sha: OTHER_SHA } };
        },
      };
    },
  });
  await assert.rejects(
    client.dispatch({ ref: 'v1.2.3', expectedSha: SHA, gateId: 'release-100-1' }),
    /does not resolve to the expected commit/i,
  );
  assert.equal(postCount, 0);
});
