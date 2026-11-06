import type {
  AutoResolveConfirmation,
  TicketProviderKind,
  TicketWriteBackMode,
} from '@/core/types/project-profile.js';

export const HOST_PROVIDER_KINDS = ['github', 'gitlab', 'bitbucket'] as const;
export type HostProviderKind = (typeof HOST_PROVIDER_KINDS)[number];

export const CI_GATE_MODES = ['wait_for_green', 'warn_only', 'off'] as const;
export type CiGateMode = (typeof CI_GATE_MODES)[number];

export const CI_ON_RED_MODES = ['stop', 'comment_and_stop'] as const;
export type CiOnRedMode = (typeof CI_ON_RED_MODES)[number];

export const GIT_WORKFLOW_FILES = [
  'tickets.yaml',
  'branches.yaml',
  'commits.yaml',
  'pull-requests.yaml',
  'enforcement.yaml',
  'design-sign-off.yaml',
] as const;
export type GitWorkflowFile = (typeof GIT_WORKFLOW_FILES)[number];

export type SummaryStyle = 'plain' | 'free';
export type AgentsEnforcement = 'warn' | 'block';
export type PeopleEnforcement = 'warn' | 'block' | 'off';

export interface TicketTransitions {
  on_pr_open: string;
  on_ci_green: string;
}

export interface TicketSource {
  tracker: TicketProviderKind;
  pattern: string;
  server: string;
  transitions: TicketTransitions;
}

export interface IntakeDecisions {
  auto_resolve_from_priors: boolean;
  auto_resolve_from_rules: boolean;
  confirm_auto_resolutions: AutoResolveConfirmation;
  max_options_per_packet: number;
  fingerprint_scope: string[];
}

export interface ResolvedTickets {
  require_ticket: boolean;
  sources: Record<string, TicketSource>;
  write_back_refined: TicketWriteBackMode;
  intake_decisions: IntakeDecisions;
}

export interface BranchType {
  prefix: string;
  commit_type: string;
  tickets: string[];
  ticket_types: string[];
  base_branch: string;
  labels: string[];
  template: string;
}

export interface ResolvedBranches {
  base_branch: string;
  template: string;
  slug_max_length: number;
  types: Record<string, BranchType>;
  default_type: string;
}

export interface ResolvedCommits {
  template: string;
  sign_off: boolean;
  ask_when_unspecified: boolean;
  summary: { style: SummaryStyle; max_length: number };
}

export interface ResolvedCi {
  gate: CiGateMode;
  timeout_minutes: number;
  on_red: CiOnRedMode;
}

export interface ResolvedPullRequests {
  host: HostProviderKind;
  host_server: string;
  title_template: string;
  body_template: string;
  draft: boolean;
  reviewers: string[];
  labels: string[];
  link_ticket: boolean;
  also_open_against: string[];
  ci: ResolvedCi;
}

export interface ResolvedEnforcement {
  enabled: boolean;
  agents: AgentsEnforcement;
  people: PeopleEnforcement;
}

export const DESIGN_SIGN_OFF_LANES = ['graduated', 'full'] as const;
export type DesignSignOffLane = (typeof DESIGN_SIGN_OFF_LANES)[number];

export const APPROVE_BY_MODES = ['reply', 'status', 'either'] as const;
export type ApproveBy = (typeof APPROVE_BY_MODES)[number];

export interface DesignApprovalChannel {
  server: string;
  channel: string;
}

export interface DesignFormat {
  summary_max_words: number;
  detail_max_words: number;
}

export interface ResolvedDesignSignOff {
  enabled: boolean;
  lanes: DesignSignOffLane[];
  approval_channel: DesignApprovalChannel;
  format: DesignFormat;
  wait_for_approval: boolean;
  approve_by: ApproveBy;
  approve_words: string[];
  approvers: string[];
  move_to_on_post: string;
  approved_status: string;
  allow_skip_with_reason: boolean;
}

export interface ResolvedGitWorkflow {
  tickets: ResolvedTickets;
  branches: ResolvedBranches;
  commits: ResolvedCommits;
  pull_requests: ResolvedPullRequests;
  enforcement: ResolvedEnforcement;
  design_sign_off: ResolvedDesignSignOff;
}

export interface GitWorkflowIssue {
  file: string;
  path: string;
  message: string;
}

export interface GitWorkflowLoadResult {
  config: ResolvedGitWorkflow;
  valid: boolean;
  errors: GitWorkflowIssue[];
  warnings: GitWorkflowIssue[];
  source: 'git-workflow' | 'defaults';
}
