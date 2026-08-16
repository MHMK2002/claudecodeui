import { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff, FolderOpen, Loader2, Plus, X } from 'lucide-react';

import { Button, Dialog, DialogContent, DialogTitle, Input } from '../../../shared/view/ui';
import { browseFilesystemFolders, createFolderInFilesystem } from '../data/workspaceApi';
import { getParentPath, joinFolderPath } from '../utils/pathUtils';
import type { FolderSuggestion } from '../types';

type FolderBrowserModalProps = {
  isOpen: boolean;
  allowCreateFolder?: boolean;
  onClose: () => void;
  onFolderSelected: (folderPath: string) => void;
};

export default function FolderBrowserModal({
  isOpen,
  allowCreateFolder = false,
  onClose,
  onFolderSelected,
}: FolderBrowserModalProps) {
  const [currentPath, setCurrentPath] = useState('~');
  const [folders, setFolders] = useState<FolderSuggestion[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [showHiddenFolders, setShowHiddenFolders] = useState(false);
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFolders = useCallback(async (pathToLoad: string) => {
    setLoadingFolders(true);
    setError(null);
    try {
      const result = await browseFilesystemFolders(pathToLoad);
      setCurrentPath(result.path);
      setFolders(result.suggestions);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load folders');
    } finally {
      setLoadingFolders(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) void loadFolders('~');
  }, [isOpen, loadFolders]);

  const visibleFolders = useMemo(
    () => folders
      .filter((folder) => showHiddenFolders || !folder.name.startsWith('.'))
      .sort((first, second) => first.name.localeCompare(second.name, undefined, { sensitivity: 'base' })),
    [folders, showHiddenFolders],
  );

  const resetNewFolder = () => {
    setShowNewFolderInput(false);
    setNewFolderName('');
  };

  const handleCreateFolder = useCallback(async () => {
    if (!newFolderName.trim()) return;
    setCreatingFolder(true);
    setError(null);
    try {
      const createdPath = await createFolderInFilesystem(joinFolderPath(currentPath, newFolderName));
      resetNewFolder();
      await loadFolders(createdPath);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Failed to create folder');
    } finally {
      setCreatingFolder(false);
    }
  }, [currentPath, loadFolders, newFolderName]);

  const parentPath = getParentPath(currentPath);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85dvh] w-[calc(100vw-1rem)] max-w-2xl flex-col overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-border p-4">
          <div className="flex min-w-0 items-center gap-3">
            <FolderOpen className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            <DialogTitle className="not-sr-only truncate text-lg font-semibold">Select folder</DialogTitle>
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="min-h-11 min-w-11"
              onClick={() => setShowHiddenFolders((previous) => !previous)}
              aria-label={showHiddenFolders ? 'Hide hidden folders' : 'Show hidden folders'}
              aria-pressed={showHiddenFolders}
            >
              {showHiddenFolders ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
            </Button>
            {allowCreateFolder && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="min-h-11 min-w-11"
                onClick={() => setShowNewFolderInput((previous) => !previous)}
                aria-label="Create destination folder"
                aria-expanded={showNewFolderInput}
              >
                <Plus aria-hidden="true" />
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="min-h-11 min-w-11"
              onClick={onClose}
              aria-label="Close folder browser"
            >
              <X aria-hidden="true" />
            </Button>
          </div>
        </div>

        {showNewFolderInput && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/50 p-3">
            <Input
              value={newFolderName}
              onChange={(event) => setNewFolderName(event.target.value)}
              placeholder="New folder name"
              aria-label="New folder name"
              className="h-11 min-w-48 flex-1"
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleCreateFolder();
                if (event.key === 'Escape') resetNewFolder();
              }}
              autoFocus
            />
            <Button type="button" variant="outline" className="min-h-11" onClick={() => void handleCreateFolder()} disabled={!newFolderName.trim() || creatingFolder}>
              {creatingFolder && <Loader2 className="animate-spin" aria-hidden="true" />}
              Create
            </Button>
            <Button type="button" variant="outline" className="min-h-11" onClick={resetNewFolder}>Cancel</Button>
          </div>
        )}

        {error && (
          <div className="flex items-center justify-between gap-3 border-b border-destructive/30 bg-destructive/10 px-4 py-3" role="alert">
            <p className="text-sm text-destructive">{error}</p>
            <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => void loadFolders(currentPath)}>
              Retry
            </Button>
          </div>
        )}

        <div className="min-h-56 flex-1 overflow-y-auto p-3">
          {loadingFolders ? (
            <div className="flex min-h-44 items-center justify-center gap-2" role="status">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              <span className="text-sm text-muted-foreground">Loading folders…</span>
            </div>
          ) : (
            <div className="space-y-1">
              {parentPath && (
                <Button type="button" variant="ghost" className="h-11 w-full justify-start" onClick={() => void loadFolders(parentPath)}>
                  <FolderOpen aria-hidden="true" />
                  Parent folder
                </Button>
              )}
              {visibleFolders.length === 0 && !error ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No subfolders found.</p>
              ) : visibleFolders.map((folder) => (
                <div key={folder.path} className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-11 min-w-0 flex-1 justify-start"
                    onClick={() => void loadFolders(folder.path)}
                    title={`Open ${folder.path}`}
                  >
                    <FolderOpen className="shrink-0 text-primary" aria-hidden="true" />
                    <span className="truncate">{folder.name}</span>
                  </Button>
                  <Button type="button" variant="outline" className="h-11" onClick={() => onFolderSelected(folder.path)}>
                    Select
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-border">
          <div className="flex min-w-0 items-center gap-2 bg-muted/50 px-4 py-3 text-sm">
            <span className="shrink-0 text-muted-foreground">Current folder:</span>
            <code className="truncate">{currentPath}</code>
          </div>
          <div className="flex items-center justify-end gap-2 p-4">
            <Button type="button" variant="outline" className="min-h-11" onClick={onClose}>Cancel</Button>
            <Button type="button" className="min-h-11" onClick={() => onFolderSelected(currentPath)}>Use this folder</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
