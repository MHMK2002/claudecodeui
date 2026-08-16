const WINDOWS_DRIVE_PATTERN = /^[A-Za-z]:\\?$/;

// Handles root edge cases for Unix-like and Windows paths.
export const getParentPath = (currentPath: string): string | null => {
  if (currentPath === '~' || currentPath === '/' || WINDOWS_DRIVE_PATTERN.test(currentPath)) {
    return null;
  }

  const lastSeparatorIndex = Math.max(currentPath.lastIndexOf('/'), currentPath.lastIndexOf('\\'));
  if (lastSeparatorIndex <= 0) {
    return '/';
  }

  if (lastSeparatorIndex === 2 && /^[A-Za-z]:/.test(currentPath)) {
    return `${currentPath.slice(0, 2)}\\`;
  }

  return currentPath.slice(0, lastSeparatorIndex);
};

export const joinFolderPath = (basePath: string, folderName: string): string => {
  const normalizedBasePath = basePath.trim().replace(/[\\/]+$/, '');
  const separator =
    normalizedBasePath.includes('\\') && !normalizedBasePath.includes('/') ? '\\' : '/';
  return `${normalizedBasePath}${separator}${folderName.trim()}`;
};
