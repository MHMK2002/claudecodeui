import { Check } from 'lucide-react';

import { cn } from '../../../lib/utils';
import type { WizardStep } from '../types';

type WizardProgressProps = { step: WizardStep };

const steps: Array<{ step: WizardStep; label: string }> = [
  { step: 1, label: 'Choose source' },
  { step: 2, label: 'Configure' },
  { step: 3, label: 'Review' },
];

export default function WizardProgress({ step }: WizardProgressProps) {
  return (
    <nav className="border-b border-border px-4 py-3 sm:px-6" aria-label="Project creation progress">
      <ol className="flex items-center">
        {steps.map((item, index) => {
          const complete = item.step < step;
          const current = item.step === step;
          return (
            <li key={item.step} className={cn('flex items-center', index < steps.length - 1 && 'flex-1')}>
              <div className="flex items-center gap-2" aria-current={current ? 'step' : undefined}>
                <span
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-medium',
                    complete && 'border-primary bg-primary text-primary-foreground',
                    current && 'border-primary bg-primary text-primary-foreground',
                    !complete && !current && 'border-border bg-muted text-muted-foreground',
                  )}
                >
                  {complete ? <Check className="h-4 w-4" aria-hidden="true" /> : item.step}
                </span>
                <span className="hidden text-sm font-medium text-foreground sm:inline">{item.label}</span>
                <span className="sr-only">{complete ? 'Complete' : current ? 'Current' : 'Upcoming'}</span>
              </div>
              {index < steps.length - 1 && (
                <span className={cn('mx-2 h-px flex-1', complete ? 'bg-primary' : 'bg-border')} aria-hidden="true" />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
