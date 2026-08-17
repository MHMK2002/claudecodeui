import assert from 'node:assert/strict';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createFileTreeService } from '@/modules/file-tree/file-tree.service.js';
import type {
  FileTreeDirectoryEntry,
  FileTreeFileSystem,
  FileTreeServiceDependencies,
  FileTreeStats,
} from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

function createDirectoryEntry(name: string, directory: boolean): FileTreeDirectoryEntry {
  return {
    name,
    isDirectory: () => directory,
  };
}

function createStats(directory: boolean, mode: number): FileTreeStats {
  return {
    size: directory ? 0 : 24,
    mtime: new Date('2026-01-02T03:04:05.000Z'),
    mode,
    isDirectory: () => directory,
    isSymbolicLink: () => false,
  };
}

function createFakeFileSystem(
  overrides: Partial<FileTreeFileSystem> = {},
): FileTreeFileSystem {
  const unexpectedOperation = async (): Promise<never> => {
    throw new Error('Unexpected File Tree filesystem operation');
  };

  return {
    access: unexpectedOperation,
    stat: unexpectedOperation,
    lstat: unexpectedOperation,
    readdir: unexpectedOperation,
    realpath: unexpectedOperation,
    readTextFile: unexpectedOperation,
    writeTextFile: unexpectedOperation,
    makeDirectory: unexpectedOperation,
    rename: unexpectedOperation,
    removeDirectory: unexpectedOperation,
    unlink: unexpectedOperation,
    copyFile: unexpectedOperation,
    createReadStream: () => Readable.from([]),
    ...overrides,
  };
}

function createDependencies(
  fileSystem: FileTreeFileSystem,
  projectRoot: string,
): FileTreeServiceDependencies {
  return {
    fileSystem,
    projects: {
      getProjectPathById: async () => projectRoot,
    },
    workspace: {
      rootPath: projectRoot,
      validatePath: async (candidatePath) => ({ valid: true, resolvedPath: candidatePath }),
    },
    resolveMimeType: () => 'text/plain',
    fileSystemConcurrency: 4,
    logger: { error: () => undefined },
  };
}

test('listProjectFiles builds a sorted tree and skips generated directories', async () => {
  const projectRoot = path.resolve('file-tree-test-project');
  const sourceDirectory = path.join(projectRoot, 'src');
  const fileSystem = createFakeFileSystem({
    access: async () => undefined,
    readdir: async (directoryPath) => {
      if (directoryPath === projectRoot) {
        return [
          createDirectoryEntry('node_modules', true),
          createDirectoryEntry('README.md', false),
          createDirectoryEntry('src', true),
        ];
      }
      if (directoryPath === sourceDirectory) {
        return [createDirectoryEntry('index.ts', false)];
      }
      return [];
    },
    lstat: async (candidatePath) => createStats(candidatePath === sourceDirectory, 0o754),
  });
  const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

  const tree = await service.listProjectFiles('project-1');

  assert.deepEqual(tree.map((entry) => entry.name), ['src', 'README.md']);
  const sourceEntry = tree[0];
  assert.ok(sourceEntry);
  assert.equal(sourceEntry.type, 'directory');
  assert.equal(sourceEntry.permissions, '754');
  assert.equal(sourceEntry.permissionsRwx, 'rwxr-xr--');
  assert.deepEqual(sourceEntry.children?.map((entry) => entry.name), ['index.ts']);
});

test('listProjectFiles excludes gitignored entries only when requested', async () => {
  const projectRoot = path.resolve('file-tree-test-project');
  const cacheDirectory = path.join(projectRoot, 'cache');
  const sourceDirectory = path.join(projectRoot, 'src');
  const readDirectories: string[] = [];
  const fileSystem = createFakeFileSystem({
    access: async () => undefined,
    readTextFile: async (filePath) => {
      assert.equal(filePath, path.join(projectRoot, '.gitignore'));
      return ['*.log', '!keep.log', 'cache/', 'src/generated.ts'].join('\n');
    },
    readdir: async (directoryPath) => {
      readDirectories.push(directoryPath);
      if (directoryPath === projectRoot) {
        return [
          createDirectoryEntry('.gitignore', false),
          createDirectoryEntry('cache', true),
          createDirectoryEntry('ignored.log', false),
          createDirectoryEntry('keep.log', false),
          createDirectoryEntry('src', true),
        ];
      }
      if (directoryPath === cacheDirectory) {
        return [createDirectoryEntry('cached.txt', false)];
      }
      if (directoryPath === sourceDirectory) {
        return [
          createDirectoryEntry('generated.ts', false),
          createDirectoryEntry('index.ts', false),
        ];
      }
      return [];
    },
    lstat: async (candidatePath) => createStats(
      candidatePath === cacheDirectory || candidatePath === sourceDirectory,
      0o644,
    ),
  });
  const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

  const tree = await service.listProjectFiles('project-1', { respectGitignore: true });

  assert.deepEqual(tree.map((entry) => entry.name), ['src', '.gitignore', 'keep.log']);
  assert.deepEqual(tree[0]?.children?.map((entry) => entry.name), ['index.ts']);
  assert.equal(readDirectories.includes(cacheDirectory), false);
});

