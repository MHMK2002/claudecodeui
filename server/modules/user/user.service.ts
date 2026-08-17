import type {
  CommitMessageGeneratorSettings,
  LLMProvider,
  ProviderTextCompletionSelection,
} from '@/shared/types.js';
import {
  AppError,
  COMMIT_MESSAGE_BASE_PROMPT_MAX_LENGTH,
  DEFAULT_COMMIT_MESSAGE_BASE_PROMPT,
} from '@/shared/utils.js';

type GitConfig = {
  git_name: string | null;
  git_email: string | null;
};

type UserDependencies = {
  users: {
    getGitConfig(userId: number): GitConfig | undefined;
    updateGitIdentity(userId: number, gitName: string | null, gitEmail: string | null): void;
    getCommitMessageGeneratorSettings(userId: number): CommitMessageGeneratorSettings | null;
    updateGitConfig(
      userId: number,
      gitName: string,
      gitEmail: string,
      generator: CommitMessageGeneratorSettings,
    ): void;
    completeOnboarding(userId: number): void;
    hasCompletedOnboarding(userId: number): boolean;
  };
  resolveDefaultTextCompletionSelection(
    userId: number,
  ): Promise<ProviderTextCompletionSelection | null>;
  validateProviderSelection(input: ProviderTextCompletionSelection & { userId: number }): Promise<void>;
  readSystemGitConfig(): Promise<GitConfig>;
  applyGlobalGitConfig(gitName: string, gitEmail: string): Promise<void>;
  logInfo(message: string): void;
  logError(message: string, error: unknown): void;
};

const GENERATOR_PROVIDERS = new Set<LLMProvider>(['claude', 'codex', 'cursor', 'opencode']);

type GitConfigUpdateInput = {
  gitName?: unknown;
  gitEmail?: unknown;
  commitMessage?: unknown;
};

function readCommitMessageSettings(value: unknown): CommitMessageGeneratorSettings {
  const input = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  const provider = input?.provider;
  const providerProfileId = input?.providerProfileId;
  const model = typeof input?.model === 'string' ? input.model.trim() : '';
  const effort = input?.effort === null
    ? null
    : typeof input?.effort === 'string'
      ? input.effort.trim()
      : '';
  const basePrompt = typeof input?.basePrompt === 'string' ? input.basePrompt.trim() : null;
  if (
    !GENERATOR_PROVIDERS.has(provider as LLMProvider)
    || !(providerProfileId === null || (Number.isInteger(providerProfileId) && Number(providerProfileId) > 0))
    || !model
    || model.length > 256
    || !(effort === null || (effort.length > 0 && effort.length <= 64))
    || basePrompt === null
    || basePrompt.length > COMMIT_MESSAGE_BASE_PROMPT_MAX_LENGTH
  ) {
    throw new AppError('Commit-message generator settings are invalid.', {
      code: 'INVALID_COMMIT_MESSAGE_SETTINGS',
      statusCode: 400,
    });
  }
  return {
    provider: provider as LLMProvider,
    providerProfileId: providerProfileId as number | null,
    model,
    effort,
    basePrompt,
  };
}

/** Creates user-profile workflows with explicit repository and Git adapters. */
export function createUserService(dependencies: UserDependencies) {
  const buildGitConfigResponse = async (userId: number, gitConfig?: GitConfig) => {
    const storedGenerator = dependencies.users.getCommitMessageGeneratorSettings(userId);
    const defaultSelection = storedGenerator
      ? null
      : await dependencies.resolveDefaultTextCompletionSelection(userId);
    return {
      success: true,
      gitName: gitConfig?.git_name ?? null,
      gitEmail: gitConfig?.git_email ?? null,
      commitMessage: storedGenerator ?? (defaultSelection
        ? { ...defaultSelection, basePrompt: DEFAULT_COMMIT_MESSAGE_BASE_PROMPT }
        : null),
      defaultCommitMessageBasePrompt: DEFAULT_COMMIT_MESSAGE_BASE_PROMPT,
      commitMessageBasePromptMaxLength: COMMIT_MESSAGE_BASE_PROMPT_MAX_LENGTH,
    };
  };

  return {
    async getGitConfig(userId: number) {
      let gitConfig = dependencies.users.getGitConfig(userId);
      if (!gitConfig || (!gitConfig.git_name && !gitConfig.git_email)) {
        const systemConfig = await dependencies.readSystemGitConfig();
        if (systemConfig.git_name || systemConfig.git_email) {
          dependencies.users.updateGitIdentity(
            userId,
            systemConfig.git_name,
            systemConfig.git_email,
          );
          gitConfig = systemConfig;
          dependencies.logInfo(`Auto-populated Git config for user ${userId}`);
        }
      }

      return buildGitConfigResponse(userId, gitConfig);
    },

    async updateGitConfig(userId: number, input: GitConfigUpdateInput) {
      const gitName = typeof input.gitName === 'string' ? input.gitName.trim() : '';
      const gitEmail = typeof input.gitEmail === 'string' ? input.gitEmail.trim() : '';
      if (!gitName || !gitEmail) {
        throw new AppError('Git name and email are required', {
          code: 'GIT_CONFIG_REQUIRED',
          statusCode: 400,
        });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(gitEmail)) {
        throw new AppError('Invalid email format', {
          code: 'INVALID_GIT_EMAIL',
          statusCode: 400,
        });
      }

      const commitMessage = readCommitMessageSettings(input.commitMessage);
      await dependencies.validateProviderSelection({ userId, ...commitMessage });
      dependencies.users.updateGitConfig(userId, gitName, gitEmail, commitMessage);
      try {
        await dependencies.applyGlobalGitConfig(gitName, gitEmail);
      } catch (error) {
        // Persisted user settings remain authoritative even if the host Git
        // installation cannot be updated (matching the previous behavior).
        dependencies.logError('Failed to apply global Git config', error);
      }
      return buildGitConfigResponse(userId, { git_name: gitName, git_email: gitEmail });
    },

    completeOnboarding(userId: number) {
      dependencies.users.completeOnboarding(userId);
      return { success: true, message: 'Onboarding completed successfully' };
    },

    getOnboardingStatus(userId: number) {
      return {
        success: true,
        hasCompletedOnboarding: dependencies.users.hasCompletedOnboarding(userId),
      };
    },
  };
}
