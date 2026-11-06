import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { Command } from 'commander';

import { PATHS } from '@/core/constants/paths.js';
import { createPendingDecision } from '@/decisions/authoring.js';
import { appendHooksLog } from '@/core/logging/hooks-log.js';
import {
  countChecks,
  runCiGate,
  type CiGateOptions,
  type CiGateResult,
} from '@/delivery/ci-gate.js';
import { planDelivery, trackerName, type DeliveryPlan } from '@/delivery/degradation.js';
import { detectDeliveryHost } from '@/delivery/host.js';
import {
  GIT_WORKFLOW_PATH,
  MISSING_LABEL_HINT,
  commitStep,
  currentBranch,
  linkTicket,
  matchTicketSource,
  missingHeadings,
  pickBranchType,
  placeholdersIn,
  planBranch,
  requireTicket,
  resolveBase,
  styleVerdict,
  uniqueInOrder,
  type DeliveryShell,
  type MatchedSource,
} from '@/delivery/runner.js';
import { createDeliveryShell } from '@/delivery/shell.js';
import { ticketInBranch } from '@/delivery/workflow-findings.js';
import { renderDelivery, type DeliveryRenderInputs } from '@/delivery/templates.js';
import { describeEarlierWork } from '@/delivery/commit-split.js';
import {
  TICKET_ACTION_IDS,
  queueTicketAction,
  readFeatureDelivery,
  recordShip,
  refreshCommitSplit,
  settleTicketAction,
  type CiState,
  type DeliveryTicketAction,
  type ShipPatch,
} from '@/feature-evidence/delivery.js';
import { featureChangeKey } from '@/feature-evidence/paths.js';
import type { DecisionOptionEvidence } from '@/planning/decision-packet.js';
import { currentFeature, recordChangeConstants } from '@/feature-evidence/stage-ledger.js';
import { loadGitWorkflow } from '@/git-workflow/load.js';
import { DEFAULT_PR_BODY } from '@/git-workflow/onboard.js';
import type { ResolvedGitWorkflow, TicketTransitions } from '@/git-workflow/types.js';
import { readProjectProfile } from '@/core/project-profile.js';
import type { ProjectMcpServer } from '@/core/types/project-profile.js';
import { resolveTicketProvider } from '@/providers/registry.js';
import { readGitState } from '@/rag/git-state.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import { GithubHostProvider } from '@/providers/github-host-provider.js';
import { raisedTechDebt } from '@/tech-debt/context.js';
import { renderTechDebtPrSection } from '@/tech-debt/pr-section.js';
import type { ChecksStatus, HostProvider, PullRequest } from '@/providers/host-provider.js';
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
  type?: string;
  base?: string | null;
  draft: boolean;
  reviewers: string[];
  labels: string[];
  bodyFile?: string | null;
  shell: DeliveryShell;
  host: HostProvider;
  resolveOpenPr: () => OpenPrDecision;
  evidenceBody: string | null;
  ci?: CiGateOptions;
  dirName?: string | null;
  now?: () => Date;
  servers?: ProjectMcpServer[];
  hostConnected?: boolean;
}

export interface DeliverResult {
  exitCode: number;
  output: string;
}

export const TURNED_OFF_MESSAGE = `Delivery help is turned off in ${GIT_WORKFLOW_PATH}/enforcement.yaml.`;

export const NO_PLACEHOLDER_MESSAGE =
  "This team's PR template has no placeholders, so fill it in yourself and pass it with --body-file <path>.";

function stopped(message: string, lines: string[] = []): DeliverResult {
  return {
    exitCode: 1,
    output: [`**▸ paqad** · delivery stopped`, ...lines, `> - 🔴 ${message}`].join('\n'),
  };
}

interface Prepared {
  config: ResolvedGitWorkflow;
  matched: MatchedSource | null;
  typeName: string;
  current: string | null;
}

