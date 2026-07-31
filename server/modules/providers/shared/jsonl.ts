import { createReadStream } from 'node:fs';
import { open, rename, stat, unlink } from 'node:fs/promises';
import { createInterface } from 'node:readline';

import { AppError } from '@/shared/utils.js';

const REWIND_TMP_SUFFIX = '.rewind';

type JsonlObject = Record<string, unknown>;

export type TruncateResult = {
  truncatedLines: number;
  backupPath: string | null;
  remainingSize: number;
};

/**
 * Reads a JSONL file line by line and returns the parsed entry whose
 * `lineIndex` matches the predicate, or -1 if none match.
 *
 * The predicate is called with the parsed object and the 0-based line index.
 * The stream is fully consumed so callers must not rely on short-circuiting
 * for side-effects — large transcripts still pay an O(n) cost.
 */
export async function findLineIndexById(
  jsonlPath: string,
  predicate: (entry: JsonlObject, lineIndex: number) => boolean,
): Promise<number> {
  const stream = createReadStream(jsonlPath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let index = 0;
  let matchIndex = -1;
  try {
    for await (const raw of rl) {
      if (!raw.trim()) {
        index += 1;
        continue;
      }
      try {
        const entry = JSON.parse(raw) as JsonlObject;
        if (predicate(entry, index)) {
          matchIndex = index;
          break;
        }
      } catch {
        // Skip malformed lines so a partial write does not break rewind.
      }
      index += 1;
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  return matchIndex;
}

function backupTimestamp(): string {
  return new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace(/Z$/, '');
}

/**
 * Truncates the JSONL transcript at the given line index (inclusive — that
 * line is the LAST line retained) using a write-tmp-then-rename strategy so a
 * crash mid-write never corrupts the original transcript.
 *
 * On success, optionally keeps a `*.bak.<timestamp>` copy of the original
 * contents next to the file so the user can manually restore if needed.
 *
 * Pass -1 to truncate everything (resulting file is empty).
 */
export async function truncateJsonlAtLine(
  jsonlPath: string,
  keepLineIndexInclusive: number,
  options: { backup?: boolean } = {},
): Promise<TruncateResult> {
  const fileStat = await stat(jsonlPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      throw new AppError(`Transcript file not found: ${jsonlPath}`, {
        code: 'TRANSCRIPT_NOT_FOUND',
        statusCode: 404,
      });
    }
    throw error;
  });

  const tmpPath = `${jsonlPath}${REWIND_TMP_SUFFIX}-${process.pid}-${Date.now()}.tmp`;
  let backupPath: string | null = null;

  if (options.backup) {
    backupPath = `${jsonlPath}.bak.${backupTimestamp()}`;
    try {
      await unlink(backupPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  const out = await open(tmpPath, 'w');
  let truncatedLines = 0;

  try {
    const stream = createReadStream(jsonlPath, { encoding: 'utf8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    let index = 0;
    for await (const raw of rl) {
      if (keepLineIndexInclusive >= 0 && index > keepLineIndexInclusive) {
        break;
      }
      if (raw.length > 0) {
        await out.write(`${raw}\n`);
        truncatedLines += 1;
      }
      index += 1;
    }

    rl.close();
    stream.destroy();

    await out.sync();
  } catch (error) {
    await out.close().catch(() => undefined);
    await unlink(tmpPath).catch(() => undefined);
    throw error;
  }

  await out.close();
  await rename(tmpPath, jsonlPath);

  if (options.backup && backupPath) {
    try {
      const source = createReadStream(jsonlPath);
      const backupOut = await open(backupPath, 'w');
      await new Promise<void>((resolve, reject) => {
        source.on('error', reject);
        source.on('end', resolve);
        source.pipe(backupOut.createWriteStream());
      });
      await backupOut.sync();
      await backupOut.close();
    } catch {
      backupPath = null;
    }
  }

  const remainingSize = (await stat(jsonlPath).catch(() => fileStat))?.size ?? fileStat.size;

  return {
    truncatedLines,
    backupPath,
    remainingSize,
  };
}
