import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import YAML from 'yaml';

import type { DeliveryShell } from '@/delivery/runner.js';
import type { TicketProviderKind } from '@/core/types/project-profile.js';

import {
  DEFAULT_BASE_BRANCH,
  DEFAULT_TRACKER_PATTERNS,
  renderDefaultGitWorkflowFile,
} from './defaults.js';
import { applyEdits, type GitWorkflowEdit } from './change.js';
import type { GitWorkflowContents } from './load.js';
import { GIT_WORKFLOW_FILES, type GitWorkflowFile } from './types.js';

export class GitReadError extends Error {}

export interface PrRecord {
  number: number;
  title: string;
  baseRefName: string;
  headRefName: string;
  labels: string[];
  isDraft: boolean;
}

export interface MainlineCommit {
  subject: string;
  body: string;
}

export interface SetupSignals {
  remote: string | null;
  defaultBranch: string;
  branches: string[];
  mainline: MainlineCommit[];
  prs: PrRecord[] | null;
  mergeMethods: string[] | null;
  rules: number | null;
  ciTargets: string[];
  codeowners: string | null;
  prTemplate: string | null;
  unknown: string[];
}

export interface Evidence {
  file: GitWorkflowFile;
  key: string;
  value: unknown;
  because: string;
}

export interface ChoiceOption {
  id: string;
  label: string;
  share?: number;
  examples?: string[];
}

export interface Choice {
  id: string;
  question: string;
  options: ChoiceOption[];
  recommended: string;
  free_text?: boolean;
}

interface InternalChoice extends Choice {
  edits: (answer: string) => GitWorkflowEdit[];
}

export interface SetupProposal {
  mode: 'from-history' | 'new-project';
  files: Record<GitWorkflowFile, string>;
  unknown: string[];
  evidence: Evidence[];
  choices: Choice[];
}

export interface ProposalWithEdits {
  proposal: SetupProposal;
  base: GitWorkflowContents;
  decided: GitWorkflowEdit[];
  choices: InternalChoice[];
}

