import { isAbsolute, relative, resolve, sep } from 'node:path';

export function toPosixPath(path: string): string {
  return path.split(sep).join('/');
}

/**
 * A path for text an agent runs or a host matches, with forward slashes on
 * every OS. Unlike toPosixPath it converts backslashes whatever the running
 * OS, and keeps a Windows drive letter, so `C:\paqad` reads `C:/paqad`.
 */
export function toSlashPath(path: string): string {
  return path.replace(/\\/gu, '/');
}

export function stripTrailingChars(value: string, chars: string): string {
  let end = value.length;
  while (end > 0 && chars.includes(value[end - 1]!)) {
    end -= 1;
  }
  return end === value.length ? value : value.slice(0, end);
}

export function trimEdgeChars(value: string, chars: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && chars.includes(value[start]!)) {
    start += 1;
  }
  while (end > start && chars.includes(value[end - 1]!)) {
    end -= 1;
  }
  return start === 0 && end === value.length ? value : value.slice(start, end);
}

export function toProjectRelativePath(projectRoot: string, path: string): string | null {
  const root = resolve(projectRoot);
  const relativePath = relative(root, resolve(root, path));
  if (
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    return null;
  }
  return toPosixPath(relativePath);
}
