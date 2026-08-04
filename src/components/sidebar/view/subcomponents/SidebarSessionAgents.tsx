import { Bot, Check, Loader2 } from 'lucide-react';
import type { TFunction } from 'i18next';

import { buttonVariants } from '../../../../shared/view/ui';
import { cn } from '../../../../lib/utils';
import type { Project, ProjectSession } from '../../../../types/app';
import type { SessionWithProvider, SubagentListItem } from '../../types/types';

type SidebarSessionAgentsProps = {
  project: Project;
  isExpanded: boolean;
  agents: SubagentListItem[] | undefined;
  hasLoaded: boolean;
  selectedSession: ProjectSession | null;
  onSessionSelect: (session: SessionWithProvider, projectId: string) => void;
  t: TFunction;
};

/**
 * Condenses a tool call into one sidebar-width fragment: the part of the input
 * a reader actually recognises (file name, pattern, command).
 */
const formatToolTarget = (toolName: string, toolInput: unknown): string => {
  const input = (typeof toolInput === 'string'
    ? (() => {
      try {
        return JSON.parse(toolInput);
      } catch {
        return {};
      }
    })()
    : toolInput ?? {}) as Record<string, string | undefined>;

  switch (toolName) {
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'ApplyPatch':
      return input.file_path?.split('/').pop() || input.file_path || '';
    case 'Grep':
    case 'Glob':
      return input.pattern || '';
    case 'Bash':
      return input.command ?? '';
    case 'Task':
    case 'Agent':
      return input.description || input.subagent_type || '';
    case 'WebFetch':
    case 'WebSearch':
      return input.url || input.query || '';
    default:
      return '';
  }
};

const formatTokens = (totalTokens: number | null): string | null => {
  if (!totalTokens || totalTokens <= 0) {
    return null;
  }

  return totalTokens >= 1000 ? `${Math.round(totalTokens / 1000)}k` : String(totalTokens);
};

const formatDuration = (totalDurationMs: number | null): string | null => {
  if (!totalDurationMs || totalDurationMs <= 0) {
    return null;
  }

  const totalSeconds = Math.round(totalDurationMs / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  return `${Math.floor(totalSeconds / 60)}m${String(totalSeconds % 60).padStart(2, '0')}s`;
};

function AgentListSkeleton() {
  return (
    <>
      {Array.from({ length: 2 }).map((_, index) => (
        <div key={index} className="flex items-center gap-2 rounded-md p-1.5">
          <div className="h-3 w-3 animate-pulse rounded-full bg-muted" />
          <div className="h-2.5 flex-1 animate-pulse rounded bg-muted" style={{ width: `${55 + index * 20}%` }} />
        </div>
      ))}
    </>
  );
}

export default function SidebarSessionAgents({
  project,
  isExpanded,
  agents,
  hasLoaded,
  selectedSession,
  onSessionSelect,
  t,
}: SidebarSessionAgentsProps) {
  if (!isExpanded) {
    return null;
  }

  if (!hasLoaded && !agents) {
    return (
      <div className="ml-3 space-y-0.5 border-l border-border pl-3">
        <AgentListSkeleton />
      </div>
    );
  }

  if (!agents || agents.length === 0) {
    return (
      <div className="ml-3 border-l border-border pl-3">
        <p className="px-2 py-1.5 text-xs text-muted-foreground">
          {t('agents.noAgents', { defaultValue: 'No agents' })}
        </p>
      </div>
    );
  }

  return (
    <div className="ml-3 space-y-0.5 border-l border-border pl-3">
      {agents.map((agent) => {
        const isSelected = selectedSession?.id === agent.sessionId;
        const isRunning = agent.status === 'running';
        const toolTarget = agent.currentTool
          ? formatToolTarget(agent.currentTool.toolName, agent.currentTool.toolInput)
          : '';
        const tokens = formatTokens(agent.totalTokens);
        const duration = formatDuration(agent.totalDurationMs);

        // The agent transcript is a session row of its own, so selecting it
        // goes through the same handler as any other session.
        const selectAgentSession = () => {
          onSessionSelect(
            {
              id: agent.sessionId,
              summary: agent.name,
              provider: agent.provider,
              __provider: agent.provider,
              parentSessionId: agent.parentSessionId,
              agentType: agent.agentType,
              lastActivity: agent.updatedAt ?? undefined,
            },
            project.projectId,
          );
        };

        return (
          <a
            key={agent.sessionId}
            href={`/session/${agent.sessionId}`}
            className={cn(
              buttonVariants({ variant: 'ghost' }),
              'h-auto w-full justify-start rounded-md p-1.5 text-left font-normal transition-colors',
              isSelected ? 'bg-primary/5 ring-1 ring-inset ring-primary/20' : 'hover:bg-accent/50',
            )}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              selectAgentSession();
            }}
          >
            <div className="flex w-full min-w-0 items-center gap-2">
              {isRunning ? (
                <Loader2 className="h-3 w-3 flex-shrink-0 animate-spin text-purple-500 dark:text-purple-400" />
              ) : agent.status === 'completed' ? (
                <Check className="h-3 w-3 flex-shrink-0 text-green-600 dark:text-green-400" />
              ) : (
                <Bot className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
              )}

              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-foreground">
                  {agent.agentType || t('agents.defaultType', { defaultValue: 'Agent' })}
                </div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {isRunning && agent.currentTool ? (
                    <>
                      <span className="text-foreground/80">{agent.currentTool.toolName}</span>
                      {toolTarget && <span className="font-mono"> {toolTarget}</span>}
                    </>
                  ) : (
                    agent.name
                  )}
                </div>
              </div>

              <div className="flex flex-shrink-0 items-center gap-1 text-[10px] text-muted-foreground/70">
                {agent.toolCount > 0 && <span>{t('agents.toolCount', { count: agent.toolCount, defaultValue: '{{count}} tools' })}</span>}
                {duration && <span>{duration}</span>}
                {tokens && <span>{tokens}</span>}
              </div>
            </div>
          </a>
        );
      })}
    </div>
  );
}
