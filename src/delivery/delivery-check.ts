import { execa } from 'execa';

import { appendHooksLog } from '@/core/logging/hooks-log.js';
import {
  pendingTicketActions,
  readFeatureDelivery,
  recordShip,
  resolveDeliveryFeatureByBranch,
  type DeliveryCiRead,
  type CiState,
  type DeliveryCiJob,
  type DeliveryPrState,
  type ShipPatch,
} from '@/feature-evidence/delivery.js';
import type { CapabilitySeam } from '@/kernel/registry.js';
import { loadGitWorkflow } from '@/git-workflow/load.js';
import type { GitWorkflowIssue, ResolvedGitWorkflow } from '@/git-workflow/types.js';
import { isOnPath } from '@/rule-scripts/execute.js';
import { recordProjectEvent } from '@/session-ledger/project-ledger.js';

import { AI_ATTRIBUTION_MARKERS, detectAiAttribution } from './ai-attribution.js';
import { shouldStripAiAttribution } from './attribution-config.js';
import { DELIVERY_EVIDENCE_DOC_TYPE, DELIVERY_EVIDENCE_SCHEMA_VERSION } from './delivery-ledger.js';
import { isConfiguredBase, isGlob } from './runner.js';
import {
  BLOCKING_CODES,
  SUBJECT_FORMAT,
  branchFinding,
  commitFindings,
  expectedBase,
  invalidFinding,
  onBaseFinding,
  parseSubjects,
  prFindings,
  type WorkflowFindingCode,
} from './workflow-findings.js';

export interface CommandRun {
  stdout: string;
  exitCode: number;
  stderr?: string;
  timedOut?: boolean;
  missing?: boolean;
}

export const GH_TIMEOUT_MS = 10_000;

export interface DeliveryCiReading {
  state: CiState;
  done: number | null;
  total: number | null;
  reason: string | null;
  jobs?: DeliveryCiJob[];
}

export interface DeliveryPrReading {
  number: number | null;
  url: string | null;
  draft: boolean | null;
  state?: DeliveryPrState | null;
  head_sha?: string | null;
  changed_files?: number | null;
  additions?: number | null;
  deletions?: number | null;
}

export type CommandRunner = (command: string, args: string[]) => Promise<CommandRun>;

export interface DeliveryFinding {
  code: WorkflowFindingCode | 'ci-red' | 'ai-attribution';
  message: string;
}

export interface DeliveryCheckResult {
  ran: boolean;
  branch: string | null;
  commit: string | null;
  ghAvailable: boolean;
  findings: DeliveryFinding[];
  pr?: DeliveryPrReading | null;
  ci?: DeliveryCiReading | null;
  upstream?: string | null;
}

interface DeliveryOutcome {
  ran: boolean;
  blocking: boolean;
  summary: string;
}

const NO_CHECK: DeliveryCheckResult = {
  ran: false,
  branch: null,
  commit: null,
  ghAvailable: false,
  findings: [],
};

const NO_OP: DeliveryOutcome = { ran: false, blocking: false, summary: '' };

export interface EvaluateDeliveryInput {
  projectRoot: string;
  policy: ResolvedGitWorkflow;
  run: CommandRunner;
  errors?: GitWorkflowIssue[];
}

async function branchSubjectFindings(
  run: CommandRunner,
  projectRoot: string,
  policy: ResolvedGitWorkflow,
  branch: string,
): Promise<DeliveryFinding[]> {
  const base = expectedBase(policy, branch);
  if (isGlob(base)) return [];
  for (const ref of [base, `origin/${base}`]) {
    const result = await run('git', [
      '-C',
      projectRoot,
      'log',
      `${ref}..HEAD`,
      `--format=${SUBJECT_FORMAT}`,
    ]);
    if (result.exitCode !== 0) continue;
    return parseSubjects(result.stdout).flatMap((commit) => commitFindings(policy, commit));
  }
  return [];
}

async function committedOnBase(
  run: CommandRunner,
  projectRoot: string,
  branch: string,
): Promise<boolean> {
  const ahead = await readLine(run, 'git', [
    '-C',
    projectRoot,
    'rev-list',
    '--count',
    `origin/${branch}..HEAD`,
  ]);
  return ahead !== null && /^\d+$/.test(ahead) && Number.parseInt(ahead, 10) > 0;
}

function labelNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (entry as { name?: unknown }).name)
    .filter((name): name is string => typeof name === 'string');
}

async function readLine(
  run: CommandRunner,
  command: string,
  args: string[],
): Promise<string | null> {
  const result = await run(command, args);
  if (result.exitCode !== 0) {
    return null;
  }
  const line = result.stdout.trim();
  return line.length > 0 ? line : null;
}

async function readBranchCommitMessages(
  run: CommandRunner,
  projectRoot: string,
  branch: string,
  base: string,
): Promise<string> {
  const range = branch === base ? ['-1'] : [`${base}..HEAD`];
  const result = await run('git', ['-C', projectRoot, 'log', ...range, '--format=%B']);
  return result.exitCode === 0 ? result.stdout : '';
}

function attributionFindings(commitMessages: string, prBody: string): DeliveryFinding[] {
  const inCommits = new Map(
    detectAiAttribution(commitMessages).map((match) => [match.marker.id, match.marker]),
  );
  const inPrBody = new Map(
    detectAiAttribution(prBody).map((match) => [match.marker.id, match.marker]),
  );

  const findings: DeliveryFinding[] = [];
  for (const marker of AI_ATTRIBUTION_MARKERS) {
    const commits = inCommits.has(marker.id);
    const body = inPrBody.has(marker.id);
    if (!commits && !body) {
      continue;
    }
    const where =
      commits && body ? 'your commits and the PR body' : commits ? 'your commits' : 'the PR body';
    findings.push({
      code: 'ai-attribution',
      message:
        `${marker.vendor} attribution is on ${where}. That trailer is what makes the repo list ` +
        `an AI vendor as a contributor. ${marker.remediation}`,
    });
  }
  return findings;
}

const FAILING = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED']);

function rollupHasFailure(rollup: unknown): boolean {
  if (!Array.isArray(rollup)) {
    return false;
  }
  return rollup.some((entry) => {
    const check = entry as { conclusion?: unknown; state?: unknown };
    const conclusion = typeof check.conclusion === 'string' ? check.conclusion.toUpperCase() : '';
    const state = typeof check.state === 'string' ? check.state.toUpperCase() : '';
    return FAILING.has(conclusion) || FAILING.has(state);
  });
}

const PASSING = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);

