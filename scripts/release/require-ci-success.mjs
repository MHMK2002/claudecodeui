import { pathToFileURL } from 'node:url';

const DEFAULT_API_URL = 'https://api.github.com';
const DEFAULT_TIMEOUT_MS = 60 * 60 * 1_000;
const DEFAULT_POLL_INTERVAL_MS = 15_000;
const DEFAULT_MAX_PAGES = 10;
const DEFAULT_PER_PAGE = 100;
const ELIGIBLE_EVENTS = new Set(['push', 'workflow_dispatch']);

function requireNonEmpty(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}

function requireSha(value) {
  const sha = requireNonEmpty(value, 'Expected SHA');
  if (!/^[0-9a-f]{40}$/i.test(sha)) {
    throw new Error('Expected SHA must be a full 40-character commit SHA.');
  }
  return sha.toLowerCase();
}

function requireRepository(value) {
  const repository = requireNonEmpty(value, 'GitHub repository');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error('GitHub repository must use the owner/name form.');
  }
  return repository;
}

function requireWorkflow(value) {
  const workflow = requireNonEmpty(value, 'Workflow');
  if (!/^[A-Za-z0-9_.-]+$/.test(workflow)) {
    throw new Error('Workflow must be a workflow file name or numeric ID.');
  }
  return workflow;
}

function requirePositiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function normalizeEvents(events) {
  const normalized = [...new Set(events || ELIGIBLE_EVENTS)].map((event) => requireNonEmpty(event, 'Event'));
  if (normalized.length === 0 || normalized.some((event) => !ELIGIBLE_EVENTS.has(event))) {
    throw new Error('Eligible events are limited to push and workflow_dispatch.');
  }
  return normalized;
}

export function createCiGateTitle(gateId) {
  const normalizedGateId = requireNonEmpty(gateId, 'Gate ID');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(normalizedGateId)) {
    throw new Error('Gate ID contains unsupported characters or is too long.');
  }
  return `CI gate ${normalizedGateId}`;
}

export function evaluateWorkflowRun(run, {
  expectedSha,
  events = ['push', 'workflow_dispatch'],
  expectedTitle = null,
  notBefore = null,
} = {}) {
  if (!run) return { outcome: 'pending', reason: 'no-run' };

  const sha = requireSha(expectedSha);
  const allowedEvents = normalizeEvents(events);
  if (String(run.head_sha || '').toLowerCase() !== sha) {
    return { outcome: 'rejected', reason: 'sha-mismatch' };
  }
  if (!allowedEvents.includes(run.event)) {
    return { outcome: 'rejected', reason: 'event-mismatch' };
  }
  if (expectedTitle !== null && run.display_title !== expectedTitle) {
    return { outcome: 'rejected', reason: 'title-mismatch' };
  }
  if (notBefore !== null) {
    const createdAt = Date.parse(run.created_at || '');
    const minimumCreatedAt = Date.parse(notBefore);
    if (!Number.isFinite(createdAt) || !Number.isFinite(minimumCreatedAt) || createdAt < minimumCreatedAt) {
      return { outcome: 'rejected', reason: 'stale-run' };
    }
  }

  if (run.status !== 'completed') {
    return { outcome: 'pending', reason: run.status || 'unknown-status' };
  }
  if (run.conclusion === 'success') {
    return { outcome: 'success', reason: 'success' };
  }
  return { outcome: 'failure', reason: run.conclusion || 'completed-without-conclusion' };
}

export function selectEligibleWorkflowRun(runs, criteria) {
  if (!Array.isArray(runs)) throw new Error('Workflow runs must be an array.');
  return runs
    .filter((run) => evaluateWorkflowRun(run, criteria).outcome !== 'rejected')
    .sort((left, right) => {
      const timeDifference = Date.parse(right.created_at || '') - Date.parse(left.created_at || '');
      if (Number.isFinite(timeDifference) && timeDifference !== 0) return timeDifference;
      return Number(right.id || 0) - Number(left.id || 0);
    })[0] || null;
}

