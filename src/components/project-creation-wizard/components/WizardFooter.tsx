import { ChevronLeft, Loader2 } from 'lucide-react';

import { Button } from '../../../shared/view/ui';
import type { ProjectCreationMode, WizardStep } from '../types';

type WizardFooterProps = {
  step: WizardStep;
  mode: ProjectCreationMode | null;
  isCreating: boolean;
  isCancelling: boolean;
  cancellationUnavailable: boolean;
  retryLabel: string | null;
  onClose: () => void;
  onBack: () => void;
  onAdvance: () => void;
  onCreate: () => void;
  onCancelClone: () => void;
};

export default function WizardFooter({
  step,
  mode,
  isCreating,
  isCancelling,
  cancellationUnavailable,
  retryLabel,
  onClose,
  onBack,
  onAdvance,
  onCreate,
  onCancelClone,
}: WizardFooterProps) {
  const primaryLabel = step === 1
    ? 'Continue'
    : step === 2
      ? 'Review'
      : retryLabel || (mode === 'clone' ? 'Clone repository' : 'Open project');

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-4 sm:px-6">
      <Button
        type="button"
        variant="outline"
        className="min-h-11"
        onClick={step === 1 ? onClose : onBack}
        disabled={isCreating}
      >
        {step > 1 && <ChevronLeft className="h-4 w-4" aria-hidden="true" />}
        {step === 1 ? 'Cancel' : 'Back'}
      </Button>

      <div className="flex min-w-0 items-center gap-3">
        {step === 1 && !mode && (
          <span id="project-source-help" className="max-w-32 text-right text-xs text-muted-foreground sm:max-w-none sm:text-sm">
            Select one option to continue.
          </span>
        )}
        {isCreating && mode === 'clone' ? (
          cancellationUnavailable ? (
            <span className="flex min-h-11 items-center px-3 text-sm font-medium text-muted-foreground" role="status">
              Finishing…
            </span>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={onCancelClone}
              disabled={isCancelling}
            >
              {isCancelling && <Loader2 className="animate-spin" aria-hidden="true" />}
              {isCancelling ? 'Cancelling…' : 'Cancel clone'}
            </Button>
          )
        ) : (
          <Button
            type="button"
            className="min-h-11"
            onClick={step === 3 ? onCreate : onAdvance}
            disabled={isCreating || (step === 1 && !mode)}
            aria-describedby={step === 1 && !mode ? 'project-source-help' : undefined}
          >
            {isCreating && <Loader2 className="animate-spin" aria-hidden="true" />}
            {isCreating ? 'Opening…' : primaryLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
