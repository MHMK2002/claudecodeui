import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import ImageViewer from '../../../file-tree/view/ImageViewer.js';
import CodeEditorBinaryFile from './CodeEditorBinaryFile.js';
import CodeEditorMediaPreview from './CodeEditorMediaPreview.js';

const file = {
  name: 'archive.bin',
  path: '/workspace/archive.bin',
  projectId: 'project-1',
};

const labels = {
  loading: 'Loading preview',
  error: 'Preview failed',
  openInNewTab: 'Open in new tab',
  fullscreen: 'Fullscreen',
  exitFullscreen: 'Exit fullscreen',
  close: 'Close',
};

const countButtons = (markup: string) => (markup.match(/<button/g) ?? []).length;

test('binary states expose one Close action and 44px named header controls', () => {
  const sidebarMarkup = renderToStaticMarkup(
    <CodeEditorBinaryFile
      file={file}
      isSidebar
      isFullscreen={false}
      onClose={() => undefined}
      onToggleFullscreen={() => undefined}
      title="Binary file"
      message="Cannot display this file"
    />,
  );
  const modalMarkup = renderToStaticMarkup(
    <CodeEditorBinaryFile
      file={file}
      isSidebar={false}
      isFullscreen={false}
      onClose={() => undefined}
      onToggleFullscreen={() => undefined}
      title="Binary file"
      message="Cannot display this file"
    />,
  );

  assert.equal(countButtons(sidebarMarkup), 1);
  assert.equal(countButtons(modalMarkup), 2);
  assert.equal((sidebarMarkup.match(/aria-label="Close"/g) ?? []).length, 1);
  assert.match(sidebarMarkup, /min-h-11/);
  assert.match(sidebarMarkup, /min-w-11/);
  assert.match(sidebarMarkup, /focus-visible:ring-2/);
});

test('media preview header controls are named, focus-visible, and at least 44px', () => {
  const markup = renderToStaticMarkup(
    <CodeEditorMediaPreview
      file={{ ...file, name: 'movie.mp4', path: '/workspace/movie.mp4' }}
      kind="video"
      projectId="project-1"
      isSidebar={false}
      isFullscreen={false}
      onClose={() => undefined}
      onToggleFullscreen={() => undefined}
      labels={labels}
    />,
  );

  assert.equal(countButtons(markup), 2);
  assert.equal((markup.match(/min-h-11/g) ?? []).length, 2);
  assert.equal((markup.match(/min-w-11/g) ?? []).length, 2);
  assert.equal((markup.match(/focus-visible:ring-2/g) ?? []).length, 2);
});

test('image viewer Close control has an accessible name and a 44px target', () => {
  const markup = renderToStaticMarkup(
    <ImageViewer
      file={{ name: 'image.png', path: '/workspace/image.png', projectId: 'project-1' }}
      onClose={() => undefined}
    />,
  );

  assert.match(markup, /aria-label="Close image viewer"/);
  assert.match(markup, /min-h-11/);
  assert.match(markup, /min-w-11/);
  assert.match(markup, /focus-visible:ring-2/);
});