function upper(value: unknown): string {
  return typeof value === 'string' ? value.toUpperCase() : '';
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

const FULL_SHA = /^[0-9a-f]{40}$/;

function shaOrNull(value: unknown): string | null {
  return typeof value === 'string' && FULL_SHA.test(value) ? value : null;
}

function countOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

export function rollupJobs(rollup: unknown): DeliveryCiJob[] {
  const entries = Array.isArray(rollup) ? (rollup as Array<Record<string, unknown>>) : [];
  return entries.map((entry) => ({
    status: textOrNull(entry.status) ?? textOrNull(entry.state),
    conclusion: textOrNull(entry.conclusion),
    started_at: textOrNull(entry.startedAt),
    completed_at: textOrNull(entry.completedAt),
  }));
}

const PR_STATES: Readonly<Record<string, DeliveryPrState>> = {
  OPEN: 'open',
  MERGED: 'merged',
  CLOSED: 'closed',
};

export function readPrState(value: unknown): DeliveryPrState | null {
  return PR_STATES[upper(value)] ?? null;
}

export function readRollup(rollup: unknown): DeliveryCiReading {
  const entries = Array.isArray(rollup) ? (rollup as Array<Record<string, unknown>>) : [];
  if (entries.length === 0) {
    return { state: 'unknown', done: 0, total: 0, reason: 'no checks reported', jobs: [] };
  }
  let done = 0;
  let failed = false;
  for (const entry of entries) {
    const outcome = upper(entry.conclusion) || upper(entry.state);
    if (FAILING.has(outcome)) failed = true;
    if (FAILING.has(outcome) || PASSING.has(outcome)) done += 1;
  }
  const total = entries.length;
  const state: CiState = failed ? 'fail' : done === total ? 'pass' : 'pending';
  return { state, done, total, reason: null, jobs: rollupJobs(entries) };
}

export function ghFailureReason(result: CommandRun): string {
  const text = `${result.stderr ?? ''}\n${result.stdout}`.toLowerCase();
  if (result.timedOut) return `gh timed out after ${GH_TIMEOUT_MS / 1000} s`;
  if (result.missing) return 'gh is not installed';
  if (text.includes('rate limit')) return 'gh is rate-limited';
  if (text.includes('auth login') || text.includes('not logged in')) return 'gh is signed out';
  if (text.includes('no pull requests found')) return 'no pull request for this branch';
  return 'gh could not read the pull request';
}

export async function evaluateDelivery(input: EvaluateDeliveryInput): Promise<DeliveryCheckResult> {
  const { projectRoot, policy, run } = input;
  if (!policy.enforcement.enabled) {
    return NO_CHECK;
  }

  const branch = await readLine(run, 'git', [
    '-C',
    projectRoot,
    'rev-parse',
    '--abbrev-ref',
    'HEAD',
  ]);
  if (!branch || branch === 'HEAD') {
    return NO_CHECK;
  }
  const commit = await readLine(run, 'git', ['-C', projectRoot, 'rev-parse', 'HEAD']);
  const upstream = await readLine(run, 'git', ['-C', projectRoot, 'rev-parse', '@{upstream}']);

  if (input.errors && input.errors.length > 0) {
    return {
      ran: true,
      branch,
      commit,
      ghAvailable: false,
      findings: [invalidFinding(input.errors)],
      upstream,
    };
  }

  const findings: DeliveryFinding[] = [];
  const base = policy.branches.base_branch;
  const onBase = isConfiguredBase(policy, branch);

  if (onBase) {
    if (await committedOnBase(run, projectRoot, branch)) findings.push(onBaseFinding(branch));
  } else {
    const shape = branchFinding(policy, branch);
    if (shape) findings.push(shape);
    findings.push(...(await branchSubjectFindings(run, projectRoot, policy, branch)));
  }

  let ghAvailable = false;
  let prBody = '';
  let prReading: DeliveryPrReading | null = null;
  let ciReading: DeliveryCiReading;
  const prView = await run('gh', [
    'pr',
    'view',
    branch,
    '--json',
    'number,url,state,headRefOid,statusCheckRollup,body,isDraft,changedFiles,additions,deletions,baseRefName,title,labels',
  ]);
  if (prView.exitCode === 0) {
    ghAvailable = true;
    try {
      const pr = JSON.parse(prView.stdout) as {
        number?: number;
        url?: unknown;
        state?: unknown;
        headRefOid?: unknown;
        isDraft?: unknown;
        statusCheckRollup?: unknown;
        body?: unknown;
        changedFiles?: unknown;
        additions?: unknown;
        deletions?: unknown;
        baseRefName?: unknown;
        title?: unknown;
        labels?: unknown;
      };
      prBody = typeof pr.body === 'string' ? pr.body : '';
      prReading = {
        number: typeof pr.number === 'number' ? pr.number : null,
        url: typeof pr.url === 'string' ? pr.url : null,
        draft: typeof pr.isDraft === 'boolean' ? pr.isDraft : null,
        state: readPrState(pr.state),
        head_sha: shaOrNull(pr.headRefOid),
        changed_files: countOrNull(pr.changedFiles),
        additions: countOrNull(pr.additions),
        deletions: countOrNull(pr.deletions),
      };
      ciReading = readRollup(pr.statusCheckRollup);
      if (!onBase) {
        findings.push(
          ...prFindings(policy, branch, {
            number: prReading.number,
            base: textOrNull(pr.baseRefName),
            title: typeof pr.title === 'string' ? pr.title : null,
            labels: labelNames(pr.labels),
            body: prBody,
          }),
        );
      }
      if (
        policy.pull_requests.ci.gate === 'wait_for_green' &&
        rollupHasFailure(pr.statusCheckRollup)
      ) {
        const label = typeof pr.number === 'number' ? ` for PR #${pr.number}` : '';
        findings.push({
          code: 'ci-red',
          message: `CI is red${label} — the delivery policy gates merge on green (\`wait_for_green\`).`,
        });
      }
    } catch {
      ghAvailable = false;
      prReading = null;
      ciReading = {
        state: 'unknown',
        done: null,
        total: null,
        reason: 'gh returned unreadable output',
      };
    }
  } else {
    ciReading = { state: 'unknown', done: null, total: null, reason: ghFailureReason(prView) };
  }

  if (shouldStripAiAttribution(projectRoot)) {
    const commitMessages = await readBranchCommitMessages(run, projectRoot, branch, base);
    findings.push(...attributionFindings(commitMessages, prBody));
  }

  findings.push(...pendingMoveFindings(projectRoot, branch));

  return {
    ran: true,
    branch,
    commit,
    ghAvailable,
    findings,
    pr: prReading,
    ci: ciReading,
    upstream,
  };
}

export function pendingMoveFindings(projectRoot: string, branch: string): DeliveryFinding[] {
  try {
    const dirName = resolveDeliveryFeatureByBranch(projectRoot, branch);
    if (!dirName) return [];
    return pendingTicketActions(readFeatureDelivery(projectRoot, dirName)).map((action) => ({
      code: 'ticket-move-pending' as const,
      message: `ticket move to "${action.to}" not confirmed`,
    }));
  } catch {
    return [];
  }
}

function pushedHead(result: DeliveryCheckResult): string | null {
  const head = shaOrNull(result.commit);
  if (!head) return null;
  return result.upstream === head || result.pr?.head_sha === head ? head : null;
}

export interface SaveReadingOptions {
  startedAt?: string;
  keepOnGhFailure?: boolean;
}

function ciReadOf(result: DeliveryCheckResult): Omit<DeliveryCiRead, 'at'> {
  if (result.ghAvailable) return { ok: true, reason: null };
  return { ok: false, reason: result.ci?.reason ?? 'gh could not read the pull request' };
}

export function saveDeliveryReading(
  projectRoot: string,
  result: DeliveryCheckResult,
  now: () => Date = () => new Date(),
  options: SaveReadingOptions = {},
): void {
  if (!result.ran || !result.branch) return;
  try {
    const dirName = resolveDeliveryFeatureByBranch(projectRoot, result.branch);
    if (!dirName) return;
    const patch: ShipPatch = { ci_read: ciReadOf(result) };
    if (options.startedAt) patch.read_at = options.startedAt;
    const pushed = pushedHead(result);
    if (pushed) patch.push = { state: 'pushed', branch: result.branch, sha: pushed };
    const keep = options.keepOnGhFailure === true && !result.ghAvailable;
    if (result.pr && !keep) patch.pr = result.pr;
    if (result.ci && !keep) {
      const sha = shaOrNull(result.pr?.head_sha) ?? shaOrNull(result.commit);
      patch.ci = { sha, ...result.ci, source: 'stop-check' };
    }
    recordShip(projectRoot, dirName, patch, now().toISOString());
  } catch (error) {
    appendHooksLog(
      projectRoot,
      `delivery-check: delivery.json not updated: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export interface DeliveryRefreshOutcome {
  refreshed: boolean;
  feature: string | null;
  reason: string | null;
  push: string | null;
  ci: { state: CiState; done: number | null; total: number | null } | null;
}

export interface RefreshDeliveryInput {
  projectRoot: string;
  run: CommandRunner;
  now?: () => Date;
  minAgeSeconds?: number | null;
}

function storedOutcome(
  projectRoot: string,
  feature: string,
  refreshed: boolean,
  reason: string | null,
): DeliveryRefreshOutcome {
  const record = readFeatureDelivery(projectRoot, feature);
  const ci = record.ci ?? null;
  return {
    refreshed,
    feature,
    reason,
    push: record.push?.state ?? null,
    ci: ci ? { state: ci.state, done: ci.done, total: ci.total } : null,
  };
}

function readIsFresh(
  read: DeliveryCiRead | null | undefined,
  minAgeSeconds: number | null | undefined,
  now: Date,
): boolean {
  if (!read || !minAgeSeconds || minAgeSeconds <= 0) return false;
  const age = now.getTime() - Date.parse(read.at);
  return Number.isFinite(age) && age >= 0 && age < minAgeSeconds * 1000;
}

export async function refreshDelivery(
  input: RefreshDeliveryInput,
): Promise<DeliveryRefreshOutcome> {
  const { projectRoot, run } = input;
  const now = input.now ?? (() => new Date());
  const skip = (reason: string): DeliveryRefreshOutcome => ({
    refreshed: false,
    feature: null,
    reason,
    push: null,
    ci: null,
  });
  const policy = loadGitWorkflow(projectRoot).config;
  if (!policy.enforcement.enabled) return skip('delivery policy is off');
  const branch = await readLine(run, 'git', [
    '-C',
    projectRoot,
    'rev-parse',
    '--abbrev-ref',
    'HEAD',
  ]);
  if (!branch || branch === 'HEAD') return skip('no branch');
  const feature = resolveDeliveryFeatureByBranch(projectRoot, branch);
  if (!feature) return skip('no change on this branch');
  const stored = readFeatureDelivery(projectRoot, feature).ci_read;
  if (readIsFresh(stored, input.minAgeSeconds, now())) {
    return storedOutcome(projectRoot, feature, false, 'fresh');
  }
  const startedAt = now().toISOString();
  const result = await evaluateDelivery({ projectRoot, policy, run });
  if (!result.ran) return skip('no branch');
  saveDeliveryReading(projectRoot, result, now, { startedAt, keepOnGhFailure: true });
  const reason = ciReadOf(result).reason;
  return storedOutcome(projectRoot, feature, result.ghAvailable, reason);
}

export function isBlockingFinding(finding: DeliveryFinding): boolean {
  return BLOCKING_CODES.has(finding.code);
}

export function formatDeliverySummary(result: DeliveryCheckResult, blocking = false): string {
  if (result.findings.length === 0) {
    return '';
  }
  const lines = result.findings.map(
    (finding) => `> - ${blocking && isBlockingFinding(finding) ? '🔴' : '🟡'} ${finding.message}`,
  );
  const lead = blocking
    ? `> 🔴 Needs your attention: this team's git workflow (agents: block) holds this turn until these are fixed:\n`
    : `> Heads up — a delivery convention to tidy before you push (not blocking):\n`;
  return `**▸ paqad** · checked how this change would ship\n` + lead + lines.join('\n');
}

export async function runDeliveryCapability(
  projectRoot: string,
  seam: CapabilitySeam,
  run: CommandRunner,
): Promise<DeliveryOutcome> {
  if (seam !== 'completion') {
    return NO_OP;
  }
  const loaded = loadGitWorkflow(projectRoot);
  const policy = loaded.config;
  const startedAt = new Date().toISOString();
  const result = await evaluateDelivery({ projectRoot, policy, run, errors: loaded.errors });
  if (!result.ran) {
    return NO_OP;
  }
  if (loaded.valid) saveDeliveryReading(projectRoot, result, undefined, { startedAt });
  recordProjectEvent(
    projectRoot,
    DELIVERY_EVIDENCE_DOC_TYPE,
    {
      kind: 'delivery-check',
      branch: result.branch,
      commit: result.commit,
      gh_available: result.ghAvailable,
      findings: result.findings,
    },
    DELIVERY_EVIDENCE_SCHEMA_VERSION,
  );
  const blocking =
    loaded.valid &&
    policy.enforcement.agents === 'block' &&
    result.findings.some((finding) => isBlockingFinding(finding));
  const summary = formatDeliverySummary(result, blocking);
  return summary ? { ran: true, blocking, summary } : NO_OP;
}

export const execaCommandRunner: CommandRunner = async (command, args) => {
  const result = await execa(command, args, { reject: false, timeout: GH_TIMEOUT_MS });
  const missing =
    (result as { code?: string }).code === 'ENOENT' ||
    (result.exitCode !== 0 && !result.timedOut && !isOnPath(command));
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode ?? 1,
    timedOut: result.timedOut,
    missing,
  };
};
