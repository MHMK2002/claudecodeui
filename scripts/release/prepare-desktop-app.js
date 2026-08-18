#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { readBuildIdentityFile } from '../../shared/buildIdentity.js';
import { ServerInstaller } from '../../electron/serverInstaller.js';
import { copyRuntimeDependencyClosure } from './runtime-dependency-closure.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..', '..');
const stageDir = path.join(rootDir, '.desktop-build', 'desktop-app');

const packageJson = JSON.parse(
  await fs.readFile(path.join(rootDir, 'package.json'), 'utf8'),
);
const productConfig = JSON.parse(
  await fs.readFile(path.join(rootDir, 'shared', 'product-config.json'), 'utf8'),
);
const canonicalIdentityPath = path.join(rootDir, '.build-identity', 'build-identity.json');
const distributionIdentityPath = path.join(rootDir, 'dist', 'build-identity.json');
const buildIdentity = await readBuildIdentityFile(canonicalIdentityPath, {
  expectedVersion: packageJson.version,
  source: 'Canonical Desktop staging build identity',
});
const isInternalRelease = process.env.CLOUDCLI_RELEASE_MODE === 'internal';
const [canonicalIdentityBytes, distributionIdentityBytes] = await Promise.all([
  fs.readFile(canonicalIdentityPath),
  fs.readFile(distributionIdentityPath),
]);
if (!canonicalIdentityBytes.equals(distributionIdentityBytes)) {
  throw new Error('Desktop staging refused: client identity is not the canonical artifact bytes.');
}

function getServerBundleName() {
  const configuredPlatform = process.env.CLOUDCLI_BUNDLE_PLATFORM || process.platform;
  const platform = configuredPlatform === 'darwin' || configuredPlatform === 'mac'
    ? 'mac'
    : configuredPlatform === 'win32' || configuredPlatform === 'win'
      ? 'win'
      : 'linux';
  const arch = (process.env.CLOUDCLI_BUNDLE_ARCH || process.arch) === 'arm64' ? 'arm64' : 'x64';
  return `cloudcli-local-server-${packageJson.version}-${platform}-${arch}.tar.gz`;
}

function getElectronVersion() {
  try {
    return JSON.parse(
      readFileSync(path.join(rootDir, 'node_modules', 'electron', 'package.json'), 'utf8'),
    ).version;
  } catch {
    try {
      return JSON.parse(
        readFileSync(path.join(rootDir, 'package-lock.json'), 'utf8'),
      ).packages['node_modules/electron'].version;
    } catch {
      throw new Error('Could not resolve an exact Electron version for desktop packaging.');
    }
  }
}