test('listProjectFiles returns the normal tree when no gitignore exists', async () => {
  const projectRoot = path.resolve('file-tree-test-project');
  const fileSystem = createFakeFileSystem({
    access: async () => undefined,
    readTextFile: async () => {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    },
    readdir: async (directoryPath) => directoryPath === projectRoot
      ? [createDirectoryEntry('debug.log', false)]
      : [],
    lstat: async () => createStats(false, 0o644),
  });
  const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

  const tree = await service.listProjectFiles('project-1', { respectGitignore: true });

  assert.deepEqual(tree.map((entry) => entry.name), ['debug.log']);
});

test('listProjectFiles distinguishes project permission failure from a missing folder', async () => {
  const projectRoot = path.resolve('file-tree-permission-project');
  const fileSystem = createFakeFileSystem({
    access: async () => {
      throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
    },
  });
  const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

  await assert.rejects(service.listProjectFiles('project-1'), (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.statusCode, 403);
    assert.equal(error.code, 'EACCES');
    assert.match(error.message, /Permission denied/);
    return true;
  });
});

test('listProjectFiles does not turn a root readdir permission failure into an empty folder', async () => {
  const projectRoot = path.resolve('file-tree-root-readdir-permission-project');
  const fileSystem = createFakeFileSystem({
    access: async () => undefined,
    readdir: async () => {
      throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
    },
  });
  const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

  await assert.rejects(service.listProjectFiles('project-1'), (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.statusCode, 403);
    assert.equal(error.code, 'EACCES');
    return true;
  });
});

test('listProjectFiles does not turn an unexpected root readdir failure into an empty folder', async () => {
  const projectRoot = path.resolve('file-tree-root-readdir-server-project');
  const fileSystem = createFakeFileSystem({
    access: async () => undefined,
    readdir: async () => {
      throw Object.assign(new Error('input/output failure'), { code: 'EIO' });
    },
  });
  const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

  await assert.rejects(
    service.listProjectFiles('project-1'),
    (error: unknown) => typeof error === 'object'
      && error !== null
      && 'code' in error
      && error.code === 'EIO',
  );
});

test('listProjectFiles does not turn a nested readdir permission failure into empty children', async () => {
  const projectRoot = path.resolve('file-tree-nested-readdir-permission-project');
  const privateDirectory = path.join(projectRoot, 'private');
  const fileSystem = createFakeFileSystem({
    access: async () => undefined,
    readdir: async (directoryPath) => {
      if (directoryPath === projectRoot) return [createDirectoryEntry('private', true)];
      assert.equal(directoryPath, privateDirectory);
      throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
    },
    lstat: async () => createStats(true, 0o700),
  });
  const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

  await assert.rejects(service.listProjectFiles('project-1'), (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.statusCode, 403);
    assert.equal(error.code, 'EACCES');
    return true;
  });
});

test('listProjectFiles does not turn a nested server failure into empty children', async () => {
  const projectRoot = path.resolve('file-tree-nested-readdir-server-project');
  const fileSystem = createFakeFileSystem({
    access: async () => undefined,
    readdir: async (directoryPath) => {
      if (directoryPath === projectRoot) return [createDirectoryEntry('unstable', true)];
      throw Object.assign(new Error('input/output failure'), { code: 'EIO' });
    },
    lstat: async () => createStats(true, 0o755),
  });
  const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

  await assert.rejects(
    service.listProjectFiles('project-1'),
    (error: unknown) => typeof error === 'object'
      && error !== null
      && 'code' in error
      && error.code === 'EIO',
  );
});

