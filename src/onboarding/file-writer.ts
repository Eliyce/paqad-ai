import {
  chmodSync,
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import type { GeneratedFile } from '@/adapters/adapter.interface.js';
import { toPosixPath } from '@/core/path-utils.js';
import type { OnboardingFileTreeEntry } from '@/core/types/onboarding.js';

export interface FileWriteResult {
  written: string[];
  skipped: string[];
}

export interface WriteGeneratedFilesOptions {
  forceOverwrite?: boolean;
}

export function writeGeneratedFiles(
  projectRoot: string,
  files: GeneratedFile[],
  options: WriteGeneratedFilesOptions = {},
): FileWriteResult {
  const written: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    const reportedPath = toPosixPath(file.path);
    const target = join(projectRoot, file.path);

    if (!options.forceOverwrite && !file.autoUpdate && existsSync(target)) {
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

export function planGeneratedFiles(
  projectRoot: string,
  files: GeneratedFile[],
): OnboardingFileTreeEntry[] {
  const entries: OnboardingFileTreeEntry[] = [];

  for (const file of files) {
    const reportedPath = toPosixPath(file.path);
    const target = join(projectRoot, file.path);

    let fd: number;
    try {
      fd = openSync(target, 'r');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        entries.push({ path: reportedPath, action: 'create' });
      } else {
        entries.push({
          path: reportedPath,
          action: 'skip',
          templateError: error instanceof Error ? error.message : 'unreadable target path',
        });
      }
      continue;
    }

    try {
      const mtimeMs = fstatSync(fd).mtimeMs;

      if (!file.autoUpdate) {
        entries.push({ path: reportedPath, action: 'skip', mtimeMs });
        continue;
      }

      const existing = readFileSync(fd);
      const action = existing.equals(Buffer.from(file.content)) ? 'skip' : 'overwrite';
      entries.push({ path: reportedPath, action, mtimeMs });
    } catch (error) {
      entries.push({
        path: reportedPath,
        action: 'skip',
        templateError: error instanceof Error ? error.message : 'unreadable target path',
      });
    } finally {
      closeSync(fd);
    }
  }

  return entries;
}
