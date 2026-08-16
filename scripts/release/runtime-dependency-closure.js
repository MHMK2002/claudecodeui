import fs from 'node:fs/promises';
import path from 'node:path';

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function packagePathParts(packageName) {
  const parts = packageName.split('/').filter(Boolean);
  if (parts.length === 0 || parts.length > 2 || (packageName.startsWith('@') && parts.length !== 2)) {
    throw new Error(`Invalid runtime package name: ${packageName}`);
  }
  return parts;
}

async function resolveInstalledPackage(packageName, fromDirectory, nodeModulesRoot) {
  const parts = packagePathParts(packageName);
  let searchDirectory = path.resolve(fromDirectory);
  const resolvedNodeModulesRoot = path.resolve(nodeModulesRoot);

  while (true) {
    const candidate = path.join(searchDirectory, 'node_modules', ...parts);
    if (await pathExists(path.join(candidate, 'package.json'))) {
      const relative = path.relative(resolvedNodeModulesRoot, path.resolve(candidate));
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`Runtime dependency resolved outside node_modules: ${packageName}`);
      }
      return candidate;
    }

    const parent = path.dirname(searchDirectory);
    if (parent === searchDirectory) break;
    searchDirectory = parent;
  }

  return null;
}

export async function copyRuntimeDependencyClosure({ rootDir, stageDir, packageNames }) {
  const realRootDir = await fs.realpath(rootDir);
  const nodeModulesRoot = path.join(realRootDir, 'node_modules');
  const visited = new Set();
  const copied = [];

  async function visit(packageName, fromDirectory, optional = false) {
    const sourceDirectory = await resolveInstalledPackage(packageName, fromDirectory, nodeModulesRoot);
    if (!sourceDirectory) {
      if (optional) return;
      throw new Error(`Required desktop dependency is missing from node_modules: ${packageName}`);
    }

    const realSourceDirectory = await fs.realpath(sourceDirectory);
    const relativeDirectory = path.relative(realRootDir, realSourceDirectory);
    if (!relativeDirectory.startsWith('node_modules' + path.sep)) {
      throw new Error(`Runtime dependency escaped the project node_modules tree: ${packageName}`);
    }
    if (visited.has(realSourceDirectory)) return;
    visited.add(realSourceDirectory);

    const packageJson = JSON.parse(
      await fs.readFile(path.join(realSourceDirectory, 'package.json'), 'utf8'),
    );
    const targetDirectory = path.join(stageDir, relativeDirectory);
    await fs.mkdir(path.dirname(targetDirectory), { recursive: true });
    await fs.cp(realSourceDirectory, targetDirectory, { recursive: true });
    copied.push({
      name: packageJson.name || packageName,
      version: packageJson.version || null,
      relativeDirectory,
    });

    for (const dependencyName of Object.keys(packageJson.dependencies || {})) {
      await visit(dependencyName, realSourceDirectory, false);
    }
    for (const dependencyName of Object.keys(packageJson.optionalDependencies || {})) {
      await visit(dependencyName, realSourceDirectory, true);
    }
  }

  for (const packageName of packageNames) {
    await visit(packageName, realRootDir, false);
  }

  return copied.sort((first, second) => first.relativeDirectory.localeCompare(second.relativeDirectory));
}
