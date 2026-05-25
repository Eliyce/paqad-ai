import type {
  AutoResolveConfirmation,
  ConventionsBlock,
  TicketProviderKind,
  TicketWriteBackMode,
} from './types/project-profile.js';

export interface ResolvedConventions {
  ticket: {
    provider: TicketProviderKind;
    server: string;
    require_ticket: boolean;
    write_back: TicketWriteBackMode;
  };
  intake_decisions: {
    auto_resolve_from_priors: boolean;
    auto_resolve_from_rules: boolean;
    confirm_auto_resolutions: AutoResolveConfirmation;
    max_options_per_packet: number;
    fingerprint_scope: string[];
  };
  branch: {
    template: string;
    type_map: Record<string, string>;
    slug_max_length: number;
    base: string;
  };
  commit: {
    template: string;
    sign_off: boolean;
  };
  pr: {
    title_template: string;
    body_template_path: string;
    base: string;
    draft: boolean;
    reviewers: string[];
    labels: string[];
    link_ticket: boolean;
    transition_on_open: string;
  };
}

/**
 * Framework defaults for the `conventions:` block. Project overrides win.
 * Mirrors the schema's `$defs/conventionsBlock`. The schema is the
 * validation source of truth; this object is the runtime source of truth for
 * "what you get without configuring anything."
 */
export const DEFAULT_CONVENTIONS: ResolvedConventions = {
  ticket: {
    provider: 'jira',
    server: '',
    require_ticket: false,
    write_back: 'ask',
  },
  intake_decisions: {
    auto_resolve_from_priors: true,
    auto_resolve_from_rules: true,
    confirm_auto_resolutions: 'batched',
    max_options_per_packet: 4,
    fingerprint_scope: ['ticket_type', 'module', 'category'],
  },
  branch: {
    template: '{type}/{ticket}-{title_slug}',
    type_map: { Story: 'feat', Bug: 'fix', Task: 'chore', default: 'feat' },
    slug_max_length: 50,
    base: 'main',
  },
  commit: {
    template: '{type}({scope}): {summary}\n\nRefs: {ticket}',
    sign_off: false,
  },
  pr: {
    title_template: '{type}({scope}): {summary} [{ticket}]',
    body_template_path: '.paqad/templates/pr-body.md',
    base: 'main',
    draft: false,
    reviewers: [],
    labels: [],
    link_ticket: true,
    transition_on_open: 'In Review',
  },
};

/**
 * Merges a project's optional `conventions:` block over the framework
 * defaults. Returns a fully-populated object — every field has a value.
 */
export function resolveConventions(input: ConventionsBlock | undefined): ResolvedConventions {
  const overrides = input ?? {};
  return {
    ticket: { ...DEFAULT_CONVENTIONS.ticket, ...(overrides.ticket ?? {}) },
    intake_decisions: {
      ...DEFAULT_CONVENTIONS.intake_decisions,
      ...(overrides.intake_decisions ?? {}),
    },
    branch: { ...DEFAULT_CONVENTIONS.branch, ...(overrides.branch ?? {}) },
    commit: { ...DEFAULT_CONVENTIONS.commit, ...(overrides.commit ?? {}) },
    pr: { ...DEFAULT_CONVENTIONS.pr, ...(overrides.pr ?? {}) },
  };
}
