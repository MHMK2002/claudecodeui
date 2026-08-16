import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import {
  closeConnection,
  getConnection,
  initializeDatabase,
} from '@/modules/database/index.js';

test('startup migrates legacy scheduled runs before creating project identity indexes', { concurrency: false }, async () => {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'scheduled-runs-migration-'));
  const databasePath = path.join(temporaryDirectory, 'auth.db');
  const legacyDatabase = new Database(databasePath);

  legacyDatabase.exec(`
    CREATE TABLE projects (
      project_id TEXT PRIMARY KEY NOT NULL,
      project_path TEXT NOT NULL UNIQUE,
      custom_project_name TEXT DEFAULT NULL,
      isStarred BOOLEAN DEFAULT 0,
      isArchived BOOLEAN DEFAULT 0
    );
    INSERT INTO projects (project_id, project_path)
    VALUES ('legacy-project', '/workspace/legacy-schedule');

    CREATE TABLE scheduled_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      project_path TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt TEXT NOT NULL,
      cron_expression TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      notify_on_success BOOLEAN NOT NULL DEFAULT 0,
      notify_on_failure BOOLEAN NOT NULL DEFAULT 1,
      notify_channels_json TEXT,
      is_enabled BOOLEAN NOT NULL DEFAULT 1,
      last_run_at DATETIME,
      next_run_at DATETIME NOT NULL,
      in_flight_run_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO scheduled_runs (
      user_id,
      title,
      project_path,
      provider,
      model,
      prompt,
      cron_expression,
      next_run_at
    ) VALUES (
      1,
      'Legacy schedule',
      '/workspace/legacy-schedule',
      'claude',
      'legacy-model',
      'Continue work',
      '0 9 * * *',
      '2026-08-17 09:00:00'
    );
  `);
  legacyDatabase.close();

  closeConnection();
  process.env.DATABASE_PATH = databasePath;

  try {
    await initializeDatabase();
    const database = getConnection();
    const columns = database
      .prepare('PRAGMA table_info(scheduled_runs)')
      .all() as Array<{ name: string }>;
    assert.equal(columns.some((column) => column.name === 'project_id'), true);
    assert.equal(columns.some((column) => column.name === 'provider_profile_id'), true);

    const migrated = database
      .prepare('SELECT project_id FROM scheduled_runs WHERE id = 1')
      .get() as { project_id: string | null };
    assert.equal(migrated.project_id, 'legacy-project');

    const index = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
      .get('idx_scheduled_runs_project_id') as { name: string } | undefined;
    assert.equal(index?.name, 'idx_scheduled_runs_project_id');
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
