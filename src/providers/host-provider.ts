import type { HostProviderKind } from '@/core/types/delivery-policy.js';

/**
 * Issue #42 — the VCS + code-host-neutral capability contract. GitHub is the
 * first adapter; GitLab / Bitbucket are additive `kind` values behind the same
 * contract. Git operations run through git directly; host operations (PR,
 * checks) run through the host CLI/MCP resolved from `process.host.provider`.
 */

export interface OpenPrInput {
  title: string;
  body: string;
  base: string;
  head: string;
  draft: boolean;
  reviewers: string[];
  labels: string[];
  /** Ticket ref this PR is linked to, when intake produced one. */
  linkedTicket?: string;
}

export interface PullRequest {
  number: number | null;
  url: string;
}

/** Aggregate CI state for a PR/branch, used by the delivery CI gate. */
export type ChecksState = 'green' | 'red' | 'pending' | 'unknown';

export interface CheckRun {
  name: string;
  /** Normalized per-check conclusion. */
  state: ChecksState;
}

export interface ChecksStatus {
  state: ChecksState;
  checks: CheckRun[];
}

/** Outcome of a single host step — mirrors the delivery runner's shape. */
export interface HostStepResult {
  ok: boolean;
  /** Actionable hint shown to the user when ok=false. */
  remediation?: string;
  output?: string;
}

export interface HostProvider {
  readonly kind: HostProviderKind;
  ensureBranch(name: string, base: string): Promise<HostStepResult>;
  commit(message: string): Promise<HostStepResult>;
  push(branch: string): Promise<HostStepResult>;
  openPR(input: OpenPrInput): Promise<HostStepResult & { pr?: PullRequest }>;
  getChecksStatus(prOrBranch: string): Promise<ChecksStatus>;
  /**
   * Post a comment on an existing PR (identified by number, URL, or branch).
   * The verifiable-trust surface (issue #119) posts paqad's rendered
   * verification evidence here so the deterministic proof lands on the PR
   * without a human running a command.
   */
  comment(prOrBranch: string, body: string): Promise<HostStepResult>;
}
