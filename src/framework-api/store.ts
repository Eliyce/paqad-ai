import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

import { validateFrameworkApiIndex } from './schema.js';
import type { FrameworkApiIndex } from './types.js';

export function frameworkApiIndexPath(projectRoot: string): string {
  return join(projectRoot, PATHS.FRAMEWORK_API_INDEX);
}

export function writeFrameworkApiIndex(projectRoot: string, index: FrameworkApiIndex): string {
  const target = frameworkApiIndexPath(projectRoot);
  mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, JSON.stringify(index, null, 2) + '\n', 'utf8');
  renameSync(tmp, target);
  return target;
}

export function readFrameworkApiIndex(projectRoot: string): FrameworkApiIndex | null {
  try {
    const parsed = JSON.parse(readFileSync(frameworkApiIndexPath(projectRoot), 'utf8')) as unknown;
    return validateFrameworkApiIndex(parsed).valid ? (parsed as FrameworkApiIndex) : null;
  } catch {
    return null;
  }
}