test('readTextFile rejects traversal before invoking the filesystem adapter', async () => {
  const projectRoot = path.resolve('file-tree-test-project');
  const readPaths: string[] = [];
  const fileSystem = createFakeFileSystem({
    readTextFile: async (filePath) => {
      readPaths.push(filePath);
      return 'should not be read';
    },
  });
  const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

  await assert.rejects(
    service.readTextFile('project-1', '../secret.txt'),
    (error: unknown) => error instanceof AppError
      && error.code === 'PATH_OUTSIDE_PROJECT'
      && error.statusCode === 403,
  );
  assert.deepEqual(readPaths, []);
});

test('createEntry performs filesystem mutation only through the injected adapter', async () => {
  const projectRoot = path.resolve('file-tree-test-project');
  const targetPath = path.join(projectRoot, 'notes.txt');
  const writtenFiles: Array<{ filePath: string; content: string }> = [];
  const fileSystem = createFakeFileSystem({
    access: async (candidatePath) => {
      if (candidatePath === targetPath) {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      }
    },
    writeTextFile: async (filePath, content) => {
      writtenFiles.push({ filePath, content });
    },
  });
  const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

  const result = await service.createEntry({
    projectId: 'project-1',
    parentPath: projectRoot,
    type: 'file',
    name: 'notes.txt',
  });

  assert.equal(result.path, targetPath);
  assert.deepEqual(writtenFiles, [{ filePath: targetPath, content: '' }]);
});

test('storeUploadedFiles reports partial success when a later file copy fails', async () => {
  const projectRoot = path.resolve('file-tree-upload-project');
  const firstTemporaryPath = path.resolve('temporary-upload-one');
  const secondTemporaryPath = path.resolve('temporary-upload-two');
  const copiedDestinations: string[] = [];
  const removedTemporaryFiles: string[] = [];
  const fileSystem = createFakeFileSystem({
    access: async () => undefined,
    realpath: async (candidatePath) => candidatePath,
    copyFile: async (_sourcePath, destinationPath) => {
      if (destinationPath.endsWith('two.txt')) {
        throw Object.assign(new Error('copy failed'), { code: 'EIO' });
      }
      copiedDestinations.push(destinationPath);
    },
    unlink: async (temporaryPath) => {
      removedTemporaryFiles.push(temporaryPath);
    },
  });
  const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

  const result = await service.storeUploadedFiles({
    projectId: 'project-1',
    targetPath: '',
    relativePaths: ['one.txt', 'two.txt'],
    requestedFileCount: 2,
    files: [
      {
        originalName: 'one.txt',
        temporaryPath: firstTemporaryPath,
        size: 3,
        mimeType: 'text/plain',
      },
      {
        originalName: 'two.txt',
        temporaryPath: secondTemporaryPath,
        size: 3,
        mimeType: 'text/plain',
      },
    ],
  });

  assert.equal(result.uploadedCount, 1);
  assert.equal(result.requestedFileCount, 2);
  assert.equal(result.status, 'partial');
  assert.equal(result.success, false);
  assert.deepEqual(result.failures, [{
    name: 'two.txt',
    code: 'EIO',
    message: 'This file could not be written.',
  }]);
  assert.deepEqual(copiedDestinations, [path.join(projectRoot, 'one.txt')]);
  assert.ok(removedTemporaryFiles.includes(firstTemporaryPath));
  assert.ok(removedTemporaryFiles.includes(secondTemporaryPath));
});

test('storeUploadedFiles rejects duplicate destinations before copying any file', async () => {
  const projectRoot = path.resolve('file-tree-duplicate-upload-project');
  const copiedDestinations: string[] = [];
  const removedTemporaryFiles: string[] = [];
  const fileSystem = createFakeFileSystem({
    access: async () => undefined,
    realpath: async (candidatePath) => candidatePath,
    copyFile: async (_sourcePath, destinationPath) => {
      copiedDestinations.push(destinationPath);
    },
    unlink: async (temporaryPath) => {
      removedTemporaryFiles.push(temporaryPath);
    },
  });
  const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

  await assert.rejects(
    service.storeUploadedFiles({
      projectId: 'project-1',
      targetPath: '',
      relativePaths: ['Same.txt', 'same.txt'],
      requestedFileCount: 2,
      files: [
        {
          originalName: 'Same.txt',
          temporaryPath: '/tmp/upload-one',
          size: 3,
          mimeType: 'text/plain',
        },
        {
          originalName: 'same.txt',
          temporaryPath: '/tmp/upload-two',
          size: 3,
          mimeType: 'text/plain',
        },
      ],
    }),
    (error: unknown) => error instanceof AppError
      && error.code === 'UPLOAD_DUPLICATE_PATH'
      && error.statusCode === 400,
  );

  assert.deepEqual(copiedDestinations, []);
  assert.deepEqual(removedTemporaryFiles.sort(), ['/tmp/upload-one', '/tmp/upload-two']);
});

