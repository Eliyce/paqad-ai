import { execa } from 'execa';

import { appendHooksLog } from '@/core/logging/hooks-log.js';
import type { ResolvedDeliveryPolicy } from '@/core/types/delivery-policy.js';
import {
  recordShip,
  resolveDeliveryFeatureByBranch,
  type CiState,
  type ShipPatch,
} from '@/feature-evidence/delivery.js';
import type { CapabilitySeam } from '@/kernel/registry.js';
import { loadDeliveryPolicy } from '@/pipeline/delivery-policy.js';
import { isOnPath } from '@/rule-scripts/execute.js';
import { recordProjectEvent } from '@/session-ledger/project-ledger.js';

import { AI_ATTRIBUTION_MARKERS, detectAiAttribution } from './ai-attribution.js';
import { shouldStripAiAttribution } from './attribution-config.js';
import { DELIVERY_EVIDENCE_DOC_TYPE, DELIVERY_EVIDENCE_SCHEMA_VERSION } from './delivery-ledger.js';

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
}

export interface DeliveryPrReading {
  number: number | null;
  url: string | null;
  draft: boolean | null;
}

export type CommandRunner = (command: string, args: string[]) => Promise<CommandRun>;

export interface DeliveryFinding {
  code: 'on-base-branch' | 'branch-shape' | 'ci-red' | 'ai-attribution';
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
  policy: ResolvedDeliveryPolicy;
  run: CommandRunner;
}

function allowedBranchTypes(policy: ResolvedDeliveryPolicy): string[] {
  return Array.from(new Set(Object.values(policy.process.branch.type_map))).filter(Boolean);
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

export function readRollup(rollup: unknown): DeliveryCiReading {
  const entries = Array.isArray(rollup) ? (rollup as Array<Record<string, unknown>>) : [];
  if (entries.length === 0) {
    return { state: 'unknown', done: 0, total: 0, reason: 'no checks reported' };
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
  return { state, done, total, reason: null };
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
  if (!policy.enabled) {
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

  const findings: DeliveryFinding[] = [];
  const base = policy.process.branch.base;

  if (branch === base) {
    findings.push({
      code: 'on-base-branch',
      message: `you're committing on \`${base}\` — the workflow expects a \`{type}/…\` branch you open a PR from.`,
    });
  } else {
    const types = allowedBranchTypes(policy);
    const shaped = types.some((type) => branch.startsWith(`${type}/`));
    if (!shaped && types.length > 0) {
      findings.push({
        code: 'branch-shape',
        message: `branch \`${branch}\` doesn't match the \`{type}/…\` convention (expected one of: ${types
          .map((type) => `${type}/`)
          .join(', ')}).`,
      });
    }
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
    'number,url,state,statusCheckRollup,body,isDraft',
  ]);
  if (prView.exitCode === 0) {
    ghAvailable = true;
    try {
      const pr = JSON.parse(prView.stdout) as {
        number?: number;
        url?: unknown;
        isDraft?: unknown;
        statusCheckRollup?: unknown;
        body?: unknown;
      };
      prBody = typeof pr.body === 'string' ? pr.body : '';
      prReading = {
        number: typeof pr.number === 'number' ? pr.number : null,
        url: typeof pr.url === 'string' ? pr.url : null,
        draft: typeof pr.isDraft === 'boolean' ? pr.isDraft : null,
      };
      ciReading = readRollup(pr.statusCheckRollup);
      if (policy.process.ci.gate === 'wait_for_green' && rollupHasFailure(pr.statusCheckRollup)) {
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

  return { ran: true, branch, commit, ghAvailable, findings, pr: prReading, ci: ciReading };
}

export function saveDeliveryReading(
  projectRoot: string,
  result: DeliveryCheckResult,
  now: () => Date = () => new Date(),
): void {
  if (!result.ran || !result.branch) return;
  try {
    const dirName = resolveDeliveryFeatureByBranch(projectRoot, result.branch);
    if (!dirName) return;
    const patch: ShipPatch = {};
    if (result.pr) patch.pr = result.pr;
    if (result.ci) patch.ci = { sha: result.commit, ...result.ci, source: 'stop-check' };
    if (Object.keys(patch).length > 0) recordShip(projectRoot, dirName, patch, now().toISOString());
  } catch (error) {
    appendHooksLog(
      projectRoot,
      `delivery-check: delivery.json not updated: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function formatDeliverySummary(result: DeliveryCheckResult): string {
  if (result.findings.length === 0) {
    return '';
  }
  const lines = result.findings.map((finding) => `> - 🟡 ${finding.message}`);
  return (
    `**▸ paqad** · checked how this change would ship\n` +
    `> Heads up — a delivery convention to tidy before you push (not blocking):\n` +
    lines.join('\n')
  );
}

export async function runDeliveryCapability(
  projectRoot: string,
  seam: CapabilitySeam,
  run: CommandRunner,
): Promise<DeliveryOutcome> {
  if (seam !== 'completion') {
    return NO_OP;
  }
  const { policy } = loadDeliveryPolicy(projectRoot);
  const result = await evaluateDelivery({ projectRoot, policy, run });
  if (!result.ran) {
    return NO_OP;
  }
  saveDeliveryReading(projectRoot, result);
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
  const summary = formatDeliverySummary(result);
  return summary ? { ran: true, blocking: false, summary } : NO_OP;
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
