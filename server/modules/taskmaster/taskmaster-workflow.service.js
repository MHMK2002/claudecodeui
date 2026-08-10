import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import spawn from 'cross-spawn';

import { sessionsDb } from '@/modules/database/index.js';

const WORKFLOW_VERSION = 1;
const MAX_PROPOSAL_BYTES = 256 * 1024;
const MAX_PROPOSAL_CAPTURE_BYTES = MAX_PROPOSAL_BYTES * 2;
const LAUNCH_LEASE_MS = 5 * 60 * 1000;
const PROVIDERS = new Set(['claude', 'codex', 'cursor', 'opencode']);
const PROPOSAL_OPEN_TAG = '<cloudcli-task-proposal>';
const PROPOSAL_CLOSE_TAG = '</cloudcli-task-proposal>';

/** @type {Map<string, Promise<void>>} */
const projectLockTails = new Map();

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = stableValue(value[key]);
        return result;
      }, {});
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function workflowPath(projectPath) {
  return path.join(projectPath, '.taskmaster', 'cloudcli-workflow.json');
}

function proposalPath(projectPath, intakeId) {
  return path.join(projectPath, '.taskmaster', 'intakes', `${intakeId}.proposal.json`);
}

function emptyWorkflow() {
  return {
    version: WORKFLOW_VERSION,
    intakes: {},
    approvals: {},
    tasks: {},
    launches: {},
  };
}

function normalizeWorkflow(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    version: WORKFLOW_VERSION,
    intakes: source.intakes && typeof source.intakes === 'object' ? source.intakes : {},
    approvals: source.approvals && typeof source.approvals === 'object' ? source.approvals : {},
    tasks: source.tasks && typeof source.tasks === 'object' ? source.tasks : {},
    launches: source.launches && typeof source.launches === 'object' ? source.launches : {},
  };
}

function readWorkflow(projectPath) {
  const filePath = workflowPath(projectPath);
  if (!fs.existsSync(filePath)) {
    return emptyWorkflow();
  }
  return normalizeWorkflow(JSON.parse(fs.readFileSync(filePath, 'utf8')));
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  const descriptor = fs.openSync(tempPath, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, payload, 'utf8');
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(tempPath, filePath);
}

function writeWorkflow(projectPath, workflow) {
  atomicWriteJson(workflowPath(projectPath), workflow);
}

async function withProjectLock(projectPath, operation) {
  const key = path.resolve(projectPath);
  const previous = projectLockTails.get(key) ?? Promise.resolve();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  projectLockTails.set(key, tail);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (projectLockTails.get(key) === tail) {
      projectLockTails.delete(key);
    }
  }
}

function normalizeUserId(userId) {
  const value = String(userId ?? '').trim();
  if (!/^\d+$/.test(value) || Number(value) <= 0) {
    throw workflowError('Authenticated user is required.', 'AUTHENTICATED_USER_REQUIRED', 401);
  }
  return value;
}

function normalizeProvider(provider) {
  const value = String(provider ?? '').trim();
  if (!PROVIDERS.has(value)) {
    throw workflowError('A supported provider is required.', 'INVALID_PROVIDER', 400);
  }
  return value;
}

function normalizeProfileId(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw workflowError('providerProfileId must be a positive integer or null.', 'INVALID_PROVIDER_PROFILE', 400);
  }
  return parsed;
}

function workflowError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function requiredString(value, name, maxLength = 100_000) {
  if (typeof value !== 'string' || !value.trim()) {
    throw workflowError(`${name} is required.`, 'INVALID_PROPOSAL', 400);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw workflowError(`${name} is too long.`, 'INVALID_PROPOSAL', 400);
  }
  return normalized;
}

function optionalString(value, name, maxLength = 200_000) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value !== 'string' || value.length > maxLength) {
    throw workflowError(`${name} must be a string.`, 'INVALID_PROPOSAL', 400);
  }
  return value.trim();
}

function stringArray(value, name) {
  if (value === null || value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw workflowError(`${name} must be an array.`, 'INVALID_PROPOSAL', 400);
  }
  return value.map((entry) => {
    if ((typeof entry !== 'string' && typeof entry !== 'number') || !String(entry).trim()) {
      throw workflowError(`${name} contains an invalid value.`, 'INVALID_PROPOSAL', 400);
    }
    return String(entry).trim();
  });
}

function recordArray(value, name) {
  if (value === null || value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw workflowError(`${name} must be an array.`, 'INVALID_PROPOSAL', 400);
  }
  return value.map((entry) => {
    if (typeof entry === 'string') {
      return { text: entry.trim() };
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw workflowError(`${name} contains an invalid value.`, 'INVALID_PROPOSAL', 400);
    }
    return stableValue(entry);
  });
}

function objectValue(value, name) {
  if (value === null || value === undefined) {
    return {};
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw workflowError(`${name} must be an object.`, 'INVALID_PROPOSAL', 400);
  }
  return stableValue(value);
}

