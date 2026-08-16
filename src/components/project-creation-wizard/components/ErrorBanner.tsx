import { AlertCircle } from 'lucide-react';

import { Button } from '../../../shared/view/ui';
import { getRecoveryActionLabel } from '../utils/projectCreationWorkflow';
import type { ProjectCreationErrorPresentation } from '../types';

type ErrorBannerProps = {
  error: ProjectCreationErrorPresentation;
  showAction: boolean;
  onAction: () => void;
};

export default function ErrorBanner({ error, showAction, onAction }: ErrorBannerProps) {
  return (
    <div
      className="flex flex-wrap items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4"
      role="alert"
      aria-live="assertive"
    >
      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-destructive">{error.message}</p>
        <p className="mt-1 text-xs text-muted-foreground">Error code: {error.code}</p>
      </div>
      {showAction && (
        <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={onAction}>
          {getRecoveryActionLabel(error.action)}
        </Button>
      )}
    </div>
  );
}
