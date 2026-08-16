import { query } from '@anthropic-ai/claude-agent-sdk';

import { providerProfilesDb } from '@/modules/database/index.js';
import { resolveClaudeCodeExecutablePath } from '@/shared/claude-cli-path.js';
import type { LLMProvider, NormalizedMessage } from '@/shared/types.js';

type ForkContextServiceDependencies = {
  query?: typeof query;
};

/**
 * Forked-session context summarizer.
 *
 * When a session is forked (often across providers — e.g. Claude → Codex), the
 * new row starts empty: provider transcript formats differ, so nothing is
 * cloned. To keep the new agent oriented, this module condenses the source
 * session's already-normalized history into a short handoff summary, which the
 * chat gateway prepends to the forked session's first outgoing message only.
 *
 * Design notes:
 * - Summaries are produced with the Claude Agent SDK (Haiku, no tools). It is
 *   the only Anthropic dependency available and it resolves every auth mode
 *   (api_key profile, auth_token profile, Local CLI) uniformly by spawning the
 *   Claude Code binary.
 * - The env-building helper is intentionally duplicated here (instead of
 *   imported from claude-sdk.js) to avoid a sessions.service → fork-context →
 *   claude-sdk → sessions.service import cycle.
 * - Every failure path (no credential, SDK error, timeout) degrades to either a
 *   rendered transcript or null, so a fork never blocks or fails because of the
 *   summary step.
 */

const SUMMARY_TIMEOUT_MS = Number(process.env.FORK_CONTEXT_SUMMARY_TIMEOUT_MS) || 20000;
const SUMMARY_MODEL = process.env.FORK_CONTEXT_MODEL || 'haiku';
const TRANSCRIPT_CHAR_CAP = 8000;
const SUMMARY_INPUT_CHAR_CAP = 24000;

const SUMMARY_SYSTEM_PROMPT = [
  'You summarize a software-engineering chat so a different AI coding agent can take over mid-task.',
  'Read the transcript and produce a tight handoff in EXACTLY this structure (no preamble, no Markdown fences):',
  '',
  '## Goal',
  '<the user objective in 1-2 sentences>',
  '',
  '## What was done',
  '<bullet list of concrete work already completed>',
  '',
  '## What\'s next',
  '<bullet list of the immediate next steps the new agent should consider>',
  '',
  '## Key files & decisions',
  '<bullet list of important file paths, decisions, constraints, or open questions>',
  '',
  'Use only information present in the transcript. If a section has nothing, write "—". Keep it under ~300 words.',
].join('\n');

type ClaudeCredential = {
  baseUrl: string | null;
  authType: string;
  secretValue: string;
};

/** Minimal shape of a runtime provider profile, what we read to build env. */
type ProviderProfileRuntimeLike = {
  baseUrl?: string | null;
  authType: string;
  secretValue?: string;
};

type BuildForkContextInput = {
  messages: NormalizedMessage[];
  sourceProvider: LLMProvider;
  sourceProviderProfileId: number | null;
  projectPath: string | null;
  /** Authenticated user id, used to look up provider profiles. */
  userId: number | null;
};

/**
 * Renders the source session's history into a compact, line-oriented transcript
 * for the summarizer. Keeps only substantive text turns (user + assistant),
 * dropping tool/result/streaming noise that would bloat the prompt.
 */
function renderTranscript(messages: NormalizedMessage[]): string {
  const lines: string[] = [];
  for (const message of messages) {
    if (message.kind !== 'text' && message.kind !== 'thinking') {
      continue;
    }
    const role = message.role ?? (message.kind === 'thinking' ? 'assistant' : 'user');
    const content = (message.content ?? '').trim();
    if (!content) {
      continue;
    }
    const label = role === 'assistant' ? 'Assistant' : 'User';
    lines.push(`${label}: ${content}`);
  }
  return lines.join('\n\n');
}

function truncateFromEnd(text: string, cap: number): string {
  if (text.length <= cap) {
    return text;
  }
  // Keep the most recent turns — they carry the current task state.
  return `…(earlier turns elided)…\n\n${text.slice(-cap)}`;
}

/**
 * Mirrors buildClaudeProviderProfileEnv in claude-sdk.js. Duplicated to avoid an
 * import cycle (see module notes). Returns the Anthropic env vars implied by a
 * profile, or an empty object for Local CLI / no profile.
 */
function buildClaudeEnvFromCredential(credential: ClaudeCredential | null): NodeJS.ProcessEnv {
  if (!credential || !credential.secretValue.trim()) {
    return { ...process.env };
  }
  const env: NodeJS.ProcessEnv = { ...process.env };
  env.ANTHROPIC_BASE_URL = credential.baseUrl ?? '';
  if (credential.authType === 'api_key') {
    env.ANTHROPIC_API_KEY = credential.secretValue;
    env.ANTHROPIC_AUTH_TOKEN = '';
  } else {
    env.ANTHROPIC_AUTH_TOKEN = credential.secretValue;
    env.ANTHROPIC_API_KEY = '';
  }
  return env;
}