async function prepare(
  projectRoot: string,
  shell: DeliveryShell,
  inputs: DeliveryRenderInputs,
  type: string | undefined,
): Promise<{ result: DeliverResult } | { prepared: Prepared }> {
  const loaded = loadGitWorkflow(projectRoot);
  const config = loaded.config;
  if (!config.enforcement.enabled) {
    return { result: { exitCode: 0, output: TURNED_OFF_MESSAGE } };
  }
  if (!loaded.valid) {
    return {
      result: stopped(
        `${GIT_WORKFLOW_PATH}/ has errors, so nothing was delivered:`,
        loaded.errors.map((error) => `> - ${error.message}`),
      ),
    };
  }
  const required = requireTicket(config, inputs.ticket);
  if (!required.ok) return { result: stopped(required.message) };
  const matched = matchTicketSource(config, inputs.ticket);
  if (!matched.ok) return { result: stopped(matched.message) };
  const current = await currentBranch(shell);
  const picked = pickBranchType(config, {
    type,
    source: matched.value?.name ?? null,
    ticketType: inputs.ticket_type,
    ticketGiven: inputs.ticket.trim() !== '',
    currentBranch: current,
  });
  if (!picked.ok) return { result: stopped(picked.message) };
  return { prepared: { config, matched: matched.value, typeName: picked.value, current } };
}

function readBodyTemplate(projectRoot: string, config: ResolvedGitWorkflow): string {
  const templatePath = join(projectRoot, config.pull_requests.body_template);
  return existsSync(templatePath) ? readFileSync(templatePath, 'utf8') : DEFAULT_PR_BODY;
}

function planLines(
  deps: DeliverDeps,
  config: ResolvedGitWorkflow,
): { plan: DeliveryPlan; lines: string[] } {
  const host = {
    kind: config.pull_requests.host,
    connected: deps.hostConnected ?? true,
  };
  const tickets = Object.entries(config.tickets.sources).map(([name, source]) => ({
    source: name,
    resolution: resolveTicketProvider(deps.servers ?? [], source),
  }));
  const plan = planDelivery(config, host, tickets);
  const lines = plan.skipped.map((step) => `> - 🟡 skipped: ${step}`);
  if (plan.nudge) lines.push(`> ${plan.nudge}`);
  return { plan, lines };
}

