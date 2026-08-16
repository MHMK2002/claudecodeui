import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

import { isExactVerifiedOrigin } from './localOrigin.js';

const MAX_HTML_BYTES = 8 * 1024 * 1024;
const MAX_FILENAME_BYTES = 180;
const PDF_SIGNATURE = Buffer.from('%PDF-', 'ascii');
const SAFE_FILENAME_PATTERN = /^[^<>:"/\\|?*\u0000-\u001f]+$/;
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export const PDF_EXPORT_CHANNEL = 'cloudcli-desktop:export-pdf';

function isLoopbackHttpOrigin(rawOrigin) {
  try {
    const parsed = new URL(rawOrigin);
    return parsed.protocol === 'http:'
      && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost');
  } catch {
    return false;
  }
}

export function assertTrustedPdfExportOrigin(senderUrl, verifiedOrigin) {
  if (!isLoopbackHttpOrigin(verifiedOrigin)
    || !isExactVerifiedOrigin(senderUrl, verifiedOrigin)) {
    throw new Error('PDF export is unavailable for this page.');
  }
}

export function registerDesktopPdfExportHandler({ ipcMain, getVerifiedOrigin, exportPdf }) {
  if (typeof ipcMain?.handle !== 'function'
    || typeof getVerifiedOrigin !== 'function'
    || typeof exportPdf !== 'function') {
    throw new TypeError('PDF export IPC dependencies are invalid.');
  }

  ipcMain.handle(PDF_EXPORT_CHANNEL, async (event, payload) => {
    assertTrustedPdfExportOrigin(event.senderFrame?.url, getVerifiedOrigin());
    return exportPdf(payload);
  });
}

function normalizeSuggestedFilename(value) {
  if (typeof value !== 'string') {
    throw new Error('The PDF filename is invalid.');
  }

  const trimmed = value.trim();
  const stem = trimmed.toLowerCase().endsWith('.pdf')
    ? trimmed.slice(0, -4)
    : trimmed;
  if (!stem
    || stem === '.'
    || stem === '..'
    || stem.endsWith('.')
    || stem.endsWith(' ')
    || !SAFE_FILENAME_PATTERN.test(stem)
    || WINDOWS_RESERVED_NAME.test(stem)) {
    throw new Error('The PDF filename is invalid.');
  }

  const filename = `${stem}.pdf`;
  if (Buffer.byteLength(filename, 'utf8') > MAX_FILENAME_BYTES) {
    throw new Error('The PDF filename is too long.');
  }
  return filename;
}

function validateRequest(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('The PDF export request is invalid.');
  }
  if (typeof payload.html !== 'string' || payload.html.length === 0) {
    throw new Error('The PDF export content is empty.');
  }
  if (Buffer.byteLength(payload.html, 'utf8') > MAX_HTML_BYTES) {
    throw new Error('This conversation is too large to export as PDF.');
  }

  return {
    html: payload.html,
    filename: normalizeSuggestedFilename(payload.suggestedFilename),
  };
}

export function hasPdfSignature(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value ?? []);
  return bytes.length >= PDF_SIGNATURE.length
    && bytes.subarray(0, PDF_SIGNATURE.length).equals(PDF_SIGNATURE);
}

export function createDesktopPdfExporter({
  BrowserWindow,
  dialog,
  getParentWindow = () => null,
  writePdf = writeFile,
}) {
  if (typeof BrowserWindow !== 'function'
    || typeof dialog?.showSaveDialog !== 'function'
    || typeof writePdf !== 'function') {
    throw new TypeError('PDF exporter dependencies are invalid.');
  }

  return async function exportDesktopPdf(payload) {
    const { html, filename } = validateRequest(payload);
    const saveOptions = {
      title: 'Export chat as PDF',
      defaultPath: filename,
      filters: [{ name: 'PDF document', extensions: ['pdf'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    };

    let selection;
    try {
      const parentWindow = getParentWindow();
      selection = parentWindow && !parentWindow.isDestroyed?.()
        ? await dialog.showSaveDialog(parentWindow, saveOptions)
        : await dialog.showSaveDialog(saveOptions);
    } catch {
      throw new Error('Could not open the PDF save dialog. Try again.');
    }

    if (selection?.canceled === true) {
      return { status: 'cancelled' };
    }
    if (typeof selection?.filePath !== 'string' || selection.filePath.length === 0) {
      throw new Error('Could not choose a location for the PDF. Try again.');
    }

    let printWindow;
    try {
      printWindow = new BrowserWindow({
        show: false,
        width: 816,
        height: 1056,
        webPreferences: {
          contextIsolation: true,
          javascript: false,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
          partition: `pdf-export-${randomUUID()}`,
        },
      });
      printWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      printWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
        callback(false);
      });

      const encodedHtml = Buffer.from(html, 'utf8').toString('base64');
      const dataUrl = `data:text/html;charset=utf-8;base64,${encodedHtml}`;
      await printWindow.loadURL(dataUrl);
      const pdfBytes = await printWindow.webContents.printToPDF({
        margins: { marginType: 'default' },
        pageSize: 'A4',
        preferCSSPageSize: true,
        printBackground: true,
      });
      if (!hasPdfSignature(pdfBytes)) {
        throw new Error('Chromium returned an invalid PDF artifact.');
      }
      await writePdf(selection.filePath, pdfBytes, { mode: 0o600 });
      return { status: 'saved' };
    } catch {
      // Never propagate Chromium's data URL or the user-selected local path.
      throw new Error('Could not create the PDF. Choose another location and try again.');
    } finally {
      if (printWindow && !printWindow.isDestroyed()) {
        printWindow.destroy();
      }
    }
  };
}
