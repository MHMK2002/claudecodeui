import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, getConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { providerProfilesDb } from '@/modules/database/repositories/provider-profiles.js';
import { sessionsDb } from '@/modules/database/repositories/sessions.db.js';

async function withIsolatedDatabase(runTest: (userId: number) => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousSecretKey = process.env.CLOUDCLI_SECRET_KEY;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'provider-profiles-db-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  process.env.CLOUDCLI_SECRET_KEY = 'test-provider-profile-secret-key';
  await initializeDatabase();

  try {
    const db = getConnection();
    const result = db
      .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
      .run('profile-user', 'hash');
    await runTest(Number(result.lastInsertRowid));
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    if (previousSecretKey === undefined) {
      delete process.env.CLOUDCLI_SECRET_KEY;
    } else {
      process.env.CLOUDCLI_SECRET_KEY = previousSecretKey;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('Claude provider profiles keep tokens write-only and encrypted at rest', async () => {
  await withIsolatedDatabase((userId) => {
    const profile = providerProfilesDb.createClaudeProfile(userId, {
      title: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/anthropic',
      authType: 'auth_token',
      secretValue: 'sk-or-test-token',
      isDefault: true,
    });

    assert.equal(profile.title, 'OpenRouter');
    assert.equal(profile.hasSecret, true);
    assert.equal('secretValue' in profile, false);

    const stored = getConnection()
      .prepare('SELECT secret_value FROM provider_profiles WHERE id = ?')
      .get(profile.id) as { secret_value: string };
    assert.match(stored.secret_value, /^enc:v1:/);
    assert.notEqual(stored.secret_value, 'sk-or-test-token');

    const runtimeProfile = providerProfilesDb.getClaudeProfileForRuntime(userId, profile.id);
    assert.equal(runtimeProfile?.secretValue, 'sk-or-test-token');
  });
});

test('app-created sessions persist the selected Claude provider profile', async () => {
  await withIsolatedDatabase((userId) => {
    const profile = providerProfilesDb.createClaudeProfile(userId, {
      title: 'Gateway',
      baseUrl: 'https://gateway.example.test/anthropic',
      authType: 'auth_token',
      secretValue: 'gateway-token',
    });

    sessionsDb.createAppSession('session-with-profile', 'claude', '/workspace/demo', profile.id);

    const session = sessionsDb.getSessionById('session-with-profile');
    assert.equal(session?.provider_profile_id, profile.id);
  });
});

test('Codex provider profiles can be stored for app-created sessions', async () => {
  await withIsolatedDatabase((userId) => {
    const profile = providerProfilesDb.createCodexProfile(userId, {
      title: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      secretValue: 'sk-or-codex-token',
    });

    assert.equal(profile.provider, 'codex');
    assert.equal(profile.authType, 'api_key');
    assert.equal(profile.hasSecret, true);

    sessionsDb.createAppSession('codex-session-with-profile', 'codex', '/workspace/demo', profile.id);

    const runtimeProfile = providerProfilesDb.getCodexProfileForRuntime(userId, profile.id);
    const session = sessionsDb.getSessionById('codex-session-with-profile');
    assert.equal(runtimeProfile?.secretValue, 'sk-or-codex-token');
    assert.equal(session?.provider_profile_id, profile.id);
  });
});

test('onboarding profile upsert renames Default Main and remains encrypted, idempotent, active, and the sole default', async () => {
  await withIsolatedDatabase((userId) => {
    providerProfilesDb.createClaudeProfile(userId, {
      title: 'Existing',
      baseUrl: null,
      authType: 'auth_token',
      secretValue: 'existing-token',
      isDefault: true,
    });

    const first = providerProfilesDb.upsertDefaultProviderProfile(userId, 'claude', {
      title: 'Work Gateway',
      baseUrl: null,
      authType: 'api_key',
      secretValue: 'first-secret',
    });
    const second = providerProfilesDb.upsertDefaultProviderProfile(userId, 'claude', {
      title: 'Work Gateway',
      baseUrl: 'https://gateway.example/anthropic',
      authType: 'api_key',
      secretValue: 'rotated-secret',
    });

    assert.equal(first.id, second.id);
    assert.equal(second.title, 'Work Gateway');
    assert.equal(second.baseUrl, 'https://gateway.example/anthropic');
    assert.equal(second.isDefault, true);
    assert.equal(second.isActive, true);
    assert.equal(providerProfilesDb.listClaudeProfiles(userId).length, 2);
    assert.equal(
      providerProfilesDb.listClaudeProfiles(userId).filter((profile) => profile.isDefault).length,
      1,
    );
    assert.equal(
      providerProfilesDb.getClaudeProfileForRuntime(userId, second.id)?.secretValue,
      'rotated-secret',
    );
    const stored = getConnection()
      .prepare('SELECT secret_value FROM provider_profiles WHERE id = ?')
      .get(second.id) as { secret_value: string };
    assert.match(stored.secret_value, /^enc:v1:/);
    assert.doesNotMatch(stored.secret_value, /rotated-secret/);
  });
});