function normalizeProposal(value, intakeId) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw workflowError('Proposal must be a JSON object.', 'INVALID_PROPOSAL', 400);
  }
  if (value.intakeId !== intakeId) {
    throw workflowError('Proposal intakeId does not match the issued intake.', 'INTAKE_MISMATCH', 409);
  }
  const priority = optionalString(value.priority, 'priority', 20) || 'medium';
  if (!['high', 'medium', 'low'].includes(priority)) {
    throw workflowError('priority must be high, medium, or low.', 'INVALID_PROPOSAL', 400);
  }
  const proposal = {
    intakeId,
    title: requiredString(value.title, 'title', 500),
    description: requiredString(value.description, 'description'),
    details: optionalString(value.details, 'details'),
    testStrategy: optionalString(value.testStrategy, 'testStrategy'),
    priority,
    dependencies: stringArray(value.dependencies, 'dependencies'),
    subtasks: recordArray(value.subtasks, 'subtasks'),
    clarificationAnswers: recordArray(value.clarificationAnswers, 'clarificationAnswers'),
    acceptedDecisions: recordArray(value.acceptedDecisions, 'acceptedDecisions'),
    acceptanceCriteria: stringArray(value.acceptanceCriteria, 'acceptanceCriteria'),
    unresolvedQuestions: stringArray(value.unresolvedQuestions, 'unresolvedQuestions'),
    projectMetadata: objectValue(value.projectMetadata, 'projectMetadata'),
    taskMetadata: objectValue(value.taskMetadata, 'taskMetadata'),
  };
  return proposal;
}

function assertCanonicalProposalPath(projectPath, intakeId) {
  const filePath = proposalPath(projectPath, intakeId);
  const parent = path.dirname(filePath);
  const resolved = path.resolve(filePath);
  if (path.dirname(resolved) !== path.resolve(parent)) {
    throw workflowError('Invalid proposal path.', 'INVALID_PROPOSAL_PATH', 400);
  }
  const taskmasterRoot = path.join(projectPath, '.taskmaster');
  for (const candidate of [taskmasterRoot, parent]) {
    if (fs.existsSync(candidate) && fs.lstatSync(candidate).isSymbolicLink()) {
      throw workflowError('Proposal directories cannot be symbolic links.', 'INVALID_PROPOSAL_PATH', 400);
    }
  }
  if (fs.existsSync(parent)) {
    const relativeParent = path.relative(fs.realpathSync(projectPath), fs.realpathSync(parent));
    if (relativeParent.startsWith('..') || path.isAbsolute(relativeParent)) {
      throw workflowError('Proposal path escapes the project.', 'INVALID_PROPOSAL_PATH', 400);
    }
  }
  return filePath;
}

function readCanonicalProposal(projectPath, intakeId) {
  const filePath = assertCanonicalProposalPath(projectPath, intakeId);
  let stats;
  try {
    stats = fs.lstatSync(filePath);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw workflowError('Proposal must be a regular file.', 'INVALID_PROPOSAL_FILE', 400);
  }
  if (stats.size > MAX_PROPOSAL_BYTES) {
    throw workflowError('Proposal file is too large.', 'PROPOSAL_TOO_LARGE', 413);
  }
  if (typeof process.getuid === 'function' && stats.uid !== process.getuid()) {
    throw workflowError('Proposal file owner is invalid.', 'INVALID_PROPOSAL_OWNER', 403);
  }
  const proposal = normalizeProposal(JSON.parse(fs.readFileSync(filePath, 'utf8')), intakeId);
  const canonical = canonicalJson(proposal);
  return {
    proposal,
    proposalHash: sha256(canonical),
    ready: proposal.unresolvedQuestions.length === 0,
  };
}

function readProviderAssistantText(message) {
  if (!message || typeof message !== 'object') {
    return '';
  }
  if (!['stream_delta', 'text'].includes(message.kind) && message.role !== 'assistant') {
    return '';
  }
  if (typeof message.content === 'string') {
    return message.content;
  }
  if (typeof message.text === 'string') {
    return message.text;
  }
  return '';
}

async function persistCapturedProposal(projectPath, intakeId, sessionId, value) {
  return withProjectLock(projectPath, async () => {
    const workflow = readWorkflow(projectPath);
    const intake = workflow.intakes[intakeId];
    if (!intake || intake.sessionId !== sessionId) {
      return;
    }
    try {
      const proposal = normalizeProposal(value, intakeId);
      assertCanonicalProposalPath(projectPath, intakeId);
      atomicWriteJson(proposalPath(projectPath, intakeId), proposal);
      intake.proposalCapturedAt = nowIso();
      intake.updatedAt = intake.proposalCapturedAt;
      delete intake.proposalCaptureError;
    } catch (error) {
      intake.proposalCaptureError = error instanceof Error ? error.message : String(error);
      intake.updatedAt = nowIso();
    }
    writeWorkflow(projectPath, workflow);
  });
}

