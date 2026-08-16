import assert from 'node:assert/strict';
import test from 'node:test';

import React, { createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import FileTreeNode from './FileTreeNode.js';
import {
  isContextMenuFocusExitKey,
  isContextMenuKeyboardShortcut,
} from './FileContextMenu.js';

const file = { name: 'README.md', path: '/workspace/README.md', type: 'file' as const };

const baseProps = {
  item: file,
  level: 0,
  viewMode: 'simple' as const,
  expandedDirs: new Set<string>(),
  onItemClick: () => undefined,
  renderFileIcon: () => null,
  formatFileSize: () => '',
  formatRelativeTime: () => '',
};

test('file rows are named focusable treeitems with keyboard semantics', () => {
  const markup = renderToStaticMarkup(<FileTreeNode {...baseProps} />);
  assert.match(markup, /role="treeitem"/);
  assert.match(markup, /tabindex="0"/);
  assert.match(markup, /aria-label="Open README\.md"/);
  assert.match(markup, /data-file-path="\/workspace\/README\.md"/);
});

test('rename input has an explicit accessible name', () => {
  const markup = renderToStaticMarkup(
    <FileTreeNode
      {...baseProps}
      renamingItem={file}
      renameValue="README.md"
      setRenameValue={() => undefined}
      handleConfirmRename={() => undefined}
      handleCancelRename={() => undefined}
      renameInputRef={createRef<HTMLInputElement>()}
    />,
  );
  assert.match(markup, /aria-label="Rename README\.md"/);
});

test('context menu keyboard shortcuts include the Menu key and Shift+F10', () => {
  assert.equal(isContextMenuKeyboardShortcut('ContextMenu', false), true);
  assert.equal(isContextMenuKeyboardShortcut('F10', true), true);
  assert.equal(isContextMenuKeyboardShortcut('F10', false), false);
});

test('Tab exits the context menu without restoring focus to its trigger', () => {
  assert.equal(isContextMenuFocusExitKey('Tab'), true);
  assert.equal(isContextMenuFocusExitKey('Escape'), false);
});
