import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import test from 'node:test';

import { ServerInstaller } from '../../electron/serverInstaller.js';

const execFileAsync = promisify(execFile);

async function createBundle(root, content) {
  const source = path.join(root, 'source');
  const entry = path.join(source, 'dist-server', 'server', 'index.js');
  const archive = path.join(root, 'custom-server.tar.gz');
  await fs.rm(source, { recursive: true, force: true });
  await fs.mkdir(path.dirname(entry), { recursive: true });
  await fs.writeFile(entry, content);
  await execFileAsync('tar', ['-czf', archive, '-C', source, '.']);
  const checksum = crypto.createHash('sha256').update(await fs.readFile(archive)).digest('hex');
  await fs.writeFile(`${archive}.sha256`, `${checksum}  ${path.basename(archive)}\n`);
  return { archive, checksum };
}

test('embedded server archive installs without contacting a release URL', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudcli-embedded-server-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { archive, checksum } = await createBundle(root, '// personalized build');
  const logs = [];
  const installer = new ServerInstaller({
    version: '1.37.0',
    installRoot: path.join(root, 'installed'),
    onLog: (line) => logs.push(line),
  });

  const entry = await installer.ensureInstalledFromArchive(archive);

  assert.equal(await fs.readFile(entry, 'utf8'), '// personalized build');
  const marker = JSON.parse(await fs.readFile(path.join(installer.getVersionDir(), '.installed.json'), 'utf8'));
  assert.equal(marker.source, 'embedded');
  assert.equal(marker.sourceChecksum, checksum);
  assert.equal(logs.some((line) => line.includes('github.com')), false);
});

test('a changed customized archive replaces an installed runtime with the same version', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudcli-embedded-server-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const installer = new ServerInstaller({
    version: '1.37.0',
    installRoot: path.join(root, 'installed'),
  });
  const first = await createBundle(root, '// first build');
  await installer.ensureInstalledFromArchive(first.archive);
  const second = await createBundle(root, '// second personalized build');

  const entry = await installer.ensureInstalledFromArchive(second.archive);

  assert.equal(await fs.readFile(entry, 'utf8'), '// second personalized build');
});