function createProposalCapture(projectPath, intakeId, sessionId) {
  let buffer = '';
  let captured = false;
  return (message) => {
    if (captured) {
      return;
    }
    const text = readProviderAssistantText(message);
    if (!text) {
      return;
    }
    buffer = `${buffer}${text}`.slice(-MAX_PROPOSAL_CAPTURE_BYTES);
    const start = buffer.lastIndexOf(PROPOSAL_OPEN_TAG);
    if (start < 0) {
      return;
    }
    const payloadStart = start + PROPOSAL_OPEN_TAG.length;
    const end = buffer.indexOf(PROPOSAL_CLOSE_TAG, payloadStart);
    if (end < 0) {
      return;
    }
    let value;
    try {
      value = JSON.parse(buffer.slice(payloadStart, end).trim());
    } catch (error) {
      value = null;
      return withProjectLock(projectPath, async () => {
        const workflow = readWorkflow(projectPath);
        const intake = workflow.intakes[intakeId];
        if (!intake || intake.sessionId !== sessionId) {
          return;
        }
        intake.proposalCaptureError = error instanceof Error ? error.message : String(error);
        intake.updatedAt = nowIso();
        writeWorkflow(projectPath, workflow);
      });
    }
    captured = true;
    const persistence = persistCapturedProposal(projectPath, intakeId, sessionId, value);
    void persistence.catch((error) => {
      console.error('[TaskMasterWorkflow] Proposal capture failed', error);
    });
    return persistence;
  };
}

function buildIntakePrompt(intake, projectPath) {
  const relativeProposalPath = path.relative(projectPath, proposalPath(projectPath, intake.id));
  return [
    `You are handling CloudCLI TaskMaster intake ${intake.id}.`,
    '',
    'Your job is requirements clarification only. Inspect the repository read-only, ask concise questions for every material ambiguity, and never guess a requirement, UX decision, data contract, or acceptance criterion.',
    'Do not implement anything. Do not run TaskMaster add/update/set-status. Do not edit tasks.json or any project file.',
    'This intake session is enforced as read-only. Continue the chat until all material questions have explicit answers.',
    '',
    `When ready, return ${PROPOSAL_OPEN_TAG}, valid JSON with exactly this shape, and ${PROPOSAL_CLOSE_TAG}. Do not wrap the tags in a code fence:`,
    JSON.stringify({
      intakeId: intake.id,
      title: '',
      description: '',
      details: '',
      testStrategy: '',
      priority: 'medium',
      dependencies: [],
      subtasks: [],
      clarificationAnswers: [],
      acceptedDecisions: [],
      acceptanceCriteria: [],
      unresolvedQuestions: [],
      projectMetadata: {},
      taskMetadata: {},
    }, null, 2),
    '',
    `CloudCLI will validate that response and persist the only proposal transport at ${relativeProposalPath}. The proposal is not approved merely because you returned it. CloudCLI will show it to the user and requires a separate explicit Approve action before any TaskMaster task can be created.`,
    '',
    `Initial brief:\n${intake.brief}`,
  ].join('\n');
}

function readTasksDocument(projectPath) {
  const filePath = path.join(projectPath, '.taskmaster', 'tasks', 'tasks.json');
  if (!fs.existsSync(filePath)) {
    return { filePath, document: {}, entries: [] };
  }
  const document = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const entries = [];
  if (Array.isArray(document)) {
    document.forEach((task) => entries.push({ tag: 'master', task }));
  } else if (Array.isArray(document.tasks)) {
    document.tasks.forEach((task) => entries.push({ tag: 'master', task }));
  } else {
    Object.entries(document).forEach(([tag, value]) => {
      if (value && typeof value === 'object' && Array.isArray(value.tasks)) {
        value.tasks.forEach((task) => entries.push({ tag, task }));
      }
    });
  }
  return { filePath, document, entries };
}

function findTask(projectPath, taskId) {
  const target = String(taskId);
  return readTasksDocument(projectPath).entries.find(({ task }) => String(task.id) === target) ?? null;
}

function findTaskByMarker(projectPath, marker) {
  return readTasksDocument(projectPath).entries.find(({ task }) => (
    typeof task.details === 'string' && task.details.includes(marker)
  )) ?? null;
}

function formatApprovedDetails(proposal, intake, marker, proposalHash) {
  const baseDetails = proposal.details || '(none)';
  return [
    baseDetails,
    '',
    '## CloudCLI approved intake',
    marker,
    `Proposal hash: ${proposalHash}`,
    `Intake session: ${intake.sessionId ?? ''}`,
    '',
    '### Clarification answers',
    JSON.stringify(proposal.clarificationAnswers, null, 2),
    '',
    '### Accepted decisions',
    JSON.stringify(proposal.acceptedDecisions, null, 2),
    '',
    '### Acceptance criteria',
    JSON.stringify(proposal.acceptanceCriteria, null, 2),
    '',
    '### Test strategy',
    proposal.testStrategy || '',
    '',
    '### Planned subtasks',
    JSON.stringify(proposal.subtasks, null, 2),
    '',
    '### Project metadata',
    JSON.stringify(proposal.projectMetadata, null, 2),
    '',
    '### Task metadata',
    JSON.stringify(proposal.taskMetadata, null, 2),
  ].join('\n');
}

function defaultRunCli(args, cwd) {
  return new Promise((resolve, reject) => {
    const voltaCommand = path.join(os.homedir(), '.volta', 'bin', 'task-master');
    const command = fs.existsSync(voltaCommand) ? voltaCommand : 'task-master';
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(workflowError(stderr || stdout || `TaskMaster exited with code ${code}.`, 'TASKMASTER_CLI_FAILED', 500));
    });
  });
}

