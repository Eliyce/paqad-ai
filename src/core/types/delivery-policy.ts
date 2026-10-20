import type {
  TicketProviderKind,
  TicketWriteBackMode,
  AutoResolveConfirmation,
} from './project-profile.js';

export const MAINTENANCE_MODES = ['auto', 'manual'] as const;
export type MaintenanceMode = (typeof MAINTENANCE_MODES)[number];

export const HOST_PROVIDER_KINDS = ['github', 'gitlab', 'bitbucket'] as const;
export type HostProviderKind = (typeof HOST_PROVIDER_KINDS)[number];

export const CI_GATE_MODES = ['wait_for_green', 'warn_only', 'off'] as const;
export type CiGateMode = (typeof CI_GATE_MODES)[number];

export const CI_ON_RED_MODES = ['stop', 'comment_and_stop'] as const;
export type CiOnRedMode = (typeof CI_ON_RED_MODES)[number];

export interface DeliveryTicketSection {
  maintained?: MaintenanceMode;
  provider?: TicketProviderKind;
  server?: string;
  require_ticket?: boolean;
  write_back_refined?: TicketWriteBackMode;
  comment_decisions?: boolean;
}

export interface DeliveryHostSection {
  maintained?: MaintenanceMode;
  provider?: HostProviderKind;
  server?: string;
}

export interface DeliveryBranchSection {
  maintained?: MaintenanceMode;
  template?: string;
  type_map?: Record<string, string>;
  slug_max_length?: number;
  base?: string;
}

export interface DeliveryCommitSection {
  maintained?: MaintenanceMode;
  template?: string;
  sign_off?: boolean;
  ask_when_unspecified?: boolean;
}

export interface DeliveryPrSection {
  maintained?: MaintenanceMode;
  title_template?: string;
  body_template_path?: string;
  base?: string;
  draft?: boolean;
  reviewers?: string[];
  labels?: string[];
  link_ticket?: boolean;
  transition_on_open?: string;
}

export interface DeliveryCiSection {
  maintained?: MaintenanceMode;
  gate?: CiGateMode;
  timeout_minutes?: number;
  on_red?: CiOnRedMode;
  transition_on_green?: string;
}

export interface DeliveryIntakeDecisionsSection {
  maintained?: MaintenanceMode;
  auto_resolve_from_priors?: boolean;
  auto_resolve_from_rules?: boolean;
  confirm_auto_resolutions?: AutoResolveConfirmation;
  max_options_per_packet?: number;
  fingerprint_scope?: string[];
}

export interface DeliveryProcessBlock {
  ticket?: DeliveryTicketSection;
  host?: DeliveryHostSection;
  branch?: DeliveryBranchSection;
  commit?: DeliveryCommitSection;
  pr?: DeliveryPrSection;
  ci?: DeliveryCiSection;
  intake_decisions?: DeliveryIntakeDecisionsSection;
}

export interface DeliveryPolicy {
  schema_version?: string;
  merge_mode?: 'append';
  enabled?: boolean;
  process?: DeliveryProcessBlock;
}

export const DELIVERY_SECTIONS = [
  'ticket',
  'host',
  'branch',
  'commit',
  'pr',
  'ci',
  'intake_decisions',
] as const;
export type DeliverySection = (typeof DELIVERY_SECTIONS)[number];

export interface ResolvedDeliveryTicket {
  maintained: MaintenanceMode;
  provider: TicketProviderKind;
  server: string;
  require_ticket: boolean;
  write_back_refined: TicketWriteBackMode;
  comment_decisions: boolean;
}

export interface ResolvedDeliveryHost {
  maintained: MaintenanceMode;
  provider: HostProviderKind;
  server: string;
}

export interface ResolvedDeliveryBranch {
  maintained: MaintenanceMode;
  template: string;
  type_map: Record<string, string>;
  slug_max_length: number;
  base: string;
}

export interface ResolvedDeliveryCommit {
  maintained: MaintenanceMode;
  template: string;
  sign_off: boolean;
  ask_when_unspecified: boolean;
}

export interface ResolvedDeliveryPr {
  maintained: MaintenanceMode;
  title_template: string;
  body_template_path: string;
  base: string;
  draft: boolean;
  reviewers: string[];
  labels: string[];
  link_ticket: boolean;
  transition_on_open: string;
}

export interface ResolvedDeliveryCi {
  maintained: MaintenanceMode;
  gate: CiGateMode;
  timeout_minutes: number;
  on_red: CiOnRedMode;
  transition_on_green: string;
}

export interface ResolvedDeliveryIntakeDecisions {
  maintained: MaintenanceMode;
  auto_resolve_from_priors: boolean;
  auto_resolve_from_rules: boolean;
  confirm_auto_resolutions: AutoResolveConfirmation;
  max_options_per_packet: number;
  fingerprint_scope: string[];
}

export interface ResolvedDeliveryProcess {
  ticket: ResolvedDeliveryTicket;
  host: ResolvedDeliveryHost;
  branch: ResolvedDeliveryBranch;
  commit: ResolvedDeliveryCommit;
  pr: ResolvedDeliveryPr;
  ci: ResolvedDeliveryCi;
  intake_decisions: ResolvedDeliveryIntakeDecisions;
}

export interface ResolvedDeliveryPolicy {
  enabled: boolean;
  process: ResolvedDeliveryProcess;
}

export interface DeliveryPolicyLoadResult {
  policy: ResolvedDeliveryPolicy;
  warnings: string[];
}
