import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { Command } from 'commander';

import { PATHS } from '@/core/constants/paths.js';
import { createPendingDecision } from '@/decisions/authoring.js';
import { runCiGate, type CiGateOptions } from '@/delivery/ci-gate.js';
import { runDelivery, type DeliveryShell } from '@/delivery/runner.js';
import { createDeliveryShell } from '@/delivery/shell.js';
import { renderDelivery, type DeliveryRenderInputs } from '@/delivery/templates.js';
import { loadDeliveryPolicy } from '@/pipeline/delivery-policy.js';
import { GithubHostProvider } from '@/providers/github-host-provider.js';
import type { HostProvider } from '@/providers/host-provider.js';
import {
  readVerificationEvidence,
  renderEvidenceMarkdown,
} from '@/verification/evidence-markdown.js';

/** The open_pr choice, or a pause when the delivery.open_pr decision is unresolved. */
export type OpenPrDecision =
  | { status: 'resolved'; choice: 'yes' | 'draft' | 'no' }
  | { status: 'paused'; message: string };

export interface DeliverDeps {
  projectRoot: string;
  dryRun: boolean;
  inputs: DeliveryRenderInputs;
  base: string;
  draft: boolean;
  reviewers: string[];
  labels: string[];
  shell: DeliveryShell;
  host: HostProvider;
  /** Resolve the mandatory delivery.open_pr pause (outward-facing action). */
  resolveOpenPr: () => OpenPrDecision;
  /** Rendered verification evidence for the on-green PR comment, or null. */
  evidenceBody: string | null;
  /** CI-gate clock/sleep seam for deterministic tests. */
  ci?: CiGateOptions;
}

export interface DeliverResult {
  exitCode: number;
  output: string;
}

/**
 * The testable core of `paqad-ai deliver` (issue #323): run the ALREADY-TESTED delivery
 * chain end-to-end — render → (delivery.open_pr pause) → branch/commit/push/PR → CI gate
 * (wait_for_green / on_red stop) → post evidence on green. Reuses `renderDelivery`,
 * `runDelivery`, and `runCiGate`; it never re-implements a git/gh flow. Returns an exit
 * code + a paqad-voice summary; it never throws (a provider failure is reported, not raised).
 */
export async function runDeliver(deps: DeliverDeps): Promise<DeliverResult> {
  const { policy } = loadDeliveryPolicy(deps.projectRoot);
  const process = policy.process;

  const templatePath = join(deps.projectRoot, process.pr.body_template_path);
  const prBody = existsSync(templatePath) ? readFileSync(templatePath, 'utf8') : '';
  const rendered = renderDelivery(process, deps.inputs, prBody);

  if (deps.dryRun) {
    return {
      exitCode: 0,
      output: [
        `**▸ paqad** · delivery dry run — nothing pushed`,
        `> branch:  ${rendered.branch}`,
        `> commit:  ${rendered.commit}`,
        `> PR title: ${rendered.pr_title}`,
        ``,
        rendered.pr_body,
      ].join('\n'),
    };
  }

  // Opening a PR / pushing is outward-facing and hard to reverse — the delivery.open_pr
  // pause is mandatory (issue #323). Stop until the user resolves it.
  const decision = deps.resolveOpenPr();
  if (decision.status === 'paused') {
    return { exitCode: 2, output: decision.message };
  }

  const run = await runDelivery(deps.shell, {
    rendered,
    base: deps.base,
    draft: deps.draft,
    reviewers: deps.reviewers,
    labels: deps.labels,
    open_pr: decision.choice,
  });

  const stepLines = run.steps.map(
    (s) => `> - ${s.ok ? '🟢' : '🔴'} ${s.step}${s.ok ? '' : ` — ${s.remediation ?? 'failed'}`}`,
  );
  if (!run.ok) {
    return {
      exitCode: 1,
      output: [`**▸ paqad** · delivery stopped`, ...stepLines].join('\n'),
    };
  }
  if (decision.choice === 'no') {
    return {
      exitCode: 0,
      output: [`**▸ paqad** · committed (no PR requested)`, ...stepLines].join('\n'),
    };
  }

  const gate = await runCiGate(deps.host, rendered.branch, process.ci, {
    ...deps.ci,
    evidenceComment: deps.evidenceBody,
  });
  const green = gate.action === 'passed' || gate.action === 'warned' || gate.action === 'skipped';
  const glyph = green ? '🟢' : '🔴';
  const verdict = green ? 'Safe to merge' : 'Needs your attention';
  const evidenceLine =
    gate.evidenceCommentPosted === true
      ? '\n> - 🟢 posted the verification evidence to the PR'
      : '';
  return {
    exitCode: green ? 0 : 1,
    output:
      [`**▸ paqad** · delivery — ${verdict}`, ...stepLines, `> - ${glyph} ${gate.message}`].join(
        '\n',
      ) + evidenceLine,
  };
}

/**
 * Resolve the delivery.open_pr decision from the packet store: a resolved
 * `delivery.open_pr` packet drives the choice; otherwise mint a pending one and pause
 * (the Decision Pause Contract's fallback). Reads the packet dirs directly so the pause
 * is deterministic and does not depend on an interactive host.
 */