let runCli = defaultRunCli;

function validateSessionBinding({ projectPath, userId, sessionId, provider, providerProfileId, workflow }) {
  const normalizedUserId = normalizeUserId(userId);
  const session = sessionsDb.getSessionById(sessionId);
  if (!session) {
    throw workflowError('The allocated session was not found.', 'SESSION_NOT_FOUND', 404);
  }
  if (path.resolve(session.project_path ?? '') !== path.resolve(projectPath)) {
    throw workflowError('The session belongs to a different project.', 'SESSION_PROJECT_MISMATCH', 409);
  }
  if (session.provider !== provider) {
    throw workflowError('The session provider does not match the workflow.', 'SESSION_PROVIDER_MISMATCH', 409);
  }
  const actualProfileId = session.provider_profile_id === null || session.provider_profile_id === undefined
    ? null
    : Number(session.provider_profile_id);
  if (actualProfileId !== providerProfileId) {
    throw workflowError('The session provider profile does not match the workflow.', 'SESSION_PROFILE_MISMATCH', 409);
  }
  if (session.provider_session_id) {
    throw workflowError('The workflow requires a fresh unused session.', 'SESSION_NOT_FRESH', 409);
  }
  const isAlreadyBound = [
    ...Object.values(workflow.intakes),
    ...Object.values(workflow.launches),
  ].some((record) => record.sessionId === sessionId);
  if (isAlreadyBound) {
    throw workflowError('The session is already bound to a workflow.', 'SESSION_ALREADY_BOUND', 409);
  }
  return { session, normalizedUserId };
}

function normalizeIdempotencyKey(value) {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!/^[A-Za-z0-9._:-]{8,200}$/.test(key)) {
    throw workflowError('A valid idempotencyKey is required.', 'INVALID_IDEMPOTENCY_KEY', 400);
  }
  return key;
}

function buildLaunchSnapshot(task, taskWorkflow) {
  const proposal = taskWorkflow.proposal ?? {};
  return {
    id: task.id ?? '',
    title: task.title ?? '',
    description: task.description ?? '',
    details: task.details ?? '',
    testStrategy: task.testStrategy || proposal.testStrategy || '',
    dependencies: Array.isArray(task.dependencies) ? task.dependencies : [],
    subtasks: Array.isArray(task.subtasks) && task.subtasks.length > 0
      ? task.subtasks
      : Array.isArray(proposal.subtasks) ? proposal.subtasks : [],
    clarification: Array.isArray(proposal.clarificationAnswers) ? proposal.clarificationAnswers : [],
    acceptedDecisions: Array.isArray(proposal.acceptedDecisions) ? proposal.acceptedDecisions : [],
    acceptanceCriteria: Array.isArray(proposal.acceptanceCriteria) ? proposal.acceptanceCriteria : [],
    projectMetadata: proposal.projectMetadata ?? {},
    taskMetadata: proposal.taskMetadata ?? {},
    proposalHash: taskWorkflow.proposalHash ?? '',
  };
}

function buildImplementationPrompt(snapshot) {
  return [
    `Implement the explicitly approved TaskMaster task ${snapshot.id}: ${snapshot.title}`,
    '',
    'This is an immutable launch snapshot captured by CloudCLI. Treat every field, including empty values, as authoritative for this launch:',
    '```json',
    JSON.stringify(snapshot, null, 2),
    '```',
    '',
    'Before editing, inspect the repository and its agent instructions. If any material ambiguity still exists or the snapshot conflicts with the codebase, ask a concise clarification question and do not guess. Otherwise implement only this task, preserve unrelated changes, and verify the result in proportion to risk.',
  ].join('\n');
}

function expireStaleLaunches(workflow) {
  const cutoff = Date.now() - LAUNCH_LEASE_MS;
  let changed = false;
  Object.values(workflow.launches).forEach((attempt) => {
    if (!['reserved', 'bound', 'dispatching'].includes(attempt.status)) {
      return;
    }
    if (Date.parse(attempt.updatedAt ?? attempt.createdAt) > cutoff) {
      return;
    }
    attempt.status = 'expired';
    attempt.failure = 'Launch lease expired before provider acceptance.';
    attempt.updatedAt = nowIso();
    attempt.orphanedSessionId = attempt.sessionId ?? null;
    changed = true;
  });
  return changed;
}

