import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import spawn from 'cross-spawn';

const TASKMASTER_MCP_NAME = 'task-master-ai';
const TASKMASTER_IMPORT = [
  '## Task Master AI Instructions',
  "**Import Task Master's development workflow commands and guidelines, treat as if import is in the main CLAUDE.md file.**",
  '@./.taskmaster/CLAUDE.md',
].join('\n');
const REQUIRED_TASKMASTER_FILES = [
  '.taskmaster/config.json',
  '.taskmaster/state.json',
  '.taskmaster/tasks/tasks.json',
  '.taskmaster/CLAUDE.md',
];

type InitializerError = Error & { code: string; statusCode: number; recovery?: 'RETRY' | 'REPAIR' };
type CommandResult = { stdout: string; stderr: string };
type FileSnapshot = { exists: boolean; content: Buffer | null; mode: number | null };
type TaskmasterClassification = {
  status: 'missing' | 'partial' | 'invalid' | 'valid';
  missing: string[];
  invalid: string[];
};
type JsonObject = Record<string, unknown>;
type InitFileAction = 'create' | 'replace' | 'merge';
type InitFileOperation = {
  path: string;
  action: InitFileAction;
  description: string;
  source: 'reference' | 'generated';
};
type InitPlan = {
  attemptId: string;
  projectPath: string;
  before: TaskmasterClassification;
  operations: InitFileOperation[];
  modelDefaults: unknown;
  changesExistingModelDefaults: false;
  repair: boolean;
};
type InitProgress = {
  stage: 'backup' | 'taskmaster' | 'instructions' | 'integration' | 'validate' | 'rollback' | 'success';
  message: string;
  completed: number;
  total: number;
};
type InitResult = {
  plan: InitPlan;
  after: TaskmasterClassification;
  added: string[];
  replaced: string[];
  merged: string[];
  rollbackPerformed: boolean;
};
type InitAttempt = {
  plan: InitPlan;
  referencePath: string;
  createdAt: number;
  cancelled: boolean;
  applyPromise: Promise<InitResult> | null;
  result: InitResult | null;
};
type BackupEntry = { relativePath: string; existed: boolean };

const ATTEMPT_TTL_MS = 30 * 60 * 1000;
const BACKUP_TARGETS = ['.taskmaster', path.join('.claude', 'commands', 'tm'), 'CLAUDE.md', '.mcp.json'];
const initAttempts = new Map<string, InitAttempt>();
const projectLocks = new Map<string, string>();
let forcedFailureStage: InitProgress['stage'] | null = null;

const isRecord = (value: unknown): value is JsonObject => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

function initializerError(message: string, code: string, statusCode = 400): InitializerError {
  const error = new Error(message) as InitializerError;
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function runCommand(command: string, args: string[], cwd: string): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(initializerError(stderr || stdout || `${command} exited with ${code}.`, 'TASKMASTER_INIT_FAILED', 500));
    });
  });
}

function taskMasterCommand(): string {
  const candidates = [
    process.env.VOLTA_HOME ? path.join(process.env.VOLTA_HOME, 'bin', 'task-master') : null,
    path.join(os.homedir(), '.volta', 'bin', 'task-master'),
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? 'task-master';
}

function snapshotFile(filePath: string): FileSnapshot {
  if (!fs.existsSync(filePath)) {
    return { exists: false, content: null, mode: null };
  }
  const stats = fs.statSync(filePath);
  return {
    exists: true,
    content: fs.readFileSync(filePath),
    mode: stats.mode,
  };
}

function restoreFile(filePath: string, snapshot: FileSnapshot): void {
  if (!snapshot.exists) {
    fs.rmSync(filePath, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (snapshot.content !== null) fs.writeFileSync(filePath, snapshot.content);
  if (snapshot.mode !== null) {
    fs.chmodSync(filePath, snapshot.mode);
  }
}

function snapshotMatches(filePath: string, snapshot: FileSnapshot): boolean {
  if (fs.existsSync(filePath) !== snapshot.exists) {
    return false;
  }
  if (!snapshot.exists) {
    return true;
  }
  return snapshot.content !== null && fs.readFileSync(filePath).equals(snapshot.content);
}

function atomicWrite(filePath: string, content: string | Buffer, mode: number | null): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, content, { mode: mode ?? 0o600 });
  fs.renameSync(tempPath, filePath);
}

function assertValidJson(filePath: string, label: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw initializerError(
      `${label} is malformed and was not overwritten: ${error instanceof Error ? error.message : String(error)}`,
      'TASKMASTER_CONFIG_CONFLICT',
      409,
    );
  }
}