export const DECIDE_SHARE = 0.7;
export const MIN_MAINLINE_COMMITS = 20;
const SKIPPED_SEGMENTS = new Set(['release', 'dependabot', 'renovate', 'HEAD']);
const SQUASH_SUFFIX = / \(#\d+\)$/;
const KEY_PREFIX = /\b([A-Z][A-Z0-9]+)-\d+\b/g;
const SERVICENOW = /\b(INC|RITM|CHG|PRB|TASK)\d{7}\b/g;
const GITHUB_ISSUE = /(?<!\()#\d+\b/g;
const IGNORED = /^(Merge |Revert "|fixup! |squash! )/;
const SIGNED_OFF = /^Signed-off-by:/m;

export const PR_TEMPLATE_PATHS = [
  '.github/pull_request_template.md',
  '.github/PULL_REQUEST_TEMPLATE.md',
  'docs/pull_request_template.md',
  'pull_request_template.md',
];
export const CODEOWNERS_PATHS = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'];

function lines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

function firstExisting(projectRoot: string, paths: string[]): string | null {
  return paths.find((path) => existsSync(join(projectRoot, path))) ?? null;
}

function prTemplatePath(projectRoot: string): string | null {
  const found = firstExisting(projectRoot, PR_TEMPLATE_PATHS);
  if (found) return found;
  try {
    const dir = '.github/PULL_REQUEST_TEMPLATE';
    const first = readdirSync(join(projectRoot, dir)).sort()[0];
    return first ? `${dir}/${first}` : null;
  } catch {
    return null;
  }
}

export function readCiTargets(projectRoot: string): string[] {
  const dir = join(projectRoot, '.github/workflows');
  let files: string[];
  try {
    files = readdirSync(dir).filter((name) => /\.ya?ml$/.test(name));
  } catch {
    return [];
  }
  const targets = new Set<string>();
  for (const file of files) {
    try {
      const doc = YAML.parse(readFileSync(join(dir, file), 'utf8')) as Record<string, unknown>;
      const on = (doc?.on ?? doc?.true) as Record<string, unknown> | undefined;
      const pr = on && typeof on === 'object' ? (on.pull_request as { branches?: unknown }) : null;
      if (pr && Array.isArray(pr.branches)) {
        for (const branch of pr.branches) if (typeof branch === 'string') targets.add(branch);
      }
    } catch {
      continue;
    }
  }
  return [...targets].sort();
}

function parsePrs(stdout: string): PrRecord[] {
  const parsed = JSON.parse(stdout) as Array<Record<string, unknown>>;
  return parsed.map((pr) => ({
    number: Number(pr.number),
    title: String(pr.title ?? ''),
    baseRefName: String(pr.baseRefName ?? ''),
    headRefName: String(pr.headRefName ?? ''),
    labels: Array.isArray(pr.labels)
      ? pr.labels.map((label) => String((label as { name?: unknown }).name ?? '')).filter(Boolean)
      : [],
    isDraft: pr.isDraft === true,
  }));
}

export async function gatherSignals(
  shell: DeliveryShell,
  projectRoot: string,
): Promise<SetupSignals> {
  const repo = await shell.run('git', ['rev-parse', '--git-dir']);
  if (repo.exitCode !== 0) {
    throw new GitReadError(`git can't read this folder: ${(repo.stderr || repo.stdout).trim()}`);
  }
  const unknown: string[] = [];
  const remoteRun = await shell.run('git', ['remote', 'get-url', 'origin']);
  const remote = remoteRun.exitCode === 0 ? remoteRun.stdout.trim() || null : null;
  const head = await shell.run('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  const defaultBranch =
    head.exitCode === 0 && head.stdout.trim() !== ''
      ? head.stdout.trim().replace(/^origin\//, '')
      : DEFAULT_BASE_BRANCH;
  const branchRun = await shell.run('git', ['branch', '-r', '--format=%(refname:short)']);
  const branches =
    branchRun.exitCode === 0
      ? lines(branchRun.stdout)
          .filter((name) => name.startsWith('origin/'))
          .map((name) => name.slice('origin/'.length))
          .filter((name) => name !== 'HEAD' && name !== '')
      : [];
  const log = await shell.run('git', [
    'log',
    '--first-parent',
    '-n',
    '200',
    '--format=%s%x1f%b%x1e',
    'origin/HEAD',
  ]);
  const mainline =
    log.exitCode === 0
      ? log.stdout
          .split('\x1e')
          .map((record) => record.replace(/^\n/, ''))
          .filter((record) => record.includes('\x1f'))
          .map((record) => {
            const [subject, body = ''] = record.split('\x1f');
            return { subject: subject.trim(), body };
          })
      : [];

  let prs: PrRecord[] | null = null;
  let mergeMethods: string[] | null = null;
  let rules: number | null = null;
  const prRun = await shell.run('gh', [
    'pr',
    'list',
    '--state',
    'all',
    '--limit',
    '200',
    '--json',
    'number,title,baseRefName,headRefName,labels,isDraft',
  ]);
  if (prRun.exitCode === 0) {
    try {
      prs = parsePrs(prRun.stdout);
    } catch {
      unknown.push("pull requests: gh's answer couldn't be read");
    }
  } else {
    unknown.push("pull requests: gh isn't installed or signed in, so PR history wasn't read");
  }
  const repoRun = await shell.run('gh', [
    'repo',
    'view',
    '--json',
    'squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed,defaultBranchRef,nameWithOwner',
  ]);
  let nameWithOwner: string | null = null;
  if (repoRun.exitCode === 0) {
    try {
      const view = JSON.parse(repoRun.stdout) as Record<string, unknown>;
      mergeMethods = [
        view.squashMergeAllowed === true ? 'squash' : null,
        view.mergeCommitAllowed === true ? 'merge' : null,
        view.rebaseMergeAllowed === true ? 'rebase' : null,
      ].filter((method): method is string => method !== null);
      nameWithOwner = typeof view.nameWithOwner === 'string' ? view.nameWithOwner : null;
    } catch {
      unknown.push("merge methods: gh's answer couldn't be read");
    }
  } else {
    unknown.push("merge methods: gh couldn't read the repository settings");
  }
  if (nameWithOwner) {
    const rulesRun = await shell.run('gh', [
      'api',
      `repos/${nameWithOwner}/rules/branches/${defaultBranch}`,
    ]);
    if (rulesRun.exitCode === 0) {
      try {
        rules = (JSON.parse(rulesRun.stdout) as unknown[]).length;
      } catch {
        rules = null;
      }
    }
  }
  if (rules === null) {
    unknown.push("branch protection: GitHub didn't show it to this account (needs admin)");
  }

  return {
    remote,
    defaultBranch,
    branches,
    mainline,
    prs,
    mergeMethods,
    rules,
    ciTargets: readCiTargets(projectRoot),
    codeowners: firstExisting(projectRoot, CODEOWNERS_PATHS),
    prTemplate: prTemplatePath(projectRoot),
    unknown,
  };
}

function count<T>(items: T[], key: (item: T) => string | null): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    if (k !== null) out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

function ranked(counts: Map<string, number>): Array<[string, number]> {
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
}

function share(part: number, total: number): number {
  return total === 0 ? 0 : Math.round((part / total) * 100) / 100;
}

export function commitTypeFor(segment: string): string {
  if (segment === 'feature') return 'feat';
  if (['bugfix', 'bug', 'fix', 'hotfix'].includes(segment)) return 'fix';
  return segment;
}

export function patternFromExample(example: string): string {
  return example
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/[A-Za-z]+/g, '[A-Z]+')
    .replace(/\d+/g, '\\d+');
}

function defaultFiles(base: string): GitWorkflowContents {
  const out: GitWorkflowContents = {};
  for (const file of GIT_WORKFLOW_FILES) {
    out[file] = renderDefaultGitWorkflowFile(file, { baseBranch: base });
  }
  return out;
}

function source(tracker: TicketProviderKind, pattern?: string) {
  return {
    tracker,
    pattern: pattern ?? DEFAULT_TRACKER_PATTERNS[tracker] ?? '',
    server: '',
    transitions: { on_pr_open: '', on_ci_green: '' },
  };
}

const TRACKER_SOURCE: Readonly<Record<string, { name: string; tracker: TicketProviderKind }>> = {
  jira: { name: 'jira', tracker: 'jira' },
  servicenow: { name: 'servicenow', tracker: 'servicenow' },
  'github-issues': { name: 'github', tracker: 'github-issues' },
};

const COMMIT_LABELS: Readonly<Record<string, string>> = {
  '{ticket}: {summary}': 'PROJ-1: summary',
  '{ticket} - {summary}': 'PROJ-1 - summary',
  '{ticket} {summary}': 'PROJ-1 summary',
  '{type}({scope}): {summary} [{ticket}]': 'feat(scope): summary [PROJ-1]',
  '{type}({scope}): {summary}': 'feat(scope): summary',
  '{summary}': 'Summary only',
};

export function starterChoices(): InternalChoice[] {
  const templateEdits = (template: string): GitWorkflowEdit[] => [
    { file: 'commits.yaml', path: ['template'], value: template },
    { file: 'pull-requests.yaml', path: ['title_template'], value: template },
  ];
  return [
    {
      id: 'tickets.tracker',
      question: 'Where do your tickets live?',
      options: [
        { id: 'jira', label: 'Jira' },
        { id: 'servicenow', label: 'ServiceNow' },
        { id: 'github-issues', label: 'GitHub Issues' },
        { id: 'none', label: 'No tickets' },
      ],
      recommended: 'jira',
      edits: (answer) => {
        const picked = TRACKER_SOURCE[answer];
        return [
          {
            file: 'tickets.yaml',
            path: ['sources'],
            value: picked ? { [picked.name]: source(picked.tracker) } : {},
          },
        ];
      },
    },
    {
      id: 'tickets.example',
      question:
        'What does one of your ticket keys look like? (only asked when a tracker was picked)',
      options: [{ id: 'PROJ-123', label: 'for example PROJ-123' }],
      recommended: '',
      free_text: true,
      edits: () => [],
    },
    {
      id: 'pull_requests.extra_target',
      question:
        'Do changes also go to a shared test branch, like qa or staging, before they go live?',
      options: [
        { id: 'no', label: 'No' },
        { id: 'qa', label: 'Yes: qa' },
        { id: 'staging', label: 'Yes: staging' },
      ],
      recommended: 'no',
      edits: (answer) => [
        {
          file: 'pull-requests.yaml',
          path: ['also_open_against'],
          value: answer === 'no' ? [] : [answer],
        },
      ],
    },
    {
      id: 'branches.releases',
      question: 'Do you keep more than one released version going at the same time?',
      options: [
        { id: 'no', label: 'No, everything goes to main' },
        { id: 'yes', label: 'Yes, release branches' },
      ],
      recommended: 'no',
      edits: (answer) =>
        answer === 'yes'
          ? [{ file: 'branches.yaml', path: ['base_branch'], value: 'release/*' }]
          : [],
    },
    {
      id: 'branches.hotfix',
      question: 'Do you need a separate path for urgent fixes?',
      options: [
        { id: 'yes', label: 'Yes' },
        { id: 'no', label: 'No' },
      ],
      recommended: 'yes',
      edits: (answer) =>
        answer === 'no' ? [{ file: 'branches.yaml', path: ['types', 'hotfix'], value: null }] : [],
    },
    {
      id: 'commits.template',
      question: 'How should a commit message start?',
      options: [
        { id: '{ticket}: {summary}', label: 'PROJ-1: summary' },
        { id: '{type}({scope}): {summary}', label: 'feat(scope): summary' },
        { id: '{summary}', label: 'Summary only' },
      ],
      recommended: '{ticket}: {summary}',
      edits: templateEdits,
    },
  ];
}

function exampleEdits(answers: Record<string, string>): GitWorkflowEdit[] {
  const tracker = TRACKER_SOURCE[answers['tickets.tracker'] ?? 'jira'];
  const example = (answers['tickets.example'] ?? '').trim();
  if (!tracker || example === '') return [];
  return [
    {
      file: 'tickets.yaml',
      path: ['sources', tracker.name, 'pattern'],
      value: patternFromExample(example),
    },
  ];
}

export function isNewProject(signals: SetupSignals): boolean {
  const others = signals.branches.filter((branch) => branch !== signals.defaultBranch);
  return (
    signals.remote === null || signals.mainline.length < MIN_MAINLINE_COMMITS || others.length === 0
  );
}

interface ClassifiedSubject {
  template: string;
  subject: string;
}

export function classifySubject(subject: string, keys: string[]): string {
  const key = keys.length > 0 ? `(?:${keys.map((k) => `(?:${k})`).join('|')})` : null;
  if (key) {
    if (new RegExp(`^${key}: `).test(subject)) return '{ticket}: {summary}';
    if (new RegExp(`^${key} - `).test(subject)) return '{ticket} - {summary}';
    if (new RegExp(`^${key} `).test(subject)) return '{ticket} {summary}';
    if (new RegExp(`^\\w+(\\([^)]*\\))?: .+ \\[${key}\\]$`).test(subject)) {
      return '{type}({scope}): {summary} [{ticket}]';
    }
  }
  if (/^\w+(\([^)]*\))?: /.test(subject)) return '{type}({scope}): {summary}';
  return '{summary}';
}

interface Decision {
  value: string;
  choice: Choice | null;
}

function decideOrAsk(
  id: string,
  question: string,
  classified: ClassifiedSubject[],
): Decision | null {
  if (classified.length === 0) return null;
  const counts = ranked(count(classified, (entry) => entry.template));
  const [top, topCount] = counts[0];
  if (topCount / classified.length >= DECIDE_SHARE) return { value: top, choice: null };
  return {
    value: top,
    choice: {
      id,
      question,
      options: counts.slice(0, 3).map(([template, n]) => ({
        id: template,
        label: COMMIT_LABELS[template] ?? template,
        share: share(n, classified.length),
        examples: classified
          .filter((entry) => entry.template === template)
          .slice(0, 2)
          .map((entry) => entry.subject),
      })),
      recommended: top,
    },
  };
}

function scanKeys(texts: string[]): {
  prefixes: Map<string, number>;
  servicenow: number;
} {
  const prefixes = new Map<string, number>();
  let servicenow = 0;
  for (const text of texts) {
    for (const match of text.matchAll(KEY_PREFIX)) {
      prefixes.set(match[1], (prefixes.get(match[1]) ?? 0) + 1);
    }
    servicenow += [...text.matchAll(SERVICENOW)].length;
  }
  return { prefixes, servicenow };
}

export function proposeFromSignals(signals: SetupSignals): ProposalWithEdits {
  const base = defaultFiles(signals.defaultBranch);
  if (isNewProject(signals)) {
    const choices = starterChoices();
    return {
      proposal: {
        mode: 'new-project',
        files: base as Record<GitWorkflowFile, string>,
        unknown: signals.unknown,
        evidence: [],
        choices: choices.map(publicChoice),
      },
      base,
      decided: [],
      choices,
    };
  }

  const evidence: Evidence[] = [];
  const decided: GitWorkflowEdit[] = [];
  const choices: InternalChoice[] = [];
  const subjects = signals.mainline
    .map((commit) => commit.subject.replace(SQUASH_SUFFIX, ''))
    .filter((subject) => subject !== '' && !IGNORED.test(subject));

  const scanned = scanKeys([...signals.branches, ...subjects]);
  const sources: Record<string, ReturnType<typeof source>> = {};
  for (const [prefix, n] of ranked(scanned.prefixes)) {
    if (n < 5) continue;
    const name = prefix.toLowerCase();
    sources[name] = source('jira', `${prefix}-\\d+`);
    evidence.push({
      file: 'tickets.yaml',
      key: `sources.${name}`,
      value: `${prefix}-\\d+`,
      because: `${n} branch names and commit subjects carry ${prefix}- keys`,
    });
    choices.push({
      id: `tickets.sources.${name}.tracker`,
      question: `Where do the ${prefix}- tickets live?`,
      options: [
        { id: 'jira', label: 'Jira' },
        { id: 'linear', label: 'Linear' },
      ],
      recommended: 'jira',
      edits: (answer) => [
        { file: 'tickets.yaml', path: ['sources', name, 'tracker'], value: answer },
      ],
    });
  }
  if (scanned.servicenow >= 5) {
    sources.servicenow = source('servicenow');
    evidence.push({
      file: 'tickets.yaml',
      key: 'sources.servicenow',
      value: DEFAULT_TRACKER_PATTERNS.servicenow,
      because: `${scanned.servicenow} branch names and commit subjects carry ServiceNow keys`,
    });
  }
  const issueHits = subjects.reduce(
    (n, subject) => n + [...subject.matchAll(GITHUB_ISSUE)].length,
    0,
  );
  if (issueHits >= 5) {
    sources.github = source('github-issues');
    evidence.push({
      file: 'tickets.yaml',
      key: 'sources.github',
      value: DEFAULT_TRACKER_PATTERNS['github-issues'],
      because: `${issueHits} commit subjects name a GitHub issue`,
    });
  }
  decided.push({ file: 'tickets.yaml', path: ['sources'], value: sources });
  const keys = Object.values(sources).map((entry) => entry.pattern);
  const keyStart = keys.length > 0 ? new RegExp(`^(?:${keys.join('|')})`) : null;

  const bases = new Set([signals.defaultBranch]);
  const segments = new Map<string, number>();
  let typed = 0;
  let ticketFirst = 0;
  const remaining = signals.branches.filter((branch) => {
    if (bases.has(branch)) return false;
    const first = branch.split('/')[0];
    return !SKIPPED_SEGMENTS.has(first) && !first.startsWith('revert-');
  });
  for (const branch of remaining) {
    if (branch.includes('/')) {
      const first = branch.split('/')[0];
      segments.set(first, (segments.get(first) ?? 0) + 1);
      typed += 1;
    } else if (keyStart?.test(branch.toUpperCase())) {
      ticketFirst += 1;
    }
  }
  const types: Record<string, { prefix: string; commit_type: string }> = {};
  for (const [segment, n] of ranked(segments)) {
    if (n / Math.max(remaining.length, 1) < 0.05) continue;
    types[segment] = { prefix: segment, commit_type: commitTypeFor(segment) };
    evidence.push({
      file: 'branches.yaml',
      key: `types.${segment}.prefix`,
      value: segment,
      because: `${n} of ${remaining.length} branches start with ${segment}/`,
    });
  }
  const typeNames = Object.keys(types);
  if (typeNames.length > 0) {
    decided.push({ file: 'branches.yaml', path: ['types'], value: types });
    decided.push({ file: 'branches.yaml', path: ['default_type'], value: typeNames[0] });
  }
  if (typed + ticketFirst > 0) {
    const total = typed + ticketFirst;
    const typedTemplate = '{prefix}/{ticket}-{title_slug}';
    const ticketTemplate = '{ticket}-{title_slug}';
    const top = typed >= ticketFirst ? typedTemplate : ticketTemplate;
    const topShare = Math.max(typed, ticketFirst) / total;
    if (topShare >= DECIDE_SHARE) {
      decided.push({ file: 'branches.yaml', path: ['template'], value: top });
    } else {
      choices.push({
        id: 'branches.template',
        question: 'How should branch names start from now on?',
        options: [
          { id: typedTemplate, label: 'feature/PROJ-1-short-title', share: share(typed, total) },
          { id: ticketTemplate, label: 'PROJ-1-short-title', share: share(ticketFirst, total) },
        ].sort((a, b) => (b.share ?? 0) - (a.share ?? 0)),
        recommended: top,
        edits: (answer) => [{ file: 'branches.yaml', path: ['template'], value: answer }],
      });
    }
  }

  let baseBranch = signals.defaultBranch;
  if (signals.prs && signals.prs.length > 0) {
    const typed = signals.prs.filter((pr) =>
      typeNames.some((name) => pr.headRefName.startsWith(`${name}/`)),
    );
    const pool = typed.length > 0 ? typed : signals.prs;
    const byBase = ranked(count(pool, (pr) => pr.baseRefName));
    const release = pool.filter((pr) => pr.baseRefName.startsWith('release/')).length;
    if (release / pool.length >= 0.5) {
      baseBranch = 'release/*';
      evidence.push({
        file: 'branches.yaml',
        key: 'base_branch',
        value: 'release/*',
        because: `${release} of ${pool.length} PRs went to a release/ branch`,
      });
    } else if (byBase[0]) {
      baseBranch = byBase[0][0];
      evidence.push({
        file: 'branches.yaml',
        key: 'base_branch',
        value: baseBranch,
        because: `${byBase[0][1]} of ${pool.length} PRs went to ${baseBranch}`,
      });
    }
    const heads = new Map<string, Set<string>>();
    for (const pr of signals.prs) {
      heads.set(pr.headRefName, (heads.get(pr.headRefName) ?? new Set()).add(pr.baseRefName));
    }
    const toBase = [...heads.values()].filter((set) => set.has(baseBranch));
    const others = count(
      toBase.flatMap((set) => [...set].filter((b) => b !== baseBranch)),
      (b) => b,
    );
    for (const [other, n] of ranked(others)) {
      if (n / Math.max(toBase.length, 1) < 0.3) continue;
      choices.push({
        id: 'pull_requests.also_open_against',
        question: `Should every change also get a PR to ${other}?`,
        options: [
          { id: 'no', label: 'No' },
          { id: other, label: `Yes: ${other}`, share: share(n, toBase.length) },
        ],
        recommended: 'no',
        edits: (answer) => [
          {
            file: 'pull-requests.yaml',
            path: ['also_open_against'],
            value: answer === 'no' ? [] : [answer],
          },
        ],
      });
      break;
    }
    const drafts = signals.prs.filter((pr) => pr.isDraft).length;
    if (drafts / signals.prs.length >= 0.5) {
      decided.push({ file: 'pull-requests.yaml', path: ['draft'], value: true });
      evidence.push({
        file: 'pull-requests.yaml',
        key: 'draft',
        value: true,
        because: `${drafts} of ${signals.prs.length} PRs were opened as drafts`,
      });
    }
    const allLabels = count(
      signals.prs.flatMap((pr) => pr.labels),
      (label) => label,
    );
    const global = ranked(allLabels)
      .filter(([, n]) => n / signals.prs!.length >= 0.8)
      .map(([label]) => label);
    if (global.length > 0) {
      decided.push({ file: 'pull-requests.yaml', path: ['labels'], value: global });
    }
    for (const name of typeNames) {
      const ofType = signals.prs.filter((pr) => pr.headRefName.startsWith(`${name}/`));
      if (ofType.length === 0) continue;
      const labels = ranked(
        count(
          ofType.flatMap((pr) => pr.labels),
          (label) => label,
        ),
      )
        .filter(([label, n]) => n / ofType.length >= 0.6 && !global.includes(label))
        .map(([label]) => label);
      if (labels.length > 0) {
        decided.push({ file: 'branches.yaml', path: ['types', name, 'labels'], value: labels });
      }
    }
  }
  if (baseBranch !== signals.defaultBranch) {
    decided.push({ file: 'branches.yaml', path: ['base_branch'], value: baseBranch });
  }

  const commitClasses = subjects.map((subject) => ({
    subject,
    template: classifySubject(subject, keys),
  }));
  const commit = decideOrAsk(
    'commits.template',
    'Which commit format should everyone use from now on?',
    commitClasses,
  );
  const titleClasses = (signals.prs ?? []).map((pr) => ({
    subject: pr.title.replace(SQUASH_SUFFIX, ''),
    template: classifySubject(pr.title.replace(SQUASH_SUFFIX, ''), keys),
  }));
  const title =
    titleClasses.length > 0
      ? decideOrAsk(
          'pull_requests.title_template',
          'Which PR title format should everyone use from now on?',
          titleClasses,
        )
      : commit;
  if (commit) {
    if (commit.choice) {
      choices.push({
        ...commit.choice,
        edits: (answer) => [{ file: 'commits.yaml', path: ['template'], value: answer }],
      });
    } else {
      decided.push({ file: 'commits.yaml', path: ['template'], value: commit.value });
      evidence.push({
        file: 'commits.yaml',
        key: 'template',
        value: commit.value,
        because: `${commitClasses.filter((c) => c.template === commit.value).length} of ${commitClasses.length} main-line subjects look like ${COMMIT_LABELS[commit.value] ?? commit.value}`,
      });
    }
  }
  if (title) {
    if (title.choice && title !== commit) {
      choices.push({
        ...title.choice,
        edits: (answer) => [
          { file: 'pull-requests.yaml', path: ['title_template'], value: answer },
        ],
      });
    } else if (title.choice) {
      const last = choices[choices.length - 1];
      const commitEdits = last.edits;
      last.edits = (answer) => [
        ...commitEdits(answer),
        { file: 'pull-requests.yaml', path: ['title_template'], value: answer },
      ];
    } else {
      decided.push({ file: 'pull-requests.yaml', path: ['title_template'], value: title.value });
    }
  }

  const signed = signals.mainline.filter((entry) => SIGNED_OFF.test(entry.body)).length;
  if (signals.mainline.length > 0 && signed / signals.mainline.length >= 0.5) {
    decided.push({ file: 'commits.yaml', path: ['sign_off'], value: true });
    evidence.push({
      file: 'commits.yaml',
      key: 'sign_off',
      value: true,
      because: `${signed} of ${signals.mainline.length} commits carry Signed-off-by`,
    });
  }
  if (signals.prTemplate) {
    decided.push({
      file: 'pull-requests.yaml',
      path: ['body_template'],
      value: signals.prTemplate,
    });
    evidence.push({
      file: 'pull-requests.yaml',
      key: 'body_template',
      value: signals.prTemplate,
      because: `the team's PR template is ${signals.prTemplate}`,
    });
  }
  if (
    signals.mergeMethods &&
    signals.mergeMethods.length === 1 &&
    signals.mergeMethods[0] === 'squash'
  ) {
    evidence.push({
      file: 'commits.yaml',
      key: 'template',
      value: null,
      because: 'PRs are squash-merged: only the PR title lands on main',
    });
  }
  if (signals.rules !== null) {
    evidence.push({
      file: 'branches.yaml',
      key: 'base_branch',
      value: signals.defaultBranch,
      because: `${signals.rules} branch rules protect ${signals.defaultBranch}`,
    });
  }
  if (signals.ciTargets.length > 0) {
    evidence.push({
      file: 'branches.yaml',
      key: 'base_branch',
      value: signals.ciTargets,
      because: `CI runs on PRs to ${signals.ciTargets.join(', ')}`,
    });
  }
  if (signals.codeowners) {
    evidence.push({
      file: 'pull-requests.yaml',
      key: 'reviewers',
      value: [],
      because: `${signals.codeowners} already asks code owners to review, so no reviewers are added`,
    });
  }

  const files = applyEdits(base, decided) as Record<GitWorkflowFile, string>;
  return {
    proposal: {
      mode: 'from-history',
      files,
      unknown: signals.unknown,
      evidence,
      choices: choices.map(publicChoice),
    },
    base,
    decided,
    choices,
  };
}

function publicChoice(choice: InternalChoice | Choice): Choice {
  const { id, question, options, recommended, free_text } = choice;
  return { id, question, options, recommended, ...(free_text ? { free_text } : {}) };
}

export interface AppliedAnswers {
  contents: GitWorkflowContents;
  notConfirmed: string[];
}

export function applyAnswers(
  built: ProposalWithEdits,
  answers: Record<string, string>,
): AppliedAnswers {
  const notConfirmed: string[] = [];
  const edits: GitWorkflowEdit[] = [...built.decided];
  const tracker = answers['tickets.tracker'];
  for (const choice of built.choices) {
    if (choice.id === 'tickets.example' && (tracker === 'none' || !answers[choice.id])) {
      if (tracker !== 'none' && built.proposal.mode === 'new-project') {
        notConfirmed.push(`not confirmed: ${choice.question}`);
      }
      continue;
    }
    const answer = answers[choice.id];
    if (answer === undefined) {
      notConfirmed.push(`not confirmed: ${choice.question}`);
      edits.push(...choice.edits(choice.recommended));
      continue;
    }
    if (!choice.free_text && !choice.options.some((option) => option.id === answer)) {
      throw new Error(
        `${choice.id}: "${answer}" isn't one of the options (${choice.options.map((o) => o.id).join(', ')}).`,
      );
    }
    edits.push(...choice.edits(answer));
  }
  if (built.proposal.mode === 'new-project') edits.push(...exampleEdits(answers));
  return { contents: applyEdits(built.base, edits), notConfirmed };
}