async function reconcileLaunch(projectPath, attemptId) {
  return withProjectLock(projectPath, async () => {
    let workflow = readWorkflow(projectPath);
    const attempt = workflow.launches[attemptId];
    if (!attempt || attempt.status === 'linked') {
      return attempt ?? null;
    }
    if (!['accepted', 'reconciling'].includes(attempt.status)) {
      return attempt;
    }
    attempt.status = 'reconciling';
    attempt.updatedAt = nowIso();
    writeWorkflow(projectPath, workflow);

    const located = findTask(projectPath, attempt.taskId);
    if (!located) {
      attempt.reconciliationError = 'Task disappeared before reconciliation.';
      writeWorkflow(projectPath, workflow);
      return attempt;
    }
    if (located.task.status !== 'in-progress') {
      try {
        await runCli(['set-status', `--id=${attempt.taskId}`, '--status=in-progress'], projectPath);
      } catch (error) {
        workflow = readWorkflow(projectPath);
        const currentAttempt = workflow.launches[attemptId];
        currentAttempt.status = 'reconciling';
        currentAttempt.reconciliationError = error instanceof Error ? error.message : String(error);
        currentAttempt.updatedAt = nowIso();
        writeWorkflow(projectPath, workflow);
        return currentAttempt;
      }
    }

    const verified = findTask(projectPath, attempt.taskId);
    if (!verified || verified.task.status !== 'in-progress') {
      workflow = readWorkflow(projectPath);
      const currentAttempt = workflow.launches[attemptId];
      currentAttempt.status = 'reconciling';
      currentAttempt.reconciliationError = 'TaskMaster did not persist in-progress status.';
      currentAttempt.updatedAt = nowIso();
      writeWorkflow(projectPath, workflow);
      return currentAttempt;
    }

    workflow = readWorkflow(projectPath);
    const currentAttempt = workflow.launches[attemptId];
    currentAttempt.status = 'linked';
    currentAttempt.linkedAt = nowIso();
    currentAttempt.updatedAt = currentAttempt.linkedAt;
    delete currentAttempt.reconciliationError;
    const taskWorkflow = workflow.tasks[String(currentAttempt.taskId)];
    taskWorkflow.implementationSessionId = currentAttempt.sessionId;
    taskWorkflow.launchAttemptId = attemptId;
    taskWorkflow.linkedAt = currentAttempt.linkedAt;
    writeWorkflow(projectPath, workflow);
    return currentAttempt;
  });
}

async function reconcileProject(projectPath) {
  const workflow = readWorkflow(projectPath);
  const pending = Object.values(workflow.launches)
    .filter((attempt) => ['accepted', 'reconciling'].includes(attempt.status))
    .map((attempt) => attempt.id);
  for (const attemptId of pending) {
    await reconcileLaunch(projectPath, attemptId);
  }
}

