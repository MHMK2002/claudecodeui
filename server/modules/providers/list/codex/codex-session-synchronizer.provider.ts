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
  agentSessionId: string;
  parentProviderSessionId: string;
  projectPath: string;
  agentType: string | null;
  sessionName: string;
};

/**
 * Session indexer for Codex transcript artifacts.
 */
export class CodexSessionSynchronizer implements IProviderSessionSynchronizer {
  private readonly provider = 'codex' as const;
  private readonly codexHome = path.join(os.homedir(), '.codex');

  /**
   * Scans ~/.codex/sessions and upserts discovered sessions into DB.
   *
   * Sub-agent rollouts are indexed in a second pass: a child row stores the
   * app-facing id of its parent, which only exists once the parent rollout has
   * been indexed.
   */
  async synchronize(since?: Date): Promise<number> {
    const nameMap = await buildLookupMap(path.join(this.codexHome, 'session_index.jsonl'), 'id', 'thread_name');
    const files = await findFilesRecursivelyCreatedAfter(
      path.join(this.codexHome, 'sessions'),
      '.jsonl',
      since ?? null
    );

    let processed = 0;
    const pendingSubagents: Array<{ filePath: string; parsed: ParsedSubagent }> = [];

    for (const filePath of files) {
      // Sub-agent rollouts live in the same tree as user sessions and are the
      // main reason `processSessionFile` returns null, so they are checked
      // first and deferred to the second pass.
      const parsedSubagent = await this.processSubagentFile(filePath);
      if (parsedSubagent) {
        pendingSubagents.push({ filePath, parsed: parsedSubagent });
        continue;
      }

      const parsed = await this.processSessionFile(filePath, nameMap);
      if (!parsed) {
        continue;
      }

      const existingSession = sessionsDb.getSessionByProviderSessionId(parsed.sessionId)
        ?? sessionsDb.getSessionById(parsed.sessionId);
      if (existingSession) {
        // If session name is untitled and we now have a name, update it
        if (existingSession.custom_name === 'Untitled Codex Session' && parsed.sessionName && parsed.sessionName !== 'Untitled Codex Session') {
          sessionsDb.updateSessionCustomName(existingSession.session_id, parsed.sessionName);
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

    for (const { filePath, parsed } of pendingSubagents) {
      if (this.upsertSubagentSession(filePath, parsed, await readFileTimestamps(filePath))) {
        processed += 1;
      }
    }

    return processed;
  }

  /**
   * Parses and upserts one Codex session JSONL file.
   */
  async synchronizeFile(filePath: string): Promise<string | null> {
    if (!filePath.endsWith('.jsonl')) {
      return null;
    }

    const parsedSubagent = await this.processSubagentFile(filePath);
    if (parsedSubagent) {
      return this.upsertSubagentSession(filePath, parsedSubagent, await readFileTimestamps(filePath));
    }

    const nameMap = await buildLookupMap(path.join(this.codexHome, 'session_index.jsonl'), 'id', 'thread_name');
    const parsed = await this.processSessionFile(filePath, nameMap);
    if (!parsed) {
      return null;
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
   * Upserts one parsed sub-agent rollout as a child of its parent thread.
   *
   * Returns null when the parent has not been indexed yet — the next scan (or
   * the watcher event for the parent rollout) picks the child up.
   */
  private upsertSubagentSession(
    filePath: string,
    parsed: ParsedSubagent,
    timestamps: { createdAt?: string; updatedAt?: string }
  ): string | null {
    const parentSession = sessionsDb.getSessionByProviderSessionId(parsed.parentProviderSessionId)
      ?? sessionsDb.getSessionById(parsed.parentProviderSessionId);
    if (!parentSession) {
      return null;
    }

    return sessionsDb.createSubagentSession({
      agentSessionId: parsed.agentSessionId,
      provider: this.provider,
      parentSessionId: parentSession.session_id,
      projectPath: parsed.projectPath,
      jsonlPath: filePath,
      agentType: parsed.agentType,
      customName: parsed.sessionName,
      createdAt: timestamps.createdAt,
      updatedAt: timestamps.updatedAt,
    });
  }

  /**
   * Extracts sub-agent metadata from one Codex rollout, or null when the
   * rollout is a normal user session.
   *
   * Codex >=0.144 records the spawning thread in `parent_thread_id` and the
   * agent identity under `source.subagent.thread_spawn`.
   */
  private async processSubagentFile(filePath: string): Promise<ParsedSubagent | null> {
    return extractFirstValidJsonlData(filePath, (rawData) => {
      const data = rawData as Record<string, unknown>;
      const payload = data.payload as Record<string, unknown> | undefined;
      if (!payload || !this.isSubagentSessionMeta(payload)) {
        return null;
      }

      const agentSessionId = typeof payload.id === 'string' ? payload.id : undefined;
      const parentProviderSessionId = typeof payload.parent_thread_id === 'string'
        ? payload.parent_thread_id
        : undefined;
      const projectPath = typeof payload.cwd === 'string' ? payload.cwd : undefined;

      if (!agentSessionId || !parentProviderSessionId || !projectPath) {
        return null;
      }

      const nickname = typeof payload.agent_nickname === 'string' ? payload.agent_nickname.trim() : '';
      const agentPath = typeof payload.agent_path === 'string' ? payload.agent_path.trim() : '';
      const agentType = agentPath ? path.basename(agentPath) : null;

      return {
        agentSessionId,
        parentProviderSessionId,
        projectPath,
        agentType,
        sessionName: nickname || agentType || `Agent ${agentSessionId.slice(0, 8)}`,
      };
    });
  }

  /**
   * Extracts session metadata from one Codex JSONL session file.
   */
  private async processSessionFile(
    filePath: string,
    nameMap: Map<string, string>
  ): Promise<ParsedSession | null> {
    const parsed = await extractFirstValidJsonlData(filePath, (rawData) => {
      const data = rawData as Record<string, unknown>;
      const payload = data.payload as Record<string, unknown> | undefined;
      const sessionId = typeof payload?.id === 'string' ? payload.id : undefined;
      const projectPath = typeof payload?.cwd === 'string' ? payload.cwd : undefined;

      if (!sessionId || !projectPath) {
        return null;
      }

      return {
        sessionId,
        projectPath,
        isSubagent: payload ? this.isSubagentSessionMeta(payload) : false,
      };
    });

    if (!parsed || parsed.isSubagent) {
      return null;
    }

    // App-created sessions are keyed by an app id, so disk-discovered provider
    // ids must be resolved through the provider-id mapping first.
    const existingSession = sessionsDb.getSessionByProviderSessionId(parsed.sessionId)
      ?? sessionsDb.getSessionById(parsed.sessionId);
    const existingSessionName = existingSession?.custom_name;
    if (existingSessionName && existingSessionName !== 'Untitled Codex Session') {
      return {
        ...parsed,
        sessionName: normalizeSessionName(existingSessionName, 'Untitled Codex Session'),
      };
    }

    // Sessions started by sending a message from cloudcli carry a distinct
    // app-allocated session_id mapped to the provider id. For these we title the
    // conversation from the first user message the user typed, instead of the
    // generic "Untitled Codex Session" placeholder. Sessions discovered purely
    // by indexing (session_id === provider_session_id) keep the existing
    // thread_name/last-agent-message setup below.
    const isAppCreated =
      existingSession != null &&
      existingSession.provider_session_id != null &&
      existingSession.session_id !== existingSession.provider_session_id;

    let sessionName = isAppCreated
      ? await this.extractFirstUserMessageFromStart(filePath)
      : undefined;
    if (!sessionName) {
      sessionName = nameMap.get(parsed.sessionId);
    }
    if (!sessionName) {
      sessionName = await this.extractLastAgentMessageFromEnd(filePath);
    }

    return {
      ...parsed,
      sessionName: normalizeSessionName(sessionName, 'Untitled Codex Session'),
    };
  }

  /**
   * Returns true when a session_meta payload belongs to a Codex sub-agent
   * thread (Codex >=0.144 collaboration spawn_agent, review, compact, etc.).
   * Sub-agent rollouts live in the same sessions tree as user sessions, so
   * they must be skipped here to stay out of the sidebar — the Codex
   * equivalent of the Claude synchronizer's subagent transcript skip.
   * Top-level sessions carry thread_source "user" and a string source
   * ("exec"/"cli"); sub-agents carry thread_source "subagent" and an object
   * source keyed by "subagent".
   */
  private isSubagentSessionMeta(payload: Record<string, unknown>): boolean {
    if (payload.thread_source === 'subagent') {
      return true;
    }

    const source = payload.source;
    return typeof source === 'object' && source !== null && 'subagent' in source;
  }

  /**
   * Returns the first user message text in a Codex transcript, used to title
   * app-created sessions from the prompt the user sent from cloudcli.
   *
   * Reads the `event_msg`/`user_message` payload rather than the raw
   * `response_item` user turn so injected `<environment_context>` boilerplate is
   * never mistaken for the user's prompt.
   */
  private async extractFirstUserMessageFromStart(filePath: string): Promise<string | undefined> {
    try {
      const content = await readFile(filePath, 'utf8');
      const lines = content.split(/\r?\n/);

      for (const rawLine of lines) {
        const line = rawLine.trim();
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
        const payload = data.payload as Record<string, unknown> | undefined;
        const payloadType = typeof payload?.type === 'string' ? payload.type : undefined;
        const message = typeof payload?.message === 'string' ? payload.message : undefined;

        if (eventType === 'event_msg' && payloadType === 'user_message' && message?.trim()) {
          return message;
        }
      }
    } catch {
      // Ignore missing/unreadable files so sync can continue.
    }

    return undefined;
  }

  private async extractLastAgentMessageFromEnd(filePath: string): Promise<string | undefined> {
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
        const payload = data.payload as Record<string, unknown> | undefined;
        const payloadType = typeof payload?.type === 'string' ? payload.type : undefined;
        const lastAgentMessage = typeof payload?.last_agent_message === 'string'
          ? payload.last_agent_message
          : undefined;

        if (eventType === 'event_msg' && payloadType === 'task_complete' && lastAgentMessage?.trim()) {
          return lastAgentMessage;
        }
      }
    } catch {
      // Ignore missing/unreadable files so sync can continue.
    }

    return undefined;
  }
}
