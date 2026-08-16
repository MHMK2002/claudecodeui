import { useCallback, useRef, useState } from 'react';
import type { DragEvent } from 'react';

import { IS_PLATFORM } from '../../../constants/config';
import type { Project } from '../../../types/app';
import {
  AUTH_LOCAL_SESSION_UNAVAILABLE_EVENT,
  expireAuthSession,
  getStoredAuthToken,
  renewDesktopLocalSession,
  storeAuthToken,
} from '../../../utils/api';
import {
  MAX_FILE_UPLOAD_COUNT,
  MAX_FILE_UPLOAD_SIZE_BYTES,
  MAX_FILE_UPLOAD_SIZE_LABEL,
} from '../constants/constants';

type UseFileTreeUploadOptions = {
  selectedProject: Project | null;
  onRefresh: () => void;
  showToast: (message: string, type: 'success' | 'error') => void;
};

export type FileTreeUploadProgressState = {
  status: 'uploading' | 'complete' | 'partial' | 'error';
  progress: number;
  fileCount: number;
  uploadedCount?: number;
  fileName?: string;
  targetPath?: string;
  error?: string;
};

type UploadedFileResult = {
  name: string;
  path: string;
  size: number;
  mimeType: string;
};

type UploadFailureResult = {
  name: string;
  code: string;
  message: string;
};

type UploadResponse = {
  files: UploadedFileResult[];
  failures: UploadFailureResult[];
  uploadedCount: number;
  requestedFileCount: number;
  status: UploadTerminalStatus;
};

const pluralizeFiles = (count: number) => (count === 1 ? 'file' : 'files');

export type UploadTerminalStatus = 'complete' | 'partial';

export const resolveUploadTerminalStatus = (
  uploadedCount: number,
  requestedFileCount: number,
): UploadTerminalStatus => uploadedCount === requestedFileCount ? 'complete' : 'partial';

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null
);

const isUploadedFileResult = (value: unknown): value is UploadedFileResult => {
  if (!isRecord(value)) return false;
  return typeof value.name === 'string'
    && typeof value.path === 'string'
    && typeof value.size === 'number'
    && Number.isFinite(value.size)
    && value.size >= 0
    && typeof value.mimeType === 'string';
};

const isUploadFailureResult = (value: unknown): value is UploadFailureResult => {
  if (!isRecord(value)) return false;
  return typeof value.name === 'string'
    && typeof value.code === 'string'
    && typeof value.message === 'string';
};

export const parseUploadSuccessResponse = (
  responseText: string,
  expectedFileCount: number,
): UploadResponse => {
  let parsed: unknown;
  try {
    parsed = responseText ? JSON.parse(responseText) as unknown : null;
  } catch {
    parsed = null;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('The server did not return a valid upload result. Retry the upload.');
  }

  const payload = parsed as Record<string, unknown>;
  const uploadedCount = payload.uploadedCount;
  const requestedFileCount = payload.requestedFileCount;
  const files = payload.files;
  const failures = payload.failures;
  const expectedStatus = typeof uploadedCount === 'number' && typeof requestedFileCount === 'number'
    ? resolveUploadTerminalStatus(uploadedCount, requestedFileCount)
    : null;
  if (
    typeof uploadedCount !== 'number'
    || typeof requestedFileCount !== 'number'
    || !Number.isInteger(uploadedCount)
    || !Number.isInteger(requestedFileCount)
    || requestedFileCount !== expectedFileCount
    || uploadedCount < 0
    || uploadedCount > requestedFileCount
    || !Array.isArray(files)
    || files.length !== uploadedCount
    || !files.every(isUploadedFileResult)
    || !Array.isArray(failures)
    || failures.length !== requestedFileCount - uploadedCount
    || !failures.every(isUploadFailureResult)
    || payload.status !== expectedStatus
  ) {
    throw new Error('The server did not return a valid upload result. Retry the upload.');
  }

  return {
    uploadedCount,
    requestedFileCount,
    files,
    failures,
    status: payload.status as UploadTerminalStatus,
  };
};

/** Prevents multiple upload requests from publishing state into one progress surface. */
export const createUploadAttemptGuard = () => {
  let active = false;
  return {
    tryBegin(): boolean {
      if (active) return false;
      active = true;
      return true;
    },
    end(): void {
      active = false;
    },
    isActive(): boolean {
      return active;
    },
  };
};

const getRelativePath = (file: File) => {
  const fileWithRelativePath = file as File & { webkitRelativePath?: string };
  return fileWithRelativePath.webkitRelativePath || file.name;
};

const normalizeUploadDestinationName = (name: string): string => (
  name
    .replace(/\\/g, '/')
    .replace(/^(\.\/)+/, '')
    .normalize('NFC')
    .toLocaleLowerCase('en-US')
);

