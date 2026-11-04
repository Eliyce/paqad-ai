import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { gitWorkflowDir, gitWorkflowFilePath } from './load.js';
import { GIT_WORKFLOW_FILES, type GitWorkflowFile } from './types.js';

declare const __PKG_VERSION__: string;

export const LAST_APPLIED_FILE = '.last-applied.json';

export interface LastApplied {
  applied_at: string;
  paqad_version: string;
  files: Partial<Record<GitWorkflowFile, string>>;
}

export function lastAppliedPath(projectRoot: string): string {
  return join(gitWorkflowDir(projectRoot), LAST_APPLIED_FILE);
}

export function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function readLastApplied(projectRoot: string): LastApplied | null {
  try {
    const parsed = JSON.parse(readFileSync(lastAppliedPath(projectRoot), 'utf8')) as LastApplied;
    return parsed && typeof parsed.files === 'object' && parsed.files !== null ? parsed : null;
  } catch {
    return null;
  }
}

function currentHash(projectRoot: string, file: GitWorkflowFile): string | null {
  const path = gitWorkflowFilePath(projectRoot, file);
  return existsSync(path) ? hashText(readFileSync(path, 'utf8')) : null;
}

export interface StampOptions {
  now?: () => Date;
  version?: string;
}

export function stampLastApplied(
  projectRoot: string,
  files: readonly GitWorkflowFile[] = GIT_WORKFLOW_FILES,
  options: StampOptions = {},
): string {
  const previous = readLastApplied(projectRoot);
  const hashes: Partial<Record<GitWorkflowFile, string>> = { ...(previous?.files ?? {}) };
  for (const file of files) {
    const hash = currentHash(projectRoot, file);
    if (hash === null) delete hashes[file];
    else hashes[file] = hash;
  }
  const record: LastApplied = {
    applied_at: (options.now ?? (() => new Date()))().toISOString(),
    paqad_version: options.version ?? __PKG_VERSION__,
    files: Object.fromEntries(
      GIT_WORKFLOW_FILES.filter((file) => hashes[file] !== undefined).map((file) => [
        file,
        hashes[file],
      ]),
    ),
  };
  const path = lastAppliedPath(projectRoot);
  mkdirSync(gitWorkflowDir(projectRoot), { recursive: true });
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return path;
}

export function changedOutside(projectRoot: string): GitWorkflowFile[] {
  const record = readLastApplied(projectRoot);
  return GIT_WORKFLOW_FILES.filter((file) => {
    const hash = currentHash(projectRoot, file);
    if (hash === null) return false;
    return record?.files[file] !== hash;
  });
}

export function refreshLastAppliedHashes(
  projectRoot: string,
  files: readonly GitWorkflowFile[],
): void {
  const record = readLastApplied(projectRoot);
  if (record === null || files.length === 0) return;
  const hashes = { ...record.files };
  for (const file of files) {
    const hash = currentHash(projectRoot, file);
    if (hash !== null) hashes[file] = hash;
  }
  writeFileSync(
    lastAppliedPath(projectRoot),
    `${JSON.stringify({ ...record, files: hashes }, null, 2)}\n`,
    'utf8',
  );
}
