import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';

import {
  assertBuildIdentity,
  buildIdentitiesMatch,
  readBuildIdentityFile,
} from '../shared/buildIdentity.js';
import productConfig from '../shared/product-config.json' with { type: 'json' };

/**
 * Installs the versioned local server runtime used by CloudCLI Desktop.
 *
 * Server bundles are cached under:
 *   ~/.cloudcli/server/<version>/dist-server/server/index.js
 */

const DEFAULT_INSTALL_ROOT = path.join(os.homedir(), '.cloudcli', 'server');
const DEFAULT_BUNDLE_BASE_URL = `${productConfig.repositoryUrl}/releases/download`;
const MAX_REDIRECTS = 5;
const LOCAL_DOWNLOAD_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const ACTIVATION_SCHEMA_VERSION = 1;
const ACTIVATION_STATES = new Set(['staged', 'swapping', 'pending', 'confirmed']);
const ACTIVATION_ID_PATTERN = /^[1-9][0-9]*-[a-f0-9]{16}$/;

function mapArch(arch = process.arch) {
  return arch === 'arm64' ? 'arm64' : 'x64';
}

function mapPlatform(platform = process.platform) {
  if (platform === 'darwin' || platform === 'mac') return 'mac';
  if (platform === 'win32' || platform === 'win') return 'win';
  return 'linux';
}

export class ServerInstaller {
  constructor({
    buildIdentity,
    version,
    buildId,
    platform = process.platform,
    arch = process.arch,
    installRoot = process.env.CLOUDCLI_SERVER_DIR || DEFAULT_INSTALL_ROOT,
    bundleBaseUrl = process.env.CLOUDCLI_SERVER_BUNDLE_URL || DEFAULT_BUNDLE_BASE_URL,
    bundleReleaseTag = process.env.CLOUDCLI_SERVER_BUNDLE_RELEASE_TAG || '',
    onLog,
  } = {}) {
    this.buildIdentity = assertBuildIdentity(
      buildIdentity || { version, buildId },
      { source: 'Server installer identity' },
    );
    this.version = this.buildIdentity.version;
    this.buildId = this.buildIdentity.buildId;
    this.platform = mapPlatform(platform);
    this.arch = mapArch(arch);
    this.installRoot = path.resolve(installRoot);
    this.bundleBaseUrl = bundleBaseUrl.replace(/\/+$/, '');
    this.bundleReleaseTag = bundleReleaseTag || `v${this.version}`;
    this.onLog = typeof onLog === 'function' ? onLog : () => {};
    this.pendingActivation = null;
  }

  /** Directory the current version's server is (or will be) installed in. */
  getVersionDir() {
    return path.join(this.installRoot, this.version);
  }

  /** Absolute path to the server entry once installed. */
  getServerEntry() {
    return path.join(this.getVersionDir(), 'dist-server', 'server', 'index.js');
  }

  getBundleName() {
    return `cloudcli-local-server-${this.version}-${this.platform}-${this.arch}.tar.gz`;
  }

  getActivationPath() {
    return path.join(this.installRoot, `.activation-${this.version}.json`);
  }

