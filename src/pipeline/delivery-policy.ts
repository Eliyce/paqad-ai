import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import YAML from 'yaml';

import { PATHS } from '@/core/constants/paths.js';
import type {
  DeliveryPolicy,
  DeliveryPolicyLoadResult,
  DeliverySection,
  ResolvedDeliveryPolicy,
  ResolvedDeliveryProcess,
} from '@/core/types/delivery-policy.js';
import { overlayDetection } from '@/delivery/detection.js';
import { readDetection } from '@/delivery/detection-store.js';
import { SchemaValidator } from '@/validators/validator.js';

/**
 * Issue #42 — loader for `docs/instructions/workflows/delivery-policy.yaml`.
 *
 * Mirrors `feature-development-policy.ts` exactly: framework defaults are the
 * baseline, a project file is validated against the JSON Schema, and a valid
 * file is merged over the defaults with `merge_mode: append` semantics (project
 * scalars win; project list/record entries are appended/merged, never dropped).
 */

export const DELIVERY_POLICY_FILE = 'delivery-policy.yaml';

export function deliveryPolicyPath(projectRoot: string): string {
  return join(projectRoot, PATHS.WORKFLOWS_DIR, DELIVERY_POLICY_FILE);
}

/**
 * Framework defaults — best-practice values, `enabled: true`, every section
 * `maintained: auto`. Detection fills the `auto` sections during
 * `create documentation`; provider-bound capabilities stay dormant until the
 * relevant MCP is connected.
 */
export function defaultDeliveryProcess(): ResolvedDeliveryProcess {
  return {
    ticket: {
      maintained: 'auto',
      provider: 'jira',
      server: '',
      require_ticket: false,
      write_back_refined: 'ask',
      comment_decisions: true,
    },
    host: {
      maintained: 'auto',
      provider: 'github',
      server: '',
    },
    branch: {
      maintained: 'auto',
      template: '{type}/{ticket}-{title_slug}',
      type_map: { Story: 'feat', Bug: 'fix', Task: 'chore', default: 'feat' },
      slug_max_length: 50,
      base: 'main',
    },
    commit: {
      maintained: 'auto',
      template: '{type}({scope}): {summary}\n\nRefs: {ticket}',
      sign_off: false,
    },
    pr: {
      maintained: 'auto',
      title_template: '{type}({scope}): {summary} [{ticket}]',
      body_template_path: '.paqad/templates/pr-body.md',
      base: 'main',
      draft: false,
      reviewers: [],
      labels: [],
      link_ticket: true,
      transition_on_open: 'In Review',
    },
    ci: {
      maintained: 'auto',
      gate: 'wait_for_green',
      timeout_minutes: 30,
      on_red: 'stop',
      transition_on_green: 'Done',
    },
    intake_decisions: {
      maintained: 'auto',
      auto_resolve_from_priors: true,
      auto_resolve_from_rules: true,
      confirm_auto_resolutions: 'batched',
      max_options_per_packet: 4,
      fingerprint_scope: ['ticket_type', 'module', 'category'],
    },
  };
}

export function defaultDeliveryPolicy(): ResolvedDeliveryPolicy {
  return {
    enabled: true,
    process: defaultDeliveryProcess(),
  };
}

export function loadDeliveryPolicy(projectRoot: string): DeliveryPolicyLoadResult {
  const defaults = defaultDeliveryPolicy();
  const path = deliveryPolicyPath(projectRoot);

  let parsed: DeliveryPolicy = {};

  if (existsSync(path)) {
    try {
      parsed = (YAML.parse(readFileSync(path, 'utf8')) as DeliveryPolicy) ?? {};
    } catch (error) {
      return {
        policy: withDetection(projectRoot, defaults),
        warnings: [
          `Delivery policy at ${PATHS.WORKFLOWS_DIR}/${DELIVERY_POLICY_FILE} could not be parsed. Using framework defaults.`,
          error instanceof Error ? error.message : 'YAML parse failed',
        ],
      };
    }

    const validator = new SchemaValidator();
    const validation = validator.validate('delivery-policy', parsed);
    if (!validation.valid) {
      return {
        policy: withDetection(projectRoot, defaults),
        warnings: [
          `Delivery policy at ${PATHS.WORKFLOWS_DIR}/${DELIVERY_POLICY_FILE} is invalid. Using framework defaults.`,
          ...validation.errors.map((error) => `${error.path} ${error.message}`),
        ],
      };
    }
  }

  // Precedence: framework defaults < detection overlay (auto sections only) <
  // project YAML (an explicit human edit always wins). `maintained` is read
  // from the raw YAML (default auto) so a `manual` section is never touched by
  // detection.
  const overlaid = withDetection(projectRoot, defaults, parsed);
  return { policy: mergeDeliveryPolicy(overlaid, parsed), warnings: [] };
}

