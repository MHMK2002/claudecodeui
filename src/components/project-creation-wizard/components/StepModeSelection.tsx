import { FolderOpen, GitFork } from 'lucide-react';

import { cn } from '../../../lib/utils';
import type { ProjectCreationMode } from '../types';

type StepModeSelectionProps = {
  mode: ProjectCreationMode | null;
  onModeChange: (mode: ProjectCreationMode) => void;
};

const choices: Array<{
  mode: ProjectCreationMode;
  title: string;
  description: string;
  icon: typeof FolderOpen;
}> = [
  {
    mode: 'local',
    title: 'Open existing folder',
    description: 'Register a folder that already exists on this computer.',
    icon: FolderOpen,
  },
  {
    mode: 'clone',
    title: 'Clone repository',
    description: 'Download a Git repository into a destination you choose.',
    icon: GitFork,
  },
];

export default function StepModeSelection({ mode, onModeChange }: StepModeSelectionProps) {
  return (
    <fieldset className="space-y-3">
      <legend className="mb-3 text-sm font-medium text-foreground">
        How do you want to open this project?
      </legend>
      {choices.map((choice) => {
        const Icon = choice.icon;
        const selected = mode === choice.mode;
        const inputId = `project-source-${choice.mode}`;
        const descriptionId = `${inputId}-description`;
        return (
          <label
            key={choice.mode}
            htmlFor={inputId}
            className="block cursor-pointer"
          >
            <input
              id={inputId}
              type="radio"
              name="project-source"
              value={choice.mode}
              checked={selected}
              aria-describedby={descriptionId}
              onChange={() => onModeChange(choice.mode)}
              className="peer sr-only"
            />
            <span
              className={cn(
                'flex min-h-16 w-full items-start gap-3 rounded-lg border p-4 text-left transition-colors',
                'peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2',
                selected
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border bg-background hover:bg-accent',
              )}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <span>
                <span className="block font-medium">{choice.title}</span>
                <span id={descriptionId} className="mt-1 block text-sm text-muted-foreground">
                  {choice.description}
                </span>
              </span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
