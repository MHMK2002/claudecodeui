import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

import { sessionsDb } from '@/modules/database/index.js';
import {
  buildLookupMap,
  extractFirstValidJsonlData,
  findFilesRecursivelyCreatedAfter,
  normalizeSessionName,
  readFileTimestamps,
} from '@/shared/utils.js';
import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';

type ParsedSession = {
  sessionId: string;
  projectPath: string;
  sessionName?: string;
};

type ParsedSubagent = {
  agentId: string;
  parentProviderSessionId: string;
  projectPath: string;
  sessionName: string;
};

/**
 * Sub-agent rows are labelled with the opening prompt Claude handed the agent,
 * trimmed to a single readable sidebar line.
 */
const SUBAGENT_NAME_MAX_LENGTH = 80;

function buildSubagentName(prompt: string | undefined, agentId: string): string {
  const firstLine = (prompt ?? '').replace(/\s+/g, ' ').trim();
  if (!firstLine) {
    return `Agent ${agentId.slice(0, 8)}`;
  }

  return firstLine.length > SUBAGENT_NAME_MAX_LENGTH
    ? `${firstLine.slice(0, SUBAGENT_NAME_MAX_LENGTH).trimEnd()}…`
    : firstLine;
}

/**
 * Session indexer for Claude transcript artifacts.
 */
export class ClaudeSessionSynchronizer implements IProviderSessionSynchronizer {
  private readonly provider = 'claude' as const;
  private readonly claudeHome = path.join(os.homedir(), '.claude');

  /**
   * Returns true when a JSONL file is a subagent transcript or tool result
   * rather than a top-level session.
   *
   * Claude stores subagent transcripts under a `subagents/` directory and
   * tool results under a `tool-results/` directory, e.g.
   * `~/.claude/projects/<encoded-cwd>/<session-id>/subagents/agent-<id>.jsonl`.
   * Those files repeat the parent session's `sessionId`, so indexing them via
   * the normal session path would overwrite the parent row's `jsonl_path` and
   * corrupt the main session record. They go through `processSubagentFile`
   * instead, which keys them by their own `agentId`.
   */
  private isSubagentTranscript(filePath: string): boolean {
    const pathParts = path.normalize(filePath).split(path.sep);
    return pathParts.includes('subagents') || pathParts.includes('tool-results');
  }

  /**
   * Scans ~/.claude/projects and upserts discovered sessions into DB.
   *
   * Sub-agent transcripts are handled in a second pass: a child row stores the
   * app-facing id of its parent, which only exists once the parent transcript
   * has been indexed.
   */
  async synchronize(since?: Date): Promise<number> {
    const nameMap = await buildLookupMap(path.join(this.claudeHome, 'history.jsonl'), 'sessionId', 'display');
    const files = await findFilesRecursivelyCreatedAfter(
      path.join(this.claudeHome, 'projects'),
      '.jsonl',
      since ?? null
    );

    const sessionFiles: string[] = [];
    const subagentFiles: string[] = [];
    for (const filePath of files) {
      if (this.isSubagentTranscript(filePath)) {
        subagentFiles.push(filePath);
      } else {
        sessionFiles.push(filePath);
      }
    }

    let processed = 0;
    for (const filePath of sessionFiles) {
      const parsed = await this.processSessionFile(filePath, nameMap);
      if (!parsed) {
        continue;
      }

      const branch = sessionsDb.getProviderBranch(this.provider, parsed.sessionId);
      if (branch) {
        sessionsDb.updateProviderBranchPath(this.provider, parsed.sessionId, filePath);
        if (branch.state !== 'current') {
          continue;
        }
      }

      const timestamps = await readFileTimestamps(filePath);
      sessionsDb.createSession(
        parsed.sessionId,
        this.provider,
        parsed.projectPath,
        parsed.sessionName,
        timestamps.createdAt,
        timestamps.updatedAt,
        filePath
      );
      processed += 1;
    }

    for (const filePath of subagentFiles) {
      if (await this.synchronizeSubagentFile(filePath)) {
        processed += 1;
      }
    }

    return processed;
  }

  /**
   * Parses and upserts one Claude session JSONL file.
   */
  async synchronizeFile(filePath: string): Promise<string | null> {
    if (!filePath.endsWith('.jsonl')) {
      return null;
    }
    if (this.isSubagentTranscript(filePath)) {
      return this.synchronizeSubagentFile(filePath);
    }

    const nameMap = await buildLookupMap(path.join(this.claudeHome, 'history.jsonl'), 'sessionId', 'display');
    const parsed = await this.processSessionFile(filePath, nameMap);
    if (!parsed) {
      return null;
    }

    const branch = sessionsDb.getProviderBranch(this.provider, parsed.sessionId);
    if (branch) {
      sessionsDb.updateProviderBranchPath(this.provider, parsed.sessionId, filePath);
      if (branch.state !== 'current') {
        return null;
      }
    }

    const timestamps = await readFileTimestamps(filePath);
    return sessionsDb.createSession(
      parsed.sessionId,
      this.provider,
      parsed.projectPath,
      parsed.sessionName,
      timestamps.createdAt,
      timestamps.updatedAt,
      filePath
    );
  }

