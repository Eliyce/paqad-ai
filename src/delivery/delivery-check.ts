import { execa } from 'execa';

import type { ResolvedDeliveryPolicy } from '@/core/types/delivery-policy.js';
import type { CapabilitySeam } from '@/kernel/registry.js';
import { loadDeliveryPolicy } from '@/pipeline/delivery-policy.js';
import { recordProjectEvent } from '@/session-ledger/project-ledger.js';

import { AI_ATTRIBUTION_MARKERS, detectAiAttribution } from './ai-attribution.js';
import { shouldStripAiAttribution } from './attribution-config.js';
import { DELIVERY_EVIDENCE_DOC_TYPE, DELIVERY_EVIDENCE_SCHEMA_VERSION } from './delivery-ledger.js';

export interface CommandRun {
  stdout: string;
  exitCode: number;
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

function rollupHasFailure(rollup: unknown): boolean {
  if (!Array.isArray(rollup)) {
    return false;
  }
  const failing = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED']);
  return rollup.some((entry) => {
    const check = entry as { conclusion?: unknown; state?: unknown };
    const conclusion = typeof check.conclusion === 'string' ? check.conclusion.toUpperCase() : '';
    const state = typeof check.state === 'string' ? check.state.toUpperCase() : '';
    return failing.has(conclusion) || failing.has(state);
  });
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
  const prView = await run('gh', [
    'pr',
    'view',
    branch,
    '--json',
    'number,url,state,statusCheckRollup,body',
  ]);
  if (prView.exitCode === 0) {
    ghAvailable = true;
    try {
      const pr = JSON.parse(prView.stdout) as {
        number?: number;
        statusCheckRollup?: unknown;
        body?: unknown;
      };
      prBody = typeof pr.body === 'string' ? pr.body : '';
      if (policy.process.ci.gate === 'wait_for_green' && rollupHasFailure(pr.statusCheckRollup)) {
        const label = typeof pr.number === 'number' ? ` for PR #${pr.number}` : '';
        findings.push({
          code: 'ci-red',
          message: `CI is red${label} — the delivery policy gates merge on green (\`wait_for_green\`).`,
        });
      }
    } catch {
      ghAvailable = false;
    }
  }

  if (shouldStripAiAttribution(projectRoot)) {
    const commitMessages = await readBranchCommitMessages(run, projectRoot, branch, base);
    findings.push(...attributionFindings(commitMessages, prBody));
  }

  return { ran: true, branch, commit, ghAvailable, findings };
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
  const result = await execa(command, args, { reject: false });
  return { stdout: result.stdout, exitCode: result.exitCode ?? 1 };
};
