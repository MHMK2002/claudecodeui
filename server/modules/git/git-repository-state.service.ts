import path from 'node:path';

type RunGit = (
  command: string,
  args: string[],
  options: Record<string, unknown>,
) => Promise<{ stdout: string; stderr: string }>;

type GitRepositoryOperation = 'merge' | 'rebase' | null;

/**
 * Builds the merge/rebase state boundary consumed by Git status and Continue
 * routes. Filesystem probes use paths returned by Git itself, so worktrees and
 * non-standard git dirs remain supported.
 */
export function createGitRepositoryStateService(dependencies: {
  runGit: RunGit;
  access: (filePath: string) => Promise<void>;
}) {
  const gitPathExists = async (projectPath: string, gitPathName: string): Promise<boolean> => {
    try {
      const { stdout } = await dependencies.runGit(
        'git',
        ['rev-parse', '--git-path', gitPathName],
        { cwd: projectPath },
      );
      const candidate = stdout.trim();
      if (!candidate) return false;
      await dependencies.access(path.isAbsolute(candidate) ? candidate : path.resolve(projectPath, candidate));
      return true;
    } catch {
      return false;
    }
  };

  const getOperation = async (projectPath: string): Promise<GitRepositoryOperation> => {
    if (await gitPathExists(projectPath, 'rebase-merge') || await gitPathExists(projectPath, 'rebase-apply')) {
      return 'rebase';
    }
    if (await gitPathExists(projectPath, 'MERGE_HEAD')) return 'merge';
    return null;
  };

  const inspect = async (projectPath: string): Promise<{
    operation: GitRepositoryOperation;
    conflicts: string[];
  }> => {
    const { stdout } = await dependencies.runGit(
      'git',
      ['diff', '--name-only', '--diff-filter=U'],
      { cwd: projectPath },
    );
    return {
      operation: await getOperation(projectPath),
      conflicts: stdout.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean),
    };
  };

  return {
    inspect,

    async continueOperation(projectPath: string, operation: Exclude<GitRepositoryOperation, null>) {
      const state = await inspect(projectPath);
      if (state.operation !== operation) {
        throw new Error(`No ${operation} operation is ready to continue.`);
      }
      if (state.conflicts.length > 0) {
        throw new Error(`${operation} conflict: resolve all conflicts manually before continuing.`);
      }
      return dependencies.runGit(
        'git',
        [operation, '--continue'],
        { cwd: projectPath, env: { ...process.env, GIT_EDITOR: 'true' } },
      );
    },

    async abortOperation(projectPath: string, operation: Exclude<GitRepositoryOperation, null>) {
      const activeOperation = await getOperation(projectPath);
      if (activeOperation !== operation) {
        throw new Error(`No ${operation} operation is active.`);
      }
      return dependencies.runGit('git', [operation, '--abort'], { cwd: projectPath });
    },
  };
}
