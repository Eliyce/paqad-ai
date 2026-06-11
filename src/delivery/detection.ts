import { detectDeliveryHost, type DeliveryHost } from './host.js';

import type {
  DeliverySection,
  HostProviderKind,
  ResolvedDeliveryProcess,
} from '@/core/types/delivery-policy.js';

/** Non-conventional commit template applied when the team is not using conventional commits. */
const FREEFORM_COMMIT_TEMPLATE = '{summary}\n\nRefs: {ticket}';

/**
 * Issue #42 — delivery-convention detection. A pure resolver: given a snapshot
 * of git facts, infer the team's host / base branch / branch-naming / commit
 * convention, each with a confidence and a human evidence string. No I/O — the
 * caller gathers the snapshot and persists/overlays the result.
 *
 * Detection only ever *proposes* values; whether they are applied is governed
 * by each section's `maintained: auto | manual` flag at overlay time.
 */

export interface GitSnapshot {
  /** `git remote get-url origin`, or null when there is no remote. */
  remoteUrl: string | null;
  /** Remote default branch (e.g. from `git symbolic-ref refs/remotes/origin/HEAD`). */
  defaultBranch: string | null;
  /** Local + remote branch names, base branches included. */
  branchNames: string[];
  /** Subjects (first line) of recent commits, newest first. */
  recentCommitSubjects: string[];
}

export interface DetectedField<T> {
  value: T;
  /** 0..1 — share of the sample that supports the value. */
  confidence: number;
  evidence: string;
}

export interface DetectedDelivery {
  host: DetectedField<HostProviderKind> | null;
  base: DetectedField<string> | null;
  branch_template: DetectedField<string> | null;
  /** True when the team uses conventional commits. */
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
      value: '{type}/{ticket}-{title_slug}',
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

/** Did detection find anything worth persisting? */
export function hasDetection(detected: DetectedDelivery): boolean {
  return Boolean(
    detected.host || detected.base || detected.branch_template || detected.commit_conventional,
  );
}

/**
 * Overlay detected values onto a resolved process. Each detected value only
 * applies when its owning section is `auto` (per `isAuto`). Returns a new
 * process object — the input is never mutated.
 */
export function overlayDetection(
  process: ResolvedDeliveryProcess,
  detected: DetectedDelivery,
  isAuto: (section: DeliverySection) => boolean,
): ResolvedDeliveryProcess {
  const next: ResolvedDeliveryProcess = {
    ticket: { ...process.ticket },
    host: { ...process.host },
    branch: { ...process.branch },
    commit: { ...process.commit },
    pr: { ...process.pr },
    ci: { ...process.ci },
    intake_decisions: { ...process.intake_decisions },
  };

  if (detected.host && isAuto('host')) {
    next.host.provider = detected.host.value;
  }
  if (detected.base && isAuto('branch')) {
    next.branch.base = detected.base.value;
  }
  if (detected.base && isAuto('pr')) {
    next.pr.base = detected.base.value;
  }
  if (detected.branch_template && isAuto('branch')) {
    next.branch.template = detected.branch_template.value;
  }
  if (detected.commit_conventional && isAuto('commit')) {
    next.commit.template = detected.commit_conventional.value
      ? process.commit.template // keep the conventional default
      : FREEFORM_COMMIT_TEMPLATE;
  }

  return next;
}

/**
 * Human-readable lines for the end-of-docs summary — "what detection
 * configured", shown at the moment conventions are detected so the team learns
 * them without a prompt.
 */
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
