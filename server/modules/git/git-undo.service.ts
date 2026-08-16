import { randomUUID } from 'node:crypto';
import path from 'node:path';

const MAX_UNDO_FILE_BYTES = 5 * 1024 * 1024;
const UNDO_TTL_MS = 5 * 60 * 1000;

type UndoEntry = {
  projectId: string;
  absolutePath: string;
  content: Buffer | null;
  expiresAt: number;
};

/**
 * Creates short-lived, process-local file snapshots for feasible Git discard
 * and untracked-delete undo. Directories and large files deliberately return
 * null rather than promising an unsafe or incomplete rollback.
 */
export function createGitUndoService(dependencies: {
  stat: (filePath: string) => Promise<{ isFile(): boolean; size: number }>;
  readFile: (filePath: string) => Promise<Buffer>;
  writeFile: (filePath: string, content: Buffer) => Promise<void>;
  mkdir: (directoryPath: string, options: { recursive: true }) => Promise<unknown>;
  rm: (filePath: string, options: { force: true }) => Promise<void>;
  now?: () => number;
  createId?: () => string;
}) {
  const entries = new Map<string, UndoEntry>();
  const now = dependencies.now ?? Date.now;
  const createId = dependencies.createId ?? randomUUID;

  const prune = () => {
    const currentTime = now();
    for (const [token, entry] of entries) {
      if (entry.expiresAt <= currentTime) entries.delete(token);
    }
  };

  return {
    async capture(input: {
      projectId: string;
      repositoryRoot: string;
      relativePath: string;
      /** True when undo should remove a file that the Git restore will recreate. */
      currentlyMissing?: boolean;
    }): Promise<string | null> {
      prune();
      const root = path.resolve(input.repositoryRoot);
      const absolutePath = path.resolve(root, input.relativePath);
      if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) return null;

      let content: Buffer | null = null;
      if (!input.currentlyMissing) {
        try {
          const stats = await dependencies.stat(absolutePath);
          if (!stats.isFile() || stats.size > MAX_UNDO_FILE_BYTES) return null;
          content = await dependencies.readFile(absolutePath);
        } catch {
          return null;
        }
      }

      const token = createId();
      entries.set(token, {
        projectId: input.projectId,
        absolutePath,
        content,
        expiresAt: now() + UNDO_TTL_MS,
      });
      return token;
    },

    async restore(projectId: string, token: string): Promise<'restored' | 'missing' | 'expired'> {
      const entry = entries.get(token);
      if (!entry || entry.projectId !== projectId) return 'missing';
      entries.delete(token);
      if (entry.expiresAt <= now()) return 'expired';

      if (entry.content === null) {
        await dependencies.rm(entry.absolutePath, { force: true });
      } else {
        await dependencies.mkdir(path.dirname(entry.absolutePath), { recursive: true });
        await dependencies.writeFile(entry.absolutePath, entry.content);
      }
      return 'restored';
    },
  };
}