const countNames = (names: string[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return counts;
};

const haveEqualNameCounts = (left: Map<string, number>, right: Map<string, number>): boolean => {
  if (left.size !== right.size) return false;
  for (const [name, count] of left) {
    if (right.get(name) !== count) return false;
  }
  return true;
};

/** Validates an upload result against its files and returns only failed files for Retry. */
export const selectFilesForUploadRetry = (
  attemptedFiles: File[],
  uploadedNames: string[],
  failedNames: string[],
): File[] => {
  const attemptedNames = attemptedFiles.map((file) => (
    normalizeUploadDestinationName(getRelativePath(file))
  ));
  if ([...countNames(attemptedNames).values()].some((count) => count > 1)) {
    throw new Error('The server did not return a valid upload result. Retry the upload.');
  }
  if (!haveEqualNameCounts(
    countNames(attemptedNames),
    countNames([...uploadedNames, ...failedNames].map(normalizeUploadDestinationName)),
  )) {
    throw new Error('The server did not return a valid upload result. Retry the upload.');
  }

  const remainingFailures = countNames(failedNames.map(normalizeUploadDestinationName));
  return attemptedFiles.filter((file) => {
    const relativePath = normalizeUploadDestinationName(getRelativePath(file));
    const remaining = remainingFailures.get(relativePath) ?? 0;
    if (remaining === 0) return false;
    if (remaining === 1) remainingFailures.delete(relativePath);
    else remainingFailures.set(relativePath, remaining - 1);
    return true;
  });
};

const getFileDisplayName = (file: File) => {
  const relativePath = getRelativePath(file);
  return relativePath.split(/[\\/]/).pop() || file.name;
};

const normalizeUploadDestination = (file: File): string => (
  normalizeUploadDestinationName(getRelativePath(file))
);

/** Validates one user-selected upload batch before any request is sent. */
export const validateFilesForUpload = (files: File[]): string | null => {
  if (files.length > MAX_FILE_UPLOAD_COUNT) {
    return `You can upload up to ${MAX_FILE_UPLOAD_COUNT} files at once.`;
  }

  const oversizedFile = files.find((file) => file.size > MAX_FILE_UPLOAD_SIZE_BYTES);
  if (oversizedFile) {
    return `${getFileDisplayName(oversizedFile)} is larger than ${MAX_FILE_UPLOAD_SIZE_LABEL}.`;
  }

  const destinations = new Set<string>();
  for (const file of files) {
    const destination = normalizeUploadDestination(file);
    if (destinations.has(destination)) {
      return 'Two selected files resolve to the same destination. Rename one file and try again.';
    }
    destinations.add(destination);
  }

  return null;
};

const parseErrorResponse = (responseText: string): { error?: string; message?: string } => {
  try {
    const parsed = JSON.parse(responseText) as unknown;
    return typeof parsed === 'object' && parsed !== null
      ? parsed as { error?: string; message?: string }
      : {};
  } catch {
    return {};
  }
};

const formatUploadSuccessMessage = (uploadedCount: number) => {
  return `Uploaded ${uploadedCount} ${pluralizeFiles(uploadedCount)} successfully`;
};

const formatUploadPartialMessage = (uploadedCount: number, requestedFileCount: number) =>
  `Upload incomplete: ${uploadedCount} of ${requestedFileCount} ${pluralizeFiles(requestedFileCount)} uploaded. Retry the upload.`;

const buildUploadFormData = (files: File[], targetPath: string) => {
  const formData = new FormData();
  const relativePaths: string[] = [];

  formData.append('targetPath', targetPath);
  formData.append('requestedFileCount', String(files.length));

  files.forEach((file) => {
    const relativePath = getRelativePath(file);
    const cleanFile = new File([file], relativePath.split(/[\\/]/).pop() || file.name, {
      type: file.type,
      lastModified: file.lastModified,
    });

    formData.append('files', cleanFile);
    relativePaths.push(relativePath);
  });

  formData.append('relativePaths', JSON.stringify(relativePaths));

  return formData;
};

const uploadFormDataWithProgress = (
  projectId: string,
  formData: FormData,
  expectedFileCount: number,
  onProgress: (progress: number) => void,
) =>
  new Promise<UploadResponse>((resolve, reject) => {
    const sendAttempt = (retriedLocalSession = false) => {
      const xhr = new XMLHttpRequest();

      xhr.open('POST', `/api/file-tree/projects/${encodeURIComponent(projectId)}/files/upload`);
      xhr.withCredentials = true;

      const token = getStoredAuthToken();
      if (!IS_PLATFORM && token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) {
          return;
        }

        // Keep 100% for the server response so the UI can distinguish transfer
        // completion from the final write/refresh step.
        onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
      };

      xhr.onload = async () => {
        const refreshedToken = xhr.getResponseHeader('X-Refreshed-Token');
        if (refreshedToken) {
          storeAuthToken(refreshedToken);
        }
        if (xhr.getResponseHeader('X-Auth-Error')) {
          const runtimeMode = xhr.getResponseHeader('X-CloudCLI-Runtime-Mode');
          if (runtimeMode === 'desktop-local') {
            if (!retriedLocalSession) {
              const renewed = await renewDesktopLocalSession();
              if (renewed === true) {
                sendAttempt(true);
                return;
              }
            }
            window.dispatchEvent(new Event(AUTH_LOCAL_SESSION_UNAVAILABLE_EVENT));
          } else {
            expireAuthSession();
          }
        }

        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(parseUploadSuccessResponse(xhr.responseText, expectedFileCount));
          } catch (error) {
            reject(error);
          }
          return;
        }

        const payload = parseErrorResponse(xhr.responseText);
        reject(new Error(payload.error || payload.message || `Upload failed with status ${xhr.status}`));
      };

      xhr.onerror = () => reject(new Error('Upload failed. Check your connection and try again.'));
      xhr.onabort = () => reject(new Error('Upload canceled.'));

      xhr.send(formData);
    };

    sendAttempt();
  });