function getGithubPublishConfiguration() {
  const repositoryUrl = new URL(productConfig.repositoryUrl);
  const pathParts = repositoryUrl.pathname.replace(/\.git$/, '').split('/').filter(Boolean);
  if (repositoryUrl.hostname !== 'github.com' || pathParts.length !== 2) {
    throw new Error('Desktop automatic updates require a canonical GitHub owner/repository URL.');
  }
  return [{
    provider: 'github',
    owner: pathParts[0],
    repo: pathParts[1],
    releaseType: 'release',
  }];
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copyRequired(relativePath) {
  const from = path.join(rootDir, relativePath);
  const to = path.join(stageDir, relativePath);
  if (!(await pathExists(from))) {
    throw new Error(`Required desktop build input is missing: ${relativePath}`);
  }
  await fs.cp(from, to, { recursive: true });
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      ...options,
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

function buildDesktopPackageJson(copiedOptionalDependencies) {
  return {
    name: `${packageJson.name}-desktop`,
    version: packageJson.version,
    productName: productConfig.productName,
    description: `${productConfig.productName} desktop shell`,
    author: packageJson.author,
    license: packageJson.license,
    type: 'module',
    main: 'electron/main.js',
    dependencies: {
      'electron-updater': packageJson.dependencies['electron-updater'],
      ws: packageJson.dependencies.ws,
    },
    optionalDependencies: copiedOptionalDependencies,
    build: {
      appId: packageJson.build.appId,
      productName: packageJson.build.productName,
      executableName: packageJson.build.executableName,
      asar: packageJson.build.asar,
      artifactName: packageJson.build.artifactName,
      electronVersion: getElectronVersion(),
      directories: {
        output: '../../release/desktop',
      },
      electronLanguages: packageJson.build.electronLanguages,
      extraMetadata: {
        main: 'electron/main.js',
      },
      files: [
        'electron/**',
        'public/**',
        'dist/**',
        'dist-server/**',
        'shared/**',
        'node_modules/**',
        'package.json',
      ],
      extraResources: [
        {
          from: 'embedded-server',
          to: 'embedded-server',
          filter: ['**/*'],
        },
      ],
      protocols: packageJson.build.protocols,
      publish: getGithubPublishConfiguration(),
      mac: isInternalRelease
        ? {
            ...packageJson.build.mac,
            notarize: false,
            identity: 'CloudCLI Internal',
          }
        : packageJson.build.mac,
      win: packageJson.build.win,
      linux: packageJson.build.linux,
      nsis: packageJson.build.nsis,
    },
  };
}

await fs.rm(stageDir, { recursive: true, force: true });
await fs.mkdir(stageDir, { recursive: true });

console.log('Preparing the customized Local CloudCLI runtime for the desktop app...');
await run(process.execPath, [path.join(rootDir, 'scripts', 'release', 'build-server-bundle.js')], {
  cwd: rootDir,
  env: process.env,
});
const serverBundleName = getServerBundleName();
const serverBundlePath = path.join(rootDir, 'release', 'local-server', serverBundleName);
const targetPlatform = process.env.CLOUDCLI_BUNDLE_PLATFORM || process.platform;
const targetArch = process.env.CLOUDCLI_BUNDLE_ARCH || process.arch;
const archiveInspector = new ServerInstaller({
  buildIdentity,
  platform: targetPlatform,
  arch: targetArch,
  installRoot: path.join(rootDir, '.desktop-build', '.archive-inspection'),
});
await archiveInspector.inspectArchive(serverBundlePath);
const embeddedServerDir = path.join(stageDir, 'embedded-server');
await fs.mkdir(embeddedServerDir, { recursive: true });
await fs.copyFile(serverBundlePath, path.join(embeddedServerDir, serverBundleName));
await fs.copyFile(`${serverBundlePath}.sha256`, path.join(embeddedServerDir, `${serverBundleName}.sha256`));

// Copy the shell and web assets only after the embedded server archive is
// complete. Both artifacts therefore consume the exact same dist/build-id.txt.
await copyRequired('electron');
await copyRequired('dist');
await copyRequired('public');
await copyRequired('shared');
const stagedIdentityBytes = await fs.readFile(
  path.join(stageDir, 'dist', 'build-identity.json'),
);
if (!canonicalIdentityBytes.equals(stagedIdentityBytes)) {
  throw new Error('Desktop staging changed the canonical build identity artifact.');
}

const copiedOptionalDependencies = {};
for (const [name, version] of Object.entries(packageJson.optionalDependencies || {})) {
  const source = path.join(rootDir, 'node_modules', ...name.split('/'));
  if (await pathExists(source)) {
    copiedOptionalDependencies[name] = version;
  }
}

const copiedRuntimeDependencies = ['electron-updater', 'ws'];
const copiedRuntimeDependencyClosure = await copyRuntimeDependencyClosure({
  rootDir,
  stageDir,
  packageNames: [...copiedRuntimeDependencies, ...Object.keys(copiedOptionalDependencies)],
});

await fs.writeFile(
  path.join(stageDir, 'package.json'),
  `${JSON.stringify(buildDesktopPackageJson(copiedOptionalDependencies), null, 2)}\n`,
  'utf8',
);

console.log(`Prepared self-contained desktop app at ${path.relative(rootDir, stageDir)}`);
console.log(`Runtime dependencies: ${copiedRuntimeDependencies.join(', ')}`);
console.log(`Runtime dependency closure: ${copiedRuntimeDependencyClosure.length} packages`);
if (Object.keys(copiedOptionalDependencies).length) {
  console.log(`Optional dependencies: ${Object.keys(copiedOptionalDependencies).join(', ')}`);
}
