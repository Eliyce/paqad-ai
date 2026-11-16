import { realpathSync } from 'node:fs';
import { isAbsolute, join, posix, relative, resolve, sep } from 'node:path';

import { JourneyRefusal } from './errors.js';

function segments(path: string): string[] {
  return path.split(/[\\/]/u);
}

export function isCleanRepoPath(path: string): boolean {
  if (path === '' || path.includes('\\') || posix.isAbsolute(path) || isAbsolute(path)) {
    return false;
  }
  return posix.normalize(path) === path && !segments(path).some((part) => part === '..');
}

function realOrNull(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

export function normalizeOutputPath(projectRoot: string, raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') throw new JourneyRefusal('An output path is empty.');
  if (segments(trimmed).includes('..')) {
    throw new JourneyRefusal(`The output ${raw} contains ".."; name the file inside the project.`);
  }
  const root = resolve(projectRoot);
  const rel = relative(root, resolve(root, trimmed));
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new JourneyRefusal(`The output ${raw} is outside the project.`);
  }
  const clean = rel.split(sep).join('/');
  const realRoot = realOrNull(root) ?? root;
  const real = realOrNull(join(root, clean));
  if (real !== null && real !== join(realRoot, clean)) {
    throw new JourneyRefusal(
      `The output ${raw} reaches its file through a symlink; onboarding records only real files.`,
    );
  }
  return clean;
}
