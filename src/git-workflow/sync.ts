import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import YAML from 'yaml';

import { PATHS } from '@/core/constants/paths.js';
import { readTextIfExistsSync } from '@/core/fs/read-if-exists.js';
import { isNewerTeamFile, newerTeamFileLine, swapTeamFileStamp } from '@/core/team-file-schema.js';

import { renderDefaultGitWorkflowFile } from './defaults.js';
import { changedOutside, refreshLastAppliedHashes, stampLastApplied } from './last-applied.js';
import { gitWorkflowDir, gitWorkflowFilePath } from './load.js';
import { remoteDefaultBranch } from './onboard.js';
import { GIT_WORKFLOW_FILES, type GitWorkflowFile } from './types.js';

declare const __PKG_VERSION__: string;

export interface SyncOptions {
  version?: string;
  baseBranch?: string;
  now?: () => Date;
  notes?: string[];
}

export function syncGitWorkflowFile(text: string): string {
  const doc = YAML.parseDocument(text);
  if (doc.errors.length > 0 || !YAML.isMap(doc.contents)) return text;
  return swapTeamFileStamp(text);
}

function createFile(path: string, text: string): boolean {
  try {
    writeFileSync(path, text, { encoding: 'utf8', flag: 'wx' });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
}

export function syncGitWorkflow(projectRoot: string, options: SyncOptions = {}): string[] {
  const version = options.version ?? __PKG_VERSION__;
  const created: GitWorkflowFile[] = [];
  const swapped: GitWorkflowFile[] = [];
  const outside = changedOutside(projectRoot);
  let baseBranch = options.baseBranch;
  mkdirSync(gitWorkflowDir(projectRoot), { recursive: true });
  for (const file of GIT_WORKFLOW_FILES) {
    const path = gitWorkflowFilePath(projectRoot, file);
    let text = readTextIfExistsSync(path);
    if (text === null) {
      baseBranch ??= remoteDefaultBranch(projectRoot);
      if (createFile(path, renderDefaultGitWorkflowFile(file, { baseBranch }))) {
        created.push(file);
        continue;
      }
      text = readFileSync(path, 'utf8');
    }
    if (isNewerTeamFile(text)) {
      options.notes?.push(newerTeamFileLine(`${PATHS.GIT_WORKFLOW_DIR}/${file}`));
      continue;
    }
    const next = syncGitWorkflowFile(text);
    if (next === text) continue;
    try {
      writeFileSync(path, next, 'utf8');
      swapped.push(file);
    } catch (error) {
      options.notes?.push(
        `Couldn't write ${PATHS.GIT_WORKFLOW_DIR}/${file}: ${error instanceof Error ? error.message : 'unknown error'}. The next update tries again.`,
      );
    }
  }
  if (created.length > 0) stampLastApplied(projectRoot, created, { version, now: options.now });
  refreshLastAppliedHashes(
    projectRoot,
    swapped.filter((file) => !outside.includes(file)),
  );
  return [...created, ...swapped].map((file) => gitWorkflowFilePath(projectRoot, file));
}
