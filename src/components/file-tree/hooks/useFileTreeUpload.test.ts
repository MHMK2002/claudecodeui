import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createUploadAttemptGuard,
  parseUploadSuccessResponse,
  resolveUploadTerminalStatus,
  selectFilesForUploadRetry,
  validateFilesForUpload,
} from './useFileTreeUpload.js';

test('upload distinguishes complete and partial success', () => {
  assert.equal(resolveUploadTerminalStatus(3, 3), 'complete');
  assert.equal(resolveUploadTerminalStatus(2, 3), 'partial');
});

test('upload rejects empty, malformed, and incomplete success responses', () => {
  for (const responseText of [
    '',
    '<html>not json</html>',
    '{}',
    '{"uploadedCount":2}',
    '{"uploadedCount":3,"requestedFileCount":2}',
  ]) {
    assert.throws(
      () => parseUploadSuccessResponse(responseText, 2),
      /valid upload result/i,
    );
  }
});

test('upload accepts bounded counts that match the current attempt', () => {
  assert.deepEqual(
    parseUploadSuccessResponse(
      JSON.stringify({
        uploadedCount: 1,
        requestedFileCount: 2,
        files: [{
          name: 'saved.txt',
          path: '/workspace/saved.txt',
          size: 5,
          mimeType: 'text/plain',
        }],
        failures: [{
          name: 'failed.txt',
          code: 'EACCES',
          message: 'Permission denied while writing this file.',
        }],
        status: 'partial',
      }),
      2,
    ),
    {
      uploadedCount: 1,
      requestedFileCount: 2,
      files: [{
        name: 'saved.txt',
        path: '/workspace/saved.txt',
        size: 5,
        mimeType: 'text/plain',
      }],
      failures: [{
        name: 'failed.txt',
        code: 'EACCES',
        message: 'Permission denied while writing this file.',
      }],
      status: 'partial',
    },
  );
});

test('upload rejects inconsistent file and failure accounting', () => {
  for (const responseText of [
    '{"uploadedCount":1,"requestedFileCount":1,"files":[],"failures":[],"status":"complete"}',
    '{"uploadedCount":1,"requestedFileCount":2,"files":[{"name":"saved.txt","path":"/saved.txt","size":1,"mimeType":"text/plain"}],"failures":[],"status":"partial"}',
    '{"uploadedCount":1,"requestedFileCount":1,"files":[{"name":"saved.txt"}],"failures":[],"status":"complete"}',
  ]) {
    assert.throws(
      () => parseUploadSuccessResponse(responseText, responseText.includes('requestedFileCount":2') ? 2 : 1),
      /valid upload result/i,
    );
  }
});

test('upload attempt guard rejects overlap and reopens after completion', () => {
  const guard = createUploadAttemptGuard();

  assert.equal(guard.tryBegin(), true);
  assert.equal(guard.tryBegin(), false);
  guard.end();
  assert.equal(guard.tryBegin(), true);
});

test('partial upload retry retains only files the server reported as failed', () => {
  const savedFile = new File(['saved'], 'saved.txt', { type: 'text/plain' });
  const failedFile = new File(['failed'], 'failed.txt', { type: 'text/plain' });
  Object.defineProperty(failedFile, 'webkitRelativePath', { value: 'nested/failed.txt' });

  assert.deepEqual(
    selectFilesForUploadRetry(
      [savedFile, failedFile],
      ['saved.txt'],
      ['nested/failed.txt'],
    ),
    [failedFile],
  );
});

test('partial upload retry rejects result names that do not match the attempt', () => {
  const attemptedFile = new File(['content'], 'attempted.txt', { type: 'text/plain' });

  assert.throws(
    () => selectFilesForUploadRetry([attemptedFile], [], ['different.txt']),
    /valid upload result/i,
  );
});

test('upload rejects duplicate normalized destination paths before sending', () => {
  const firstFile = new File(['first'], 'Same.txt', { type: 'text/plain' });
  const secondFile = new File(['second'], 'same.txt', { type: 'text/plain' });

  assert.match(
    validateFilesForUpload([firstFile, secondFile]) ?? '',
    /same destination/i,
  );
  assert.throws(
    () => selectFilesForUploadRetry([firstFile, secondFile], ['Same.txt'], ['same.txt']),
    /valid upload result/i,
  );
});
