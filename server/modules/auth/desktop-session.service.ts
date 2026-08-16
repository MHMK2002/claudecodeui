import crypto from 'node:crypto';

import type { RuntimeMode } from '@/shared/types.js';
import {
  AppError,
  isLoopbackNetworkAddress,
  secureStringsMatch,
} from '@/shared/utils.js';

import { isDesktopSessionNonce } from '../../../shared/local-session.js';

const INTERNAL_USERNAME = '__cloudcli_desktop_local__';
const HANDOFF_TTL_MS = 60_000;
const MAX_TRACKED_NONCES = 512;

type AuthUser = {
  id: number | bigint;
  username: string;
};

type DesktopSessionDependencies = {
  runtimeMode: RuntimeMode;
  bootstrapSecret?: string;
  users: {
    getFirstUser(): AuthUser | undefined;
    createUser(username: string, passwordHash: string): AuthUser;
    updateCredentials(userId: number, username: string, passwordHash: string): void;
    completeOnboarding(userId: number): void;
    updateLastLogin(userId: number): void;
  };
  transaction: {
    begin(): void;
    commit(): void;
    rollback(): void;
  };
  hashPassword(password: string): Promise<string>;
  generateToken(user: AuthUser): string;
  now?: () => number;
  randomSecret?: () => string;
};

function numericUserId(userId: number | bigint): number {
  return Number(userId);
}

/**
 * Creates the passwordless Desktop session broker used only by Auth routes.
 * The launch secret never enters a renderer; every request nonce is accepted
 * once, and browser handoffs expire before they can become durable URLs.
 */