export const taskmasterWorkflowService = {
  async createIntake({ projectPath, projectId, userId, brief, provider, providerProfileId }) {
    return withProjectLock(projectPath, async () => {
      const normalizedBrief = requiredString(brief, 'brief', 50_000);
      const normalizedProvider = normalizeProvider(provider);
      const normalizedProfileId = normalizeProfileId(providerProfileId);
      const intakeId = createId('intake');
      const workflow = readWorkflow(projectPath);
      const intake = {
        id: intakeId,
        projectId: String(projectId),
        userId: normalizeUserId(userId),
        brief: normalizedBrief,
        provider: normalizedProvider,
        providerProfileId: normalizedProfileId,
        status: 'created',
        proposalPath: path.relative(projectPath, proposalPath(projectPath, intakeId)),
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      workflow.intakes[intakeId] = intake;
      writeWorkflow(projectPath, workflow);
      return {
        intake,
        prompt: buildIntakePrompt(intake, projectPath),
        contentHash: sha256(buildIntakePrompt(intake, projectPath)),
      };
    });
  },

  async bindIntakeSession({ projectPath, intakeId, userId, sessionId }) {
    return withProjectLock(projectPath, async () => {
      const workflow = readWorkflow(projectPath);
      const intake = workflow.intakes[intakeId];
      if (!intake) {
        throw workflowError('Intake not found.', 'INTAKE_NOT_FOUND', 404);
      }
      const normalizedUserId = normalizeUserId(userId);
      if (intake.userId !== normalizedUserId) {
        throw workflowError('Intake belongs to a different user.', 'INTAKE_FORBIDDEN', 403);
      }
      if (intake.sessionId) {
        if (intake.sessionId === sessionId) {
          return intake;
        }
        throw workflowError('Intake already has a session.', 'INTAKE_ALREADY_BOUND', 409);
      }
      validateSessionBinding({
        projectPath,
        userId,
        sessionId,
        provider: intake.provider,
        providerProfileId: intake.providerProfileId,
        workflow,
      });
      intake.sessionId = sessionId;
      intake.status = 'bound';
      intake.updatedAt = nowIso();
      writeWorkflow(projectPath, workflow);
      const prompt = buildIntakePrompt(intake, projectPath);
      return { ...intake, prompt, contentHash: sha256(prompt) };
    });
  },

  async listIntakes({ projectPath, userId }) {
    await reconcileProject(projectPath);
    const workflow = readWorkflow(projectPath);
    const normalizedUserId = normalizeUserId(userId);
    return Object.values(workflow.intakes)
      .filter((intake) => intake.userId === normalizedUserId)
      .map((intake) => {
        let proposalResult = null;
        let proposalError = null;
        try {
          proposalResult = readCanonicalProposal(projectPath, intake.id);
        } catch (error) {
          proposalError = error instanceof Error ? error.message : String(error);
        }
        const approval = workflow.approvals[intake.id] ?? null;
        return {
          ...intake,
          proposal: proposalResult?.proposal ?? null,
          proposalHash: proposalResult?.proposalHash ?? null,
          proposalReady: Boolean(proposalResult?.ready),
          proposalError: proposalError ?? intake.proposalCaptureError ?? null,
          approvalStatus: approval?.status ?? null,
          taskId: approval?.taskId ?? null,
        };
      })
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  },

  async approveIntake({ projectPath, intakeId, userId, approved, proposalHash, idempotencyKey }) {
    if (approved !== true) {
      throw workflowError('Explicit approval is required.', 'APPROVAL_REQUIRED', 400);
    }
    const normalizedKey = normalizeIdempotencyKey(idempotencyKey);
    return withProjectLock(projectPath, async () => {
      let workflow = readWorkflow(projectPath);
      const intake = workflow.intakes[intakeId];
      if (!intake) {
        throw workflowError('Intake not found.', 'INTAKE_NOT_FOUND', 404);
      }
      if (intake.userId !== normalizeUserId(userId)) {
        throw workflowError('Intake belongs to a different user.', 'INTAKE_FORBIDDEN', 403);
      }
      if (!intake.sessionId || intake.status !== 'active') {
        throw workflowError(
          'The fresh intake session must accept its initial message before approval.',
          'INTAKE_NOT_ACTIVE',
          409,
        );
      }
      const canonical = readCanonicalProposal(projectPath, intakeId);
      if (!canonical || !canonical.ready) {
        throw workflowError('All material questions must be resolved before approval.', 'PROPOSAL_NOT_READY', 409);
      }
      if (canonical.proposalHash !== proposalHash) {
        throw workflowError('The proposal changed; review the latest revision before approving.', 'STALE_PROPOSAL', 409);
      }

      const existing = workflow.approvals[intakeId];
      if (existing) {
        if (existing.idempotencyKey !== normalizedKey || existing.proposalHash !== proposalHash) {
          throw workflowError('Approval already exists with different content.', 'APPROVAL_CONFLICT', 409);
        }
        if (existing.taskId && workflow.tasks[String(existing.taskId)]) {
          return { approval: existing, task: findTask(projectPath, existing.taskId)?.task ?? null };
        }
      }

      const marker = existing?.marker ?? `cloudcli-intake:${intakeId}:${proposalHash.slice(0, 16)}`;
      const approval = existing ?? {
        intakeId,
        userId: normalizeUserId(userId),
        proposalHash,
        idempotencyKey: normalizedKey,
        marker,
        status: 'prepared',
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      workflow.approvals[intakeId] = approval;
      writeWorkflow(projectPath, workflow);

      let markedTask = findTaskByMarker(projectPath, marker);
      if (!markedTask) {
        const details = formatApprovedDetails(canonical.proposal, intake, marker, proposalHash);
        const args = [
          'add-task',
          '--title', canonical.proposal.title,
          '--description', canonical.proposal.description,
          '--details', details,
          '--priority', canonical.proposal.priority,
        ];
        if (canonical.proposal.dependencies.length > 0) {
          args.push('--dependencies', canonical.proposal.dependencies.join(','));
        }
        try {
          await runCli(args, projectPath);
        } catch (error) {
          markedTask = findTaskByMarker(projectPath, marker);
          if (!markedTask) {
            workflow = readWorkflow(projectPath);
            const failedApproval = workflow.approvals[intakeId];
            failedApproval.status = 'failed';
            failedApproval.error = error instanceof Error ? error.message : String(error);
            failedApproval.updatedAt = nowIso();
            writeWorkflow(projectPath, workflow);
            throw error;
          }
        }
        markedTask = markedTask ?? findTaskByMarker(projectPath, marker);
      }
      if (!markedTask) {
        throw workflowError('TaskMaster did not create the marked task.', 'TASK_CREATION_NOT_FOUND', 500);
      }

      const taskId = String(markedTask.task.id);
      workflow = readWorkflow(projectPath);
      const taskCreatedApproval = workflow.approvals[intakeId];
      taskCreatedApproval.status = 'task-created';
      taskCreatedApproval.taskId = taskId;
      taskCreatedApproval.updatedAt = nowIso();
      writeWorkflow(projectPath, workflow);

      if (markedTask.task.status !== 'pending') {
        await runCli(['set-status', `--id=${taskId}`, '--status=pending'], projectPath);
      }
      const pendingTask = findTask(projectPath, taskId);
      if (!pendingTask || pendingTask.task.status !== 'pending') {
        throw workflowError('TaskMaster task was not persisted as pending.', 'TASK_NOT_PENDING', 500);
      }

      workflow = readWorkflow(projectPath);
      const finalizedApproval = workflow.approvals[intakeId];
      finalizedApproval.status = 'finalized';
      finalizedApproval.taskId = taskId;
      finalizedApproval.finalizedAt = nowIso();
      finalizedApproval.updatedAt = finalizedApproval.finalizedAt;
      workflow.tasks[taskId] = {
        taskId,
        intakeId,
        proposalHash,
        proposal: canonical.proposal,
        intakeSessionId: intake.sessionId ?? null,
        marker,
        approvedAt: finalizedApproval.finalizedAt,
      };
      intake.status = 'approved';
      intake.updatedAt = finalizedApproval.finalizedAt;
      writeWorkflow(projectPath, workflow);
      return { approval: finalizedApproval, task: pendingTask.task };
    });
  },

  async beginLaunch({ projectPath, taskId, userId, provider, providerProfileId, idempotencyKey }) {
    await reconcileProject(projectPath);
    return withProjectLock(projectPath, async () => {
      const workflow = readWorkflow(projectPath);
      if (expireStaleLaunches(workflow)) {
        writeWorkflow(projectPath, workflow);
      }
      const taskWorkflow = workflow.tasks[String(taskId)];
      if (!taskWorkflow) {
        throw workflowError('Only explicitly approved CloudCLI tasks can be launched.', 'TASK_NOT_APPROVED', 409);
      }
      if (taskWorkflow.implementationSessionId) {
        throw workflowError('Task is already linked to an implementation session.', 'TASK_ALREADY_LINKED', 409);
      }
      const located = findTask(projectPath, taskId);
      if (!located) {
        throw workflowError('Task not found.', 'TASK_NOT_FOUND', 404);
      }
      if (located.task.status !== 'pending') {
        throw workflowError('Only pending tasks can be launched.', 'TASK_NOT_PENDING', 409);
      }
      const normalizedKey = normalizeIdempotencyKey(idempotencyKey);
      const existing = Object.values(workflow.launches).find((attempt) => (
        String(attempt.taskId) === String(taskId)
        && !['failed', 'expired'].includes(attempt.status)
      ));
      if (existing) {
        if (existing.idempotencyKey === normalizedKey) {
          return existing;
        }
        throw workflowError('A launch is already active for this task.', 'LAUNCH_ALREADY_ACTIVE', 409);
      }
      const snapshot = buildLaunchSnapshot(located.task, taskWorkflow);
      const prompt = buildImplementationPrompt(snapshot);
      const attemptId = createId('launch');
      const timestamp = nowIso();
      const attempt = {
        id: attemptId,
        taskId: String(taskId),
        userId: normalizeUserId(userId),
        provider: normalizeProvider(provider),
        providerProfileId: normalizeProfileId(providerProfileId),
        idempotencyKey: normalizedKey,
        status: 'reserved',
        snapshot,
        content: prompt,
        contentHash: sha256(prompt),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      workflow.launches[attemptId] = attempt;
      writeWorkflow(projectPath, workflow);
      return attempt;
    });
  },

  async bindLaunchSession({ projectPath, attemptId, userId, sessionId }) {
    return withProjectLock(projectPath, async () => {
      const workflow = readWorkflow(projectPath);
      const attempt = workflow.launches[attemptId];
      if (!attempt) {
        throw workflowError('Launch attempt not found.', 'LAUNCH_NOT_FOUND', 404);
      }
      if (attempt.userId !== normalizeUserId(userId)) {
        throw workflowError('Launch attempt belongs to a different user.', 'LAUNCH_FORBIDDEN', 403);
      }
      if (attempt.sessionId) {
        if (attempt.sessionId === sessionId) {
          return attempt;
        }
        throw workflowError('Launch attempt already has a session.', 'LAUNCH_ALREADY_BOUND', 409);
      }
      if (attempt.status !== 'reserved') {
        throw workflowError('Launch attempt is not reservable.', 'INVALID_LAUNCH_STATE', 409);
      }
      const taskWorkflow = workflow.tasks[String(attempt.taskId)];
      if (taskWorkflow?.intakeSessionId === sessionId) {
        throw workflowError('Implementation cannot reuse the intake session.', 'SESSION_NOT_FRESH', 409);
      }
      validateSessionBinding({
        projectPath,
        userId,
        sessionId,
        provider: attempt.provider,
        providerProfileId: attempt.providerProfileId,
        workflow,
      });
      attempt.sessionId = sessionId;
      attempt.status = 'bound';
      attempt.updatedAt = nowIso();
      writeWorkflow(projectPath, workflow);
      return attempt;
    });
  },

  async getLaunch({ projectPath, attemptId, userId }) {
    await reconcileProject(projectPath);
    const workflow = readWorkflow(projectPath);
    if (expireStaleLaunches(workflow)) {
      writeWorkflow(projectPath, workflow);
    }
    const attempt = workflow.launches[attemptId];
    if (!attempt) {
      throw workflowError('Launch attempt not found.', 'LAUNCH_NOT_FOUND', 404);
    }
    if (attempt.userId !== normalizeUserId(userId)) {
      throw workflowError('Launch attempt belongs to a different user.', 'LAUNCH_FORBIDDEN', 403);
    }
    return attempt;
  },

  getSessionRuntimePolicy({ projectPath, sessionId }) {
    if (!projectPath || !sessionId) {
      return null;
    }
    const workflow = readWorkflow(projectPath);
    const intake = Object.values(workflow.intakes).find((entry) => entry.sessionId === sessionId);
    if (!intake) {
      return null;
    }
    return {
      kind: 'intake',
      permissionMode: 'plan',
      onProviderEvent: createProposalCapture(projectPath, intake.id, sessionId),
    };
  },

  async getTaskWorkflowSummary(projectPath) {
    await reconcileProject(projectPath);
    const workflow = readWorkflow(projectPath);
    return Object.entries(workflow.tasks).reduce((result, [taskId, task]) => {
      result[taskId] = {
        approved: true,
        proposalHash: task.proposalHash ?? '',
        intakeSessionId: task.intakeSessionId ?? null,
        implementationSessionId: task.implementationSessionId ?? null,
        launchAttemptId: task.launchAttemptId ?? null,
        linkedAt: task.linkedAt ?? null,
      };
      return result;
    }, {});
  },

  assertStatusChangeAllowed({ projectPath, taskId, status }) {
    if (status !== 'in-progress') {
      return;
    }
    const workflow = readWorkflow(projectPath);
    const task = workflow.tasks[String(taskId)];
    if (task && !task.implementationSessionId) {
      throw workflowError(
        'Approved CloudCLI tasks can become in-progress only through Start implementation after fresh-session delivery is accepted.',
        'IMPLEMENTATION_LAUNCH_REQUIRED',
        409,
      );
    }
  },

  async authorizeDispatch({ projectPath, userId, sessionId, workflowMessage, content }) {
    const kind = workflowMessage?.kind;
    const workflowId = typeof workflowMessage?.id === 'string' ? workflowMessage.id : '';
    const claimedHash = typeof workflowMessage?.contentHash === 'string' ? workflowMessage.contentHash : '';
    if (!workflowId || !['intake', 'implementation'].includes(kind)) {
      throw workflowError('Invalid workflow dispatch metadata.', 'INVALID_WORKFLOW_DISPATCH', 400);
    }
    const actualHash = sha256(typeof content === 'string' ? content : '');
    if (!claimedHash || claimedHash !== actualHash) {
      throw workflowError('Workflow content hash does not match the dispatched content.', 'WORKFLOW_HASH_MISMATCH', 409);
    }
    return withProjectLock(projectPath, async () => {
      const workflow = readWorkflow(projectPath);
      const record = kind === 'intake' ? workflow.intakes[workflowId] : workflow.launches[workflowId];
      if (!record) {
        throw workflowError('Workflow dispatch was not found.', 'WORKFLOW_NOT_FOUND', 404);
      }
      if (record.userId !== normalizeUserId(userId)) {
        throw workflowError('Workflow dispatch belongs to a different user.', 'WORKFLOW_FORBIDDEN', 403);
      }
      if (record.sessionId !== sessionId) {
        throw workflowError('Workflow dispatch session does not match.', 'WORKFLOW_SESSION_MISMATCH', 409);
      }
      const expectedPrompt = kind === 'intake' ? buildIntakePrompt(record, projectPath) : record.content;
      const expectedHash = sha256(expectedPrompt);
      if (claimedHash !== expectedHash || content !== expectedPrompt) {
        throw workflowError('Workflow dispatch content differs from the immutable snapshot.', 'WORKFLOW_CONTENT_MISMATCH', 409);
      }
      if (record.status !== 'bound') {
        throw workflowError('Workflow dispatch is not in a sendable state.', 'INVALID_WORKFLOW_STATE', 409);
      }
      record.status = 'dispatching';
      record.updatedAt = nowIso();
      writeWorkflow(projectPath, workflow);
      let accepted = false;
      return {
        kind,
        id: workflowId,
        onFirstProviderEvent: () => {
          if (accepted) {
            return;
          }
          accepted = true;
          const latest = readWorkflow(projectPath);
          const current = kind === 'intake' ? latest.intakes[workflowId] : latest.launches[workflowId];
          if (!current || current.status !== 'dispatching' || current.sessionId !== sessionId) {
            return;
          }
          current.status = kind === 'intake' ? 'active' : 'accepted';
          current.acceptedAt = nowIso();
          current.updatedAt = current.acceptedAt;
          writeWorkflow(projectPath, latest);
          if (kind === 'implementation') {
            void reconcileLaunch(projectPath, workflowId).catch((error) => {
              console.error('[TaskMasterWorkflow] Launch reconciliation failed', error);
            });
          }
        },
        onFailure: async (reason) => {
          if (accepted) {
            return;
          }
          await withProjectLock(projectPath, async () => {
            const latest = readWorkflow(projectPath);
            const current = kind === 'intake' ? latest.intakes[workflowId] : latest.launches[workflowId];
            if (!current || !['bound', 'dispatching'].includes(current.status)) {
              return;
            }
            current.status = 'failed';
            current.failure = reason;
            current.updatedAt = nowIso();
            current.orphanedSessionId = current.sessionId ?? null;
            writeWorkflow(projectPath, latest);
          });
        },
      };
    });
  },

  async reconcileProject(projectPath) {
    return reconcileProject(projectPath);
  },

  // Narrow test hooks; production callers use the singleton methods above.
  _test: {
    canonicalJson,
    sha256,
    normalizeProposal,
    readCanonicalProposal,
    readProviderAssistantText,
    buildLaunchSnapshot,
    buildIntakePrompt,
    createProposalCapture,
    setRunCli(nextRunner) {
      runCli = nextRunner ?? defaultRunCli;
    },
    resetRunCli() {
      runCli = defaultRunCli;
    },
  },
};