// Helper function to read all files from a directory entry recursively
const readAllDirectoryEntries = async (directoryEntry: FileSystemDirectoryEntry, basePath = ''): Promise<File[]> => {
  const files: File[] = [];

  const reader = directoryEntry.createReader();
  let entries: FileSystemEntry[] = [];

  // Read all entries from the directory (may need multiple reads)
  let batch: FileSystemEntry[];
  do {
    batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    entries = entries.concat(batch);
  } while (batch.length > 0);

  // Files to ignore (system files)
  const ignoredFiles = ['.DS_Store', 'Thumbs.db', 'desktop.ini'];

  for (const entry of entries) {
    const entryPath = basePath ? `${basePath}/${entry.name}` : entry.name;

    if (entry.isFile) {
      const fileEntry = entry as FileSystemFileEntry;
      const file = await new Promise<File>((resolve, reject) => {
        fileEntry.file(resolve, reject);
      });

      // Skip ignored files
      if (ignoredFiles.includes(file.name)) {
        continue;
      }

      // Create a new file with the relative path as the name
      const fileWithPath = new File([file], entryPath, {
        type: file.type,
        lastModified: file.lastModified,
      });
      files.push(fileWithPath);
    } else if (entry.isDirectory) {
      const dirEntry = entry as FileSystemDirectoryEntry;
      const subFiles = await readAllDirectoryEntries(dirEntry, entryPath);
      files.push(...subFiles);
    }
  }

  return files;
};

const collectDroppedFiles = async (dataTransfer: DataTransfer) => {
  const files: File[] = [];

  // Use DataTransferItemList for folder support
  const { items } = dataTransfer;
  if (items) {
    for (const item of Array.from(items)) {
      if (item.kind !== 'file') {
        continue;
      }

      const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
      if (!entry) {
        const file = item.getAsFile();
        if (file) {
          files.push(file);
        }
        continue;
      }

      if (entry.isFile) {
        const file = await new Promise<File>((resolve, reject) => {
          (entry as FileSystemFileEntry).file(resolve, reject);
        });
        files.push(file);
      } else if (entry.isDirectory) {
        // Pass the directory name as basePath so files include the folder path
        const dirFiles = await readAllDirectoryEntries(entry as FileSystemDirectoryEntry, entry.name);
        files.push(...dirFiles);
      }
    }
    return files;
  }

  // Fallback for browsers that don't support webkitGetAsEntry
  for (const file of Array.from(dataTransfer.files)) {
    files.push(file);
  }

  return files;
};