export function createDesktopSessionService(dependencies: DesktopSessionDependencies) {
  const now = dependencies.now ?? Date.now;
  const randomSecret = dependencies.randomSecret
    ?? (() => crypto.randomBytes(48).toString('hex'));
  // Only a caller holding the Desktop owner secret can add an entry, so this
  // process-lifetime set cannot be filled by an unauthenticated network peer.
  // Keeping every accepted nonce prevents an old captured request from becoming
  // valid again merely because a browser-handoff TTL elapsed.
  const usedNonces = new Set<string>();
  const browserHandoffs = new Map<string, number>();
  let principalPromise: Promise<AuthUser> | null = null;

  const prune = () => {
    for (const [nonce, expiresAt] of browserHandoffs) {
      if (expiresAt <= now() || browserHandoffs.size > MAX_TRACKED_NONCES) {
        browserHandoffs.delete(nonce);
      }
    }
  };

  const assertLocalRequest = (remoteAddress: string | undefined) => {
    if (dependencies.runtimeMode !== 'desktop-local') {
      throw new AppError('Desktop local sessions are unavailable in this runtime mode.', {
        code: 'DESKTOP_SESSION_UNAVAILABLE',
        statusCode: 404,
      });
    }
    if (!isLoopbackNetworkAddress(remoteAddress)) {
      throw new AppError('Desktop local sessions require a loopback request.', {
        code: 'DESKTOP_SESSION_LOOPBACK_REQUIRED',
        statusCode: 403,
      });
    }
  };

  const consumeChallenge = (
    providedSecret: string | undefined,
    nonce: string | undefined,
    remoteAddress: string | undefined,
  ) => {
    assertLocalRequest(remoteAddress);
    if (
      !dependencies.bootstrapSecret
      || !providedSecret
      || !secureStringsMatch(providedSecret, dependencies.bootstrapSecret)
    ) {
      throw new AppError('Desktop bootstrap challenge is invalid.', {
        code: 'DESKTOP_BOOTSTRAP_INVALID',
        statusCode: 401,
      });
    }
    if (typeof nonce !== 'string' || !isDesktopSessionNonce(nonce)) {
      throw new AppError('Desktop bootstrap nonce is invalid.', {
        code: 'DESKTOP_BOOTSTRAP_NONCE_INVALID',
        statusCode: 400,
      });
    }
    prune();
    if (usedNonces.has(nonce)) {
      throw new AppError('Desktop bootstrap nonce was already used.', {
        code: 'DESKTOP_BOOTSTRAP_REPLAYED',
        statusCode: 409,
      });
    }
    usedNonces.add(nonce);
  };

  const getOrCreatePrincipal = async (): Promise<AuthUser> => {
    const existing = dependencies.users.getFirstUser();
    if (existing) return existing;
    if (principalPromise) return principalPromise;

    principalPromise = (async () => {
      const passwordHash = await dependencies.hashPassword(randomSecret());
      dependencies.transaction.begin();
      try {
        const concurrentExisting = dependencies.users.getFirstUser();
        if (concurrentExisting) {
          dependencies.transaction.commit();
          return concurrentExisting;
        }
        const created = dependencies.users.createUser(INTERNAL_USERNAME, passwordHash);
        dependencies.users.completeOnboarding(numericUserId(created.id));
        dependencies.transaction.commit();
        return created;
      } catch (error) {
        dependencies.transaction.rollback();
        throw error;
      }
    })().finally(() => {
      principalPromise = null;
    });
    return principalPromise;
  };

  const createSession = async () => {
    const principal = await getOrCreatePrincipal();
    dependencies.users.updateLastLogin(numericUserId(principal.id));
    return {
      token: dependencies.generateToken(principal),
      user: {
        id: principal.id,
        username: principal.username,
        internal: principal.username === INTERNAL_USERNAME,
      },
    };
  };

  return {
    async bootstrap(options: {
      providedSecret?: string;
      nonce?: string;
      remoteAddress?: string;
    }) {
      consumeChallenge(options.providedSecret, options.nonce, options.remoteAddress);
      return createSession();
    },

    registerBrowserHandoff(options: {
      providedSecret?: string;
      nonce?: string;
      remoteAddress?: string;
    }) {
      consumeChallenge(options.providedSecret, options.nonce, options.remoteAddress);
      browserHandoffs.set(options.nonce as string, now() + HANDOFF_TTL_MS);
      return { path: `/api/auth/desktop-handoff/${options.nonce}` };
    },

    async consumeBrowserHandoff(nonce: string, remoteAddress: string | undefined) {
      assertLocalRequest(remoteAddress);
      prune();
      const expiresAt = browserHandoffs.get(nonce);
      browserHandoffs.delete(nonce);
      if (!expiresAt || expiresAt <= now()) {
        throw new AppError('Desktop browser handoff is invalid or expired.', {
          code: 'DESKTOP_HANDOFF_INVALID',
          statusCode: 410,
        });
      }
      return createSession();
    },

    async configureLanCredentials(options: {
      providedSecret?: string;
      nonce?: string;
      remoteAddress?: string;
      username?: unknown;
      password?: unknown;
    }) {
      consumeChallenge(options.providedSecret, options.nonce, options.remoteAddress);
      const username = typeof options.username === 'string' ? options.username.trim() : '';
      const password = typeof options.password === 'string' ? options.password : '';
      if (username.length < 3 || username === INTERNAL_USERNAME) {
        throw new AppError('LAN username must contain at least 3 characters.', {
          code: 'DESKTOP_LAN_USERNAME_INVALID',
          statusCode: 400,
        });
      }
      if (password.length < 8) {
        throw new AppError('LAN password must contain at least 8 characters.', {
          code: 'DESKTOP_LAN_PASSWORD_INVALID',
          statusCode: 400,
        });
      }

      const principal = await getOrCreatePrincipal();
      const passwordHash = await dependencies.hashPassword(password);
      dependencies.transaction.begin();
      try {
        dependencies.users.updateCredentials(numericUserId(principal.id), username, passwordHash);
        dependencies.users.completeOnboarding(numericUserId(principal.id));
        dependencies.transaction.commit();
      } catch (error) {
        dependencies.transaction.rollback();
        throw error;
      }
      return { success: true, username };
    },
  };
}
