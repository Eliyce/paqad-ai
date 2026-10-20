import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { Command } from 'commander';

import { PATHS } from '@/core/constants/paths.js';
import { createPendingDecision } from '@/decisions/authoring.js';
import { appendHooksLog } from '@/core/logging/hooks-log.js';
import { runCiGate, type CiGateOptions, type CiGateResult } from '@/delivery/ci-gate.js';
import { runDelivery, type DeliveryRunResult, type DeliveryShell } from '@/delivery/runner.js';
import { createDeliveryShell } from '@/delivery/shell.js';
import { renderDelivery, type DeliveryRenderInputs } from '@/delivery/templates.js';
import { recordShip, type CiState, type ShipPatch } from '@/feature-evidence/delivery.js';
import { currentFeature } from '@/feature-evidence/stage-ledger.js';
import { loadDeliveryPolicy } from '@/pipeline/delivery-policy.js';
import { readGitState } from '@/rag/git-state.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import { GithubHostProvider } from '@/providers/github-host-provider.js';
import { raisedTechDebt } from '@/tech-debt/context.js';
import { renderTechDebtPrSection } from '@/tech-debt/pr-section.js';
import type { HostProvider } from '@/providers/host-provider.js';
import {
  readVerificationEvidence,
  renderEvidenceMarkdown,
} from '@/verification/evidence-markdown.js';

export type OpenPrDecision =
  { status: 'resolved'; choice: 'yes' | 'draft' | 'no' } | { status: 'paused'; message: string };

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
  resolveOpenPr: () => OpenPrDecision;
  evidenceBody: string | null;
  ci?: CiGateOptions;
  dirName?: string | null;
  now?: () => Date;
}

export interface DeliverResult {
  exitCode: number;
  output: string;
}

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

  const decision = deps.resolveOpenPr();
  if (decision.status === 'paused') {
    return { exitCode: 2, output: decision.message };
  }

  const run = await runDelivery(
    deps.shell,
    {
      rendered,
      base: deps.base,
      draft: deps.draft,
      reviewers: deps.reviewers,
      labels: deps.labels,
      open_pr: decision.choice,
    },
    (input) => deps.host.openPR(input),
  );
  saveShip(deps, shipFromRun(run, rendered.branch, decision.choice === 'draft', headSha(deps)));

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
  saveShip(deps, shipFromGate(gate, headSha(deps)));
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

const CI_STATE: Record<CiGateResult['state'], CiState> = {
  green: 'pass',
  red: 'fail',
  pending: 'pending',
  unknown: 'unknown',
};

function headSha(deps: DeliverDeps): string | null {
  return deps.dirName ? (readGitState(deps.projectRoot).head_commit ?? null) : null;
}

function shipFromRun(
  run: DeliveryRunResult,
  branch: string,
  draft: boolean,
  sha: string | null,
): ShipPatch {
  const patch: ShipPatch = {};
  const push = run.steps.find((step) => step.step === 'push');
  if (push) patch.push = { state: push.ok ? 'pushed' : 'failed', branch, sha };
  const pr = run.steps.find((step) => step.step === 'pr')?.pr;
  if (pr) patch.pr = { number: pr.number, url: pr.url, draft };
  return patch;
}

function shipFromGate(gate: CiGateResult, sha: string | null): ShipPatch {
  if (gate.action === 'skipped') return {};
  const state = CI_STATE[gate.state];
  return {
    ci: {
      sha,
      state,
      done: gate.checks?.done ?? null,
      total: gate.checks?.total ?? null,
      reason: state === 'unknown' ? gate.message : null,
      source: 'ci-gate',
    },
  };
}

function saveShip(deps: DeliverDeps, patch: ShipPatch): void {
  if (!deps.dirName || Object.keys(patch).length === 0) return;
  try {
    recordShip(
      deps.projectRoot,
      deps.dirName,
      patch,
      (deps.now ?? (() => new Date()))().toISOString(),
    );
  } catch (error) {
    appendHooksLog(
      deps.projectRoot,
      `deliver: delivery.json not updated: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function resolveOpenPrDecision(projectRoot: string, defaultChoice: string): OpenPrDecision {
  const resolvedDir = join(projectRoot, PATHS.DECISIONS_RESOLVED_DIR);
  const pendingDir = join(projectRoot, PATHS.DECISIONS_PENDING_DIR);

  const resolved = findDeliveryPacket(resolvedDir);
  if (resolved && typeof resolved.chosen === 'string') {
    const choice = normalizeChoice(resolved.chosen);
    if (choice) return { status: 'resolved', choice };
  }

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
  } catch {}
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

function findDeliveryPacket(dir: string): Record<string, unknown> | null {
  let entries: string[];
  try {
    entries = readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .sort();
  } catch {
    return null;
  }
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    try {
      const packet = JSON.parse(readFileSync(join(dir, entries[i]), 'utf8')) as Record<
        string,
        unknown
      >;
      if (packet.category === 'delivery.open_pr') return packet;
    } catch {}
  }
  return null;
}

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
  session?: string;
}

export function createDeliveryCommand(): Command {
  return new Command('deliver')
    .description('Run the delivery chain: PR (after asking) → wait for CI → evidence on green')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--dry-run', 'Render branch/commit/PR text without pushing', false)
    .option('--base <branch>', 'Base branch for the PR', 'main')
    .option('--draft', 'Open the PR as a draft', false)
    .option('--title <title>', 'Change title (branch slug + PR title)', '')
    .option('--summary <summary>', 'One-line summary for the commit/PR body', '')
    .option('--ticket <ref>', 'Linked ticket ref (e.g. #<number> or PQD-<number>)')
    .option('--ticket-type <type>', 'Ticket type (Story/Bug/Task) → conventional commit type')
    .option('--scope <scope>', 'Conventional-commit scope (usually the module)')
    .option('--open-pr <mode>', 'Recommended open_pr choice for the pause (yes|draft|no)', 'yes')
    .option('--reviewer <handle>', 'PR reviewer (repeatable)', collect, [])
    .option('--label <label>', 'PR label (repeatable)', collect, [])
    .option('--session <id>', 'Session id (defaults to SE_SESSION / CLAUDE_SESSION_ID)')
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
          tech_debt: renderTechDebtPrSection(
            raisedTechDebt(
              projectRoot,
              options.session ?? process.env.SE_SESSION ?? process.env.CLAUDE_SESSION_ID ?? null,
            ),
          ),
        },
        base: options.base,
        draft: options.draft,
        reviewers: options.reviewer ?? [],
        labels: options.label ?? [],
        shell,
        host,
        resolveOpenPr: () => resolveOpenPrDecision(projectRoot, options.openPr),
        evidenceBody: loadEvidenceBody(projectRoot),
        dirName: activeChange(projectRoot, options.session),
      });
      if (result.exitCode === 0) {
        console.log(result.output);
      } else {
        console.error(result.output);
        process.exitCode = result.exitCode;
      }
    });
}

function activeChange(projectRoot: string, session: string | undefined): string | null {
  try {
    return currentFeature(
      projectRoot,
      resolveSessionId(
        projectRoot,
        session ?? process.env.SE_SESSION ?? process.env.CLAUDE_SESSION_ID ?? null,
      ),
    );
  } catch {
    return null;
  }
}

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}
