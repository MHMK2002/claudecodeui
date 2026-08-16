import { RotateCcw, X } from 'lucide-react';

type ShellHeaderProps = {
  isConnected: boolean;
  isInitialized: boolean;
  isRestarting: boolean;
  projectName: string;
  onDisconnect: () => void;
  onRestart: () => void;
  connectedText: string;
  disconnectedText: string;
  initializingText: string;
  restartingText: string;
  disconnectLabel: string;
  disconnectTitle: string;
  restartLabel: string;
  restartTitle: string;
  disableRestart: boolean;
};

export default function ShellHeader({
  isConnected,
  isInitialized,
  isRestarting,
  projectName,
  onDisconnect,
  onRestart,
  connectedText,
  disconnectedText,
  initializingText,
  restartingText,
  disconnectLabel,
  disconnectTitle,
  restartLabel,
  restartTitle,
  disableRestart,
}: ShellHeaderProps) {
  const stateText = isRestarting
    ? restartingText
    : !isInitialized
      ? initializingText
      : isConnected
        ? connectedText
        : disconnectedText;

  return (
    <div className="flex-shrink-0 border-b border-border bg-background px-4 py-2">
      <div className="flex min-h-11 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-xs text-foreground">
          <span
            className={`h-2.5 w-2.5 flex-none rounded-full ${isConnected ? 'bg-primary' : 'bg-muted-foreground'}`}
            aria-hidden="true"
          />
          <span className="font-medium">{stateText}</span>
          <span aria-hidden="true">·</span>
          <span className="truncate text-muted-foreground" title={projectName}>{projectName}</span>
        </div>

        <div className="flex flex-none items-center gap-2">
          {isConnected && (
            <button
              type="button"
              onClick={onDisconnect}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title={disconnectTitle}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{disconnectLabel}</span>
            </button>
          )}

          <button
            type="button"
            onClick={onRestart}
            disabled={disableRestart}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:text-muted-foreground"
            title={restartTitle}
          >
            <RotateCcw className={`h-3.5 w-3.5 ${isRestarting ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>{restartLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
