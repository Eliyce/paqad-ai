import { detectDeliveryHost, type DeliveryHost } from '@/delivery/host.js';
import type { DeliveryShell } from '@/delivery/runner.js';

import type { HostProviderKind } from './types.js';

export interface GitSnapshot {
  remoteUrl: string | null;
  defaultBranch: string | null;
  branchNames: string[];
  recentCommitSubjects: string[];
}

export interface DetectedField<T> {
  value: T;
  confidence: number;
  evidence: string;
}

export interface DetectedDelivery {
  host: DetectedField<HostProviderKind> | null;
  base: DetectedField<string> | null;
  branch_template: DetectedField<string> | null;
  commit_conventional: DetectedField<boolean> | null;
}

const BASE_BRANCH_NAMES = new Set(['main', 'master', 'develop', 'development', 'trunk']);
const TYPED_PREFIX = /^(feat|feature|fix|bugfix|hotfix|chore|docs|refactor|test|perf|build|ci)\//i;
const TICKET_FIRST = /^[A-Z]{2,}-\d+[-/]/;
const CONVENTIONAL_COMMIT = /^(\w+)(\([^)]+\))?!?:\s/;

function normalizeBranch(name: string): string {
  let n = name.trim();
  n = n.replace(/^refs\/heads\//, '').replace(/^refs\/remotes\//, '');
  n = n.replace(/^(origin|upstream)\//i, '');
  return n;
}

export function detectHost(remoteUrl: string | null): DetectedField<HostProviderKind> | null {
  const host: DeliveryHost = detectDeliveryHost(remoteUrl);
  if (host === 'unknown') {
    return null;
  }
  return {
    value: host,
    confidence: 1,
    evidence: `git remote resolves to ${host}`,
  };
}

export function detectBase(snapshot: GitSnapshot): DetectedField<string> | null {
  if (snapshot.defaultBranch) {
    const base = normalizeBranch(snapshot.defaultBranch);
    return { value: base, confidence: 1, evidence: `remote default branch is ${base}` };
  }
  const known = snapshot.branchNames.map(normalizeBranch).find((b) => BASE_BRANCH_NAMES.has(b));
  if (known) {
    return { value: known, confidence: 0.6, evidence: `found a ${known} branch` };
  }
  return null;
}

export function detectBranchTemplate(snapshot: GitSnapshot): DetectedField<string> | null {
  const feature = snapshot.branchNames
    .map(normalizeBranch)
    .filter((b) => b !== '' && !BASE_BRANCH_NAMES.has(b) && !/^(HEAD)$/.test(b));
  if (feature.length === 0) {
    return null;
  }

  let typed = 0;
  let ticketFirst = 0;
  for (const b of feature) {
    if (TICKET_FIRST.test(b)) {
      ticketFirst += 1;
    } else if (TYPED_PREFIX.test(b)) {
      typed += 1;
    }
  }

  if (typed >= ticketFirst && typed > 0) {
    return {
      value: '{prefix}/{ticket}-{title_slug}',
      confidence: typed / feature.length,
      evidence: `typed branch prefix (${typed}/${feature.length} branches)`,
    };
  }
  if (ticketFirst > 0) {
    return {
      value: '{ticket}-{title_slug}',
      confidence: ticketFirst / feature.length,
      evidence: `ticket-first branches (${ticketFirst}/${feature.length})`,
    };
  }
  return null;
}

export function detectCommitConvention(snapshot: GitSnapshot): DetectedField<boolean> | null {
  const subjects = snapshot.recentCommitSubjects.filter((s) => s.trim() !== '');
  if (subjects.length === 0) {
    return null;
  }
  const conventional = subjects.filter((s) => CONVENTIONAL_COMMIT.test(s)).length;
  const ratio = conventional / subjects.length;
  if (ratio >= 0.5) {
    return {
      value: true,
      confidence: ratio,
      evidence: `conventional commits (${conventional}/${subjects.length})`,
    };
  }
  return {
    value: false,
    confidence: 1 - ratio,
    evidence: `free-form commit subjects (${subjects.length - conventional}/${subjects.length})`,
  };
}

export function detectDelivery(snapshot: GitSnapshot): DetectedDelivery {
  return {
    host: detectHost(snapshot.remoteUrl),
    base: detectBase(snapshot),
    branch_template: detectBranchTemplate(snapshot),
    commit_conventional: detectCommitConvention(snapshot),
  };
}

export function hasDetection(detected: DetectedDelivery): boolean {
  return Boolean(
    detected.host || detected.base || detected.branch_template || detected.commit_conventional,
  );
}

export function summarizeDetection(detected: DetectedDelivery): string[] {
  const lines: string[] = [];
  if (detected.host) {
    lines.push(`host ${detected.host.value} (${detected.host.evidence})`);
  }
  if (detected.branch_template) {
    lines.push(
      `branch \`${detected.branch_template.value}\` (${detected.branch_template.evidence})`,
    );
  }
  if (detected.commit_conventional) {
    lines.push(
      detected.commit_conventional.value
        ? `commits: ${detected.commit_conventional.evidence}`
        : `commits: free-form (${detected.commit_conventional.evidence})`,
    );
  }
  if (detected.base) {
    lines.push(`base \`${detected.base.value}\` (${detected.base.evidence})`);
  }
  return lines;
}

export async function gatherGitSnapshot(shell: DeliveryShell): Promise<GitSnapshot> {
  const remote = await shell.run('git', ['remote', 'get-url', 'origin']);
  const head = await shell.run('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  const branches = await shell.run('git', ['branch', '--all', '--format=%(refname:short)']);
  const commits = await shell.run('git', ['log', '-n', '100', '--format=%s']);

  return {
    remoteUrl: remote.exitCode === 0 ? remote.stdout.trim() || null : null,
    defaultBranch: head.exitCode === 0 ? head.stdout.trim() || null : null,
    branchNames:
      branches.exitCode === 0
        ? branches.stdout
            .split('\n')
            .map((b) => b.trim())
            .filter((b) => b !== '' && !b.includes('->'))
        : [],
    recentCommitSubjects:
      commits.exitCode === 0
        ? commits.stdout
            .split('\n')
            .map((s) => s.trim())
            .filter((s) => s !== '')
        : [],
  };
}