export function resolveOpenPrDecision(projectRoot: string, defaultChoice: string): OpenPrDecision {
  const resolvedDir = join(projectRoot, PATHS.DECISIONS_RESOLVED_DIR);
  const pendingDir = join(projectRoot, PATHS.DECISIONS_PENDING_DIR);

  const resolved = findDeliveryPacket(resolvedDir);
  if (resolved && typeof resolved.chosen === 'string') {
    const choice = normalizeChoice(resolved.chosen);
    if (choice) return { status: 'resolved', choice };
  }

  // Already waiting on a pending packet → stay paused (don't mint a duplicate).
  if (findDeliveryPacket(pendingDir)) {
    return { status: 'paused', message: pauseMessage() };
  }

  try {
    createPendingDecision(projectRoot, {
      category: 'delivery.open_pr',
      title: 'Open a pull request for this change?',
      context:
        'Delivery is ready. Opening a PR pushes the branch to the remote — an outward-facing, ' +
        'hard-to-reverse action — so paqad is asking before it does.',
      options: [
        { option_key: 'yes', label: 'Open a PR now' },
        { option_key: 'draft', label: 'Open a draft PR' },
        { option_key: 'no', label: 'Commit only, no PR' },
      ],
      recommendation: normalizeChoice(defaultChoice) ? defaultChoice : 'yes',
    });
  } catch {
    // Best-effort: even if minting fails, we still pause rather than push unasked.
  }
  return { status: 'paused', message: pauseMessage() };
}

function pauseMessage(): string {
  return (
    `**▸ paqad** · I hit a real choice that's yours to make, so I stopped to ask\n` +
    `> Opening a PR pushes your branch to the remote. I wrote a \`delivery.open_pr\` decision ` +
    `packet — answer it (yes / draft / no), then re-run \`paqad-ai deliver\`.`
  );
}

function normalizeChoice(raw: string): 'yes' | 'draft' | 'no' | null {
  const value = raw.trim().toLowerCase();
  return value === 'yes' || value === 'draft' || value === 'no' ? value : null;
}

/** Newest `delivery.open_pr` packet in a decisions dir, or null. */
function findDeliveryPacket(dir: string): Record<string, unknown> | null {
  let entries: string[];
  try {
    entries = readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .sort();
  } catch {
    return null;
  }
  // Newest last (ids are time-sortable ULIDs), so scan from the end.
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    try {
      const packet = JSON.parse(readFileSync(join(dir, entries[i]), 'utf8')) as Record<
        string,
        unknown
      >;
      if (packet.category === 'delivery.open_pr') return packet;
    } catch {
      // Skip a malformed packet file.
    }
  }
  return null;
}

/** Read + render the persisted verification evidence for the PR comment, or null. */
function loadEvidenceBody(projectRoot: string): string | null {
  try {
    const evidence = readVerificationEvidence(projectRoot);
    return evidence ? renderEvidenceMarkdown(evidence, {}) : null;
  } catch {
    return null;
  }
}

interface DeliverOptions {
  projectRoot: string;
  dryRun: boolean;
  base: string;
  draft: boolean;
  ticket?: string;
  ticketType?: string;
  title: string;
  summary: string;
  scope?: string;
  openPr: string;
  reviewer?: string[];
  label?: string[];
}

/**
 * `paqad-ai deliver` (issue #323) — the one verb that runs the delivery engine and closes
 * the ticket → green-PR loop. It asks before opening the PR (delivery.open_pr pause), then
 * renders/branches/commits/pushes/opens the PR, waits for CI, stops on red, and posts the
 * verification evidence on green. `--dry-run` shows the rendered surface without pushing.
 */
export function createDeliveryCommand(): Command {
  return new Command('deliver')
    .description('Run the delivery chain: PR (after asking) → wait for CI → evidence on green')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--dry-run', 'Render branch/commit/PR text without pushing', false)
    .option('--base <branch>', 'Base branch for the PR', 'main')
    .option('--draft', 'Open the PR as a draft', false)
    .option('--title <title>', 'Change title (branch slug + PR title)', '')
    .option('--summary <summary>', 'One-line summary for the commit/PR body', '')
    .option('--ticket <ref>', 'Linked ticket ref (e.g. #45 or PQD-123)')
    .option('--ticket-type <type>', 'Ticket type (Story/Bug/Task) → conventional commit type')
    .option('--scope <scope>', 'Conventional-commit scope (usually the module)')
    .option('--open-pr <mode>', 'Recommended open_pr choice for the pause (yes|draft|no)', 'yes')
    .option('--reviewer <handle>', 'PR reviewer (repeatable)', collect, [])
    .option('--label <label>', 'PR label (repeatable)', collect, [])
    .action(async (options: DeliverOptions) => {
      const projectRoot = resolve(options.projectRoot);
      const shell = createDeliveryShell(projectRoot);
      const host = new GithubHostProvider(shell);
      const result = await runDeliver({
        projectRoot,
        dryRun: options.dryRun,
        inputs: {
          ticket: options.ticket ?? '',
          ticket_type: options.ticketType,
          title: options.title,
          summary: options.summary,
          scope: options.scope,
        },
        base: options.base,
        draft: options.draft,
        reviewers: options.reviewer ?? [],
        labels: options.label ?? [],
        shell,
        host,
        resolveOpenPr: () => resolveOpenPrDecision(projectRoot, options.openPr),
        evidenceBody: loadEvidenceBody(projectRoot),
      });
      if (result.exitCode === 0) {
        console.log(result.output);
      } else {
        console.error(result.output);
        process.exitCode = result.exitCode;
      }
    });
}

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}
