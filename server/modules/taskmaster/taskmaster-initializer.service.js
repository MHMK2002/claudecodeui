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

function initializerError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
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
      reject(initializerError(stderr || stdout || `${command} exited with ${code}.`, 'TASKMASTER_INIT_FAILED', 500));
    });
  });
}

function taskMasterCommand() {
  const candidates = [
    process.env.VOLTA_HOME ? path.join(process.env.VOLTA_HOME, 'bin', 'task-master') : null,
    path.join(os.homedir(), '.volta', 'bin', 'task-master'),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? 'task-master';
}

function snapshotFile(filePath) {
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

function restoreFile(filePath, snapshot) {
  if (!snapshot.exists) {
    fs.rmSync(filePath, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, snapshot.content);
  if (snapshot.mode !== null) {
    fs.chmodSync(filePath, snapshot.mode);
  }
}

function snapshotMatches(filePath, snapshot) {
  if (fs.existsSync(filePath) !== snapshot.exists) {
    return false;
  }
  if (!snapshot.exists) {
    return true;
  }
  return fs.readFileSync(filePath).equals(snapshot.content);
}

function atomicWrite(filePath, content, mode) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, content, { mode: mode ?? 0o600 });
  fs.renameSync(tempPath, filePath);
}

function assertValidJson(filePath, label) {
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

function copyMissingTree(sourceRoot, targetRoot, relative = '') {
  const sourcePath = path.join(sourceRoot, relative);
  const targetPath = path.join(targetRoot, relative);
  const stats = fs.statSync(sourcePath);
  const added = [];
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

function mergeClaudeInstructions(projectPath) {
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

function findTaskMasterMcpEntry(mcpServers) {
  if (mcpServers[TASKMASTER_MCP_NAME]) {
    return TASKMASTER_MCP_NAME;
  }
  return Object.keys(mcpServers).find((name) => {
    const entry = mcpServers[name];
    return Array.isArray(entry?.args) && entry.args.some((arg) => String(arg).includes('task-master-ai'));
  }) ?? null;
}

function isPlaceholderSecret(value) {
  return typeof value === 'string' && /^YOUR_.+_HERE$/.test(value);
}

function mergeProjectMcp(projectPath) {
  const filePath = path.join(projectPath, '.mcp.json');
  const document = fs.existsSync(filePath)
    ? assertValidJson(filePath, '.mcp.json')
    : {};
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw initializerError('.mcp.json must contain a JSON object.', 'TASKMASTER_CONFIG_CONFLICT', 409);
  }
  document.mcpServers = document.mcpServers && typeof document.mcpServers === 'object'
    ? document.mcpServers
    : {};
  const existingName = findTaskMasterMcpEntry(document.mcpServers);
  const existing = existingName ? document.mcpServers[existingName] : null;
  const preservedEnv = Object.entries(existing?.env ?? {}).reduce((result, [key, value]) => {
    if (!isPlaceholderSecret(value)) {
      result[key] = value;
    }
    return result;
  }, {});
  const normalized = {
    type: 'stdio',
    command: existing?.command || 'npx',
    args: Array.isArray(existing?.args) && existing.args.length > 0
      ? existing.args
      : ['-y', 'task-master-ai'],
    env: {
      ...preservedEnv,
      TASK_MASTER_TOOLS: 'standard',
    },
  };
  if (existingName && existingName !== TASKMASTER_MCP_NAME) {
    delete document.mcpServers[existingName];
  }
  const before = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
  document.mcpServers[TASKMASTER_MCP_NAME] = normalized;
  const after = `${JSON.stringify(document, null, 2)}\n`;
  if (before === after) {
    return { changed: false, file: '.mcp.json' };
  }
  atomicWrite(filePath, after, fs.existsSync(filePath) ? fs.statSync(filePath).mode : 0o644);
  return { changed: true, file: '.mcp.json' };
}

function classifyTaskMaster(projectPath) {
  const taskmasterRoot = path.join(projectPath, '.taskmaster');
  if (!fs.existsSync(taskmasterRoot)) {
    return { status: 'missing', missing: [...REQUIRED_TASKMASTER_FILES], invalid: [] };
  }
  const missing = REQUIRED_TASKMASTER_FILES.filter((relative) => !fs.existsSync(path.join(projectPath, relative)));
  const invalid = [];
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

function ensureTasksFile(projectPath) {
  const filePath = path.join(projectPath, '.taskmaster', 'tasks', 'tasks.json');
  if (fs.existsSync(filePath)) {
    return false;
  }
  const projectName = (() => {
    const configPath = path.join(projectPath, '.taskmaster', 'config.json');
    if (!fs.existsSync(configPath)) return path.basename(projectPath);
    const config = assertValidJson(configPath, '.taskmaster/config.json');
    return config?.global?.projectName || path.basename(projectPath);
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

async function createReferenceProject() {
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

async function configureModels(projectPath) {
  const command = taskMasterCommand();
  await runCommand(command, ['models', '--set-main', 'sonnet', '--claude-code'], projectPath);
  await runCommand(command, ['models', '--set-research', 'gpt-5.2-codex', '--codex-cli'], projectPath);
  await runCommand(command, ['models', '--set-fallback', 'opus', '--claude-code'], projectPath);
}

export const taskmasterInitializerService = {
  classify(projectPath) {
    return classifyTaskMaster(projectPath);
  },

  async initializeOrRepair(projectPath) {
    const resolvedProjectPath = path.resolve(projectPath);
    if (!fs.existsSync(resolvedProjectPath) || !fs.statSync(resolvedProjectPath).isDirectory()) {
      throw initializerError('Project directory does not exist.', 'PROJECT_PATH_INVALID', 404);
    }
    const before = classifyTaskMaster(resolvedProjectPath);
    if (before.status === 'invalid') {
      throw initializerError(
        `TaskMaster contains malformed files and was not changed: ${before.invalid.join(', ')}`,
        'TASKMASTER_CONFIG_CONFLICT',
        409,
      );
    }

    const referencePath = await createReferenceProject();
    try {
      const added = copyMissingTree(
        path.join(referencePath, '.taskmaster'),
        path.join(resolvedProjectPath, '.taskmaster'),
      ).map((entry) => path.join('.taskmaster', entry));
      if (ensureTasksFile(resolvedProjectPath)) {
        added.push('.taskmaster/tasks/tasks.json');
      }
      const referenceCommands = path.join(referencePath, '.claude', 'commands', 'tm');
      if (fs.existsSync(referenceCommands)) {
        added.push(...copyMissingTree(
          referenceCommands,
          path.join(resolvedProjectPath, '.claude', 'commands', 'tm'),
        ).map((entry) => path.join('.claude', 'commands', 'tm', entry)));
      }
      const claudeMerge = mergeClaudeInstructions(resolvedProjectPath);
      const mcpMerge = mergeProjectMcp(resolvedProjectPath);
      await configureModels(resolvedProjectPath);
      const after = classifyTaskMaster(resolvedProjectPath);
      if (after.status !== 'valid') {
        throw initializerError('TaskMaster repair did not produce a valid project.', 'TASKMASTER_REPAIR_INCOMPLETE', 500);
      }
      return {
        before,
        after,
        added,
        merged: [claudeMerge, mcpMerge].filter((entry) => entry.changed).map((entry) => entry.file),
      };
    } finally {
      fs.rmSync(referencePath, { recursive: true, force: true });
    }
  },

  _test: {
    classifyTaskMaster,
    copyMissingTree,
    mergeClaudeInstructions,
    mergeProjectMcp,
    ensureTasksFile,
  },
};
