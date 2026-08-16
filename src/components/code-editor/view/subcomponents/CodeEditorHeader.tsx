import { Code2, Download, Eye, Loader2, Maximize2, Minimize2, Save, Settings as SettingsIcon, X } from 'lucide-react';

import type { CodeEditorFile } from '../../types/types';

type CodeEditorHeaderProps = {
  file: CodeEditorFile;
  isSidebar: boolean;
  isFullscreen: boolean;
  isMarkdownFile: boolean;
  isHtmlPreviewFile: boolean;
  markdownPreview: boolean;
  saving: boolean;
  saveSuccess: boolean;
  onToggleMarkdownPreview: () => void;
  onOpenHtmlPreview: () => void;
  onOpenSettings: () => void;
  onDownload: () => void;
  onSave: () => void;
  onToggleFullscreen: () => void;
  onClose: () => void;
  labels: {
    showingChanges: string;
    editMarkdown: string;
    previewMarkdown: string;
    previewHtml: string;
    settings: string;
    download: string;
    save: string;
    saving: string;
    saved: string;
    fullscreen: string;
    exitFullscreen: string;
    close: string;
  };
};

export default function CodeEditorHeader({
  file,
  isSidebar,
  isFullscreen,
  isMarkdownFile,
  isHtmlPreviewFile,
  markdownPreview,
  saving,
  saveSuccess,
  onToggleMarkdownPreview,
  onOpenHtmlPreview,
  onOpenSettings,
  onDownload,
  onSave,
  onToggleFullscreen,
  onClose,
  labels,
}: CodeEditorHeaderProps) {
  const saveTitle = saveSuccess ? labels.saved : saving ? labels.saving : labels.save;

  return (
    <div className="flex min-w-0 flex-shrink-0 flex-col items-stretch gap-1 border-b border-border px-3 py-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
      {/* File info - can shrink */}
      <div className="flex min-w-0 flex-1 shrink items-center gap-2">
        <div className="min-w-0 shrink">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-sm font-medium text-gray-900 dark:text-white">{file.name}</h3>
            {file.diffInfo && (
              <span className="shrink-0 whitespace-nowrap rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-600 dark:bg-blue-900 dark:text-blue-300">
                {labels.showingChanges}
              </span>
            )}
          </div>
          <p className="truncate text-xs text-gray-500 dark:text-gray-400">{file.path}</p>
        </div>
      </div>

      {/* Buttons - don't shrink, always visible */}
      <div className="flex max-w-full flex-wrap items-center justify-end gap-0.5 sm:shrink-0">
        {(saving || saveSuccess) && (
          <span className="mr-1 shrink-0 whitespace-nowrap text-xs text-muted-foreground" role="status" aria-live="polite">
            {saving ? labels.saving : labels.saved}
          </span>
        )}
        {isMarkdownFile && (
          <button
            type="button"
            onClick={onToggleMarkdownPreview}
            className={`flex min-h-11 min-w-11 items-center justify-center rounded-md p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              markdownPreview
                ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white'
            }`}
            title={markdownPreview ? labels.editMarkdown : labels.previewMarkdown}
            aria-label={markdownPreview ? labels.editMarkdown : labels.previewMarkdown}
          >
            {markdownPreview ? <Code2 className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
          </button>
        )}

        {isHtmlPreviewFile && (
          <button
            type="button"
            onClick={onOpenHtmlPreview}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-md p-1.5 text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
            title={labels.previewHtml}
            aria-label={labels.previewHtml}
          >
            <Eye className="h-4 w-4" aria-hidden="true" />
          </button>
        )}

        <button
          type="button"
          onClick={onOpenSettings}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-md p-1.5 text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
          title={labels.settings}
          aria-label={labels.settings}
        >
          <SettingsIcon className="h-4 w-4" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={onDownload}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-md p-1.5 text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
          title={labels.download}
          aria-label={labels.download}
        >
          <Download className="h-4 w-4" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className={`flex min-h-11 min-w-11 items-center justify-center rounded-md p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${
            saveSuccess
              ? 'bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400'
              : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white'
          }`}
          title={saveTitle}
          aria-label={saveTitle}
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : saveSuccess ? (
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <Save className="h-4 w-4" aria-hidden="true" />
          )}
        </button>

        {!isSidebar && (
          <button
            type="button"
            onClick={onToggleFullscreen}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-md p-1.5 text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
            title={isFullscreen ? labels.exitFullscreen : labels.fullscreen}
            aria-label={isFullscreen ? labels.exitFullscreen : labels.fullscreen}
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" aria-hidden="true" /> : <Maximize2 className="h-4 w-4" aria-hidden="true" />}
          </button>
        )}

        <button
          type="button"
          onClick={onClose}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-md p-1.5 text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
          title={labels.close}
          aria-label={labels.close}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