/**
 * Resolves a Claude credential to drive the summarizer. Prefers the source
 * session's own Claude profile; otherwise falls back to the user's default
 * Claude profile (so a Codex → Claude fork can still summarize via Claude); and
 * finally to Local CLI (server process env + the Claude Code executable's own
 * stored auth). Returns null when no profile applies — the caller then relies on
 * Local CLI auth alone.
 */
function resolveClaudeCredential(input: BuildForkContextInput): ClaudeCredential | null {
  const { userId, sourceProvider, sourceProviderProfileId } = input;

  if (sourceProvider === 'claude' && userId != null && sourceProviderProfileId != null) {
    const profile = providerProfilesDb.getProviderProfileForRuntime(
      userId,
      'claude',
      sourceProviderProfileId,
    );
    if (profile) {
      return profileToCredential(profile);
    }
  }

  // For non-Claude sources (or a missing source profile), try the user's
  // default Claude profile so the summary still runs on Claude.
  if (userId != null) {
    const defaultClaude = providerProfilesDb
      .listProviderProfiles(userId, 'claude')
      .find((profile) => profile.isActive !== false);
    if (defaultClaude && defaultClaude.id != null) {
      const runtime = providerProfilesDb.getProviderProfileForRuntime(userId, 'claude', defaultClaude.id);
      if (runtime) {
        return profileToCredential(runtime);
      }
    }
  }

  return null;
}

function profileToCredential(profile: ProviderProfileRuntimeLike): ClaudeCredential {
  return {
    baseUrl: profile.baseUrl ?? null,
    authType: profile.authType,
    secretValue: profile.secretValue ?? '',
  };
}

/**
 * Drives a constrained Claude Agent SDK query (Haiku, no tools) to summarize the
 * rendered transcript. Collects assistant text blocks and returns the joined
 * summary. Throws on any error or timeout — the caller handles fallbacks.
 */
async function summarizeWithClaude(
  transcript: string,
  env: NodeJS.ProcessEnv,
  cwd: string | undefined,
  queryFn: typeof query,
): Promise<string> {
  const queryInstance = queryFn({
    prompt: transcript,
    options: {
      model: SUMMARY_MODEL,
      // Pure text: no tools, no MCP, no project settings that could change behavior.
      allowedTools: [],
      disallowedTools: [],
      permissionMode: 'bypassPermissions',
      systemPrompt: SUMMARY_SYSTEM_PROMPT,
      settingSources: [],
      persistSession: false,
      env,
      pathToClaudeCodeExecutable: resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH),
      ...(cwd ? { cwd } : {}),
    },
  });

  const chunks: string[] = [];
  for await (const message of queryInstance) {
    const assistantContent = message?.type === 'assistant' ? message?.message?.content : null;
    if (!Array.isArray(assistantContent)) {
      continue;
    }
    for (const block of assistantContent) {
      if (block && typeof block === 'object' && (block as { type?: string }).type === 'text') {
        const text = (block as { text?: string }).text;
        if (typeof text === 'string' && text.length) {
          chunks.push(text);
        }
      }
    }
  }

  const summary = chunks.join('').trim();
  if (!summary) {
    throw new Error('Claude summarizer produced no text output.');
  }
  return summary;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Creates the context handoff service consumed by sessions.service. Provider
 * tests inject the Claude query dependency to verify SDK options without
 * credentials, network access, or filesystem persistence.
 */
export function createForkContextService(dependencies: ForkContextServiceDependencies = {}) {
  const queryFn = dependencies.query ?? query;

  return {
    /**
     * Builds the carried-over context for a forked session. Returns a summary
     * string (preferred), a rendered transcript fallback, or null when there is
     * nothing usable. Never throws — fork callers can await this unconditionally.
     */
    async buildForkContext(input: BuildForkContextInput): Promise<string | null> {
      const transcript = renderTranscript(input.messages);
      if (!transcript.trim()) {
        return null;
      }

      const truncatedTranscript = truncateFromEnd(transcript, SUMMARY_INPUT_CHAR_CAP);
      const credential = resolveClaudeCredential(input);
      const env = buildClaudeEnvFromCredential(credential);
      const cwd = input.projectPath ?? undefined;

      try {
        const summary = await withTimeout(
          summarizeWithClaude(truncatedTranscript, env, cwd, queryFn),
          SUMMARY_TIMEOUT_MS,
          'fork-context summary',
        );
        return summary;
      } catch (error) {
        // Any failure (no/bad credential, SDK error, timeout) degrades to the raw
        // transcript so the fork still carries context, just unsummarized.
        console.warn(
          '[fork-context] Claude summary failed; falling back to rendered transcript:',
          error instanceof Error ? error.message : error,
        );
        return truncateFromEnd(transcript, TRANSCRIPT_CHAR_CAP);
      }
    },
  };
}

/** Singleton consumed by sessions.service when a fork carries source context. */
export const forkContextService = createForkContextService();
