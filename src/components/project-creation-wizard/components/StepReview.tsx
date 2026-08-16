import { Loader2 } from 'lucide-react';

import type { CloneProgress, ProjectCreationMode, TokenMode } from '../types';

type StepReviewProps = {
  mode: ProjectCreationMode;
  folderPath: string;
  repositoryUrl: string;
  destinationPath: string;
  credentialRequired: boolean;
  tokenMode: TokenMode;
  selectedTokenName: string | null;
  isCreating: boolean;
  attemptId: string | null;
  cloneProgress: CloneProgress | null;
};

export default function StepReview({
  mode,
  folderPath,
  repositoryUrl,
  destinationPath,
  credentialRequired,
  tokenMode,
  selectedTokenName,
  isCreating,
  attemptId,
  cloneProgress,
}: StepReviewProps) {
  const operationLabel = mode === 'local' ? 'Open existing folder' : 'Clone repository';
  const destination = mode === 'local' ? folderPath : destinationPath;
  const credentialLabel = tokenMode === 'stored'
    ? selectedTokenName || 'Stored credential'
    : tokenMode === 'new'
      ? 'Credential entered for this attempt'
      : 'No credential';

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border bg-muted/40 p-4" aria-labelledby="project-review-title">
        <h4 id="project-review-title" className="mb-3 font-medium text-foreground">Review operation</h4>
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-muted-foreground">Operation</dt>
            <dd className="mt-1 font-medium text-foreground">{operationLabel}</dd>
          </div>
          {mode === 'clone' && (
            <div>
              <dt className="text-muted-foreground">Repository URL</dt>
              <dd className="mt-1 break-all font-mono text-xs text-foreground">{repositoryUrl}</dd>
            </div>
          )}
          <div>
            <dt className="text-muted-foreground">Exact destination</dt>
            <dd className="mt-1 break-all font-mono text-xs text-foreground">{destination}</dd>
          </div>
          {mode === 'clone' && credentialRequired && (
            <div>
              <dt className="text-muted-foreground">Authentication</dt>
              <dd className="mt-1 text-foreground">{credentialLabel}</dd>
            </div>
          )}
        </dl>
      </section>

      {mode === 'local' ? (
        <p className="rounded-lg border border-border bg-background p-4 text-sm text-muted-foreground">
          The existing folder will be registered without creating or changing its files.
        </p>
      ) : isCreating ? (
        <section className="rounded-lg border border-primary/30 bg-primary/10 p-4" role="status" aria-live="polite">
          <div className="flex items-start gap-3">
            <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-primary" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-foreground">{cloneProgress?.message || 'Starting clone…'}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {cloneProgress?.phase || 'preparing'}{attemptId ? ` · attempt ${attemptId}` : ''}
              </p>
              <progress
                className="mt-3 h-2 w-full"
                max={100}
                value={cloneProgress?.percent ?? undefined}
                aria-label="Clone progress"
              />
            </div>
          </div>
        </section>
      ) : (
        <p className="rounded-lg border border-border bg-background p-4 text-sm text-muted-foreground">
          Git will clone into an attempt-owned staging folder and move it into the exact destination only after success.
        </p>
      )}
    </div>
  );
}
