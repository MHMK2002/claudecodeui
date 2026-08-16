import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';
import { sessionExportService } from '@/modules/providers/services/session-export.service.js';
import type { LLMProvider } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

const EMPTY_TRANSCRIPT_DIGEST = 'c4e4a2506fe2df9a217f7562f6f4c933541cf7913ffaffb4064af6fa58d675c7';

test('established provider history read failures are typed instead of becoming empty success', { concurrency: false }, async () => {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'provider-history-failure-'));
  const originalHome = os.homedir;
  (os as unknown as { homedir: () => string }).homedir = () => tempRoot;

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
  await initializeDatabase();

  try {
    const providers: LLMProvider[] = ['claude', 'codex', 'cursor', 'opencode'];
    for (const provider of providers) {
      const sessionId = `${provider}-history-failure`;
      sessionsDb.createAppSession(sessionId, provider, path.join(tempRoot, 'workspace'));
      sessionsDb.assignProviderSessionId(sessionId, `${provider}-native-missing`);

      await assert.rejects(
        sessionsService.fetchHistory(sessionId, { limit: null, offset: 0 }),
        (error: unknown) => error instanceof AppError
          && error.code === 'PROVIDER_HISTORY_UNAVAILABLE'
          && error.statusCode === 502,
        `${provider} must propagate an unavailable transcript`,
      );
      await assert.rejects(
        sessionExportService.exportSession(sessionId, 'zip', EMPTY_TRANSCRIPT_DIGEST),
        (error: unknown) => error instanceof AppError
          && error.code === 'EXPORT_HISTORY_UNAVAILABLE'
          && error.statusCode === 502,
        `${provider} export must not produce an empty success archive`,
      );
    }

    sessionsDb.createAppSession('new-session', 'claude', path.join(tempRoot, 'workspace'));
    assert.deepEqual(
      await sessionsService.fetchHistory('new-session', { limit: null, offset: 0 }),
      { messages: [], total: 0, hasMore: false, offset: 0, limit: null },
    );

    for (const provider of ['claude', 'codex'] as const) {
      const sessionId = `${provider}-corrupt-history`;
      const transcriptPath = path.join(tempRoot, `${sessionId}.jsonl`);
      await writeFile(transcriptPath, 'not-json\n{"truncated":\n', 'utf8');
      sessionsDb.createSession(
        sessionId,
        provider,
        path.join(tempRoot, 'workspace'),
        'Corrupt history',
        undefined,
        undefined,
        transcriptPath,
      );
      await assert.rejects(
        sessionsService.fetchHistory(sessionId, { limit: null, offset: 0 }),
        (error: unknown) => error instanceof AppError
          && error.code === 'PROVIDER_HISTORY_UNAVAILABLE',
        `${provider} must not convert a fully malformed transcript to empty success`,
      );
    }

    for (const provider of ['claude', 'codex'] as const) {
      const sessionId = `${provider}-semantic-corrupt-history`;
      const transcriptPath = path.join(tempRoot, `${sessionId}.jsonl`);
      await writeFile(
        transcriptPath,
        ['null', '42', '[]', '{}', '{"type":"unknown","payload":{}}'].join('\n'),
        'utf8',
      );
      sessionsDb.createSession(
        sessionId,
        provider,
        path.join(tempRoot, 'workspace'),
        'Semantic corrupt history',
        undefined,
        undefined,
        transcriptPath,
      );
      await assert.rejects(
        sessionsService.fetchHistory(sessionId, { limit: null, offset: 0 }),
        (error: unknown) => error instanceof AppError
          && error.code === 'PROVIDER_HISTORY_UNAVAILABLE',
        `${provider} must reject JSON values that are not provider records`,
      );
    }

    const validMetadataTranscripts = [
      {
        provider: 'claude' as const,
        line: JSON.stringify({
          type: 'summary',
          summary: 'A valid compact summary with no renderable message.',
          leafUuid: 'leaf-1',
        }),
      },
      {
        provider: 'codex' as const,
        line: JSON.stringify({
          type: 'session_meta',
          payload: { id: 'codex-metadata-native', cwd: path.join(tempRoot, 'workspace') },
        }),
      },
    ];
    for (const fixture of validMetadataTranscripts) {
      const sessionId = `${fixture.provider}-metadata-only-history`;
      const transcriptPath = path.join(tempRoot, `${sessionId}.jsonl`);
      await writeFile(transcriptPath, `${fixture.line}\n`, 'utf8');
      sessionsDb.createSession(
        sessionId,
        fixture.provider,
        path.join(tempRoot, 'workspace'),
        'Metadata only history',
        undefined,
        undefined,
        transcriptPath,
      );
      assert.deepEqual(
        await sessionsService.fetchHistory(sessionId, { limit: null, offset: 0 }),
        {
          messages: [],
          total: 0,
          hasMore: false,
          offset: 0,
          limit: null,
          ...(fixture.provider === 'codex' ? { tokenUsage: null } : {}),
        },
        `${fixture.provider} metadata-only transcript must remain valid empty history`,
      );
    }
  } finally {
    closeConnection();
    (os as unknown as { homedir: () => string }).homedir = originalHome;
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    await rm(tempRoot, { recursive: true, force: true });
  }
});