test('storeUploadedFiles rejects a symlinked destination parent before copying', async () => {
  const projectRoot = path.resolve('file-tree-symlink-upload-project');
  const aliasDirectory = path.join(projectRoot, 'alias');
  const realDirectory = path.join(projectRoot, 'real');
  const copiedDestinations: string[] = [];
  const fileSystem = createFakeFileSystem({
    access: async () => undefined,
    realpath: async (candidatePath) => {
      if (candidatePath === aliasDirectory) return realDirectory;
      if (
        candidatePath === path.join(aliasDirectory, 'same.txt')
        || candidatePath === path.join(realDirectory, 'same.txt')
      ) {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      }
      return candidatePath;
    },
    copyFile: async (_sourcePath, destinationPath) => {
      copiedDestinations.push(destinationPath);
    },
    unlink: async () => undefined,
  });
  const service = createFileTreeService(createDependencies(fileSystem, projectRoot));

  await assert.rejects(
    service.storeUploadedFiles({
      projectId: 'project-1',
      targetPath: '',
      relativePaths: ['alias/same.txt', 'real/same.txt'],
      requestedFileCount: 2,
      files: [
        {
          originalName: 'same.txt',
          temporaryPath: '/tmp/alias-upload',
          size: 3,
          mimeType: 'text/plain',
        },
        {
          originalName: 'same.txt',
          temporaryPath: '/tmp/real-upload',
          size: 3,
          mimeType: 'text/plain',
        },
      ],
    }),
    (error: unknown) => error instanceof AppError
      && error.code === 'UPLOAD_SYMLINK_PATH'
      && error.statusCode === 400,
  );

  assert.deepEqual(copiedDestinations, []);
});

test('browseWorkspace lists folders without descending into protected children', async () => {
  const workspaceRoot = path.resolve('file-tree-browse-workspace');
  const trashDirectory = path.join(workspaceRoot, '.Trash');
  const readDirectories: string[] = [];
  const fileSystem = createFakeFileSystem({
    access: async () => undefined,
    stat: async () => createStats(true, 0o755),
    realpath: async (candidatePath) => candidatePath,
    readdir: async (directoryPath) => {
      readDirectories.push(directoryPath);
      if (directoryPath === workspaceRoot) {
        return [
          createDirectoryEntry('.Trash', true),
          createDirectoryEntry('notes.md', false),
          createDirectoryEntry('Projects', true),
        ];
      }
      throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
    },
    lstat: async (candidatePath) => createStats(candidatePath !== path.join(workspaceRoot, 'notes.md'), 0o700),
  });
  const service = createFileTreeService(createDependencies(fileSystem, workspaceRoot));

  const result = await service.browseWorkspace('~');

  assert.equal(result.path, workspaceRoot);
  assert.deepEqual(result.suggestions.map((entry) => entry.name), ['Projects', '.Trash']);
  assert.deepEqual(readDirectories, [workspaceRoot]);
  assert.equal(readDirectories.includes(trashDirectory), false);
});

test('browseWorkspace reports a permission failure for an unreadable folder', async () => {
  const workspaceRoot = path.resolve('file-tree-browse-permission-workspace');
  const fileSystem = createFakeFileSystem({
    access: async () => undefined,
    stat: async () => createStats(true, 0o700),
    realpath: async (candidatePath) => candidatePath,
    readdir: async () => {
      throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
    },
  });
  const service = createFileTreeService(createDependencies(fileSystem, workspaceRoot));

  await assert.rejects(service.browseWorkspace(path.join(workspaceRoot, '.Trash')), (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.statusCode, 403);
    assert.equal(error.code, 'EPERM');
    assert.match(error.message, /Permission denied/);
    return true;
  });
});