  getBundleUrl() {
    const url = new URL(`${this.bundleBaseUrl}/${this.bundleReleaseTag}/${this.getBundleName()}`);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_DOWNLOAD_HOSTS.has(url.hostname))) {
      throw new Error(`Refusing unsupported server bundle URL: ${url.toString()}`);
    }
    return url.toString();
  }

  log(line) {
    this.onLog(String(line));
  }

  async isInstalled(sourceChecksum = null) {
    try {
      const marker = JSON.parse(
        await fs.readFile(path.join(this.getVersionDir(), '.installed.json'), 'utf8'),
      );
      if (!buildIdentitiesMatch(marker, this.buildIdentity)) return false;
      if (marker.platform !== this.platform || marker.arch !== this.arch) return false;
      if (sourceChecksum && marker.sourceChecksum !== sourceChecksum) return false;
      const embeddedIdentity = await readBuildIdentityFile(
        path.join(this.getVersionDir(), 'dist', 'build-identity.json'),
        { expectedVersion: this.version, source: 'Installed server build identity' },
      );
      if (!buildIdentitiesMatch(embeddedIdentity, this.buildIdentity)) return false;
      const entry = this.getServerEntry();
      if (!/^[a-f0-9]{64}$/i.test(String(marker.entrySha256 || ''))) return false;
      if (await this.#sha256(entry) !== marker.entrySha256.toLowerCase()) return false;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validates checksum, archive paths, platform metadata, and both embedded
   * identity copies without changing the currently installed runtime.
   */
  async inspectArchive(archivePath, { expectedChecksum = null } = {}) {
    const prepared = await this.#prepareArchive(archivePath, { expectedChecksum });
    try {
      return { checksum: prepared.checksum, metadata: prepared.metadata };
    } finally {
      await prepared.cleanup();
    }
  }

  /**
   * Installs the server archive shipped inside a self-contained desktop build.
   * The archive checksum is also the build identity, so a customized rebuild
   * replaces any downloaded runtime that happened to use the same app version.
   */
  async ensureInstalledFromArchive(archivePath) {
    await this.recoverInterruptedActivation();
    const prepared = await this.#prepareArchive(archivePath);
    try {
      if (await this.isInstalled(prepared.checksum)) {
        this.log(`Customized Local CloudCLI ${this.version} already installed.`);
        return this.getServerEntry();
      }

      this.log('Installing customized Local CloudCLI bundled with this desktop app…');
      const entry = await this.#installArchiveAtomically(prepared.archivePath, {
        source: 'embedded',
        sourceChecksum: prepared.checksum,
      });
      this.log(`Customized Local CloudCLI ${this.version} installed.`);
      return entry;
    } catch (error) {
      throw new Error(`Failed to install embedded local server: ${error.message}`);
    } finally {
      await prepared.cleanup();
    }
  }

  /**
   * Ensures the server for this version is installed, downloading + extracting
   * it if needed. Returns the resolved server entry path.
   */
  async ensureInstalled() {
    await this.recoverInterruptedActivation();
    if (await this.isInstalled()) {
      this.log(`Local server ${this.version} already installed.`);
      return this.getServerEntry();
    }

    const tmpDir = path.join(this.installRoot, `.tmp-${this.version}-${process.pid}`);
    const archivePath = path.join(tmpDir, this.getBundleName());

    await fs.mkdir(tmpDir, { recursive: true });
    try {
      const url = this.getBundleUrl();
      this.log(`Downloading local server bundle…`);
      this.log(url);
      await this.#download(url, archivePath);
      const checksum = await this.#verifyChecksum(url, archivePath);
      const prepared = await this.#prepareArchive(archivePath, { expectedChecksum: checksum });
      try {
        this.log('Extracting local server…');
        const entry = await this.#installArchiveAtomically(prepared.archivePath, {
          source: 'download',
          sourceChecksum: prepared.checksum,
        });
        this.log(`Local server ${this.version} installed.`);
        return entry;
      } finally {
        await prepared.cleanup();
      }
    } catch (error) {
      throw new Error(`Failed to install local server: ${error.message}`);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /** Called by LocalServerController only after the new runtime passes health identity checks. */
  async confirmInstalledRuntime() {
    const activation = this.pendingActivation || await this.#readActivation();
    if (!activation) return;
    if (activation.state !== 'pending' && activation.state !== 'confirmed') {
      throw new Error(`Cannot confirm a server activation in state ${activation.state}.`);
    }
    const confirmed = activation.state === 'confirmed'
      ? activation
      : await this.#writeActivation({ ...activation, state: 'confirmed' });
    await this.#cleanupActivationArtifacts(confirmed);
    this.pendingActivation = null;
  }

  /** Restores the prior runtime when the newly activated runtime fails its post-launch gate. */
  async rollbackInstalledRuntime() {
    const activation = this.pendingActivation || await this.#readActivation();
    if (!activation) return;
    await this.#restoreActivation(activation);
  }

  /** Recovers an activation interrupted before the Desktop health gate completed. */
  async recoverInterruptedActivation() {
    const activation = await this.#readActivation();
    if (!activation) return false;
    if (activation.state === 'confirmed') {
      await this.#cleanupActivationArtifacts(activation);
      this.pendingActivation = null;
      return false;
    }
    await this.#restoreActivation(activation);
    return true;
  }

  async #installArchiveAtomically(archivePath, markerFields) {
    await fs.mkdir(this.installRoot, { recursive: true });
    const activationId = `${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
    const versionDir = this.getVersionDir();
    const stageDir = path.join(this.installRoot, `.stage-${this.version}-${activationId}`);
    const backupDir = path.join(this.installRoot, `.backup-${this.version}-${activationId}`);
    let activation = null;

    try {
      await fs.mkdir(stageDir, { recursive: true });
      await this.#extract(archivePath, stageDir);
      const metadata = await this.#validateExtractedBundle(stageDir);
      const entrySha256 = await this.#sha256(
        path.join(stageDir, 'dist-server', 'server', 'index.js'),
      );
      await fs.writeFile(
        path.join(stageDir, '.installed.json'),
        JSON.stringify({
          ...metadata,
          ...markerFields,
          activationId,
          entrySha256,
          installedAt: new Date().toISOString(),
        }, null, 2),
        'utf8',
      );

      activation = await this.#writeActivation({
        schemaVersion: ACTIVATION_SCHEMA_VERSION,
        version: this.version,
        buildId: this.buildId,
        state: 'staged',
        activationId,
        versionDir,
        stageDir,
        backupDir,
        movedExisting: false,
      });

      try {
        await fs.rename(versionDir, backupDir);
        activation = { ...activation, movedExisting: true };
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      activation = await this.#writeActivation({ ...activation, state: 'swapping' });
      await fs.rename(stageDir, versionDir);
      activation = await this.#writeActivation({ ...activation, state: 'pending' });
      this.pendingActivation = activation;
      return this.getServerEntry();
    } catch (error) {
      if (activation) {
        try {
          await this.#restoreActivation(activation);
        } catch (restoreError) {
          throw new Error(
            `${error.message}; previous runtime restore failed: ${restoreError.message}`,
          );
        }
      } else {
        await fs.rm(stageDir, { recursive: true, force: true }).catch(() => {});
      }
      throw error;
    }
  }

  async #prepareArchive(archivePath, { expectedChecksum = null } = {}) {
    let expected = expectedChecksum;
    if (!expected) {
      try {
        expected = (await fs.readFile(`${archivePath}.sha256`, 'utf8')).trim().split(/\s+/)[0];
      } catch (error) {
        throw new Error(`Could not read server bundle checksum: ${error.message}`);
      }
    }
    if (!/^[a-f0-9]{64}$/i.test(String(expected || ''))) {
      throw new Error('Server bundle checksum is empty or invalid.');
    }

    const inspectionRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudcli-server-inspect-'));
    const privateArchivePath = path.join(inspectionRoot, 'server-bundle.tar.gz');
    const extractedRoot = path.join(inspectionRoot, 'extracted');
    const cleanup = () => fs.rm(inspectionRoot, { recursive: true, force: true }).catch(() => {});
    try {
      await fs.copyFile(archivePath, privateArchivePath);
      const actual = await this.#sha256(privateArchivePath);
      if (String(expected).toLowerCase() !== actual.toLowerCase()) {
        throw new Error('Server bundle checksum mismatch — refusing to install');
      }
      await this.#validateArchive(privateArchivePath);
      await fs.mkdir(extractedRoot, { recursive: true });
      await this.#extract(privateArchivePath, extractedRoot);
      const metadata = await this.#validateExtractedBundle(extractedRoot);
      return {
        archivePath: privateArchivePath,
        checksum: actual,
        metadata,
        cleanup,
      };
    } catch (error) {
      await cleanup();
      throw error;
    }
  }

  #validateActivation(value, { requireCurrentBuild = false } = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Server activation record must be an object.');
    }
    const identity = assertBuildIdentity(value, {
      expectedVersion: this.version,
      source: 'Server activation identity',
    });
    if (requireCurrentBuild && !buildIdentitiesMatch(identity, this.buildIdentity)) {
      throw new Error('Server activation identity does not match this Desktop build.');
    }
    if (value.schemaVersion !== ACTIVATION_SCHEMA_VERSION) {
      throw new Error('Server activation record has an unsupported schema version.');
    }
    if (!ACTIVATION_STATES.has(value.state)) {
      throw new Error(`Server activation state ${String(value.state)} is invalid.`);
    }
    if (!ACTIVATION_ID_PATTERN.test(String(value.activationId || ''))) {
      throw new Error('Server activation id is invalid.');
    }
    if (value.versionDir !== this.getVersionDir()) {
      throw new Error('Server activation version directory is invalid.');
    }
    const expectedStageDir = path.join(
      this.installRoot,
      `.stage-${this.version}-${value.activationId}`,
    );
    const expectedBackupDir = path.join(
      this.installRoot,
      `.backup-${this.version}-${value.activationId}`,
    );
    if (value.stageDir !== expectedStageDir || path.dirname(value.stageDir) !== this.installRoot) {
      throw new Error('Server activation stage directory is invalid.');
    }
    if (value.backupDir !== expectedBackupDir || path.dirname(value.backupDir) !== this.installRoot) {
      throw new Error('Server activation backup directory is invalid.');
    }
    if (typeof value.movedExisting !== 'boolean') {
      throw new Error('Server activation movedExisting flag is invalid.');
    }
    return {
      schemaVersion: ACTIVATION_SCHEMA_VERSION,
      version: identity.version,
      buildId: identity.buildId,
      state: value.state,
      activationId: value.activationId,
      versionDir: value.versionDir,
      stageDir: value.stageDir,
      backupDir: value.backupDir,
      movedExisting: value.movedExisting,
    };
  }

  async #readActivation() {
    let raw;
    try {
      raw = await fs.readFile(this.getActivationPath(), 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw new Error(`Could not read server activation state: ${error.message}`);
    }
    try {
      return this.#validateActivation(JSON.parse(raw));
    } catch (error) {
      throw new Error(`Invalid server activation state: ${error.message}`);
    }
  }

  async #writeActivation(value) {
    const activation = this.#validateActivation(value, { requireCurrentBuild: true });
    await fs.mkdir(this.installRoot, { recursive: true });
    const tmpPath = path.join(
      this.installRoot,
      `.activation-${this.version}-${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp`,
    );
    let handle;
    try {
      handle = await fs.open(tmpPath, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify(activation, null, 2)}\n`, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await fs.rename(tmpPath, this.getActivationPath());
      return activation;
    } finally {
      await handle?.close().catch(() => {});
      await fs.rm(tmpPath, { force: true }).catch(() => {});
    }
  }

  async #pathExists(targetPath) {
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  async #isActivatedRuntime(activation) {
    try {
      const marker = JSON.parse(
        await fs.readFile(path.join(activation.versionDir, '.installed.json'), 'utf8'),
      );
      return buildIdentitiesMatch(marker, activation)
        && marker.activationId === activation.activationId;
    } catch {
      return false;
    }
  }

  async #cleanupActivationArtifacts(value) {
    const activation = this.#validateActivation(value);
    await fs.rm(activation.backupDir, { recursive: true, force: true });
    await fs.rm(activation.stageDir, { recursive: true, force: true });
    await fs.rm(this.getActivationPath(), { force: true });
  }

  async #restoreActivation(value) {
    const activation = this.#validateActivation(value);
    if (activation.state === 'confirmed') {
      await this.#cleanupActivationArtifacts(activation);
      this.pendingActivation = null;
      return;
    }

    const versionExists = await this.#pathExists(activation.versionDir);
    const backupExists = await this.#pathExists(activation.backupDir);

    if (activation.state === 'staged') {
      if (!versionExists && backupExists) {
        await fs.rename(activation.backupDir, activation.versionDir);
      } else if (versionExists && backupExists) {
        await fs.rm(activation.backupDir, { recursive: true, force: true });
      }
      await fs.rm(activation.stageDir, { recursive: true, force: true });
      await fs.rm(this.getActivationPath(), { force: true });
      this.pendingActivation = null;
      return;
    }

    if (backupExists) {
      if (versionExists) {
        if (!await this.#isActivatedRuntime(activation)) {
          throw new Error('Refusing to remove a runtime not owned by the pending activation.');
        }
        await fs.rm(activation.versionDir, { recursive: true, force: true });
      }
      await fs.rename(activation.backupDir, activation.versionDir);
    } else if (versionExists && await this.#isActivatedRuntime(activation)) {
      if (activation.movedExisting) {
        throw new Error('Pending activation backup is missing; refusing a destructive rollback.');
      }
      await fs.rm(activation.versionDir, { recursive: true, force: true });
    }

    await fs.rm(activation.stageDir, { recursive: true, force: true });
    await fs.rm(this.getActivationPath(), { force: true });
    this.pendingActivation = null;
  }

  #download(url, destPath, redirectsLeft = MAX_REDIRECTS) {
    return new Promise((resolve, reject) => {
      const req = https.get(url, (res) => {
        const { statusCode, headers } = res;

        if (statusCode >= 300 && statusCode < 400 && headers.location) {
          res.resume();
          if (redirectsLeft <= 0) {
            reject(new Error('Too many redirects'));
            return;
          }
          const next = new URL(headers.location, url).toString();
          resolve(this.#download(next, destPath, redirectsLeft - 1));
          return;
        }

        if (statusCode !== 200) {
          res.resume();
          reject(new Error(`Download failed with HTTP ${statusCode}`));
          return;
        }

        const total = Number(headers['content-length']) || 0;
        let received = 0;
        let lastPct = -1;
        const out = createWriteStream(destPath);

        res.on('data', (chunk) => {
          received += chunk.length;
          if (total) {
            const pct = Math.floor((received / total) * 100);
            if (pct !== lastPct && pct % 10 === 0) {
              lastPct = pct;
              this.log(`Downloading… ${pct}%`);
            }
          }
        });
        res.pipe(out);
        out.on('finish', () => out.close(resolve));
        out.on('error', reject);
        res.on('error', reject);
      });
      req.on('error', reject);
    });
  }

  async #verifyChecksum(url, archivePath) {
    let expected;
    try {
      expected = (await this.#fetchText(`${url}.sha256`)).trim().split(/\s+/)[0];
    } catch (error) {
      throw new Error(`Could not verify server bundle checksum: ${error.message}`);
    }
    if (!/^[a-f0-9]{64}$/i.test(String(expected || ''))) {
      throw new Error('Downloaded server bundle checksum is empty or invalid');
    }
    const actual = await this.#sha256(archivePath);
    if (expected.toLowerCase() !== actual.toLowerCase()) {
      throw new Error('Checksum mismatch — refusing to install');
    }
    this.log('Checksum verified.');
    return actual;
  }

  #fetchText(url, redirectsLeft = MAX_REDIRECTS) {
    return new Promise((resolve, reject) => {
      https
        .get(url, (res) => {
          const { statusCode, headers } = res;
          if (statusCode >= 300 && statusCode < 400 && headers.location) {
            res.resume();
            if (redirectsLeft <= 0) return reject(new Error('Too many redirects'));
            return resolve(this.#fetchText(new URL(headers.location, url).toString(), redirectsLeft - 1));
          }
          if (statusCode !== 200) {
            res.resume();
            return reject(new Error(`HTTP ${statusCode}`));
          }
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (c) => (body += c));
          res.on('end', () => resolve(body));
          res.on('error', reject);
        })
        .on('error', reject);
    });
  }

  #sha256(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = createReadStream(filePath);
      stream.on('data', (c) => hash.update(c));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  async #validateExtractedBundle(rootDirectory) {
    let metadata;
    try {
      metadata = JSON.parse(
        await fs.readFile(path.join(rootDirectory, '.installed.json'), 'utf8'),
      );
    } catch (error) {
      throw new Error(`Server archive metadata is missing or invalid: ${error.message}`);
    }

    const archiveIdentity = assertBuildIdentity(metadata, {
      expectedVersion: this.version,
      source: 'Server archive metadata',
    });
    if (!buildIdentitiesMatch(archiveIdentity, this.buildIdentity)) {
      throw new Error(
        `Server archive buildId ${archiveIdentity.buildId} does not match desktop buildId ${this.buildId}.`,
      );
    }
    if (metadata.platform !== this.platform || metadata.arch !== this.arch) {
      throw new Error(
        `Server archive target ${metadata.platform}/${metadata.arch} does not match desktop target ${this.platform}/${this.arch}.`,
      );
    }
    if (metadata.productName !== productConfig.productName) {
      throw new Error(`Server archive product ${metadata.productName || 'unknown'} is incompatible.`);
    }

    const distributionIdentity = await readBuildIdentityFile(
      path.join(rootDirectory, 'dist', 'build-identity.json'),
      { expectedVersion: this.version, source: 'Archived server distribution identity' },
    );
    if (!buildIdentitiesMatch(distributionIdentity, this.buildIdentity)) {
      throw new Error('Archived server distribution identity does not match archive metadata.');
    }
    const compiledServerIdentity = await readBuildIdentityFile(
      path.join(rootDirectory, 'dist-server', 'build-identity.json'),
      { expectedVersion: this.version, source: 'Archived compiled server identity' },
    );
    if (!buildIdentitiesMatch(compiledServerIdentity, this.buildIdentity)) {
      throw new Error('Archived compiled server identity does not match archive metadata.');
    }
    await fs.access(path.join(rootDirectory, 'dist-server', 'server', 'index.js'));

    return {
      productName: productConfig.productName,
      features: metadata.features || productConfig.features,
      version: archiveIdentity.version,
      buildId: archiveIdentity.buildId,
      platform: this.platform,
      arch: this.arch,
      builtAt: typeof metadata.builtAt === 'string' ? metadata.builtAt : null,
    };
  }

  #extract(archivePath, destDir) {
    return new Promise((resolve, reject) => {
      const child = spawn('tar', ['-xzf', path.basename(archivePath), '-C', destDir], {
        cwd: path.dirname(archivePath),
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
      });
      let stderr = '';
      child.stderr?.on('data', (c) => (stderr += c));
      child.once('error', reject);
      child.once('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`tar exited with code ${code}: ${stderr.trim()}`));
      });
    });
  }

  #listArchive(archivePath, verbose = false) {
    return new Promise((resolve, reject) => {
      const child = spawn('tar', [verbose ? '-tvzf' : '-tzf', path.basename(archivePath)], {
        cwd: path.dirname(archivePath),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (c) => { stdout += c; });
      child.stderr?.on('data', (c) => { stderr += c; });
      child.once('error', reject);
      child.once('exit', (code) => {
        if (code !== 0) {
          reject(new Error(`tar list exited with code ${code}: ${stderr.trim()}`));
          return;
        }
        resolve(stdout.split(/\r?\n/).filter(Boolean));
      });
    });
  }

  async #validateArchive(archivePath) {
    const entries = await this.#listArchive(archivePath);
    for (const entry of entries) {
      const normalized = entry.replace(/\\/g, '/');
      if (
        normalized.includes('\0')
        || path.isAbsolute(normalized)
        || /^[a-zA-Z]:\//.test(normalized)
        || normalized.split('/').includes('..')
      ) {
        throw new Error(`Refusing unsafe archive entry: ${entry}`);
      }
    }

    const verboseEntries = await this.#listArchive(archivePath, true);
    for (const entry of verboseEntries) {
      const entryType = entry.trimStart()[0];
      if (entryType !== '-' && entryType !== 'd') {
        throw new Error(`Refusing archive link or special entry: ${entry}`);
      }
    }
  }
}
