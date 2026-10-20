import type { HostProviderKind } from '@/core/types/delivery-policy.js';

export interface OpenPrInput {
  title: string;
  body: string;
  base: string;
  head: string;
  draft: boolean;
  reviewers: string[];
  labels: string[];
  linkedTicket?: string;
}

export interface PullRequest {
  number: number | null;
  url: string;
}

export type ChecksState = 'green' | 'red' | 'pending' | 'unknown';

export interface CheckRun {
  name: string;
  state: ChecksState;
}

export interface ChecksStatus {
  state: ChecksState;
  checks: CheckRun[];
}

export interface HostStepResult {
  ok: boolean;
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
  comment(prOrBranch: string, body: string): Promise<HostStepResult>;
}
