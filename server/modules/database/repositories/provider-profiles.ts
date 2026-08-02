import { getConnection } from '@/modules/database/connection.js';
import { decryptSecret, encryptSecret } from '@/modules/database/secret-vault.js';
import type {
  CodexProviderProfilePublic,
  CodexProviderProfileRuntime,
  ClaudeProviderProfileAuthType,
  ClaudeProviderProfilePublic,
  ClaudeProviderProfileRuntime,
  ProviderProfileAuthType,
  ProviderProfileProvider,
  ProviderProfilePublic,
  ProviderProfileRuntime,
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

type CreateCodexProfileInput = {
  title: string;
  baseUrl: string;
  authType?: 'api_key';
  secretValue: string;
  isDefault?: boolean;
  isActive?: boolean;
};

type UpdateCodexProfileInput = Partial<Omit<CreateCodexProfileInput, 'secretValue'>> & {
  secretValue?: string;
};

const CLAUDE_PROVIDER = 'claude';
const CODEX_PROVIDER = 'codex';

function toAuthType(value: string): ProviderProfileAuthType {
  return value === 'api_key' ? 'api_key' : 'auth_token';
}

function toProfileProvider(value: string): ProviderProfileProvider {
  return value === CODEX_PROVIDER ? CODEX_PROVIDER : CLAUDE_PROVIDER;
}

function toPublicProfile(row: ProviderProfileRow): ProviderProfilePublic {
  return {
    id: Number(row.id),
    provider: toProfileProvider(row.provider),
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

function toRuntimeProfile(row: ProviderProfileRow): ProviderProfileRuntime {
  return {
    ...toPublicProfile(row),
    secretValue: decryptSecret(row.secret_value),
  };
}

function fetchProfileRow(
  userId: number,
  profileId: number,
  provider: ProviderProfileProvider,
): ProviderProfileRow | null {
  const db = getConnection();
  const row = db
    .prepare(
      `SELECT *
       FROM provider_profiles
       WHERE id = ? AND user_id = ? AND provider = ?
       LIMIT 1`,
    )
    .get(profileId, userId, provider) as ProviderProfileRow | undefined;

  return row ?? null;
}

function normalizeSecret(secretValue: string): string {
  const trimmed = secretValue.trim();
  if (!trimmed) {
    throw new Error('Secret value is required.');
  }
  return encryptSecret(trimmed);
}

function normalizeCodexInput<TInput extends CreateCodexProfileInput | UpdateCodexProfileInput>(
  input: TInput,
): TInput & { authType: 'api_key' } {
  return {
    ...input,
    authType: 'api_key',
  };
}

export const providerProfilesDb = {
  listProviderProfiles(
    userId: number,
    provider: ProviderProfileProvider,
  ): ProviderProfilePublic[] {
    const db = getConnection();
    const rows = db
      .prepare(
        `SELECT *
         FROM provider_profiles
         WHERE user_id = ? AND provider = ?
         ORDER BY is_default DESC, is_active DESC, title COLLATE NOCASE ASC, id ASC`,
      )
      .all(userId, provider) as ProviderProfileRow[];

    return rows.map(toPublicProfile);
  },

  listClaudeProfiles(userId: number): ClaudeProviderProfilePublic[] {
    return this.listProviderProfiles(userId, CLAUDE_PROVIDER) as ClaudeProviderProfilePublic[];
  },

  listCodexProfiles(userId: number): CodexProviderProfilePublic[] {
    return this.listProviderProfiles(userId, CODEX_PROVIDER) as CodexProviderProfilePublic[];
  },

  countActiveProviderProfiles(userId: number, provider: ProviderProfileProvider): number {
    const db = getConnection();
    const row = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM provider_profiles
         WHERE user_id = ? AND provider = ? AND is_active = 1`,
      )
      .get(userId, provider) as { count: number } | undefined;

    return Number(row?.count ?? 0);
  },

  countActiveClaudeProfiles(userId: number): number {
    return this.countActiveProviderProfiles(userId, CLAUDE_PROVIDER);
  },

  countActiveCodexProfiles(userId: number): number {
    return this.countActiveProviderProfiles(userId, CODEX_PROVIDER);
  },

  getProviderProfile(
    userId: number,
    provider: ProviderProfileProvider,
    profileId: number,
  ): ProviderProfilePublic | null {
    const row = fetchProfileRow(userId, profileId, provider);
    return row ? toPublicProfile(row) : null;
  },

  getClaudeProfile(userId: number, profileId: number): ClaudeProviderProfilePublic | null {
    return this.getProviderProfile(userId, CLAUDE_PROVIDER, profileId) as ClaudeProviderProfilePublic | null;
  },

  getCodexProfile(userId: number, profileId: number): CodexProviderProfilePublic | null {
    return this.getProviderProfile(userId, CODEX_PROVIDER, profileId) as CodexProviderProfilePublic | null;
  },

  getProviderProfileForRuntime(
    userId: number,
    provider: ProviderProfileProvider,
    profileId: number,
  ): ProviderProfileRuntime | null {
    const row = fetchProfileRow(userId, profileId, provider);
    if (!row || !row.is_active) {
      return null;
    }
    return toRuntimeProfile(row);
  },

  getClaudeProfileForRuntime(
    userId: number,
    profileId: number,
  ): ClaudeProviderProfileRuntime | null {
    return this.getProviderProfileForRuntime(
      userId,
      CLAUDE_PROVIDER,
      profileId,
    ) as ClaudeProviderProfileRuntime | null;
  },

  getCodexProfileForRuntime(
    userId: number,
    profileId: number,
  ): CodexProviderProfileRuntime | null {
    return this.getProviderProfileForRuntime(
      userId,
      CODEX_PROVIDER,
      profileId,
    ) as CodexProviderProfileRuntime | null;
  },

  createProviderProfile(
    userId: number,
    provider: ProviderProfileProvider,
    input: CreateClaudeProfileInput | CreateCodexProfileInput,
  ): ProviderProfilePublic {
    const db = getConnection();
    const existingCount = Number(
      (db
        .prepare('SELECT COUNT(*) AS count FROM provider_profiles WHERE user_id = ? AND provider = ?')
        .get(userId, provider) as { count: number } | undefined)?.count ?? 0,
    );
    const isDefault = input.isDefault === true || existingCount === 0;
    const encryptedSecret = normalizeSecret(input.secretValue);

    const create = db.transaction(() => {
      if (isDefault) {
        db.prepare(
          'UPDATE provider_profiles SET is_default = 0, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND provider = ?',
        ).run(userId, provider);
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
          provider,
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
    const row = fetchProfileRow(userId, profileId, provider);
    if (!row) {
      throw new Error('Created provider profile could not be loaded.');
    }
    return toPublicProfile(row);
  },

  createClaudeProfile(
    userId: number,
    input: CreateClaudeProfileInput,
  ): ClaudeProviderProfilePublic {
    return this.createProviderProfile(
      userId,
      CLAUDE_PROVIDER,
      input,
    ) as ClaudeProviderProfilePublic;
  },

  createCodexProfile(
    userId: number,
    input: CreateCodexProfileInput,
  ): CodexProviderProfilePublic {
    return this.createProviderProfile(
      userId,
      CODEX_PROVIDER,
      normalizeCodexInput(input),
    ) as CodexProviderProfilePublic;
  },

  updateProviderProfile(
    userId: number,
    provider: ProviderProfileProvider,
    profileId: number,
    input: UpdateClaudeProfileInput | UpdateCodexProfileInput,
  ): ProviderProfilePublic | null {
    const db = getConnection();
    const existing = fetchProfileRow(userId, profileId, provider);
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
        ).run(userId, provider);
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
        provider,
      );
    });

    update();
    const row = fetchProfileRow(userId, profileId, provider);
    return row ? toPublicProfile(row) : null;
  },

  updateClaudeProfile(
    userId: number,
    profileId: number,
    input: UpdateClaudeProfileInput,
  ): ClaudeProviderProfilePublic | null {
    return this.updateProviderProfile(
      userId,
      CLAUDE_PROVIDER,
      profileId,
      input,
    ) as ClaudeProviderProfilePublic | null;
  },

  updateCodexProfile(
    userId: number,
    profileId: number,
    input: UpdateCodexProfileInput,
  ): CodexProviderProfilePublic | null {
    return this.updateProviderProfile(
      userId,
      CODEX_PROVIDER,
      profileId,
      normalizeCodexInput(input),
    ) as CodexProviderProfilePublic | null;
  },

  deleteProviderProfile(
    userId: number,
    provider: ProviderProfileProvider,
    profileId: number,
  ): boolean {
    const db = getConnection();
    const existing = fetchProfileRow(userId, profileId, provider);
    if (!existing) {
      return false;
    }

    const remove = db.transaction(() => {
      db.prepare(
        'DELETE FROM provider_profiles WHERE id = ? AND user_id = ? AND provider = ?',
      ).run(profileId, userId, provider);

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
        .get(userId, provider) as { id: number } | undefined;

      if (replacement) {
        db.prepare(
          'UPDATE provider_profiles SET is_default = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?',
        ).run(replacement.id, userId);
      }
    });

    remove();
    return true;
  },

  deleteClaudeProfile(userId: number, profileId: number): boolean {
    return this.deleteProviderProfile(userId, CLAUDE_PROVIDER, profileId);
  },

  deleteCodexProfile(userId: number, profileId: number): boolean {
    return this.deleteProviderProfile(userId, CODEX_PROVIDER, profileId);
  },
};