export async function runDeliver(deps: DeliverDeps): Promise<DeliverResult> {
  const ready = await prepare(deps.projectRoot, deps.shell, deps.inputs, deps.type);
  if ('result' in ready) return ready.result;
  const { config, matched, typeName, current } = ready.prepared;
  const branchType = config.branches.types[typeName];

  const base = await resolveBase(
    deps.shell,
    deps.base || branchType?.base_branch || config.branches.base_branch,
  );
  if (!base.ok) return stopped(base.message);

  const bodyTemplate = readBodyTemplate(deps.projectRoot, config);
  const rendered = renderDelivery(config, deps.inputs, bodyTemplate, typeName);
  let body: string;
  const headingWarnings: string[] = [];
  if (deps.bodyFile) {
    body = readFileSync(resolve(deps.projectRoot, deps.bodyFile), 'utf8');
    for (const heading of missingHeadings(bodyTemplate, body)) {
      headingWarnings.push(`The PR body is missing the template heading "${heading.trim()}".`);
    }
    if (headingWarnings.length > 0 && config.enforcement.agents === 'block') {
      return stopped(
        headingWarnings[0],
        headingWarnings.slice(1).map((w) => `> - 🟡 ${w}`),
      );
    }
  } else if (placeholdersIn(bodyTemplate).length > 0) {
    body = rendered.pr_body;
  } else {
    return stopped(NO_PLACEHOLDER_MESSAGE);
  }
  body = linkTicket(body, deps.inputs.ticket, matched, config.pull_requests.link_ticket);

  if (deps.dryRun) {
    return {
      exitCode: 0,
      output: [
        `**▸ paqad** · delivery dry run — nothing pushed`,
        `> type:    ${typeName}`,
        `> base:    ${base.value}`,
        `> branch:  ${rendered.branch}`,
        `> commit:  ${rendered.commit}`,
        `> PR title: ${rendered.pr_title}`,
        ``,
        body,
      ].join('\n'),
    };
  }

  const decision = deps.resolveOpenPr();
  if (decision.status === 'paused') {
    return { exitCode: 2, output: decision.message };
  }

  const { plan, lines: planned } = planLines(deps, config);
  const stepLines: string[] = [];

  if (!current) return stopped("Couldn't read the current branch. Check out a branch and re-run.");
  const branchPlan = planBranch(config, current, base.value, rendered.branch, typeName);
  if (!branchPlan.ok) return stopped(branchPlan.message);
  const branch = branchPlan.value.branch;
  if (branchPlan.value.create) {
    const created = await deps.shell.run('git', ['checkout', '-b', branch]);
    if (created.exitCode !== 0) {
      return stopped(
        `Failed to create branch ${branch}. Resolve the conflicting state and re-run delivery.`,
      );
    }
    if (deps.dirName) recordChangeConstants(deps.projectRoot, deps.dirName, { branch }, deps.now);
  }
  stepLines.push(`> - 🟢 branch ${branch}`);

  const committed = await commitStep(deps.shell, config, rendered.commit, {
    base: base.value,
    branch,
    requireWork: true,
  });
  if (!committed.ok) return stopped(committed.message, stepLines);
  stepLines.push(
    ...committed.value.warnings.map((warning) => `> - 🟡 ${warning}`),
    committed.value.committed
      ? `> - 🟢 commit ${rendered.commit.split('\n')[0]}`
      : `> - 🟢 commit (already committed on ${branch})`,
  );

  if (decision.choice === 'no') {
    return {
      exitCode: 0,
      output: [`**▸ paqad** · committed (no PR requested)`, ...stepLines].join('\n'),
    };
  }
  if (!plan.push) {
    return {
      exitCode: 0,
      output: [`**▸ paqad** · committed (push and PR skipped)`, ...stepLines, ...planned].join(
        '\n',
      ),
    };
  }

  const pushed = await deps.shell.run('git', ['push', '--set-upstream', 'origin', branch]);
  saveShip(deps, {
    push: { state: pushed.exitCode === 0 ? 'pushed' : 'failed', branch, sha: headSha(deps) },
  });
  if (pushed.exitCode !== 0) {
    return stopped(
      'git push failed. Check remote auth and branch protection before retrying.',
      stepLines,
    );
  }
  stepLines.push(`> - 🟢 push`);

  const titleStyle = styleVerdict(
    config,
    rendered.pr_title,
    config.pull_requests.title_template,
    'PR title',
  );
  if (titleStyle.block) return stopped(titleStyle.messages[0], stepLines);
  stepLines.push(
    ...titleStyle.messages.map((message) => `> - 🟡 ${message}`),
    ...headingWarnings.map((warning) => `> - 🟡 ${warning}`),
  );

  const draft = deps.draft || config.pull_requests.draft || decision.choice === 'draft';
  const labels = uniqueInOrder(config.pull_requests.labels, branchType?.labels ?? [], deps.labels);
  const reviewers = uniqueInOrder(config.pull_requests.reviewers, deps.reviewers);
  const targets = uniqueInOrder([base.value], config.pull_requests.also_open_against);
  const opened: PullRequest[] = [];
  for (const target of targets) {
    const result = await deps.host.openPR({
      title: rendered.pr_title,
      body,
      base: target,
      head: branch,
      draft,
      reviewers,
      labels,
    });
    if (!result.ok) {
      saveOpened(deps, opened, draft);
      return stopped(
        `${(result.output ?? result.remediation ?? 'gh pr create failed').trim()} ${MISSING_LABEL_HINT}`,
        stepLines,
      );
    }
    if (result.pr) opened.push(result.pr);
    stepLines.push(`> - 🟢 PR to ${target}${result.pr?.url ? ` ${result.pr.url}` : ''}`);
  }
  saveOpened(deps, opened, draft);
  stepLines.push(...queueMove(deps, matched, 'on_pr_open'));

  const sha = headSha(deps);
  const gate = await runCiGate(deps.host, branch, config.pull_requests.ci, {
    ...deps.ci,
    evidenceComment: deps.evidenceBody,
    onPoll: (status) => saveShip(deps, shipFromStatus(status, sha)),
  });
  saveShip(deps, shipFromGate(gate, sha));
  const green = gate.action === 'passed' || gate.action === 'warned' || gate.action === 'skipped';
  const moves = gate.state === 'green' ? queueMove(deps, matched, 'on_ci_green') : [];
  const glyph = green ? '🟢' : '🔴';
  const verdict = green ? 'Safe to merge' : 'Needs your attention';
  const evidenceLine =
    gate.evidenceCommentPosted === true
      ? '\n> - 🟢 posted the verification evidence to the PR'
      : '';
  return {
    exitCode: green ? 0 : 1,
    output:
      [
        `**▸ paqad** · delivery — ${verdict}`,
        ...stepLines,
        `> - ${glyph} ${gate.message}`,
        ...moves,
        ...planned,
      ].join('\n') + evidenceLine,
  };
}