function copyMissingTree(sourceRoot: string, targetRoot: string, relative = ''): string[] {
  const sourcePath = path.join(sourceRoot, relative);
  const targetPath = path.join(targetRoot, relative);
  const stats = fs.statSync(sourcePath);
  const added: string[] = [];
  if (stats.isDirectory()) {
    if (!fs.existsSync(targetPath)) {
      fs.mkdirSync(targetPath, { recursive: true, mode: stats.mode });
    }
    for (const entry of fs.readdirSync(sourcePath)) {
      added.push(...copyMissingTree(sourceRoot, targetRoot, path.join(relative, entry)));
    }
    return added;
  }
  if (fs.existsSync(targetPath)) {
    return added;
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(targetPath, stats.mode);
  added.push(relative);
  return added;
}

function mergeClaudeInstructions(projectPath: string): { changed: boolean; file: string } {
  const filePath = path.join(projectPath, 'CLAUDE.md');
  if (!fs.existsSync(filePath)) {
    atomicWrite(filePath, `# Claude Code Instructions\n\n${TASKMASTER_IMPORT}\n`, 0o644);
    return { changed: true, file: 'CLAUDE.md' };
  }
  const original = fs.readFileSync(filePath, 'utf8');
  if (original.includes('@./.taskmaster/CLAUDE.md')) {
    return { changed: false, file: 'CLAUDE.md' };
  }
  const separator = original.endsWith('\n') ? '\n' : '\n\n';
  atomicWrite(filePath, `${original}${separator}${TASKMASTER_IMPORT}\n`, fs.statSync(filePath).mode);
  return { changed: true, file: 'CLAUDE.md' };
}

function findTaskMasterMcpEntry(mcpServers: JsonObject): string | null {
  if (mcpServers[TASKMASTER_MCP_NAME]) {
    return TASKMASTER_MCP_NAME;
  }
  return Object.keys(mcpServers).find((name) => {
    const entry = mcpServers[name];
    return isRecord(entry)
      && Array.isArray(entry.args)
      && entry.args.some((arg: unknown) => String(arg).includes('task-master-ai'));
  }) ?? null;
}

function isPlaceholderSecret(value: unknown): boolean {
  return typeof value === 'string' && /^YOUR_.+_HERE$/.test(value);
}

function buildProjectMcpContent(projectPath: string): {
  before: string | null;
  after: string;
  mode: number;
} {
  const filePath = path.join(projectPath, '.mcp.json');
  const documentValue = fs.existsSync(filePath)
    ? assertValidJson(filePath, '.mcp.json')
    : {};
  if (!isRecord(documentValue)) {
    throw initializerError('.mcp.json must contain a JSON object.', 'TASKMASTER_CONFIG_CONFLICT', 409);
  }
  const document = documentValue;
  const mcpServers = isRecord(document.mcpServers) ? document.mcpServers : {};
  document.mcpServers = mcpServers;
  const existingName = findTaskMasterMcpEntry(mcpServers);
  const existingValue = existingName ? mcpServers[existingName] : null;
  const existing = isRecord(existingValue) ? existingValue : null;
  const existingEnv = isRecord(existing?.env) ? existing.env : {};
  const preservedEnv = Object.entries(existingEnv).reduce<Record<string, unknown>>((result, [key, value]) => {
    if (!isPlaceholderSecret(value)) {
      result[key] = value;
    }
    return result;
  }, {});
  const normalized = {
    type: 'stdio',
    command: typeof existing?.command === 'string' && existing.command ? existing.command : 'npx',
    args: Array.isArray(existing?.args) && existing.args.length > 0
      ? existing.args
      : ['-y', 'task-master-ai'],
    env: {
      ...preservedEnv,
      TASK_MASTER_TOOLS: 'standard',
    },
  };
  if (existingName && existingName !== TASKMASTER_MCP_NAME) {
    delete mcpServers[existingName];
  }
  const before = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
  mcpServers[TASKMASTER_MCP_NAME] = normalized;
  const after = `${JSON.stringify(document, null, 2)}\n`;
  return {
    before,
    after,
    mode: fs.existsSync(filePath) ? fs.statSync(filePath).mode : 0o644,
  };
}

function mergeProjectMcp(projectPath: string): { changed: boolean; file: string } {
  const filePath = path.join(projectPath, '.mcp.json');
  const { before, after, mode } = buildProjectMcpContent(projectPath);
  if (before === after) {
    return { changed: false, file: '.mcp.json' };
  }
  atomicWrite(filePath, after, mode);
  return { changed: true, file: '.mcp.json' };
}

function classifyTaskMaster(projectPath: string): TaskmasterClassification {
  const taskmasterRoot = path.join(projectPath, '.taskmaster');
  if (!fs.existsSync(taskmasterRoot)) {
    return { status: 'missing', missing: [...REQUIRED_TASKMASTER_FILES], invalid: [] };
  }
  const missing = REQUIRED_TASKMASTER_FILES.filter((relative) => !fs.existsSync(path.join(projectPath, relative)));
  const invalid: string[] = [];
  for (const relative of REQUIRED_TASKMASTER_FILES.filter((entry) => entry.endsWith('.json'))) {
    const filePath = path.join(projectPath, relative);
    if (!fs.existsSync(filePath)) continue;
    try {
      JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      invalid.push(relative);
    }
  }
  if (invalid.length > 0) {
    return { status: 'invalid', missing, invalid };
  }
  return { status: missing.length > 0 ? 'partial' : 'valid', missing, invalid };
}

function ensureTasksFile(projectPath: string): boolean {
  const filePath = path.join(projectPath, '.taskmaster', 'tasks', 'tasks.json');
  if (fs.existsSync(filePath)) {
    return false;
  }
  const projectName = (() => {
    const configPath = path.join(projectPath, '.taskmaster', 'config.json');
    if (!fs.existsSync(configPath)) return path.basename(projectPath);
    const config = assertValidJson(configPath, '.taskmaster/config.json');
    const global = isRecord(config) && isRecord(config.global) ? config.global : null;
    return typeof global?.projectName === 'string' && global.projectName
      ? global.projectName
      : path.basename(projectPath);
  })();
  atomicWrite(filePath, `${JSON.stringify({
    master: {
      tasks: [],
      metadata: {
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        description: `Tasks for ${projectName}`,
      },
    },
  }, null, 2)}\n`, 0o644);
  return true;
}

async function createReferenceProject(): Promise<string> {
  const referencePath = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudcli-taskmaster-reference-'));
  const zshrcPath = path.join(os.homedir(), '.zshrc');
  const zshrcSnapshot = snapshotFile(zshrcPath);
  try {
    await runCommand(taskMasterCommand(), [
      'init',
      '--yes',
      '--skip-install',
      '--no-git',
      '--no-aliases',
      '--git-tasks',
      '--rules',
      'claude,codex',
    ], referencePath);
  } finally {
    if (!snapshotMatches(zshrcPath, zshrcSnapshot)) {
      restoreFile(zshrcPath, zshrcSnapshot);
    }
  }
  return referencePath;
}

function listRelativeFiles(rootPath: string, relativePath = ''): string[] {
  const candidate = path.join(rootPath, relativePath);
  if (!fs.existsSync(candidate)) return [];
  const stats = fs.statSync(candidate);
  if (!stats.isDirectory()) return [relativePath];
  return fs.readdirSync(candidate)
    .flatMap((entry) => listRelativeFiles(rootPath, path.join(relativePath, entry)));
}

function readReferenceModelDefaults(referencePath: string): unknown {
  const configPath = path.join(referencePath, '.taskmaster', 'config.json');
  if (!fs.existsSync(configPath)) return null;
  const config = assertValidJson(configPath, 'generated .taskmaster/config.json');
  if (!isRecord(config)) return null;
  if (config.models !== undefined) return config.models;
  return isRecord(config.global) ? config.global.models ?? null : null;
}

function markRecovery(error: unknown, recovery: 'RETRY' | 'REPAIR'): InitializerError {
  if (error instanceof Error && 'code' in error && 'statusCode' in error) {
    const deliberate = error as InitializerError;
    deliberate.recovery = recovery;
    return deliberate;
  }
  const wrapped = initializerError(
    error instanceof Error ? error.message : 'Task setup failed.',
    'TASKMASTER_INIT_FAILED',
    500,
  );
  wrapped.recovery = recovery;
  return wrapped;
}

function pruneAttempts(): void {
  const cutoff = Date.now() - ATTEMPT_TTL_MS;
  for (const [attemptId, attempt] of initAttempts) {
    if (attempt.createdAt >= cutoff || attempt.applyPromise) continue;
    fs.rmSync(attempt.referencePath, { recursive: true, force: true });
    initAttempts.delete(attemptId);
  }
}

function buildPlan(
  projectPath: string,
  referencePath: string,
  before: TaskmasterClassification,
  repair: boolean,
): InitPlan {
  const operations: InitFileOperation[] = [];
  const referenceFiles = [
    ...listRelativeFiles(path.join(referencePath, '.taskmaster')).map((entry) => path.join('.taskmaster', entry)),
    ...listRelativeFiles(path.join(referencePath, '.claude', 'commands', 'tm'))
      .map((entry) => path.join('.claude', 'commands', 'tm', entry)),
  ];

  for (const relativePath of referenceFiles) {
    const targetPath = path.join(projectPath, relativePath);
    const invalid = before.invalid.includes(relativePath);
    if (fs.existsSync(targetPath) && !invalid) continue;
    operations.push({
      path: relativePath,
      action: invalid ? 'replace' : 'create',
      description: invalid
        ? `Replace malformed ${relativePath} after backup`
        : `Create ${relativePath}`,
      source: 'reference',
    });
  }

  const tasksPath = path.join(projectPath, '.taskmaster', 'tasks', 'tasks.json');
  if (!fs.existsSync(tasksPath) && !operations.some((entry) => entry.path === '.taskmaster/tasks/tasks.json')) {
    operations.push({
      path: '.taskmaster/tasks/tasks.json',
      action: 'create',
      description: 'Create an empty TaskMaster task store',
      source: 'generated',
    });
  }

  const claudePath = path.join(projectPath, 'CLAUDE.md');
  if (!fs.existsSync(claudePath) || !fs.readFileSync(claudePath, 'utf8').includes('@./.taskmaster/CLAUDE.md')) {
    operations.push({
      path: 'CLAUDE.md',
      action: fs.existsSync(claudePath) ? 'merge' : 'create',
      description: 'Add the TaskMaster instruction import while preserving existing instructions',
      source: 'generated',
    });
  }

  try {
    const mcp = buildProjectMcpContent(projectPath);
    if (mcp.before !== mcp.after) {
      operations.push({
        path: '.mcp.json',
        action: mcp.before === null ? 'create' : 'merge',
        description: 'Add the TaskMaster MCP entry while preserving configured credentials',
        source: 'generated',
      });
    }
  } catch (error) {
    if (!repair) throw markRecovery(error, 'REPAIR');
    operations.push({
      path: '.mcp.json',
      action: 'replace',
      description: 'Replace malformed .mcp.json after backup, then add the TaskMaster MCP entry',
      source: 'generated',
    });
  }

  return {
    attemptId: `task_setup_${randomUUID()}`,
    projectPath,
    before,
    operations,
    modelDefaults: operations.some((entry) => entry.path === '.taskmaster/config.json')
      ? readReferenceModelDefaults(referencePath)
      : null,
    changesExistingModelDefaults: false,
    repair,
  };
}

function createBackup(projectPath: string): { backupPath: string; entries: BackupEntry[] } {
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudcli-taskmaster-backup-'));
  const entries = BACKUP_TARGETS.map((relativePath) => {
    const sourcePath = path.join(projectPath, relativePath);
    const existed = fs.existsSync(sourcePath);
    if (existed) {
      const destinationPath = path.join(backupPath, relativePath);
      fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
      fs.cpSync(sourcePath, destinationPath, { recursive: true, preserveTimestamps: true });
    }
    return { relativePath, existed };
  });
  return { backupPath, entries };
}

function restoreBackup(projectPath: string, backupPath: string, entries: BackupEntry[]): void {
  for (const entry of entries) {
    const targetPath = path.join(projectPath, entry.relativePath);
    fs.rmSync(targetPath, { recursive: true, force: true });
    if (!entry.existed) continue;
    const sourcePath = path.join(backupPath, entry.relativePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.cpSync(sourcePath, targetPath, { recursive: true, preserveTimestamps: true });
  }
}

function emitProgress(
  onProgress: ((progress: InitProgress) => void) | undefined,
  progress: InitProgress,
): void {
  try {
    onProgress?.(progress);
  } catch {
    // Client disconnects must not interrupt an already-confirmed filesystem transaction.
  }
}

function failAtTestStage(stage: InitProgress['stage']): void {
  if (forcedFailureStage !== stage) return;
  forcedFailureStage = null;
  throw initializerError(`Forced ${stage} failure.`, 'TASKMASTER_TEST_FAILURE', 500);
}

function assertAttemptActive(attempt: InitAttempt): void {
  if (!attempt.cancelled) return;
  const error = initializerError('Task setup was cancelled.', 'TASKMASTER_INIT_CANCELLED', 409);
  error.recovery = 'RETRY';
  throw error;
}

const yieldToCancellation = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function copyPlannedReferenceFile(attempt: InitAttempt, operation: InitFileOperation): void {
  const sourcePath = path.join(attempt.referencePath, operation.path);
  const targetPath = path.join(attempt.plan.projectPath, operation.path);
  if (!fs.existsSync(sourcePath)) {
    throw initializerError(`Generated setup file is missing: ${operation.path}`, 'TASKMASTER_REFERENCE_INVALID', 500);
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
  fs.chmodSync(targetPath, fs.statSync(sourcePath).mode);
}

async function applyAttempt(
  attempt: InitAttempt,
  onProgress?: (progress: InitProgress) => void,
): Promise<InitResult> {
  const { plan } = attempt;
  const existingLock = projectLocks.get(plan.projectPath);
  if (existingLock && existingLock !== plan.attemptId) {
    const error = initializerError('Another Task setup is already running for this project.', 'TASKMASTER_INIT_LOCKED', 409);
    error.recovery = 'RETRY';
    throw error;
  }
  projectLocks.set(plan.projectPath, plan.attemptId);

  let backup: ReturnType<typeof createBackup> | null = null;
  let writesStarted = false;
  const added: string[] = [];
  const replaced: string[] = [];
  const merged: string[] = [];
  const total = 6;

  try {
    assertAttemptActive(attempt);
    if (JSON.stringify(classifyTaskMaster(plan.projectPath)) !== JSON.stringify(plan.before)) {
      const error = initializerError('TaskMaster files changed after preview. Analyze again.', 'TASKMASTER_PLAN_STALE', 409);
      error.recovery = 'RETRY';
      throw error;
    }

    emitProgress(onProgress, { stage: 'backup', message: 'Backing up existing TaskMaster files', completed: 0, total });
    backup = createBackup(plan.projectPath);
    writesStarted = true;
    await yieldToCancellation();
    assertAttemptActive(attempt);

    emitProgress(onProgress, { stage: 'taskmaster', message: 'Applying TaskMaster project files', completed: 1, total });
    for (const operation of plan.operations.filter((entry) => entry.source === 'reference' && entry.path.startsWith('.taskmaster'))) {
      copyPlannedReferenceFile(attempt, operation);
      (operation.action === 'replace' ? replaced : added).push(operation.path);
      await yieldToCancellation();
      assertAttemptActive(attempt);
    }
    if (ensureTasksFile(plan.projectPath)) added.push('.taskmaster/tasks/tasks.json');
    await yieldToCancellation();
    failAtTestStage('taskmaster');

    emitProgress(onProgress, { stage: 'instructions', message: 'Adding project instructions and commands', completed: 2, total });
    for (const operation of plan.operations.filter((entry) => entry.source === 'reference' && entry.path.startsWith('.claude'))) {
      copyPlannedReferenceFile(attempt, operation);
      added.push(operation.path);
      await yieldToCancellation();
      assertAttemptActive(attempt);
    }
    if (plan.operations.some((entry) => entry.path === 'CLAUDE.md')) {
      const change = mergeClaudeInstructions(plan.projectPath);
      if (change.changed) merged.push(change.file);
    }

    emitProgress(onProgress, { stage: 'integration', message: 'Configuring the project integration', completed: 3, total });
    const mcpOperation = plan.operations.find((entry) => entry.path === '.mcp.json');
    if (mcpOperation?.action === 'replace') atomicWrite(path.join(plan.projectPath, '.mcp.json'), '{}\n', 0o644);
    if (mcpOperation) {
      const change = mergeProjectMcp(plan.projectPath);
      if (change.changed) (mcpOperation.action === 'replace' ? replaced : merged).push(change.file);
    }
    await yieldToCancellation();
    failAtTestStage('integration');
    assertAttemptActive(attempt);

    emitProgress(onProgress, { stage: 'validate', message: 'Validating TaskMaster setup', completed: 4, total });
    const after = classifyTaskMaster(plan.projectPath);
    if (after.status !== 'valid') {
      throw initializerError('TaskMaster setup did not produce a valid project.', 'TASKMASTER_REPAIR_INCOMPLETE', 500);
    }

    const result: InitResult = {
      plan,
      after,
      added: [...new Set(added)],
      replaced: [...new Set(replaced)],
      merged: [...new Set(merged)],
      rollbackPerformed: false,
    };
    emitProgress(onProgress, { stage: 'success', message: 'TaskMaster setup complete', completed: total, total });
    attempt.result = result;
    return result;
  } catch (error) {
    if (writesStarted && backup) {
      emitProgress(onProgress, { stage: 'rollback', message: 'Restoring the pre-setup backup', completed: 5, total });
      try {
        restoreBackup(plan.projectPath, backup.backupPath, backup.entries);
      } catch (rollbackError) {
        throw markRecovery(
          new Error(`Task setup failed and automatic rollback also failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`),
          'REPAIR',
        );
      }
    }
    throw markRecovery(error, error instanceof Error && 'code' in error && error.code === 'TASKMASTER_INIT_CANCELLED' ? 'RETRY' : 'REPAIR');
  } finally {
    if (backup) fs.rmSync(backup.backupPath, { recursive: true, force: true });
    fs.rmSync(attempt.referencePath, { recursive: true, force: true });
    if (projectLocks.get(plan.projectPath) === plan.attemptId) projectLocks.delete(plan.projectPath);
  }
}

/** Used by Taskmaster routes to analyze, preview, apply, cancel, and repair setup transactions. */
export const taskmasterInitializerService = {
  classify(projectPath: string) {
    return classifyTaskMaster(projectPath);
  },

  async analyze(projectPath: string, options: { repair?: boolean } = {}): Promise<InitPlan> {
    pruneAttempts();
    const resolvedProjectPath = path.resolve(projectPath);
    if (!fs.existsSync(resolvedProjectPath) || !fs.statSync(resolvedProjectPath).isDirectory()) {
      throw initializerError('Project directory does not exist.', 'PROJECT_PATH_INVALID', 404);
    }
    const before = classifyTaskMaster(resolvedProjectPath);
    const repair = options.repair === true;
    if (before.status === 'invalid' && !repair) {
      const error = initializerError(
        `TaskMaster contains malformed files: ${before.invalid.join(', ')}`,
        'TASKMASTER_CONFIG_CONFLICT',
        409,
      );
      error.recovery = 'REPAIR';
      throw error;
    }

    const referencePath = await createReferenceProject();
    try {
      const plan = buildPlan(resolvedProjectPath, referencePath, before, repair);
      initAttempts.set(plan.attemptId, {
        plan,
        referencePath,
        createdAt: Date.now(),
        cancelled: false,
        applyPromise: null,
        result: null,
      });
      return plan;
    } catch (error) {
      fs.rmSync(referencePath, { recursive: true, force: true });
      throw error;
    }
  },

  async apply(
    projectPath: string,
    attemptId: string,
    options: { onProgress?: (progress: InitProgress) => void } = {},
  ): Promise<InitResult> {
    pruneAttempts();
    const attempt = initAttempts.get(attemptId);
    const resolvedProjectPath = path.resolve(projectPath);
    if (!attempt || attempt.plan.projectPath !== resolvedProjectPath) {
      const error = initializerError('Task setup preview expired. Analyze again.', 'TASKMASTER_ATTEMPT_NOT_FOUND', 404);
      error.recovery = 'RETRY';
      throw error;
    }
    if (attempt.result) {
      emitProgress(options.onProgress, {
        stage: 'success',
        message: 'TaskMaster setup was already completed',
        completed: 6,
        total: 6,
      });
      return attempt.result;
    }
    if (!attempt.applyPromise) {
      attempt.applyPromise = applyAttempt(attempt, options.onProgress)
        .finally(() => {
          attempt.applyPromise = null;
        });
    }
    return attempt.applyPromise;
  },

  cancel(projectPath: string, attemptId: string): { cancelled: boolean } {
    const attempt = initAttempts.get(attemptId);
    if (!attempt || attempt.plan.projectPath !== path.resolve(projectPath) || attempt.result) {
      return { cancelled: false };
    }
    attempt.cancelled = true;
    if (!attempt.applyPromise) {
      fs.rmSync(attempt.referencePath, { recursive: true, force: true });
      initAttempts.delete(attemptId);
    }
    return { cancelled: true };
  },

  async initializeOrRepair(projectPath: string): Promise<InitResult> {
    const plan = await this.analyze(projectPath, { repair: true });
    return this.apply(projectPath, plan.attemptId);
  },

  _test: {
    classifyTaskMaster,
    copyMissingTree,
    mergeClaudeInstructions,
    mergeProjectMcp,
    ensureTasksFile,
    buildPlan,
    createBackup,
    restoreBackup,
    resetAttempts() {
      for (const attempt of initAttempts.values()) {
        fs.rmSync(attempt.referencePath, { recursive: true, force: true });
      }
      initAttempts.clear();
      projectLocks.clear();
      forcedFailureStage = null;
    },
    registerAttemptFromReference(projectPath: string, referencePath: string, repair = false) {
      const resolvedProjectPath = path.resolve(projectPath);
      const plan = buildPlan(
        resolvedProjectPath,
        referencePath,
        classifyTaskMaster(resolvedProjectPath),
        repair,
      );
      initAttempts.set(plan.attemptId, {
        plan,
        referencePath,
        createdAt: Date.now(),
        cancelled: false,
        applyPromise: null,
        result: null,
      });
      return plan;
    },
    forceFailureAt(stage: InitProgress['stage'] | null) {
      forcedFailureStage = stage;
    },
  },
};
