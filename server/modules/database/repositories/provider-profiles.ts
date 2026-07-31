import { getConnection } from '@/modules/database/connection.js';
import { decryptSecret, encryptSecret } from '@/modules/database/secret-vault.js';
import type {
  ClaudeProviderProfileAuthType,
  ClaudeProviderProfilePublic,
  ClaudeProviderProfileRuntime,
} from '@/shared/types.js';

type ProviderProfileRow = {
  id: number;
  user_id: number;
  provider: string;
  title: string;
  base_url: string | null;
  auth_type: string;
  secret_value: string;
  is_default: number;
  is_active: number;
  created_at: string;
  updated_at: string;
};

type CreateClaudeProfileInput = {
  title: string;
  baseUrl: string | null;
  authType: ClaudeProviderProfileAuthType;
  secretValue: string;
  isDefault?: boolean;
  isActive?: boolean;
};

type UpdateClaudeProfileInput = Partial<Omit<CreateClaudeProfileInput, 'secretValue'>> & {
  secretValue?: string;
};

const CLAUDE_PROVIDER = 'claude';

function toAuthType(value: string): ClaudeProviderProfileAuthType {
  return value === 'api_key' ? 'api_key' : 'auth_token';
}

function toPublicProfile(row: ProviderProfileRow): ClaudeProviderProfilePublic {
  return {
    id: Number(row.id),
    provider: 'claude',
    title: row.title,
    baseUrl: row.base_url,
    authType: toAuthType(row.auth_type),
    isDefault: Boolean(row.is_default),
    isActive: Boolean(row.is_active),
    hasSecret: row.secret_value.trim().length > 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRuntimeProfile(row: ProviderProfileRow): ClaudeProviderProfileRuntime {
  return {
    ...toPublicProfile(row),
    secretValue: decryptSecret(row.secret_value),
  };
}

function fetchProfileRow(userId: number, profileId: number): ProviderProfileRow | null {
  const db = getConnection();
  const row = db
    .prepare(
      `SELECT *
       FROM provider_profiles
       WHERE id = ? AND user_id = ? AND provider = ?
       LIMIT 1`,
    )
    .get(profileId, userId, CLAUDE_PROVIDER) as ProviderProfileRow | undefined;

  return row ?? null;
}

function normalizeSecret(secretValue: string): string {
  const trimmed = secretValue.trim();
  if (!trimmed) {
    throw new Error('Secret value is required.');
  }
  return encryptSecret(trimmed);
}

export const providerProfilesDb = {
  listClaudeProfiles(userId: number): ClaudeProviderProfilePublic[] {
    const db = getConnection();
    const rows = db
      .prepare(
        `SELECT *
         FROM provider_profiles
         WHERE user_id = ? AND provider = ?
         ORDER BY is_default DESC, is_active DESC, title COLLATE NOCASE ASC, id ASC`,
      )
      .all(userId, CLAUDE_PROVIDER) as ProviderProfileRow[];

    return rows.map(toPublicProfile);
  },

  countActiveClaudeProfiles(userId: number): number {
    const db = getConnection();
    const row = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM provider_profiles
         WHERE user_id = ? AND provider = ? AND is_active = 1`,
      )
      .get(userId, CLAUDE_PROVIDER) as { count: number } | undefined;

    return Number(row?.count ?? 0);
  },

  getClaudeProfile(userId: number, profileId: number): ClaudeProviderProfilePublic | null {
    const row = fetchProfileRow(userId, profileId);
    return row ? toPublicProfile(row) : null;
  },

  getClaudeProfileForRuntime(
    userId: number,
    profileId: number,
  ): ClaudeProviderProfileRuntime | null {
    const row = fetchProfileRow(userId, profileId);
    if (!row || !row.is_active) {
      return null;
    }
    return toRuntimeProfile(row);
  },

  createClaudeProfile(
    userId: number,
    input: CreateClaudeProfileInput,
  ): ClaudeProviderProfilePublic {
    const db = getConnection();
    const existingCount = Number(
      (db
        .prepare('SELECT COUNT(*) AS count FROM provider_profiles WHERE user_id = ? AND provider = ?')
        .get(userId, CLAUDE_PROVIDER) as { count: number } | undefined)?.count ?? 0,
    );
    const isDefault = input.isDefault === true || existingCount === 0;
    const encryptedSecret = normalizeSecret(input.secretValue);

    const create = db.transaction(() => {
      if (isDefault) {
        db.prepare(
          'UPDATE provider_profiles SET is_default = 0, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND provider = ?',
        ).run(userId, CLAUDE_PROVIDER);
      }

      const result = db
        .prepare(
          `INSERT INTO provider_profiles (
             user_id, provider, title, base_url, auth_type, secret_value, is_default, is_active, created_at, updated_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        )
        .run(
          userId,
          CLAUDE_PROVIDER,
          input.title,
          input.baseUrl,
          input.authType,
          encryptedSecret,
          isDefault ? 1 : 0,
          input.isActive === false ? 0 : 1,
        );

      return Number(result.lastInsertRowid);
    });

    const profileId = create();
    const row = fetchProfileRow(userId, profileId);
    if (!row) {
      throw new Error('Created Claude profile could not be loaded.');
    }
    return toPublicProfile(row);
  },

  updateClaudeProfile(
    userId: number,
    profileId: number,
    input: UpdateClaudeProfileInput,
  ): ClaudeProviderProfilePublic | null {
    const db = getConnection();
    const existing = fetchProfileRow(userId, profileId);
    if (!existing) {
      return null;
    }

    const nextTitle = input.title ?? existing.title;
    const nextBaseUrl = input.baseUrl !== undefined ? input.baseUrl : existing.base_url;
    const nextAuthType = input.authType ?? toAuthType(existing.auth_type);
    const nextSecret = input.secretValue !== undefined
      ? normalizeSecret(input.secretValue)
      : existing.secret_value;
    const nextActive = input.isActive !== undefined
      ? (input.isActive ? 1 : 0)
      : existing.is_active;
    const nextDefault = input.isDefault !== undefined
      ? (input.isDefault ? 1 : 0)
      : existing.is_default;

    const update = db.transaction(() => {
      if (nextDefault) {
        db.prepare(
          'UPDATE provider_profiles SET is_default = 0, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND provider = ?',
        ).run(userId, CLAUDE_PROVIDER);
      }

      db.prepare(
        `UPDATE provider_profiles
         SET title = ?,
             base_url = ?,
             auth_type = ?,
             secret_value = ?,
             is_default = ?,
             is_active = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND user_id = ? AND provider = ?`,
      ).run(
        nextTitle,
        nextBaseUrl,
        nextAuthType,
        nextSecret,
        nextDefault,
        nextActive,
        profileId,
        userId,
        CLAUDE_PROVIDER,
      );
    });

    update();
    const row = fetchProfileRow(userId, profileId);
    return row ? toPublicProfile(row) : null;
  },

  deleteClaudeProfile(userId: number, profileId: number): boolean {
    const db = getConnection();
    const existing = fetchProfileRow(userId, profileId);
    if (!existing) {
      return false;
    }

    const remove = db.transaction(() => {
      db.prepare(
        'DELETE FROM provider_profiles WHERE id = ? AND user_id = ? AND provider = ?',
      ).run(profileId, userId, CLAUDE_PROVIDER);

      if (!existing.is_default) {
        return;
      }

      const replacement = db
        .prepare(
          `SELECT id
           FROM provider_profiles
           WHERE user_id = ? AND provider = ? AND is_active = 1
           ORDER BY updated_at DESC, id DESC
           LIMIT 1`,
        )
        .get(userId, CLAUDE_PROVIDER) as { id: number } | undefined;

      if (replacement) {
        db.prepare(
          'UPDATE provider_profiles SET is_default = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?',
        ).run(replacement.id, userId);
      }
    });

    remove();
    return true;
  },
};
