import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { GeneratedFile } from '@/adapters/adapter.interface.js';
import { toPosixPath } from '@/core/path-utils.js';
import type { OnboardingFileTreeEntry } from '@/core/types/onboarding.js';

export interface FileWriteResult {
  written: string[];
  skipped: string[];
}

export function writeGeneratedFiles(projectRoot: string, files: GeneratedFile[]): FileWriteResult {
  const written: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    // Always emit forward-slash paths in the result lists — these are
    // user-facing (manifest JSON, console summaries, return value to callers).
    const reportedPath = toPosixPath(file.path);
    const target = join(projectRoot, file.path);

    if (!file.autoUpdate && existsSync(target)) {
      skipped.push(reportedPath);
      continue;
    }

    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content);
    if (file.executable === true) {
      chmodSync(target, 0o755);
    }
    written.push(reportedPath);
  }

  return { written, skipped };
}

/**
 * Classify what {@link writeGeneratedFiles} *would* do for each file, without touching disk.
 *
 * Pure read-only counterpart to `writeGeneratedFiles`: it performs no `mkdirSync`,
 * `writeFileSync`, or `chmodSync`. The action mirrors the write logic exactly —
 *
 * - target missing → `create`
 * - target exists, not auto-updatable → `skip` (project-owned; the writer leaves it alone)
 * - target exists, auto-updatable, bytes identical → `skip`
 * - target exists, auto-updatable, bytes differ → `overwrite`
 *
 * `mtimeMs` is populated whenever the target exists. If a target's on-disk state cannot be
 * read (e.g. a permission error on a nested path), the entry is recorded as `skip` with a
 * `templateError` annotation and the loop continues, so one bad path never fails the whole tree.
 */
export function planGeneratedFiles(
  projectRoot: string,
  files: GeneratedFile[],
): OnboardingFileTreeEntry[] {
  const entries: OnboardingFileTreeEntry[] = [];

  for (const file of files) {
    const reportedPath = toPosixPath(file.path);
    const target = join(projectRoot, file.path);

    if (!existsSync(target)) {
      entries.push({ path: reportedPath, action: 'create' });
      continue;
    }

    try {
      const stat = statSync(target);
      const mtimeMs = stat.mtimeMs;

      if (!file.autoUpdate) {
        // The writer skips an existing non-auto-update file regardless of content.
        entries.push({ path: reportedPath, action: 'skip', mtimeMs });
        continue;
      }

      const existing = readFileSync(target);
      const action = existing.equals(Buffer.from(file.content)) ? 'skip' : 'overwrite';
      entries.push({ path: reportedPath, action, mtimeMs });
    } catch (error) {
      entries.push({
        path: reportedPath,
        action: 'skip',
        templateError: error instanceof Error ? error.message : 'unreadable target path',
      });
    }
  }

  return entries;
}