export const useFileTreeUpload = ({
  selectedProject,
  onRefresh,
  showToast,
}: UseFileTreeUploadOptions) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [operationLoading, setOperationLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<FileTreeUploadProgressState | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const lastUploadAttemptRef = useRef<{ files: File[]; targetPath: string } | null>(null);
  const uploadAttemptGuardRef = useRef(createUploadAttemptGuard());

  const setUploadError = useCallback(
    (message: string, fileCount: number, targetPath = '', fileName?: string, progress = 0) => {
      setUploadProgress({
        status: 'error',
        progress,
        fileCount,
        fileName,
        targetPath,
        error: message,
      });
    },
    [],
  );

  const uploadFiles = useCallback(
    async (files: File[], targetPath = '') => {
      if (files.length === 0) {
        setDropTarget(null);
        return;
      }

      const fileName = files.length === 1 ? getFileDisplayName(files[0]) : undefined;

      if (!selectedProject) {
        lastUploadAttemptRef.current = null;
        const message = 'Select a project before uploading files.';
        showToast(message, 'error');
        setUploadError(message, files.length, targetPath, fileName);
        return;
      }

      const validationError = validateFilesForUpload(files);
      if (validationError) {
        lastUploadAttemptRef.current = null;
        showToast(validationError, 'error');
        setUploadError(validationError, files.length, targetPath, fileName);
        return;
      }

      if (!uploadAttemptGuardRef.current.tryBegin()) {
        showToast('An upload is already in progress.', 'error');
        setDropTarget(null);
        return;
      }

      setOperationLoading(true);
      lastUploadAttemptRef.current = { files, targetPath };
      setUploadProgress({
        status: 'uploading',
        progress: 0,
        fileCount: files.length,
        fileName,
        targetPath,
      });

      let latestProgress = 0;

      try {
        const response = await uploadFormDataWithProgress(
          selectedProject.projectId,
          buildUploadFormData(files, targetPath),
          files.length,
          (progress) => {
            latestProgress = progress;
            setUploadProgress((current) =>
              current && current.status === 'uploading'
                ? { ...current, progress }
                : current,
            );
          },
        );

        const uploadedCount = response.uploadedCount;
        const requestedFileCount = response.requestedFileCount;
        const retryFiles = selectFilesForUploadRetry(
          files,
          response.files.map((file) => file.name),
          response.failures.map((failure) => failure.name),
        );
        const terminalStatus = resolveUploadTerminalStatus(uploadedCount, requestedFileCount);
        const resultProgress = requestedFileCount > 0
          ? Math.round((uploadedCount / requestedFileCount) * 100)
          : 0;

        setUploadProgress({
          status: terminalStatus,
          progress: terminalStatus === 'complete' ? 100 : resultProgress,
          fileCount: requestedFileCount,
          uploadedCount,
          fileName,
          targetPath,
        });

        if (terminalStatus === 'complete') {
          lastUploadAttemptRef.current = null;
          showToast(formatUploadSuccessMessage(uploadedCount), 'success');
        } else {
          lastUploadAttemptRef.current = { files: retryFiles, targetPath };
          showToast(formatUploadPartialMessage(uploadedCount, requestedFileCount), 'error');
        }
        onRefresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Upload failed';
        console.error('Upload error:', err);
        showToast(message, 'error');
        setUploadError(message, files.length, targetPath, fileName, latestProgress);
      } finally {
        uploadAttemptGuardRef.current.end();
        setOperationLoading(false);
        setDropTarget(null);
      }
    },
    [
      onRefresh,
      selectedProject,
      setUploadError,
      showToast,
    ],
  );

  const handleFileSelect = useCallback(
    async (fileList: FileList | File[]) => {
      await uploadFiles(Array.from(fileList), '');
    },
    [uploadFiles],
  );

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (uploadAttemptGuardRef.current.isActive()) {
      setIsDragOver(false);
      setDropTarget(null);
      return;
    }
    setIsDragOver(true);
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set isDragOver to false if we're leaving the entire tree
    if (treeRef.current && !treeRef.current.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
      setDropTarget(null);
    }
  }, []);

  const handleDrop = useCallback(
    async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      if (uploadAttemptGuardRef.current.isActive()) {
        showToast('An upload is already in progress.', 'error');
        setDropTarget(null);
        return;
      }

      const targetPath = dropTarget || '';

      try {
        const files = await collectDroppedFiles(e.dataTransfer);
        await uploadFiles(files, targetPath);
      } catch (err) {
        lastUploadAttemptRef.current = null;
        const message = err instanceof Error ? err.message : 'Could not read dropped files';
        console.error('Upload error:', err);
        showToast(message, 'error');
        setUploadError(message, 0, targetPath);
        setDropTarget(null);
      }
    },
    [dropTarget, setUploadError, showToast, uploadFiles],
  );

  const handleItemDragOver = useCallback((e: DragEvent, itemPath: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(itemPath);
  }, []);

  const handleItemDrop = useCallback((e: DragEvent, itemPath: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(itemPath);
  }, []);

  const retryUpload = useCallback(async () => {
    const lastUploadAttempt = lastUploadAttemptRef.current;
    if (!lastUploadAttempt || operationLoading) {
      return;
    }

    await uploadFiles(lastUploadAttempt.files, lastUploadAttempt.targetPath);
  }, [operationLoading, uploadFiles]);

  const clearUploadProgress = useCallback(() => {
    lastUploadAttemptRef.current = null;
    setUploadProgress(null);
  }, []);

  return {
    isDragOver,
    dropTarget,
    operationLoading,
    uploadProgress,
    clearUploadProgress,
    retryUpload,
    canRetryUpload: Boolean(lastUploadAttemptRef.current) && !operationLoading,
    treeRef,
    handleFileSelect,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleItemDragOver,
    handleItemDrop,
    setDropTarget,
  };
};