/** True when a section is effectively `auto` (raw YAML says auto, or is unset). */
function sectionIsAuto(raw: DeliveryPolicy, section: DeliverySection): boolean {
  return (raw.process?.[section]?.maintained ?? 'auto') === 'auto';
}

/** Overlay the persisted detection artifact onto the defaults' `auto` sections. */
function withDetection(
  projectRoot: string,
  base: ResolvedDeliveryPolicy,
  raw: DeliveryPolicy = {},
): ResolvedDeliveryPolicy {
  const detected = readDetection(projectRoot);
  if (!detected) {
    return base;
  }
  return {
    enabled: base.enabled,
    process: overlayDetection(base.process, detected, (section) => sectionIsAuto(raw, section)),
  };
}

/**
 * Append-merge a project policy over the framework defaults. Scalars are
 * overridden; `type_map` records merge key-by-key; list fields (`reviewers`,
 * `labels`, `fingerprint_scope`) append uniquely so a project never silently
 * loses a framework default.
 */
export function mergeDeliveryPolicy(
  defaults: ResolvedDeliveryPolicy,
  raw: DeliveryPolicy,
): ResolvedDeliveryPolicy {
  const d = defaults.process;
  const p = raw.process ?? {};

  const process: ResolvedDeliveryProcess = {
    ticket: { ...d.ticket, ...(p.ticket ?? {}) },
    host: { ...d.host, ...(p.host ?? {}) },
    branch: {
      ...d.branch,
      ...(p.branch ?? {}),
      type_map: { ...d.branch.type_map, ...(p.branch?.type_map ?? {}) },
    },
    commit: { ...d.commit, ...(p.commit ?? {}) },
    pr: {
      ...d.pr,
      ...(p.pr ?? {}),
      reviewers: appendUnique(d.pr.reviewers, p.pr?.reviewers),
      labels: appendUnique(d.pr.labels, p.pr?.labels),
    },
    ci: { ...d.ci, ...(p.ci ?? {}) },
    intake_decisions: {
      ...d.intake_decisions,
      ...(p.intake_decisions ?? {}),
      fingerprint_scope: appendUnique(
        d.intake_decisions.fingerprint_scope,
        p.intake_decisions?.fingerprint_scope,
      ),
    },
  };

  return {
    enabled: raw.enabled ?? defaults.enabled,
    process,
  };
}

function appendUnique(base: string[], additions: string[] | undefined): string[] {
  return Array.from(new Set([...base, ...(additions ?? [])]));
}

/**
 * The on-disk default `delivery-policy.yaml`, written by `paqad-ai onboard`.
 * Fully commented so the team can flip any section to `manual` or change a value
 * without reading external docs.
 */
export function renderDefaultDeliveryPolicyYaml(): string {
  return `# Delivery Workflow Policy  (issue #42)
# Authored exactly like feature-development.yaml: same location, same schema
# validation, same merge_mode: append precedence — project edits win.
#
# enabled: on by default. Git-only parts (branch/commit naming) are active
# immediately; ticket/PR/CI parts stay dormant until the matching MCP is
# connected, then light up with no re-enable step.
#
# Every section carries  maintained: auto | manual
#   auto   — the framework keeps it in sync with your repo; detection fills it
#            during \`create documentation\`.
#   manual — you own it; detection never touches it.
schema_version: "1"
merge_mode: append
enabled: true

process:
  ticket:
    maintained: auto
    provider: jira              # kind; future: linear | github-issues | generic
    server: ""                  # explicit MCP server name; "" = first enabled of that kind
    require_ticket: false       # teams that gate on tickets set true
    write_back_refined: ask     # never | ask | always
    comment_decisions: true     # post every resolved decision to the ticket

  host:
    maintained: auto
    provider: github            # kind; future: gitlab | bitbucket
    server: ""

  branch:
    maintained: auto
    template: "{type}/{ticket}-{title_slug}"
    type_map: { Story: feat, Bug: fix, Task: chore, default: feat }
    slug_max_length: 50
    base: main

  commit:
    maintained: auto
    template: "{type}({scope}): {summary}\\n\\nRefs: {ticket}"
    sign_off: false

  pr:
    maintained: auto
    title_template: "{type}({scope}): {summary} [{ticket}]"
    body_template_path: .paqad/templates/pr-body.md
    base: main
    draft: false
    reviewers: []
    labels: []
    link_ticket: true
    transition_on_open: "In Review"   # "" = no transition

  ci:
    maintained: auto
    gate: wait_for_green        # wait_for_green | warn_only | off
    timeout_minutes: 30
    on_red: stop                # stop | comment_and_stop
    transition_on_green: "Done" # "" = no transition

  intake_decisions:
    maintained: auto
    auto_resolve_from_priors: true
    auto_resolve_from_rules: true
    confirm_auto_resolutions: batched   # always | batched | never
    max_options_per_packet: 4
    fingerprint_scope: [ticket_type, module, category]
`;
}
