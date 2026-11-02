import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import YAML from 'yaml';

import { versionAtLeast } from '@/core/version-compare.js';

import { renderDefaultGitWorkflowFile } from './defaults.js';
import { stampLastApplied } from './last-applied.js';
import { gitWorkflowDir, gitWorkflowFilePath } from './load.js';
import { remoteDefaultBranch } from './onboard.js';
import { GIT_WORKFLOW_FILES, type GitWorkflowFile } from './types.js';
import { hasPath, insertKey, readPath, setValue } from './yaml-edit.js';

declare const __PKG_VERSION__: string;

const TEAM_NAMED = new Set(['sources', 'types']);

export interface SyncOptions {
  version?: string;
  baseBranch?: string;
  now?: () => Date;
}

type Plain = Record<string, unknown>;

function isPlain(value: unknown): value is Plain {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function missingKeys(text: string, defaults: Plain, path: string[]): Array<[string[], unknown]> {
  const missing: Array<[string[], unknown]> = [];
  for (const [key, value] of Object.entries(defaults)) {
    if (key === 'paqad_version') continue;
    const here = [...path, key];
    if (!hasPath(text, here)) {
      missing.push([here, value]);
      continue;
    }
    if (isPlain(value) && !TEAM_NAMED.has(key) && isPlain(readPath(text, here))) {
      missing.push(...missingKeys(text, value, here));
    }
  }
  return missing;
}

export function isNewerThanPackage(fileVersion: unknown, running: string): boolean {
  return typeof fileVersion === 'string' && !versionAtLeast(running, fileVersion);
}

export function syncGitWorkflowFile(
  text: string,
  file: GitWorkflowFile,
  options: { version: string; baseBranch: string },
): string {
  const doc = YAML.parseDocument(text);
  if (doc.errors.length > 0 || !YAML.isMap(doc.contents)) return text;
  if (isNewerThanPackage(doc.get('paqad_version'), options.version)) return text;
  const defaults = YAML.parse(
    renderDefaultGitWorkflowFile(file, {
      version: options.version,
      baseBranch: options.baseBranch,
    }),
  ) as Plain;
  const missing = missingKeys(text, defaults, []);
  if (missing.length === 0) return text;
  let next = text;
  for (const [path, value] of missing) {
    next = insertKey(
      next,
      path.slice(0, -1),
      path[path.length - 1],
      value,
      `Added in paqad-ai ${options.version}`,
    );
  }
  return setValue(next, ['paqad_version'], options.version);
}

export function syncGitWorkflow(projectRoot: string, options: SyncOptions = {}): string[] {
  const version = options.version ?? __PKG_VERSION__;
  const written: GitWorkflowFile[] = [];
  let baseBranch = options.baseBranch;
  mkdirSync(gitWorkflowDir(projectRoot), { recursive: true });
  for (const file of GIT_WORKFLOW_FILES) {
    const path = gitWorkflowFilePath(projectRoot, file);
    if (!existsSync(path)) {
      baseBranch ??= remoteDefaultBranch(projectRoot);
      writeFileSync(path, renderDefaultGitWorkflowFile(file, { version, baseBranch }), 'utf8');
      written.push(file);
      continue;
    }
    const text = readFileSync(path, 'utf8');
    let next: string;
    try {
      next = syncGitWorkflowFile(text, file, { version, baseBranch: baseBranch ?? 'main' });
    } catch {
      continue;
    }
    if (next !== text) {
      writeFileSync(path, next, 'utf8');
      written.push(file);
    }
  }
  if (written.length > 0) stampLastApplied(projectRoot, written, { version, now: options.now });
  return written.map((file) => gitWorkflowFilePath(projectRoot, file));
}