export async function collectWorkflowRunPages({
  listPage,
  maxPages = DEFAULT_MAX_PAGES,
  perPage = DEFAULT_PER_PAGE,
}) {
  if (typeof listPage !== 'function') throw new Error('listPage must be a function.');
  const pageLimit = requirePositiveInteger(maxPages, 'Maximum pages');
  const pageSize = requirePositiveInteger(perPage, 'Runs per page');
  const runs = [];

  for (let page = 1; page <= pageLimit; page += 1) {
    const pageRuns = await listPage({ page, perPage: pageSize });
    if (!Array.isArray(pageRuns)) throw new Error('GitHub returned an invalid workflow-runs page.');
    runs.push(...pageRuns);
    if (pageRuns.length < pageSize) break;
  }
  return runs;
}

export async function waitForWorkflowSuccess({
  expectedSha,
  events = ['push', 'workflow_dispatch'],
  expectedTitle = null,
  notBefore = null,
  listPage,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  maxPages = DEFAULT_MAX_PAGES,
  perPage = DEFAULT_PER_PAGE,
  now = Date.now,
  sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
}) {
  const normalizedSha = requireSha(expectedSha);
  const normalizedEvents = normalizeEvents(events);
  const timeout = requirePositiveInteger(timeoutMs, 'Timeout');
  const pollInterval = requirePositiveInteger(pollIntervalMs, 'Poll interval');
  const startedAt = now();
  const maximumPolls = Math.max(1, Math.ceil(timeout / pollInterval) + 1);
  const criteria = {
    expectedSha: normalizedSha,
    events: normalizedEvents,
    expectedTitle,
    notBefore,
  };

  for (let poll = 0; poll < maximumPolls; poll += 1) {
    const runs = await collectWorkflowRunPages({ listPage, maxPages, perPage });
    const run = selectEligibleWorkflowRun(runs, criteria);
    const evaluation = evaluateWorkflowRun(run, criteria);
    if (evaluation.outcome === 'success') return run;
    if (evaluation.outcome === 'failure') {
      throw new Error(`CI run ${run.id || 'unknown'} completed with ${evaluation.reason}.`);
    }

    const elapsed = Math.max(0, now() - startedAt);
    if (elapsed >= timeout || poll === maximumPolls - 1) break;
    await sleep(Math.min(pollInterval, timeout - elapsed));
  }

  throw new Error(`Timed out waiting for CI success for ${normalizedSha}.`);
}

