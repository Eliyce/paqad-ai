import { PATHS } from '@/core/constants/paths.js';
import { isNewerTeamFile, newerTeamFileLine } from '@/core/team-file-schema.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { renderDefaultGitWorkflowFile } from './defaults.js';
import { unifiedDiff } from './diff.js';
import { stampLastApplied } from './last-applied.js';
import {
  gitWorkflowDir,
  gitWorkflowFilePath,
  readGitWorkflowContents,
  resolveGitWorkflow,
  type GitWorkflowContents,
} from './load.js';
import { remoteDefaultBranch } from './onboard.js';
import { GIT_WORKFLOW_FILES, type GitWorkflowFile, type GitWorkflowIssue } from './types.js';
import { removeKey, setValue } from './yaml-edit.js';

export interface GitWorkflowEdit {
  file: GitWorkflowFile;
  path: string[];
  value: unknown;
}

export interface ChangeOutcome {
  diff: string;
  valid: boolean;
  errors: GitWorkflowIssue[];
  warnings: GitWorkflowIssue[];
}

export class GitWorkflowInputError extends Error {}

const TEAM_NAMED: Readonly<Partial<Record<GitWorkflowFile, string>>> = {
  'branches.yaml': 'types',
  'tickets.yaml': 'sources',
};

export function isTeamNamedEntry(file: GitWorkflowFile, path: readonly string[]): boolean {
  return path.length === 2 && TEAM_NAMED[file] === path[0];
}

export function parseEdits(raw: unknown): GitWorkflowEdit[] {
  const edits = (raw as { edits?: unknown } | null)?.edits;
  if (!Array.isArray(edits)) throw new GitWorkflowInputError('change.json needs an "edits" list.');
  return edits.map((entry, index) => {
    const edit = entry as Partial<GitWorkflowEdit> | null;
    const where = `edits[${index}]`;
    if (!edit || !GIT_WORKFLOW_FILES.includes(edit.file as GitWorkflowFile)) {
      throw new GitWorkflowInputError(
        `${where}.file must be one of: ${GIT_WORKFLOW_FILES.join(', ')}.`,
      );
    }
    if (
      !Array.isArray(edit.path) ||
      edit.path.length === 0 ||
      !edit.path.every((part) => typeof part === 'string' && part !== '')
    ) {
      throw new GitWorkflowInputError(`${where}.path must be a non-empty list of keys.`);
    }
    if (!('value' in edit)) throw new GitWorkflowInputError(`${where}.value is missing.`);
    if (edit.path[0] === 'schema_version' || edit.path[0] === 'paqad_version') {
      throw new GitWorkflowInputError(
        `${where}: ${edit.path[0]} is set by paqad, not by a change.`,
      );
    }
    if (edit.value === null && !isTeamNamedEntry(edit.file as GitWorkflowFile, edit.path)) {
      throw new GitWorkflowInputError(
        `${where}: value null only removes a branch type or a ticket source. ${edit.file} ${edit.path.join('.')} can't be removed.`,
      );
    }
    return { file: edit.file as GitWorkflowFile, path: edit.path, value: edit.value };
  });
}

export function currentContents(projectRoot: string): GitWorkflowContents {
  const present = readGitWorkflowContents(projectRoot);
  const base = remoteDefaultBranch(projectRoot);
  const out: GitWorkflowContents = {};
  for (const file of GIT_WORKFLOW_FILES) {
    out[file] = present[file] ?? renderDefaultGitWorkflowFile(file, { baseBranch: base });
  }
  return out;
}

export function applyEdits(
  contents: GitWorkflowContents,
  edits: readonly GitWorkflowEdit[],
): GitWorkflowContents {
  const next: GitWorkflowContents = { ...contents };
  for (const edit of edits) {
    const text = next[edit.file] ?? '';
    try {
      if (edit.value === null) {
        next[edit.file] = removeKey(text, edit.path);
      } else {
        next[edit.file] = setValue(text, edit.path, edit.value);
      }
    } catch (error) {
      throw new GitWorkflowInputError(
        `${edit.file} ${edit.path.join('.')}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return next;
}

export function diffContents(
  before: GitWorkflowContents,
  after: GitWorkflowContents,
  present: GitWorkflowContents = before,
): string {
  return GIT_WORKFLOW_FILES.map((file) =>
    unifiedDiff(
      file,
      present[file] === undefined ? null : (before[file] ?? null),
      after[file] ?? '',
    ),
  ).join('');
}

export function changedFiles(
  before: GitWorkflowContents,
  after: GitWorkflowContents,
): GitWorkflowFile[] {
  return GIT_WORKFLOW_FILES.filter((file) => before[file] !== after[file]);
}

export function validate(contents: GitWorkflowContents): Omit<ChangeOutcome, 'diff'> {
  const result = resolveGitWorkflow(contents);
  return { valid: result.valid, errors: result.errors, warnings: result.warnings };
}

export function writeContents(
  projectRoot: string,
  contents: GitWorkflowContents,
  files: readonly GitWorkflowFile[],
): void {
  mkdirSync(gitWorkflowDir(projectRoot), { recursive: true });
  for (const file of files) {
    const text = contents[file];
    if (text !== undefined) writeFileSync(gitWorkflowFilePath(projectRoot, file), text, 'utf8');
  }
  stampLastApplied(projectRoot, files);
}

export function planChange(projectRoot: string, edits: readonly GitWorkflowEdit[]): ChangeOutcome {
  const present = readGitWorkflowContents(projectRoot);
  const before = currentContents(projectRoot);
  const after = applyEdits(before, edits);
  return { diff: diffContents(before, after, present), ...validate(after) };
}

export function applyChange(
  projectRoot: string,
  edits: readonly GitWorkflowEdit[],
): ChangeOutcome & { written: GitWorkflowFile[] } {
  const present = readGitWorkflowContents(projectRoot);
  const before = currentContents(projectRoot);
  const after = applyEdits(before, edits);
  const outcome = { diff: diffContents(before, after, present), ...validate(after) };
  if (!outcome.valid) return { ...outcome, written: [] };
  const written = GIT_WORKFLOW_FILES.filter(
    (file) => present[file] === undefined || before[file] !== after[file],
  );
  const newer = written.filter((file) => isNewerTeamFile(present[file] ?? ''));
  if (newer.length > 0) {
    return {
      ...outcome,
      valid: false,
      errors: [
        ...outcome.errors,
        ...newer.map((file) => ({
          file,
          path: '',
          message: newerTeamFileLine(`${PATHS.GIT_WORKFLOW_DIR}/${file}`),
        })),
      ],
      written: [],
    };
  }
  writeContents(projectRoot, after, written);
  return { ...outcome, written };
}

export function readJsonFile(path: string): unknown {
  if (!existsSync(path)) throw new GitWorkflowInputError(`${path} doesn't exist.`);
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (error) {
    throw new GitWorkflowInputError(
      `${path} isn't valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
