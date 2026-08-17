import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, getConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { userDb } from '@/modules/database/repositories/users.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'users-db-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();
  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('users migration persists one global commit-message generator preference', async () => {
  await withIsolatedDatabase(() => {
    const userId = Number(userDb.createUser('settings-user', 'hash').id);
    const columns = getConnection()
      .prepare('PRAGMA table_info(users)')
      .all() as Array<{ name: string }>;
    assert.deepEqual(
      columns
        .map((column) => column.name)
        .filter((name) => name.startsWith('commit_message_'))
        .sort(),
      [
        'commit_message_base_prompt',
        'commit_message_effort',
        'commit_message_model',
        'commit_message_provider',
        'commit_message_provider_profile_id',
      ],
    );
    assert.equal(userDb.getCommitMessageGeneratorSettings(userId), null);

    userDb.updateGitConfig(userId, 'Alice', 'alice@example.com', {
      provider: 'codex',
      providerProfileId: 8,
      model: 'gpt-test',
      effort: 'low',
      basePrompt: 'Write concise Persian commit subjects.',
    });

    assert.deepEqual(userDb.getGitConfig(userId), {
      git_name: 'Alice',
      git_email: 'alice@example.com',
    });
    assert.deepEqual(userDb.getCommitMessageGeneratorSettings(userId), {
      provider: 'codex',
      providerProfileId: 8,
      model: 'gpt-test',
      effort: 'low',
      basePrompt: 'Write concise Persian commit subjects.',
    });
  });
});
