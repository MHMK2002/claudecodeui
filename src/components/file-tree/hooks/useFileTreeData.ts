import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '../../../utils/api';
import type { Project } from '../../../types/app';
import type { FileTreeNode } from '../types/types';

export type FileTreeLoadErrorKind = 'permission' | 'server';
export type FileTreeDataStatus = 'idle' | 'loading' | 'ready' | 'permission-error' | 'server-error';

export class FileTreeLoadError extends Error {
  readonly kind: FileTreeLoadErrorKind;
  readonly status: number;

  constructor(kind: FileTreeLoadErrorKind, status: number, message: string) {
    super(message);
    this.name = 'FileTreeLoadError';
    this.kind = kind;
    this.status = status;
  }
}

type GetFilesRequest = (
  projectId: string,
  options: { signal?: AbortSignal },
) => Promise<Response>;

async function readErrorMessage(response: Response): Promise<string> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      const payload = await response.json() as { error?: string; message?: string };
      return payload.error || payload.message || '';
    } catch {
      return '';
    }
  }
  return '';
}

export async function fetchFileTreeData(
  projectId: string,
  signal?: AbortSignal,
  getFiles: GetFilesRequest = api.getFiles,
): Promise<FileTreeNode[]> {
  const response = await getFiles(projectId, { signal });
  if (!response.ok) {
    const kind: FileTreeLoadErrorKind = response.status === 401 || response.status === 403
      ? 'permission'
      : 'server';
    const fallback = kind === 'permission'
      ? 'CloudCLI cannot read this project folder. Check its permissions and try again.'
      : 'Files could not be loaded from the local server. Try again.';
    throw new FileTreeLoadError(kind, response.status, await readErrorMessage(response) || fallback);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new FileTreeLoadError('server', response.status, 'The file server returned an invalid response.');
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new FileTreeLoadError('server', response.status, 'The file server returned invalid JSON.');
  }
  if (!Array.isArray(data)) {
    throw new FileTreeLoadError('server', response.status, 'The file server returned an invalid file list.');
  }
  return data as FileTreeNode[];
}

type UseFileTreeDataResult = {
  files: FileTreeNode[];
  status: FileTreeDataStatus;
  error: FileTreeLoadError | null;
  loading: boolean;
  refreshFiles: () => void;
};

export function useFileTreeData(selectedProject: Project | null): UseFileTreeDataResult {
  const [files, setFiles] = useState<FileTreeNode[]>([]);
  const [status, setStatus] = useState<FileTreeDataStatus>('idle');
  const [error, setError] = useState<FileTreeLoadError | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const refreshFiles = useCallback(() => setRefreshKey((previous) => previous + 1), []);

  useEffect(() => {
    const projectId = selectedProject?.projectId;
    if (!projectId) {
      setFiles([]);
      setError(null);
      setStatus('idle');
      return;
    }

    abortControllerRef.current?.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    let active = true;

    const fetchFiles = async () => {
      setStatus('loading');
      setError(null);
      try {
        const nextFiles = await fetchFileTreeData(projectId, abortController.signal);
        if (!active) return;
        setFiles(nextFiles);
        setStatus('ready');
      } catch (caughtError) {
        if (!active || (caughtError as { name?: string }).name === 'AbortError') return;
        const loadError = caughtError instanceof FileTreeLoadError
          ? caughtError
          : new FileTreeLoadError('server', 0, 'Files could not be loaded. Try again.');
        setError(loadError);
        setStatus(loadError.kind === 'permission' ? 'permission-error' : 'server-error');
      }
    };
    void fetchFiles();

    return () => {
      active = false;
      abortController.abort();
    };
  }, [selectedProject?.projectId, refreshKey]);

  return { files, status, error, loading: status === 'loading', refreshFiles };
}
