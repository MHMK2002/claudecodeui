import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  assertTrustedPdfExportOrigin,
  createDesktopPdfExporter,
  registerDesktopPdfExportHandler,
} from '../../electron/pdfExport.js';

const VALID_PDF = Buffer.from('%PDF-1.7\n% CloudCLI desktop export\n%%EOF\n', 'ascii');

function createWindowHarness({ pdfBytes = VALID_PDF, loadError = null } = {}) {
  const windows = [];

  class FakeBrowserWindow {
    constructor(options) {
      this.options = options;
      this.destroyed = false;
      this.webContents = {
        session: {
          setPermissionRequestHandler: (handler) => {
            this.permissionHandler = handler;
          },
        },
        setWindowOpenHandler: (handler) => {
          this.windowOpenHandler = handler;
        },
        printToPDF: async (options) => {
          this.printOptions = options;
          return pdfBytes;
        },
      };
      windows.push(this);
    }

    async loadURL(url) {
      this.loadedUrl = url;
      if (loadError) throw loadError;
    }

    destroy() {
      this.destroyed = true;
    }

    isDestroyed() {
      return this.destroyed;
    }
  }

  return { BrowserWindow: FakeBrowserWindow, windows };
}

test('desktop PDF service writes a signed artifact from a hidden sandboxed window', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'cloudcli-pdf-export-'));
  const artifactPath = path.join(directory, 'chat.pdf');
  const harness = createWindowHarness();
  let dialogOptions;
  const exportPdf = createDesktopPdfExporter({
    BrowserWindow: harness.BrowserWindow,
    dialog: {
      async showSaveDialog(options) {
        dialogOptions = options;
        return { canceled: false, filePath: artifactPath };
      },
    },
  });

  try {
    const result = await exportPdf({
      html: '<!doctype html><html><body>Export</body></html>',
      suggestedFilename: 'session.pdf',
    });
    const artifact = await readFile(artifactPath);
    const [printWindow] = harness.windows;

    assert.deepEqual(result, { status: 'saved' });
    assert.equal(artifact.subarray(0, 5).toString('ascii'), '%PDF-');
    assert.deepEqual(artifact, VALID_PDF);
    assert.equal(dialogOptions.defaultPath, 'session.pdf');
    assert.equal(printWindow.options.show, false);
    assert.equal(printWindow.options.webPreferences.sandbox, true);
    assert.equal(printWindow.options.webPreferences.contextIsolation, true);
    assert.equal(printWindow.options.webPreferences.nodeIntegration, false);
    assert.equal(printWindow.options.webPreferences.javascript, false);
    assert.deepEqual(printWindow.windowOpenHandler({ url: 'https://example.com' }), { action: 'deny' });
    let permissionGranted = true;
    printWindow.permissionHandler(null, 'clipboard-read', (allowed) => { permissionGranted = allowed; });
    assert.equal(permissionGranted, false);
    assert.equal(printWindow.destroyed, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('desktop PDF cancellation is explicit and creates no renderer or artifact', async () => {
  const harness = createWindowHarness();
  const exportPdf = createDesktopPdfExporter({
    BrowserWindow: harness.BrowserWindow,
    dialog: { showSaveDialog: async () => ({ canceled: true }) },
  });

  assert.deepEqual(await exportPdf({ html: '<p>Export</p>', suggestedFilename: 'chat' }), {
    status: 'cancelled',
  });
  assert.equal(harness.windows.length, 0);
});

test('PDF IPC invokes the service only for the exact verified local origin', async () => {
  let registeredChannel;
  let registeredHandler;
  const exportedPayloads = [];
  registerDesktopPdfExportHandler({
    ipcMain: {
      handle(channel, handler) {
        registeredChannel = channel;
        registeredHandler = handler;
      },
    },
    getVerifiedOrigin: () => 'http://127.0.0.1:4312',
    exportPdf: async (payload) => {
      exportedPayloads.push(payload);
      return { status: 'saved' };
    },
  });
  const payload = { html: '<p>Export</p>', suggestedFilename: 'chat.pdf' };

  assert.equal(registeredChannel, 'cloudcli-desktop:export-pdf');
  assert.deepEqual(await registeredHandler({
    senderFrame: { url: 'http://127.0.0.1:4312/projects/1' },
  }, payload), { status: 'saved' });
  await assert.rejects(
    registeredHandler({
      senderFrame: { url: 'http://127.0.0.1:4313/projects/1' },
    }, payload),
    /unavailable for this page/i,
  );
  assert.deepEqual(exportedPayloads, [payload]);
});

test('desktop PDF service rejects untrusted origins, unbounded input, and unsafe filenames', async () => {
  assert.doesNotThrow(() => assertTrustedPdfExportOrigin(
    'http://127.0.0.1:4312/projects/1',
    'http://127.0.0.1:4312',
  ));
  for (const senderUrl of [
    'http://127.0.0.1:4313/projects/1',
    'http://localhost:4312/projects/1',
    'https://127.0.0.1:4312/projects/1',
    'https://example.com/projects/1',
  ]) {
    assert.throws(
      () => assertTrustedPdfExportOrigin(senderUrl, 'http://127.0.0.1:4312'),
      /unavailable for this page/i,
    );
  }

  const harness = createWindowHarness();
  const exportPdf = createDesktopPdfExporter({
    BrowserWindow: harness.BrowserWindow,
    dialog: { showSaveDialog: async () => ({ canceled: true }) },
  });
  await assert.rejects(
    exportPdf({ html: 'x'.repeat((8 * 1024 * 1024) + 1), suggestedFilename: 'chat' }),
    /too large/i,
  );
  await assert.rejects(
    exportPdf({ html: '<p>Export</p>', suggestedFilename: '../private/chat' }),
    /filename is invalid/i,
  );
});

test('desktop PDF failures expose neither HTML nor the selected local path', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'cloudcli-private-pdf-'));
  const artifactPath = path.join(directory, 'private-chat.pdf');
  const secretHtml = '<p>private-project-secret</p>';
  const harness = createWindowHarness({ loadError: new Error(`${secretHtml} ${artifactPath}`) });
  const exportPdf = createDesktopPdfExporter({
    BrowserWindow: harness.BrowserWindow,
    dialog: { showSaveDialog: async () => ({ canceled: false, filePath: artifactPath }) },
  });

  try {
    await assert.rejects(
      exportPdf({ html: secretHtml, suggestedFilename: 'chat' }),
      (error) => {
        assert.doesNotMatch(error.message, /private-project-secret/);
        assert.doesNotMatch(error.message, /cloudcli-private-pdf/);
        return true;
      },
    );
    await assert.rejects(access(artifactPath));
    assert.equal(harness.windows[0].destroyed, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the workspace ViewHost keeps its global new-window denial policy', async () => {
  const source = await readFile(new URL('../../electron/viewHost.js', import.meta.url), 'utf8');
  assert.match(
    source,
    /setWindowOpenHandler\(\(\{ url \}\) => \{[\s\S]*?return \{ action: 'deny' \};/,
  );
});
