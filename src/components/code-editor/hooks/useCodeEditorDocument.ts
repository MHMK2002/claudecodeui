import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../utils/api';
import type { CodeEditorFile } from '../types/types';
import { isBinaryFile } from '../utils/binaryFile';
import { getPreviewKind } from '../utils/previewableFile';
import { createCodeEditorDocumentGuard } from './codeEditorDocumentGuard';

type UseCodeEditorDocumentParams = {
  file: CodeEditorFile;
  projectPath?: string;
};

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
};

export const useCodeEditorDocument = ({ file, projectPath }: UseCodeEditorDocumentParams) => {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadIdentity, setLoadIdentity] = useState('');
  const [loadedIdentity, setLoadedIdentity] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadGeneration, setReloadGeneration] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isBinary, setIsBinary] = useState(false);
  // Some binaries (images, PDFs, audio, video) can be rendered natively, so the
  // editor shows an inline preview instead of the generic binary placeholder.
  const previewKind = getPreviewKind(file.name);
  // `fileProjectId` is the DB primary key passed down from the editor sidebar;
  // the fallback to `projectPath` preserves older callers that didn't yet
  // propagate the identifier.
  const fileProjectId = file.projectId ?? projectPath;
  const filePath = file.path;
  const fileName = file.name;
  const fileDiffNewString = file.diffInfo?.new_string;
  const fileDiffOldString = file.diffInfo?.old_string;
  const documentIdentity = `${fileProjectId ?? ''}\0${filePath}`;
  const [documentGuard] = useState(createCodeEditorDocumentGuard);
  const saveInFlightRef = useRef(false);

  useEffect(() => {
    const loadToken = documentGuard.beginDocumentLoad(documentIdentity);
    let effectActive = true;
    const canCommitLoad = () => effectActive && documentGuard.canCommitLoad(loadToken);

    const loadFileContent = async () => {
      try {
        setLoading(true);
        setLoadIdentity(documentIdentity);
        setLoadedIdentity('');
        setLoadError(null);
        setContent('');
        setIsBinary(false);
        setSaving(false);
        setSaveSuccess(false);
        setSaveError(null);
        saveInFlightRef.current = false;

        // Natively previewable media (image/pdf/audio/video) is rendered by
        // CodeEditorMediaPreview, so there is nothing to read as text here.
        // Clear any buffer left over from a previously opened text file so a
        // stray save can't write stale content over the binary file.
        if (getPreviewKind(file.name)) {
          if (canCommitLoad()) setLoadedIdentity(documentIdentity);
          return;
        }

        // Check if file is binary by extension
        if (isBinaryFile(file.name)) {
          if (canCommitLoad()) {
            setIsBinary(true);
            setLoadedIdentity(documentIdentity);
          }
          return;
        }

        // Diff payload may already include full old/new snapshots, so avoid disk read.
        if (file.diffInfo && fileDiffNewString !== undefined && fileDiffOldString !== undefined) {
          if (canCommitLoad()) {
            setContent(fileDiffNewString);
            setLoadedIdentity(documentIdentity);
          }
          return;
        }

        if (!fileProjectId) {
          throw new Error('Missing project identifier');
        }

        const response = await api.readFile(fileProjectId, filePath);
        if (!response.ok) {
          throw new Error(`Failed to load file: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        if (canCommitLoad()) {
          setContent(data.content);
          setLoadedIdentity(documentIdentity);
        }
      } catch (error) {
        if (!canCommitLoad()) return;
        const message = getErrorMessage(error);
        console.error('Error loading file:', error);
        setContent('');
        setLoadError(message);
      } finally {
        if (canCommitLoad()) setLoading(false);
      }
    };

    void loadFileContent();
    return () => {
      effectActive = false;
    };
  }, [
    documentGuard,
    documentIdentity,
    file.diffInfo,
    file.name,
    fileDiffNewString,
    fileDiffOldString,
    fileProjectId,
    reloadGeneration,
  ]);

  const handleSave = useCallback(async () => {
    // Preview-only and binary files have no editable text buffer; never write
    // them back (e.g. via Cmd/Ctrl+S) or we'd corrupt the file on disk.
    if (
      previewKind
      || isBinaryFile(fileName)
      || loading
      || loadedIdentity !== documentIdentity
      || !documentGuard.isActiveDocument(documentIdentity)
      || saveInFlightRef.current
    ) {
      return;
    }

    const saveToken = documentGuard.beginDocumentSave(documentIdentity);
    saveInFlightRef.current = true;
    setSaving(true);
    setSaveError(null);

    try {
      if (!fileProjectId) {
        throw new Error('Missing project identifier');
      }

      const response = await api.saveFile(fileProjectId, filePath, content);

      if (!response.ok) {
        const contentType = response.headers.get('content-type');
        if (contentType?.includes('application/json')) {
          const errorData = await response.json();
          throw new Error(errorData.error || `Save failed: ${response.status}`);
        }

        const textError = await response.text();
        console.error('Non-JSON error response:', textError);
        throw new Error(`Save failed: ${response.status} ${response.statusText}`);
      }

      await response.json();

      if (documentGuard.canCommitSave(saveToken)) setSaveSuccess(true);
    } catch (error) {
      if (!documentGuard.isLatestSave(saveToken)) return;
      const message = getErrorMessage(error);
      console.error('Error saving file:', error);
      setSaveError(message);
    } finally {
      if (documentGuard.isLatestSave(saveToken)) {
        saveInFlightRef.current = false;
        setSaving(false);
      }
    }
  }, [
    content,
    documentGuard,
    documentIdentity,
    fileName,
    filePath,
    fileProjectId,
    loadedIdentity,
    loading,
    previewKind,
  ]);

  const handleContentChange = useCallback((nextContent: string) => {
    documentGuard.noteContentChange(documentIdentity);
    setContent(nextContent);
    setSaveSuccess(false);
    setSaveError(null);
  }, [documentGuard, documentIdentity]);

  const handleRetryLoad = useCallback(() => {
    setReloadGeneration((previous) => previous + 1);
  }, []);

  const handleDownload = useCallback(() => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = file.name;

    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);

    URL.revokeObjectURL(url);
  }, [content, file.name]);

  return {
    content,
    setContent: handleContentChange,
    loading: loading || loadIdentity !== documentIdentity,
    loadError,
    saving,
    saveSuccess,
    saveError,
    isBinary,
    previewKind,
    fileProjectId,
    handleRetryLoad,
    handleSave,
    handleDownload,
  };
};
