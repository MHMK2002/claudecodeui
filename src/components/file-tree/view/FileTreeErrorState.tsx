import { AlertTriangle, LockKeyhole } from 'lucide-react';

import { Button } from '../../../shared/view/ui';
import type { FileTreeDataStatus } from '../hooks/useFileTreeData';

type FileTreeErrorStateProps = {
  status: Extract<FileTreeDataStatus, 'permission-error' | 'server-error'>;
  message: string;
  onRetry: () => void;
};

export default function FileTreeErrorState({ status, message, onRetry }: FileTreeErrorStateProps) {
  const isPermission = status === 'permission-error';
  const Icon = isPermission ? LockKeyhole : AlertTriangle;
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center px-4 py-10 text-center" role="alert">
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </span>
      <h4 className="font-medium text-foreground">
        {isPermission ? 'Folder permission required' : 'Files unavailable'}
      </h4>
      <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      <Button type="button" className="mt-4 min-h-11" onClick={onRetry}>Retry</Button>
    </div>
  );
}