function saveOpened(deps: DeliverDeps, opened: PullRequest[], draft: boolean): void {
  const [first, ...extra] = opened;
  if (!first) return;
  const sha = headSha(deps);
  saveShip(deps, {
    pr: { number: first.number, url: first.url, draft, state: 'open', head_sha: sha },
    ...(extra.length > 0
      ? {
          extra_prs: extra.map((pr) => ({
            number: pr.number,
            url: pr.url,
            draft,
            state: 'open' as const,
            head_sha: sha,
          })),
        }
      : {}),
  });
}

export function ticketMoveLine(action: DeliveryTicketAction): string {
  return `> - 🟡 ticket: move ${action.ticket} to "${action.to}" with your tracker tool, then run paqad-ai deliver ticket-done ${action.id}`;
}

function queueMove(
  deps: DeliverDeps,
  matched: MatchedSource | null,
  id: keyof TicketTransitions,
): string[] {
  const ticket = deps.inputs.ticket.trim();
  if (!matched || ticket === '') return [];
  const to = matched.source.transitions[id];
  if (!to) return [];
  const resolution = resolveTicketProvider(deps.servers ?? [], matched.source);
  const at = (deps.now ?? (() => new Date()))().toISOString();
  const action: DeliveryTicketAction = resolution.connected
    ? { id, ticket, source: matched.name, to, state: 'pending', reason: null, at: null }
    : {
        id,
        ticket,
        source: matched.name,
        to,
        state: 'skipped',
        reason: `no ${trackerName(resolution.kind)} connection`,
        at,
      };
  if (deps.dirName) {
    try {
      queueTicketAction(deps.projectRoot, deps.dirName, action, at);
    } catch (error) {
      appendHooksLog(
        deps.projectRoot,
        `deliver: ticket move not recorded: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (action.state === 'skipped') {
    return [`> - 🟡 skipped: ticket move to "${to}" (${action.reason})`];
  }
  return [ticketMoveLine(action)];
}

export interface TicketDoneDeps {
  projectRoot: string;
  dirName: string | null;
  id: string;
  failed?: string;
  skipped?: string;
  now?: () => Date;
}

export function runTicketDone(deps: TicketDoneDeps): DeliverResult {
  if (!(TICKET_ACTION_IDS as readonly string[]).includes(deps.id)) {
    return stopped(`${deps.id} isn't a ticket move. Use one of: ${TICKET_ACTION_IDS.join(', ')}.`);
  }
  if (deps.failed !== undefined && deps.skipped !== undefined) {
    return stopped('Pass --failed or --skipped, not both.');
  }
  if (!deps.dirName) {
    return stopped('No active change in this session, so there is no ticket move to record.');
  }
  const state =
    deps.failed !== undefined ? 'failed' : deps.skipped !== undefined ? 'skipped' : 'done';
  const reason = deps.failed ?? deps.skipped ?? null;
  const at = (deps.now ?? (() => new Date()))().toISOString();
  const settled = settleTicketAction(deps.projectRoot, deps.dirName, deps.id, state, reason, at);
  if (!settled.ok) return stopped(settled.message);
  const glyph = state === 'done' ? '🟢' : '🟡';
  const tail = reason ? ` (${reason})` : '';
  return {
    exitCode: 0,
    output: [
      `**▸ paqad** · ticket move recorded`,
      `> - ${glyph} ${settled.action.ticket} to "${settled.action.to}": ${state}${tail}`,
    ].join('\n'),
  };
}

export interface DeliverCommitDeps {
  projectRoot: string;
  shell: DeliveryShell;
  summary: string;
  ticket?: string;
  type?: string;
  scope?: string;
}

export function ticketFromBranch(config: ResolvedGitWorkflow, branch: string): string {
  return ticketInBranch(config, branch);
}

export async function runDeliverCommit(deps: DeliverCommitDeps): Promise<DeliverResult> {
  const current = await currentBranch(deps.shell);
  const preview = loadGitWorkflow(deps.projectRoot).config;
  const ticket = deps.ticket ?? (current ? ticketFromBranch(preview, current) : '');
  const inputs: DeliveryRenderInputs = {
    ticket,
    title: '',
    summary: deps.summary,
    scope: deps.scope,
  };
  const ready = await prepare(deps.projectRoot, deps.shell, inputs, deps.type);
  if ('result' in ready) return ready.result;
  const { config, typeName } = ready.prepared;
  const message = renderDelivery(config, inputs, '', typeName).commit;
  const committed = await commitStep(deps.shell, config, message, {
    base: null,
    branch: current ?? '',
    requireWork: false,
  });
  if (!committed.ok) return stopped(committed.message);
  return {
    exitCode: 0,
    output: [
      `**▸ paqad** · committed`,
      ...committed.value.warnings.map((warning) => `> - 🟡 ${warning}`),
      `> - 🟢 ${message.split('\n')[0]}`,
    ].join('\n'),
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

function shipFromStatus(status: ChecksStatus, sha: string | null): ShipPatch {
  const checks = countChecks(status);
  return {
    ci: {
      sha,
      state: CI_STATE[status.state],
      done: checks.done,
      total: checks.total,
      reason: null,
      source: 'ci-gate',
      jobs: status.checks.map((check) => ({
        status: check.state === 'green' || check.state === 'red' ? 'COMPLETED' : 'IN_PROGRESS',
        conclusion: check.state === 'green' ? 'SUCCESS' : check.state === 'red' ? 'FAILURE' : null,
        started_at: null,
        completed_at: null,
      })),
    },
  };
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

interface ShipsWith {
  context: string;
  evidence: DecisionOptionEvidence | undefined;
}

function shipsWith(projectRoot: string, dirName: string | null | undefined): ShipsWith {
  const none: ShipsWith = { context: '', evidence: undefined };
  if (!dirName) return none;
  try {
    const split = refreshCommitSplit(
      projectRoot,
      dirName,
      readFeatureDelivery(projectRoot, dirName),
    ).commit_split;
    if (split?.state !== 'known' || !split.own || !split.inherited) return none;
    const own = `${split.own.count} own commit${split.own.count === 1 ? '' : 's'}`;
    const riding = describeEarlierWork(split.inherited);
    const note =
      split.inherited.count > 0
        ? ' The commits from earlier work ship in this PR too unless you split the branch yourself; ' +
          'paqad never moves, cherry-picks or rebases commits.'
        : '';
    return {
      context: ` This PR carries ${own} and ${riding}.${note}`,
      evidence: { findings: [own, riding] },
    };
  } catch {
    return none;
  }
}

export function resolveOpenPrDecision(
  projectRoot: string,
  defaultChoice: string,
  dirName?: string | null,
): OpenPrDecision {
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
    const ships = shipsWith(projectRoot, dirName);
    const withEvidence = ships.evidence ? { evidence: ships.evidence } : {};
    createPendingDecision(projectRoot, {
      category: 'delivery.open_pr',
      title: 'Open a pull request for this change?',
      context:
        'Delivery is ready. Opening a PR pushes the branch to the remote — an outward-facing, ' +
        'hard-to-reverse action — so paqad is asking before it does.' +
        ships.context,
      options: [
        { option_key: 'yes', label: 'Open a PR now', ...withEvidence },
        { option_key: 'draft', label: 'Open a draft PR', ...withEvidence },
        { option_key: 'no', label: 'Commit only, no PR' },
      ],
      recommendation: normalizeChoice(defaultChoice) ? defaultChoice : 'yes',
      change: dirName ? featureChangeKey(dirName) : null,
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
  base?: string;
  draft: boolean;
  type?: string;
  ticket?: string;
  ticketType?: string;
  title: string;
  summary: string;
  scope?: string;
  openPr: string;
  reviewer?: string[];
  label?: string[];
  bodyFile?: string;
  session?: string;
}

async function hostIsConnected(
  shell: DeliveryShell,
  host: ResolvedGitWorkflow['pull_requests']['host'],
): Promise<boolean> {
  const remote = await shell.run('git', ['remote', 'get-url', 'origin']);
  if (remote.exitCode !== 0) return false;
  const gh = await shell.run('gh', ['--version']);
  return gh.exitCode === 0 && detectDeliveryHost(remote.stdout.trim()) === host;
}

function report(result: DeliverResult): void {
  if (result.exitCode === 0) {
    console.log(result.output);
  } else {
    console.error(result.output);
    process.exitCode = result.exitCode;
  }
}

function createDeliverCommitCommand(): Command {
  return new Command('commit')
    .description("Commit the staged changes with the team's commit message template")
    .requiredOption('--summary <text>', 'What changes, in plain words')
    .option('--ticket <ref>', 'Ticket ref (defaults to the one in the branch name)')
    .option('--type <name>', "Branch type from branches.yaml (defaults to the branch's type)")
    .option('--scope <scope>', 'Scope for templates that use {scope}')
    .option('--project-root <path>', 'Project root', process.cwd())
    .action(
      async (options: {
        summary: string;
        ticket?: string;
        type?: string;
        scope?: string;
        projectRoot: string;
      }) => {
        const projectRoot = resolve(options.projectRoot);
        report(
          await runDeliverCommit({
            projectRoot,
            shell: createDeliveryShell(projectRoot),
            summary: options.summary,
            ticket: options.ticket,
            type: options.type,
            scope: options.scope,
          }),
        );
      },
    );
}

function createTicketDoneCommand(): Command {
  return new Command('ticket-done')
    .description('Record a ticket move you made with your tracker tool')
    .argument('<id>', `The ticket move (${TICKET_ACTION_IDS.join(' or ')})`)
    .option('--failed <reason>', 'The move failed, and why')
    .option('--skipped <reason>', 'The move was skipped, and why')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--session <id>', 'Session id (defaults to SE_SESSION / CLAUDE_SESSION_ID)')
    .action(
      (
        id: string,
        options: { failed?: string; skipped?: string; projectRoot: string; session?: string },
      ) => {
        const projectRoot = resolve(options.projectRoot);
        report(
          runTicketDone({
            projectRoot,
            dirName: activeChange(projectRoot, options.session),
            id,
            failed: options.failed,
            skipped: options.skipped,
          }),
        );
      },
    );
}

export function createDeliveryCommand(): Command {
  return new Command('deliver')
    .description(
      "Deliver the change by the team's git workflow: branch, commit, PR (after asking), CI gate",
    )
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--dry-run', 'Render branch/commit/PR text without pushing', false)
    .option('--base <branch>', 'Base branch for the PR (a parent branch for a stacked PR)')
    .option('--draft', 'Open the PR as a draft', false)
    .option('--type <name>', 'Branch type from branches.yaml')
    .option('--title <title>', 'Change title (branch slug + PR title)', '')
    .option('--summary <summary>', 'What changes, in plain words', '')
    .option('--ticket <ref>', 'Linked ticket ref')
    .option(
      '--ticket-type <type>',
      "Tracker issue type, matched against a branch type's ticket_types",
    )
    .option('--scope <scope>', 'Scope for templates that use {scope}')
    .option('--open-pr <mode>', 'Recommended open_pr choice for the pause (yes|draft|no)', 'yes')
    .option('--reviewer <handle>', 'PR reviewer (repeatable)', collect, [])
    .option('--label <label>', 'PR label (repeatable)', collect, [])
    .option('--body-file <path>', 'A PR body you filled in from the team template')
    .option('--session <id>', 'Session id (defaults to SE_SESSION / CLAUDE_SESSION_ID)')
    .addCommand(createDeliverCommitCommand())
    .addCommand(createTicketDoneCommand())
    .action(async (options: DeliverOptions) => {
      const projectRoot = resolve(options.projectRoot);
      const shell = createDeliveryShell(projectRoot);
      const host = new GithubHostProvider(shell, { projectRoot });
      const dirName = activeChange(projectRoot, options.session);
      const config = loadGitWorkflow(projectRoot).config;
      report(
        await runDeliver({
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
          type: options.type,
          base: options.base ?? null,
          draft: options.draft,
          reviewers: options.reviewer ?? [],
          labels: options.label ?? [],
          bodyFile: options.bodyFile ?? null,
          shell,
          host,
          resolveOpenPr: () => resolveOpenPrDecision(projectRoot, options.openPr, dirName),
          evidenceBody: loadEvidenceBody(projectRoot),
          dirName,
          servers: readProjectProfile(projectRoot)?.mcp?.servers ?? [],
          hostConnected: options.dryRun
            ? true
            : await hostIsConnected(shell, config.pull_requests.host),
        }),
      );
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
