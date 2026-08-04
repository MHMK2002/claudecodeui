import { promises as fsp } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';

export type JsonlLineIndex = {
  /** Zero-based line index into the JSONL file, ignoring trailing whitespace-only lines. */
  index: number;
  /** The raw line text as it existed in the file (without trailing newline). */
  raw: string;
};

export type FindJsonlLineResult =
  | { found: true; match: JsonlLineIndex }
  | { found: false };

/**
 * Streams a JSONL file line-by-line and returns the first line that matches
 * `predicate` along with its zero-based index. Malformed JSONL lines are
 * skipped silently so callers can keep streaming even when a runtime is
 * mid-write.
 */
export async function findJsonlLine(
  jsonlPath: string,
  predicate: (parsed: unknown, rawLine: string, index: number) => boolean,
): Promise<FindJsonlLineResult> {
  const handle = await open(jsonlPath, 'r');
  try {
    const index = await walkLines(handle, (rawLine, lineIndex) => {
      try {
        const parsed = JSON.parse(rawLine) as unknown;
        if (predicate(parsed, rawLine, lineIndex)) {
          return { done: true, value: { index: lineIndex, raw: rawLine } };
        }
      } catch {
        // Skip malformed lines.
      }
      return { done: false };
    });
    return index ? { found: true, match: index } : { found: false };
  } finally {
    await handle.close();
  }
}

async function walkLines<T>(
  handle: Awaited<ReturnType<typeof open>>,
  visitor: (rawLine: string, index: number) => { done: true; value: T } | { done: false },
): Promise<T | null> {
  let leftover = '';
  let index = 0;
  let result: T | null = null;
  const stream = handle.createReadStream({ encoding: 'utf8' });

  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk: string | Buffer) => {
      if (result !== null) return;
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const combined = leftover + text;
      const lines = combined.split('\n');
      leftover = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.length) continue;
        const step = visitor(line, index);
        if (step.done) {
          result = step.value;
          stream.destroy();
          return resolve();
        }
        index += 1;
      }
    });
    stream.on('end', () => resolve());
    stream.on('error', reject);
  });

  return result;
}

/** Flush the kept-line buffer once it reaches this size. */
const WRITE_BATCH_BYTES = 256 * 1024;

export type TruncateJsonlOptions = {
  /** When true, copy the original file to <path>.bak.<ts> after a successful rewrite. */
  backup?: boolean;
};

export type TruncateJsonlResult = {
  /** Number of lines that were kept in the rewritten file. */
  kept: number;
  /** Total number of lines that were scanned (excluding blank ones). */
  scanned: number;
  /** Backup path if a backup was created. */
  backupPath: string | null;
};

/**
 * Rewrites `jsonlPath` in place, keeping only lines with zero-based index
 * strictly less than `keepUpToIndex`. The rewrite is atomic on the same
 * filesystem: the kept lines are streamed into a sibling `.rewind-<pid>-<ts>.tmp`
 * file, fsync'd, and then renamed over the original. If anything throws the
 * temporary file is unlinked and the original file is left untouched.
 */
export async function truncateJsonlAtLine(
  jsonlPath: string,
  keepUpToIndex: number,
  options: TruncateJsonlOptions = {},
): Promise<TruncateJsonlResult> {
  if (!Number.isFinite(keepUpToIndex) || keepUpToIndex < 0) {
    throw new Error(`truncateJsonlAtLine: invalid keepUpToIndex ${keepUpToIndex}`);
  }

  const tmpPath = `${jsonlPath}.rewind-${process.pid}-${Date.now()}.tmp`;
  const dir = path.dirname(jsonlPath);
  await fsp.mkdir(dir, { recursive: true });

  const handle = await open(jsonlPath, 'r');
  let tmpHandle: Awaited<ReturnType<typeof open>> | null = null;
  let kept = 0;
  let scanned = 0;

  try {
    tmpHandle = await open(tmpPath, 'w');
    let leftover = '';
    // Buffer the kept lines and flush in batches: one write() per line costs a
    // syscall per transcript row, and long sessions run to tens of thousands.
    let pending: string[] = [];
    let pendingBytes = 0;

    const flush = async () => {
      if (pending.length === 0) return;
      const payload = pending.join('');
      pending = [];
      pendingBytes = 0;
      await tmpHandle!.write(payload);
    };

    // `for await` (NOT stream.on('data', async …)): an async 'data' listener is
    // not awaited by the stream, so the next chunk's handler starts while this
    // one is still awaiting its write. That interleaving corrupts the shared
    // `leftover`/`scanned` state and lets lines reach the tmp file out of order
    // — which silently scrambled every transcript larger than one 64 KB chunk
    // instead of truncating it. Iterating sequentially keeps chunk N fully
    // written before chunk N+1 is read.
    const stream = handle.createReadStream({ encoding: 'utf8' });
    outer: for await (const chunk of stream) {
      const text = typeof chunk === 'string' ? chunk : (chunk as Buffer).toString('utf8');
      const combined = leftover + text;
      const lines = combined.split('\n');
      leftover = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.length) continue;
        const currentIndex = scanned;
        scanned += 1;

        if (currentIndex >= keepUpToIndex) {
          break outer;
        }

        pending.push(`${line}\n`);
        pendingBytes += line.length + 1;
        kept += 1;
        if (pendingBytes >= WRITE_BATCH_BYTES) {
          await flush();
        }
      }
    }

    await flush();

    // Drop any dangling trailing data without a newline; we only ever want
    // cleanly newline-terminated entries.
    void leftover;

    if (tmpHandle) {
      await tmpHandle.sync();
      await tmpHandle.close();
      tmpHandle = null;
    }
  } catch (error) {
    if (tmpHandle) {
      try { await tmpHandle.close(); } catch { /* ignore */ }
    }
    await fsp.unlink(tmpPath).catch(() => { /* ignore */ });
    await handle.close().catch(() => { /* ignore */ });
    throw error;
  }

  await handle.close();

  // Take the backup from the file BEFORE we rename over it. The tmp file
  // holds the truncated rewrite, not the original; copying after the rename
  // would snapshot the truncated state. We want a restore-able snapshot of
  // the dropped turns.
  let backupPath: string | null = null;
  if (options.backup) {
    backupPath = `${jsonlPath}.bak.${Date.now()}`;
    try {
      await fsp.copyFile(jsonlPath, backupPath);
    } catch (error) {
      backupPath = null;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[jsonl] Backup copy failed for ${jsonlPath}:`, message);
    }
  }

  try {
    await fsp.rename(tmpPath, jsonlPath);
  } catch (error) {
    await fsp.unlink(tmpPath).catch(() => { /* ignore */ });
    if (backupPath) {
      await fsp.unlink(backupPath).catch(() => { /* ignore */ });
    }
    throw error;
  }

  return { kept, scanned, backupPath };
}
