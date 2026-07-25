import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import TOML from '@iarna/toml';
import spawn from 'cross-spawn';

import { CODEX_MODEL_PROVIDER_ID } from '@/modules/providers/list/codex/codex-runtime.js';
import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';
import { readObjectRecord, readOptionalString } from '@/shared/utils.js';

export type CodexCredentialsStatus = {
  authenticated: boolean;
  email: string | null;
  method: string | null;
  error?: string;
};

export const readCodexCustomProviderCredentials = (
  configValue: unknown,
  env: NodeJS.ProcessEnv,
): CodexCredentialsStatus | null => {
  const config = readObjectRecord(configValue);
  const providers = readObjectRecord(config?.model_providers);
  const provider = readObjectRecord(providers?.[CODEX_MODEL_PROVIDER_ID]);
  if (!provider || provider.requires_openai_auth === true) {
    return null;
  }

  const providerName = readOptionalString(provider.name) ?? CODEX_MODEL_PROVIDER_ID;
  const envKey = readOptionalString(provider.env_key);
  if (envKey && !readOptionalString(env[envKey])) {
    return {
      authenticated: false,
      email: null,
      method: 'provider_api_key',
      error: `${envKey} is not set for Codex provider "${CODEX_MODEL_PROVIDER_ID}"`,
    };
  }

  return {
    authenticated: true,
    email: envKey ? `${providerName} API Key` : providerName,
    method: envKey ? 'provider_api_key' : 'custom_provider',
  };
};

export class CodexProviderAuth implements IProviderAuth {
  /**
   * Checks whether Codex is available to the server runtime.
   */
  private checkInstalled(): boolean {
    const result = spawn.sync('codex', ['--version'], { stdio: 'ignore', timeout: 5000 });
    return !result.error && result.status === 0;
  }

  /**
   * Returns Codex SDK availability and credential status.
   */
  async getStatus(): Promise<ProviderAuthStatus> {
    const installed = this.checkInstalled();
    const credentials = await this.checkCredentials();

    return {
      installed,
      provider: 'codex',
      authenticated: credentials.authenticated,
      email: credentials.email,
      method: credentials.method,
      error: credentials.authenticated ? undefined : credentials.error || 'Not authenticated',
    };
  }

  /**
   * Reads Codex auth.json and checks OAuth tokens or an API key fallback.
   */
  private async checkCredentials(): Promise<CodexCredentialsStatus> {
    try {
      const configPath = path.join(os.homedir(), '.codex', 'config.toml');
      const config = TOML.parse(await readFile(configPath, 'utf8'));
      const customProviderCredentials = readCodexCustomProviderCredentials(config, process.env);
      if (customProviderCredentials) {
        return customProviderCredentials;
      }
    } catch {
      // Fall through to Codex's persisted OpenAI credentials.
    }

    try {
      const authPath = path.join(os.homedir(), '.codex', 'auth.json');
      const content = await readFile(authPath, 'utf8');
      const auth = readObjectRecord(JSON.parse(content)) ?? {};
      const tokens = readObjectRecord(auth.tokens) ?? {};
      const idToken = readOptionalString(tokens.id_token);
      const accessToken = readOptionalString(tokens.access_token);

      if (idToken || accessToken) {
        return {
          authenticated: true,
          email: idToken ? this.readEmailFromIdToken(idToken) : 'Authenticated',
          method: 'credentials_file',
        };
      }

      if (readOptionalString(auth.OPENAI_API_KEY)) {
        return { authenticated: true, email: 'API Key Auth', method: 'api_key' };
      }

      return { authenticated: false, email: null, method: null, error: 'No valid tokens found' };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return {
        authenticated: false,
        email: null,
        method: null,
        error: code === 'ENOENT' ? 'Codex not configured' : error instanceof Error ? error.message : 'Failed to read Codex auth',
      };
    }
  }

  /**
   * Extracts the user email from a Codex id_token when a readable JWT payload exists.
   */
  private readEmailFromIdToken(idToken: string): string {
    try {
      const parts = idToken.split('.');
      if (parts.length >= 2) {
        const payload = readObjectRecord(JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')));
        return readOptionalString(payload?.email) ?? readOptionalString(payload?.user) ?? 'Authenticated';
      }
    } catch {
      // Fall back to a generic authenticated marker if the token payload is not readable.
    }

    return 'Authenticated';
  }
}
