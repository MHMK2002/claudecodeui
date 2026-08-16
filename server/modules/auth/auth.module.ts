import { createRequire } from 'node:module';

import { getConnection, userDb } from '@/modules/database/index.js';
import { RUNTIME_MODE } from '@/shared/utils.js';

import { authenticateToken, generateToken } from './auth.middleware.js';
import { createAuthRouter } from './auth.routes.js';
import { createAuthService } from './auth.service.js';
import { createDesktopSessionService } from './desktop-session.service.js';

type BcryptAdapter = {
  hash(password: string, saltRounds: number): Promise<string>;
  compare(password: string, passwordHash: string): Promise<boolean>;
};

// bcrypt does not ship TypeScript declarations in this project, so the
// composition root narrows its CommonJS runtime surface before injecting it.
const require = createRequire(import.meta.url);
const bcrypt = require('bcrypt') as BcryptAdapter;
const databaseConnection = getConnection();

const authService = createAuthService({
  runtimeMode: RUNTIME_MODE,
  users: {
    hasUsers: () => userDb.hasUsers(),
    createUser: (username, passwordHash) => userDb.createUser(username, passwordHash),
    getUserByUsername: (username) => userDb.getUserByUsername(username),
    updateLastLogin: (userId) => userDb.updateLastLogin(userId),
  },
  transaction: {
    begin: () => databaseConnection.prepare('BEGIN').run(),
    commit: () => databaseConnection.prepare('COMMIT').run(),
    rollback: () => databaseConnection.prepare('ROLLBACK').run(),
  },
  hashPassword: (password) => bcrypt.hash(password, 12),
  comparePassword: (password, passwordHash) => bcrypt.compare(password, passwordHash),
  generateToken,
});

const desktopSessions = createDesktopSessionService({
  runtimeMode: RUNTIME_MODE,
  bootstrapSecret: process.env.CLOUDCLI_DESKTOP_OWNER_NONCE,
  users: {
    getFirstUser: () => userDb.getFirstUser(),
    createUser: (username, passwordHash) => userDb.createUser(username, passwordHash),
    updateCredentials: (userId, username, passwordHash) => {
      userDb.updateCredentials(userId, username, passwordHash);
    },
    completeOnboarding: (userId) => userDb.completeOnboarding(userId),
    updateLastLogin: (userId) => userDb.updateLastLogin(userId),
  },
  transaction: {
    begin: () => databaseConnection.prepare('BEGIN').run(),
    commit: () => databaseConnection.prepare('COMMIT').run(),
    rollback: () => databaseConnection.prepare('ROLLBACK').run(),
  },
  hashPassword: (password) => bcrypt.hash(password, 12),
  generateToken,
});

/** Auth router assembled for the server entrypoint. */
export const authRoutes = createAuthRouter({
  service: authService,
  desktopSessions,
  authenticateToken,
  runtimeMode: RUNTIME_MODE,
});
