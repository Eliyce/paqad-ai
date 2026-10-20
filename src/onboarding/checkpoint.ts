import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { toPosixPath } from '@/core/path-utils.js';

interface OnboardingCheckpoint {
  schema_version: 1;
  written: string[];
}

export function writeOnboardingCheckpoint(projectRoot: string, writtenPaths: string[]): void {
  const target = join(projectRoot, PATHS.ONBOARDING_CHECKPOINT);
  mkdirSync(dirname(target), { recursive: true });

  const payload: OnboardingCheckpoint = {
    schema_version: 1,
    written: dedupePreservingOrder(writtenPaths.map(toPosixPath)),
  };

  const tmp = `${target}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  renameSync(tmp, target);
}

export function readOnboardingCheckpoint(projectRoot: string): string[] | null {
  const target = join(projectRoot, PATHS.ONBOARDING_CHECKPOINT);
  if (!existsSync(target)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(target, 'utf8')) as Partial<OnboardingCheckpoint>;
    if (!Array.isArray(parsed.written)) {
      return null;
    }
    return parsed.written.filter((entry): entry is string => typeof entry === 'string');
  } catch {
    return null;
  }
}

export function deleteOnboardingCheckpoint(projectRoot: string): void {
  rmSync(join(projectRoot, PATHS.ONBOARDING_CHECKPOINT), { force: true });
}

function dedupePreservingOrder(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const path of paths) {
    if (!seen.has(path)) {
      seen.add(path);
      result.push(path);
    }
  }
  return result;
}