  /**
   * Upserts one sub-agent transcript as a child of the session that spawned it.
   *
   * Returns null when the parent has not been indexed yet — the next scan (or
   * the watcher event for the parent's own transcript) picks the child up.
   */
  private async synchronizeSubagentFile(filePath: string): Promise<string | null> {
    const parsed = await this.processSubagentFile(filePath);
    if (!parsed) {
      return null;
    }

    // The rows inside an agent transcript carry the *parent's* provider session
    // id, which still has to be mapped onto the app-facing row id.
    const parentBranch = sessionsDb.getProviderBranch(
      this.provider,
      parsed.parentProviderSessionId,
    );
    if (parentBranch && parentBranch.state !== 'current') {
      return null;
    }
    const parentSession = parentBranch
      ? sessionsDb.getSessionById(parentBranch.app_session_id)
      : sessionsDb.getSessionByProviderSessionId(parsed.parentProviderSessionId)
        ?? sessionsDb.getSessionById(parsed.parentProviderSessionId);
    if (!parentSession) {
      return null;
    }

    const timestamps = await readFileTimestamps(filePath);
    return sessionsDb.createSubagentSession({
      agentSessionId: parsed.agentId,
      provider: this.provider,
      parentSessionId: parentSession.session_id,
      projectPath: parsed.projectPath,
      jsonlPath: filePath,
      customName: parsed.sessionName,
      createdAt: timestamps.createdAt,
      updatedAt: timestamps.updatedAt,
    });
  }

  /**
   * Extracts sub-agent metadata from one `agent-<id>.jsonl` transcript.
   *
   * The first row is the prompt Claude handed the agent, and every row carries
   * both `agentId` and the parent's `sessionId`.
   */
  private async processSubagentFile(filePath: string): Promise<ParsedSubagent | null> {
    return extractFirstValidJsonlData(filePath, (rawData) => {
      const data = rawData as Record<string, unknown>;
      const agentId = typeof data.agentId === 'string' ? data.agentId : undefined;
      const parentProviderSessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined;
      const projectPath = typeof data.cwd === 'string' ? data.cwd : undefined;

      if (!agentId || !parentProviderSessionId || !projectPath) {
        return null;
      }

      const message = data.message as Record<string, unknown> | undefined;
      const prompt = typeof message?.content === 'string' ? message.content : undefined;

      return {
        agentId,
        parentProviderSessionId,
        projectPath,
        sessionName: buildSubagentName(prompt, agentId),
      };
    });
  }

  /**
   * Extracts session metadata from one Claude JSONL session file.
   */
  private async processSessionFile(
    filePath: string,
    nameMap: Map<string, string>
  ): Promise<ParsedSession | null> {
    const parsed = await extractFirstValidJsonlData(filePath, (rawData) => {
      const data = rawData as Record<string, unknown>;
      const sessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined;
      const projectPath = typeof data.cwd === 'string' ? data.cwd : undefined;

      if (!sessionId || !projectPath) {
        return null;
      }

      return {
        sessionId,
        projectPath,
      };
    });

    if (!parsed) {
      return null;
    }

    // App-created sessions are keyed by an app id, so disk-discovered provider
    // ids must be resolved through the provider-id mapping first.
    const existingSession = sessionsDb.getSessionByProviderSessionId(parsed.sessionId)
      ?? sessionsDb.getSessionById(parsed.sessionId);
    const existingSessionName = existingSession?.custom_name;
    if (existingSessionName && existingSessionName !== 'Untitled Claude Session') {
      return {
        ...parsed,
        sessionName: normalizeSessionName(existingSessionName, 'Untitled Claude Session'),
      };
    }

    let sessionName = nameMap.get(parsed.sessionId);
    if (!sessionName) {
      sessionName = await this.extractSessionAiTitleFromEnd(filePath, parsed.sessionId);
    }

    return {
      ...parsed,
      sessionName: normalizeSessionName(sessionName, 'Untitled Claude Session'),
    };
  }

  private async extractSessionAiTitleFromEnd(
    filePath: string,
    sessionId: string
  ): Promise<string | undefined> {
    try {
      const content = await readFile(filePath, 'utf8');
      const lines = content.split(/\r?\n/);

      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index]?.trim();
        if (!line) {
          continue;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }

        const data = parsed as Record<string, unknown>;
        const eventType = typeof data.type === 'string' ? data.type : undefined;
        const eventSessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined;
        const aiTitle = typeof data.aiTitle === 'string' ? data.aiTitle : undefined;
        const lastPrompt = typeof data.lastPrompt === 'string' ? data.lastPrompt : undefined;
        const claudeRenamedTitle = typeof data.customTitle === 'string' ? data.customTitle : undefined;

        if (
          (eventType === 'ai-title' && eventSessionId === sessionId && aiTitle?.trim()) ||
          (eventType === 'last-prompt' && eventSessionId === sessionId && lastPrompt?.trim()) ||
          (eventType === "custom-title" && eventSessionId === sessionId && claudeRenamedTitle?.trim())
        ) {
          return aiTitle || lastPrompt || claudeRenamedTitle;
        }
      }
    } catch {
      // Ignore missing/unreadable files so sync can continue.
    }

    return undefined;
  }
}
