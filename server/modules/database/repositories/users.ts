/**
 * User repository.
 *
 * Provides typed CRUD operations for the `users` table.
 * This is a single-user system, but the schema supports multiple
 * users for forward compatibility.
 */

import { getConnection } from '@/modules/database/connection.js';
import type { CommitMessageGeneratorSettings, LLMProvider } from '@/shared/types.js';
import { DEFAULT_COMMIT_MESSAGE_BASE_PROMPT } from '@/shared/utils.js';

type UserRow = {
  id: number;
  username: string;
  password_hash: string;
  created_at: string;
  last_login: string | null;
  is_active: number;
  git_name: string | null;
  git_email: string | null;
  commit_message_provider: string | null;
  commit_message_provider_profile_id: number | null;
  commit_message_model: string | null;
  commit_message_effort: string | null;
  commit_message_base_prompt: string | null;
  has_completed_onboarding: number;
};

type UserPublicRow = Pick<UserRow, 'id' | 'username' | 'created_at' | 'last_login'>;

type UserGitConfig = {
  git_name: string | null;
  git_email: string | null;
};

type UserCommitMessageGeneratorRow = Pick<
  UserRow,
  | 'commit_message_provider'
  | 'commit_message_provider_profile_id'
  | 'commit_message_model'
  | 'commit_message_effort'
  | 'commit_message_base_prompt'
>;

const COMMIT_MESSAGE_PROVIDERS = new Set<LLMProvider>([
  'claude',
  'codex',
  'cursor',
  'opencode',
]);

type CreateUserResult = {
  id: number | bigint;
  username: string;
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const userDb = {
  /** Returns true if at least one user exists in the database. */
  hasUsers(): boolean {
    const db = getConnection();
    const row = db.prepare('SELECT COUNT(*) as count FROM users').get() as {
      count: number;
    };
    return row.count > 0;
  },

  /** Inserts a new user and returns the created ID + username. */
  createUser(username: string, passwordHash: string): CreateUserResult {
    const db = getConnection();
    const result = db
      .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
      .run(username, passwordHash);
    return { id: result.lastInsertRowid, username };
  },

  /** Replaces credentials in place so Desktop LAN setup preserves all user-owned rows. */
  updateCredentials(userId: number, username: string, passwordHash: string): void {
    const db = getConnection();
    db.prepare(
      'UPDATE users SET username = ?, password_hash = ? WHERE id = ? AND is_active = 1'
    ).run(username, passwordHash, userId);
  },

  /**
   * Looks up an active user by username.
   * Returns the full row (including password hash) for auth verification.
   */
  getUserByUsername(username: string): UserRow | undefined {
    const db = getConnection();
    return db
      .prepare('SELECT * FROM users WHERE username = ? AND is_active = 1')
      .get(username) as UserRow | undefined;
  },

  /** Updates the last_login timestamp. Non-fatal — logs but does not throw. */
  updateLastLogin(userId: number): void {
    try {
      const db = getConnection();
      db.prepare(
        'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?'
      ).run(userId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Failed to update last login', { error: message });
    }
  },

  /** Returns public user fields by ID (no password hash). */
  getUserById(userId: number): UserPublicRow | undefined {
    const db = getConnection();
    return db
      .prepare(
        'SELECT id, username, created_at, last_login FROM users WHERE id = ? AND is_active = 1'
      )
      .get(userId) as UserPublicRow | undefined;
  },

  /** Returns the first active user. Used for single-user mode lookups. */
  getFirstUser(): UserPublicRow | undefined {
    const db = getConnection();
    return db
      .prepare(
        'SELECT id, username, created_at, last_login FROM users WHERE is_active = 1 LIMIT 1'
      )
      .get() as UserPublicRow | undefined;
  },

  /** Stores only Git identity, used by first-load system Git import. */
  updateGitIdentity(
    userId: number,
    gitName: string | null,
    gitEmail: string | null
  ): void {
    const db = getConnection();
    db.prepare('UPDATE users SET git_name = ?, git_email = ? WHERE id = ?').run(
      gitName,
      gitEmail,
      userId
    );
  },

  /** Atomically stores Git identity and the global commit-message generator preference. */
  updateGitConfig(
    userId: number,
    gitName: string,
    gitEmail: string,
    generator: CommitMessageGeneratorSettings,
  ): void {
    const db = getConnection();
    db.prepare(`
      UPDATE users
      SET git_name = ?,
          git_email = ?,
          commit_message_provider = ?,
          commit_message_provider_profile_id = ?,
          commit_message_model = ?,
          commit_message_effort = ?,
          commit_message_base_prompt = ?
      WHERE id = ?
    `).run(
      gitName,
      gitEmail,
      generator.provider,
      generator.providerProfileId,
      generator.model,
      generator.effort,
      generator.basePrompt === DEFAULT_COMMIT_MESSAGE_BASE_PROMPT
        ? null
        : generator.basePrompt,
      userId,
    );
  },

  /** Retrieves the user's git identity (name + email). */
  getGitConfig(userId: number): UserGitConfig | undefined {
    const db = getConnection();
    return db
      .prepare('SELECT git_name, git_email FROM users WHERE id = ?')
      .get(userId) as UserGitConfig | undefined;
  },

  /** Retrieves a complete global generator preference, or null until the user saves one. */
  getCommitMessageGeneratorSettings(userId: number): CommitMessageGeneratorSettings | null {
    const db = getConnection();
    const row = db.prepare(`
      SELECT
        commit_message_provider,
        commit_message_provider_profile_id,
        commit_message_model,
        commit_message_effort,
        commit_message_base_prompt
      FROM users
      WHERE id = ?
    `).get(userId) as UserCommitMessageGeneratorRow | undefined;
    if (
      !row
      || !COMMIT_MESSAGE_PROVIDERS.has(row.commit_message_provider as LLMProvider)
      || !row.commit_message_model
    ) {
      return null;
    }
    return {
      provider: row.commit_message_provider as LLMProvider,
      providerProfileId: row.commit_message_provider_profile_id,
      model: row.commit_message_model,
      effort: row.commit_message_effort,
      basePrompt: row.commit_message_base_prompt ?? DEFAULT_COMMIT_MESSAGE_BASE_PROMPT,
    };
  },

  /** Marks onboarding as complete for the given user. */
  completeOnboarding(userId: number): void {
    const db = getConnection();
    db.prepare(
      'UPDATE users SET has_completed_onboarding = 1 WHERE id = ?'
    ).run(userId);
  },

  /** Returns true if the user has finished the onboarding flow. */
  hasCompletedOnboarding(userId: number): boolean {
    const db = getConnection();
    const row = db
      .prepare('SELECT has_completed_onboarding FROM users WHERE id = ?')
      .get(userId) as { has_completed_onboarding: number } | undefined;
    return row?.has_completed_onboarding === 1;
  },
};
