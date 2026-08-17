import * as fs from 'node:fs/promises';

import spawn from 'cross-spawn';

import { projectsDb, userDb } from '@/modules/database/index.js';
import { providerSelectionService } from '@/modules/providers/index.js';
import type { ProviderTextCompletionService } from '@/shared/types.js';

import { createGitCommitMessageService } from './git-commit-message.service.js';
import { createGitRouter } from './git.routes.js';

type GitExternalDependencies = {
  textCompletion: ProviderTextCompletionService;
};

/** Assembles Git routes with the Providers public text-completion boundary. */
export function createGitModule(externalDependencies: GitExternalDependencies) {
  const resolveProjectPathById = (projectId: string) => projectsDb.getProjectPathById(projectId);
  const commitMessageService = createGitCommitMessageService({
    spawnProcess: spawn,
    resolveProjectPathById,
    textCompletion: externalDependencies.textCompletion,
    getCommitMessageGeneratorSettings: (userId) => (
      userDb.getCommitMessageGeneratorSettings(userId)
    ),
    resolveDefaultTextCompletionSelection: (userId) => (
      providerSelectionService.resolveDefaultTextCompletionSelection(userId)
    ),
  });
  return createGitRouter({
    fileSystem: fs,
    spawnProcess: spawn,
    resolveProjectPathById,
    commitMessageService,
  });
}
