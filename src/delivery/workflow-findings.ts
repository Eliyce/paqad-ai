import { firstLine, templateToRegExp, ticketOptional } from '@/git-workflow/patterns.js';
import {
  checkSummaryStyle,
  isIgnoredSubject,
  summaryStyleMessage,
} from '@/git-workflow/summary-style.js';
import type { GitWorkflowIssue, ResolvedGitWorkflow } from '@/git-workflow/types.js';

import {
  GIT_WORKFLOW_PATH,
  globMatches,
  isConfiguredBase,
  isGlob,
  typeOfBranch,
} from './runner.js';

export type WorkflowFindingCode =
  | 'git-workflow-invalid'
  | 'on-base-branch'
  | 'branch-shape'
  | 'commit-shape'
  | 'commit-summary-style'
  | 'pr-base'
  | 'pr-title-shape'
  | 'pr-labels'
  | 'pr-ticket-link'
  | 'ticket-move-pending';

export interface WorkflowFinding {
  code: WorkflowFindingCode;
  message: string;
}

export const NON_BLOCKING_CODES: ReadonlySet<string> = new Set([
  'git-workflow-invalid',
  'ticket-move-pending',
]);

export const BLOCKING_CODES: ReadonlySet<string> = new Set([
  'on-base-branch',
  'branch-shape',
  'commit-shape',
  'commit-summary-style',
  'pr-base',
  'pr-title-shape',
  'pr-labels',
  'pr-ticket-link',
]);

export function invalidFinding(errors: GitWorkflowIssue[]): WorkflowFinding {
  return {
    code: 'git-workflow-invalid',
    message: `${GIT_WORKFLOW_PATH}/ has errors, so nothing was checked: ${errors[0]?.message ?? 'unknown error'}`,
  };
}

export function onBaseFinding(branch: string): WorkflowFinding {
  return {
    code: 'on-base-branch',
    message: `you're committing on ${branch}. This team works on a branch and opens a PR from it.`,
  };
}

export function followsBranchShape(config: ResolvedGitWorkflow, branch: string): boolean {
  return Object.values(config.branches.types).some((type) => {
    const template = type.template || config.branches.template;
    const optional = template.includes('{prefix}') ? ticketOptional(config) : ['scope' as const];
    return templateToRegExp(template, config, {
      optional,
      branch: true,
      prefixes: [type.prefix],
    }).test(branch);
  });
}

export function branchFinding(config: ResolvedGitWorkflow, branch: string): WorkflowFinding | null {
  if (isConfiguredBase(config, branch)) return null;
  if (Object.keys(config.branches.types).length === 0) return null;
  if (followsBranchShape(config, branch)) return null;
  return {
    code: 'branch-shape',
    message: `branch ${branch} doesn't follow this team's pattern ${config.branches.template}.`,
  };
}

export interface CommitSubject {
  subject: string;
  merge: boolean;
}

export function commitFindings(
  config: ResolvedGitWorkflow,
  commit: CommitSubject,
): WorkflowFinding[] {
  const { subject } = commit;
  if (commit.merge || isIgnoredSubject(subject)) return [];
  const template = firstLine(config.commits.template);
  const findings: WorkflowFinding[] = [];
  const shape = templateToRegExp(template, config, { optional: ticketOptional(config) });
  if (!shape.test(subject)) {
    findings.push({
      code: 'commit-shape',
      message: `commit "${subject}" doesn't follow this team's pattern ${template}.`,
    });
  }
  for (const reason of checkSummaryStyle(subject, template, config)) {
    findings.push({ code: 'commit-summary-style', message: summaryStyleMessage(subject, reason) });
  }
  return findings;
}

export function ticketInBranch(config: ResolvedGitWorkflow, branch: string): string {
  for (const source of Object.values(config.tickets.sources)) {
    const hashed = source.pattern.startsWith('#');
    const pattern = hashed ? source.pattern.slice(1) : source.pattern;
    try {
      const found = new RegExp(`(?<![A-Za-z0-9])(?:${pattern})(?![A-Za-z0-9])`).exec(branch);
      if (found) return hashed ? `#${found[0]}` : found[0];
    } catch {
      continue;
    }
  }
  return '';
}

export interface PrSnapshot {
  number: number | null;
  base: string | null;
  title: string | null;
  labels: string[];
  body: string;
}

function baseMatches(base: string, actual: string): boolean {
  return isGlob(base) ? globMatches(base, actual) : base === actual;
}

export function prFindings(
  config: ResolvedGitWorkflow,
  branch: string,
  pr: PrSnapshot,
): WorkflowFinding[] {
  const findings: WorkflowFinding[] = [];
  const n = pr.number ?? '?';
  const typeName = typeOfBranch(config, branch)[0] ?? config.branches.default_type;
  const type = config.branches.types[typeName];
  const expected = type?.base_branch || config.branches.base_branch;
  if (pr.base) {
    const accepted =
      baseMatches(expected, pr.base) ||
      config.pull_requests.also_open_against.includes(pr.base) ||
      typeOfBranch(config, pr.base).length > 0;
    if (!accepted) {
      findings.push({
        code: 'pr-base',
        message: `PR #${n} targets ${pr.base}, but this team sends ${typeName} changes to ${expected}.`,
      });
    }
  }
  if (pr.title !== null) {
    const template = config.pull_requests.title_template;
    const shape = templateToRegExp(template, config, { optional: ticketOptional(config) });
    if (!shape.test(pr.title)) {
      findings.push({
        code: 'pr-title-shape',
        message: `PR #${n} title "${pr.title}" doesn't follow this team's pattern ${template}.`,
      });
    }
  }
  const required = Array.from(new Set([...config.pull_requests.labels, ...(type?.labels ?? [])]));
  const missing = required.filter((label) => !pr.labels.includes(label));
  if (missing.length > 0) {
    findings.push({
      code: 'pr-labels',
      message: `PR #${n} is missing the labels: ${missing.join(', ')}.`,
    });
  }
  const ticket = ticketInBranch(config, branch);
  if (config.pull_requests.link_ticket && ticket !== '' && !pr.body.includes(ticket)) {
    findings.push({ code: 'pr-ticket-link', message: `PR #${n} doesn't link ${ticket}.` });
  }
  return findings;
}

export function expectedBase(config: ResolvedGitWorkflow, branch: string): string {
  const typeName = typeOfBranch(config, branch)[0] ?? config.branches.default_type;
  return config.branches.types[typeName]?.base_branch || config.branches.base_branch;
}

export const SUBJECT_FORMAT = '%s%x1f%P%x1e';

export function parseSubjects(stdout: string): CommitSubject[] {
  return stdout
    .split('\x1e')
    .map((record) => record.replace(/^\n/, ''))
    .filter((record) => record.includes('\x1f'))
    .map((record) => {
      const [subject, parents = ''] = record.split('\x1f');
      return { subject, merge: parents.trim().split(/\s+/).length > 1 };
    });
}
