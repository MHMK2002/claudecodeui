import { ChevronRight, Trash2 } from 'lucide-react';

import type { FileStatusCode } from '../../types/types';
import { getStatusBadgeClass, getStatusLabel } from '../../utils/gitPanelUtils';
import GitDiffViewer from '../shared/GitDiffViewer';

type FileChangeItemProps = {
  filePath: string;
  status: FileStatusCode;
  isMobile: boolean;
  isExpanded: boolean;
  isSelected: boolean;
  diff?: string;
  wrapText: boolean;
  onToggleSelected: (filePath: string) => void;
  onToggleExpanded: (filePath: string) => void;
  onOpenFile: (filePath: string) => void;
  onToggleWrapText: () => void;
  onRequestFileAction: (filePath: string, status: FileStatusCode) => void;
};

export default function FileChangeItem({
  filePath,
  status,
  isMobile,
  isExpanded,
  isSelected,
  diff,
  wrapText,
  onToggleSelected,
  onToggleExpanded,
  onOpenFile,
  onToggleWrapText,
  onRequestFileAction,
}: FileChangeItemProps) {
  const statusLabel = getStatusLabel(status);
  const badgeClass = getStatusBadgeClass(status);

  return (
    <div className="border-b border-border last:border-0">
      <div className={`flex min-h-14 items-center transition-colors hover:bg-accent/50 ${isMobile ? 'px-1' : 'px-2'}`}>
        <label
          className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg focus-within:ring-2 focus-within:ring-ring hover:bg-accent"
          title={`${isSelected ? 'Unstage' : 'Stage'} ${filePath}`}
        >
          <input
            type="checkbox"
            checked={isSelected}
            aria-label={`${isSelected ? 'Unstage' : 'Stage'} ${filePath}`}
            onChange={() => onToggleSelected(filePath)}
            onClick={(event) => event.stopPropagation()}
            className="h-4 w-4 rounded border-border bg-background text-primary checked:bg-primary focus:ring-primary/40"
          />
        </label>

        <div className="flex min-w-0 flex-1 items-center gap-1">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggleExpanded(filePath);
            }}
            className="flex min-h-11 shrink-0 cursor-pointer items-center gap-1 rounded-lg px-2 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title={isExpanded ? 'Collapse diff' : 'Expand diff'}
            aria-label={`${isExpanded ? 'Hide' : 'Review'} changes for ${filePath}`}
            aria-expanded={isExpanded}
          >
            <ChevronRight className={`h-4 w-4 transition-transform duration-200 ease-in-out ${isExpanded ? 'rotate-90' : 'rotate-0'}`} />
            {!isMobile && (
              <span className="text-xs font-medium">{isExpanded ? 'Hide' : 'Review'}</span>
            )}
          </button>

          <button
            type="button"
            className={`min-h-11 min-w-0 flex-1 cursor-pointer truncate rounded-lg px-2 text-left ${isMobile ? 'text-xs' : 'text-sm'} hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
            onClick={(event) => {
              event.stopPropagation();
              onOpenFile(filePath);
            }}
            title={`Open ${filePath}`}
          >
            {filePath}
          </button>

          <span className="flex items-center gap-1">
            {(status === 'M' || status === 'D' || status === 'U') && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onRequestFileAction(filePath, status);
                }}
                className={`${isMobile ? 'px-2 text-xs' : 'w-11'} flex min-h-11 items-center justify-center gap-1 rounded-lg font-medium text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
                title={status === 'U' ? 'Delete untracked file' : 'Discard changes'}
                aria-label={`${status === 'U' ? 'Delete' : 'Discard changes to'} ${filePath}`}
              >
                <Trash2 className="h-3 w-3" />
                {isMobile && <span>{status === 'U' ? 'Delete' : 'Discard'}</span>}
              </button>
            )}

            <span
              className={`inline-flex h-5 w-5 items-center justify-center rounded border text-[10px] font-bold ${badgeClass}`}
              title={statusLabel}
              aria-label={statusLabel}
            >
              {status}
            </span>
          </span>
        </div>
      </div>

      <div
        className={`duration-400 overflow-hidden bg-muted/50 transition-all ease-in-out ${isExpanded && diff ? 'max-h-[600px] translate-y-0 opacity-100' : 'max-h-0 -translate-y-1 opacity-0'
          }`}
      >
        <div className="flex items-center justify-between border-b border-border p-2">
          <span className="flex items-center gap-2">
            <span className={`inline-flex h-5 w-5 items-center justify-center rounded border text-[10px] font-bold ${badgeClass}`}>
              {status}
            </span>
            <span className="text-sm font-medium text-foreground">{statusLabel}</span>
          </span>
          {isMobile && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onToggleWrapText();
              }}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              title={wrapText ? 'Switch to horizontal scroll' : 'Switch to text wrap'}
            >
              {wrapText ? 'Scroll' : 'Wrap'}
            </button>
          )}
        </div>

        <div className="max-h-96 overflow-y-auto">
          {diff && <GitDiffViewer diff={diff} isMobile={isMobile} wrapText={wrapText} />}
        </div>
      </div>
    </div>
  );
}
