import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import CodeEditorHeader from './CodeEditorHeader.js';

const labels = {
  showingChanges: 'Showing changes',
  editMarkdown: 'Edit Markdown',
  previewMarkdown: 'Preview Markdown',
  previewHtml: 'Preview HTML',
  settings: 'Settings',
  download: 'Download',
  save: 'Save',
  saving: 'Saving…',
  saved: 'Saved',
  fullscreen: 'Fullscreen',
  exitFullscreen: 'Exit fullscreen',
  close: 'Close',
};

test('saving is visibly represented without a hidden breakpoint-only label', () => {
  const markup = renderToStaticMarkup(
    <CodeEditorHeader
      file={{ name: 'README.md', path: '/workspace/README.md' }}
      isSidebar
      isFullscreen={false}
      isMarkdownFile={false}
      isHtmlPreviewFile={false}
      markdownPreview={false}
      saving
      saveSuccess={false}
      onToggleMarkdownPreview={() => undefined}
      onOpenHtmlPreview={() => undefined}
      onOpenSettings={() => undefined}
      onDownload={() => undefined}
      onSave={() => undefined}
      onToggleFullscreen={() => undefined}
      onClose={() => undefined}
      labels={labels}
    />,
  );

  assert.match(markup, />Saving…</);
  assert.doesNotMatch(markup, /hidden[^\"]*text-xs[^\"]*Saving/);
  assert.match(markup, /animate-spin/);
});