async function githubRequest({ fetchFn, apiUrl, token, repository, endpoint, method = 'GET', body }) {
  const response = await fetchFn(`${apiUrl}/repos/${repository}${endpoint}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    throw new Error(`GitHub API request failed with status ${response.status}.`);
  }
  if (response.status === 204) return null;
  return response.json();
}

async function resolveTagCommit({ fetchFn, apiUrl, token, repository, tag }) {
  const tagRef = requireNonEmpty(tag, 'Immutable tag');
  if (!/^v[0-9]+\.[0-9]+\.[0-9]+$/.test(tagRef)) {
    throw new Error('CI dispatch requires an immutable stable vMAJOR.MINOR.PATCH tag.');
  }
  let object = (await githubRequest({
    fetchFn,
    apiUrl,
    token,
    repository,
    endpoint: `/git/ref/tags/${encodeURIComponent(tagRef)}`,
  }))?.object;
  for (let depth = 0; object?.type === 'tag' && depth < 5; depth += 1) {
    object = (await githubRequest({
      fetchFn,
      apiUrl,
      token,
      repository,
      endpoint: `/git/tags/${encodeURIComponent(object.sha)}`,
    }))?.object;
  }
  if (object?.type !== 'commit') throw new Error(`Tag ${tagRef} does not resolve to a commit.`);
  return requireSha(object.sha);
}

export function createGitHubWorkflowClient({
  token,
  repository,
  workflow = 'ci.yml',
  apiUrl = DEFAULT_API_URL,
  fetchFn = fetch,
}) {
  const normalizedToken = requireNonEmpty(token, 'GH_TOKEN');
  const normalizedRepository = requireRepository(repository);
  const normalizedWorkflow = requireWorkflow(workflow);
  const normalizedApiUrl = requireNonEmpty(apiUrl, 'GitHub API URL').replace(/\/$/, '');

  return {
    async dispatch({ ref, expectedSha, gateId }) {
      const normalizedSha = requireSha(expectedSha);
      const gateTitle = createCiGateTitle(gateId);
      const tagCommit = await resolveTagCommit({
        fetchFn,
        apiUrl: normalizedApiUrl,
        token: normalizedToken,
        repository: normalizedRepository,
        tag: ref,
      });
      if (tagCommit !== normalizedSha) {
        throw new Error(`Tag ${ref} does not resolve to the expected commit.`);
      }
      await githubRequest({
        fetchFn,
        apiUrl: normalizedApiUrl,
        token: normalizedToken,
        repository: normalizedRepository,
        endpoint: `/actions/workflows/${encodeURIComponent(normalizedWorkflow)}/dispatches`,
        method: 'POST',
        body: {
          ref,
          inputs: { expected_sha: normalizedSha, gate_id: gateId },
        },
      });
      return gateTitle;
    },
    async listPage({ page, perPage }) {
      const payload = await githubRequest({
        fetchFn,
        apiUrl: normalizedApiUrl,
        token: normalizedToken,
        repository: normalizedRepository,
        endpoint: `/actions/workflows/${encodeURIComponent(normalizedWorkflow)}/runs?per_page=${perPage}&page=${page}`,
      });
      return payload?.workflow_runs || [];
    },
  };
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  const values = { event: [] };
  for (let index = 0; index < rest.length; index += 2) {
    const option = rest[index];
    const value = rest[index + 1];
    if (!option?.startsWith('--') || value === undefined) throw new Error(`Invalid argument ${option || ''}.`);
    const key = option.slice(2).replaceAll('-', '_');
    if (key === 'event') values.event.push(value);
    else values[key] = value;
  }
  return { command, values };
}

export async function runCli(argv, env = process.env) {
  const { command, values } = parseArguments(argv);
  if (!['wait', 'dispatch-and-wait'].includes(command)) {
    throw new Error('Usage: require-ci-success.mjs <wait|dispatch-and-wait> [options].');
  }
  const client = createGitHubWorkflowClient({
    token: env.GH_TOKEN,
    repository: values.repository || env.GITHUB_REPOSITORY,
    workflow: values.workflow || 'ci.yml',
    apiUrl: env.GITHUB_API_URL || DEFAULT_API_URL,
  });
  const expectedSha = values.expected_sha;
  let expectedTitle = values.gate_title || null;
  let notBefore = null;
  if (command === 'dispatch-and-wait') {
    notBefore = new Date(Math.floor(Date.now() / 1_000) * 1_000).toISOString();
    expectedTitle = await client.dispatch({
      ref: values.ref,
      expectedSha,
      gateId: values.gate_id,
    });
  }

  const run = await waitForWorkflowSuccess({
    expectedSha,
    events: values.event.length > 0
      ? values.event
      : command === 'dispatch-and-wait'
        ? ['workflow_dispatch']
        : ['push', 'workflow_dispatch'],
    expectedTitle,
    notBefore,
    listPage: (page) => client.listPage(page),
    timeoutMs: Number(values.timeout_seconds || DEFAULT_TIMEOUT_MS / 1_000) * 1_000,
    pollIntervalMs: Number(values.poll_seconds || DEFAULT_POLL_INTERVAL_MS / 1_000) * 1_000,
    maxPages: Number(values.max_pages || DEFAULT_MAX_PAGES),
  });
  process.stdout.write(`CI run ${run.id} succeeded for ${requireSha(expectedSha)}.\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedPath === import.meta.url) {
  runCli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'CI gate failed.'}\n`);
    process.exitCode = 1;
  });
}
