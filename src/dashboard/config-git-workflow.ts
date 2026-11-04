import { isNewerTeamFile, newerTeamFileLine } from '@/core/team-file-schema.js';
import { PATHS } from '@/core/constants/paths.js';
import { stampLastApplied, changedOutside } from '@/git-workflow/last-applied.js';
import {
  GIT_WORKFLOW_SCHEMAS,
  loadGitWorkflow,
  readGitWorkflowContents,
  resolveGitWorkflow,
} from '@/git-workflow/load.js';
import {
  GIT_WORKFLOW_FILES,
  type GitWorkflowFile,
  type GitWorkflowIssue,
  type ResolvedGitWorkflow,
} from '@/git-workflow/types.js';

import { readManagedFile, writeManagedFile } from './write-pipeline.js';

export const GIT_WORKFLOW_WRITE_ACTION = 'dashboard.config.git-workflow.write';

export class GitWorkflowValidationError extends Error {
  readonly issues: GitWorkflowIssue[];

  constructor(message: string, issues: GitWorkflowIssue[]) {
    super(message);
    this.name = 'GitWorkflowValidationError';
    this.issues = issues;
  }
}

export class UnknownGitWorkflowFileError extends Error {
  constructor(name: string) {
    super(`${name} isn't a git-workflow file. Use one of: ${GIT_WORKFLOW_FILES.join(', ')}.`);
    this.name = 'UnknownGitWorkflowFileError';
  }
}

export interface GitWorkflowFileEntry {
  name: GitWorkflowFile;
  path: string;
  exists: boolean;
  content: string | null;
  hash: string | null;
}

export interface GitWorkflowConfig {
  files: GitWorkflowFileEntry[];
  resolved: ResolvedGitWorkflow;
  errors: GitWorkflowIssue[];
  warnings: GitWorkflowIssue[];
  changedOutside: GitWorkflowFile[];
  schemas: Record<GitWorkflowFile, Record<string, unknown>>;
}

export function gitWorkflowRelativePath(file: GitWorkflowFile): string {
  return `${PATHS.GIT_WORKFLOW_DIR}/${file}`;
}

export function isGitWorkflowFile(name: string): name is GitWorkflowFile {
  return (GIT_WORKFLOW_FILES as readonly string[]).includes(name);
}

export function getGitWorkflowConfig(projectRoot: string): GitWorkflowConfig {
  const loaded = loadGitWorkflow(projectRoot);
  return {
    files: GIT_WORKFLOW_FILES.map((name) => ({
      name,
      ...readManagedFile(projectRoot, gitWorkflowRelativePath(name)),
    })),
    resolved: loaded.config,
    errors: loaded.errors,
    warnings: loaded.warnings,
    changedOutside: changedOutside(projectRoot),
    schemas: Object.fromEntries(
      GIT_WORKFLOW_FILES.map((name) => [
        name,
        GIT_WORKFLOW_SCHEMAS[name] as Record<string, unknown>,
      ]),
    ) as Record<GitWorkflowFile, Record<string, unknown>>,
  };
}

export interface PutGitWorkflowInput {
  content: string;
  baseHash: string | null;
}

export interface PutGitWorkflowResult {
  path: string;
  hash: string;
  resolved: ResolvedGitWorkflow;
  warnings: GitWorkflowIssue[];
}

function issueKey(issue: GitWorkflowIssue): string {
  return `${issue.file}\u0000${issue.path}\u0000${issue.message}`;
}

export function putGitWorkflowFile(
  projectRoot: string,
  name: string,
  input: PutGitWorkflowInput,
): PutGitWorkflowResult {
  if (!isGitWorkflowFile(name)) throw new UnknownGitWorkflowFileError(name);

  const current = readGitWorkflowContents(projectRoot);
  if (isNewerTeamFile(current[name] ?? '')) {
    const message = newerTeamFileLine(gitWorkflowRelativePath(name));
    throw new GitWorkflowValidationError(message, [{ file: name, path: '', message }]);
  }
  const before = new Set(resolveGitWorkflow(current).errors.map(issueKey));
  const after = resolveGitWorkflow({ ...current, [name]: input.content });
  const blocking = after.errors.filter(
    (issue) => issue.file === name || !before.has(issueKey(issue)),
  );
  if (blocking.length > 0) {
    throw new GitWorkflowValidationError(`${name} wasn't saved. Fix these first.`, blocking);
  }

  const written = writeManagedFile(projectRoot, {
    relativePath: gitWorkflowRelativePath(name),
    content: input.content,
    baseHash: input.baseHash,
    action: GIT_WORKFLOW_WRITE_ACTION,
  });
  stampLastApplied(projectRoot, [name]);

  const reloaded = loadGitWorkflow(projectRoot);
  return {
    path: written.path,
    hash: written.hash,
    resolved: reloaded.config,
    warnings: reloaded.warnings,
  };
}
