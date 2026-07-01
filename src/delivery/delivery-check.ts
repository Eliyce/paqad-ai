// Delivery convention check (RCA Step 5b — the delivery capability's leaf logic).
//
// The delivery policy (`delivery-policy.yaml`) shipped with a loader, a schema, and
// detection, but had ZERO runtime consumer — a change could be committed straight to
// `main`, or with a non-conventional branch name, and nothing noticed. This is the
// consumer: at the completion (Stop) seam it reads HEAD branch/commit and the PR/CI
// state, then WARNS (never blocks — delivery is `mandatory:false`, warn-floor) on a
// convention violation, so a bad push is surfaced one turn late rather than never.
//
// Pure by construction: every subprocess goes through an injected `CommandRunner`, so
// the branch/commit/gh states are driven deterministically in tests with no real git
// or gh. `runDeliveryCapability` is the full capability behaviour with the runner as a
// parameter, so the kernel wrapper (src/kernel/capability.ts) is a one-line delegate
// and every branch here is unit-reachable.

import { execa } from 'execa';

import type { ResolvedDeliveryPolicy } from '@/core/types/delivery-policy.js';
import type { CapabilitySeam } from '@/kernel/registry.js';
import { loadDeliveryPolicy } from '@/pipeline/delivery-policy.js';
import { recordProjectEvent } from '@/session-ledger/project-ledger.js';

import { DELIVERY_EVIDENCE_DOC_TYPE, DELIVERY_EVIDENCE_SCHEMA_VERSION } from './delivery-ledger.js';

/** Result of one subprocess run. `exitCode !== 0` is a soft signal, never a throw. */
export interface CommandRun {
  stdout: string;
  exitCode: number;
}

/** Runs a command and resolves its result. Never rejects (the execa-backed impl uses
 *  `reject:false`); a missing binary resolves to a non-zero `exitCode`. */
export type CommandRunner = (command: string, args: string[]) => Promise<CommandRun>;

/** One delivery-convention deviation. `code` is stable (for the ledger); `message` is
 *  the plain-English line surfaced to the developer. */
export interface DeliveryFinding {
  code: 'on-base-branch' | 'branch-shape' | 'ci-red';
  message: string;
}

export interface DeliveryCheckResult {
  /** False when there was nothing to check (policy disabled, or no real branch). */
  ran: boolean;
  branch: string | null;
  commit: string | null;
  /** True when `gh` answered for this branch's PR (present, authed, PR exists). */
  ghAvailable: boolean;
  findings: DeliveryFinding[];
}

/** A non-blocking capability outcome. Structurally a kernel `CapabilityOutcome`; kept
 *  local so this module never imports the kernel at runtime. */
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

/** The conventional-commit `{type}` set the branch template accepts, derived from the
 *  policy's `type_map` values (feat, fix, chore, …). */
function allowedBranchTypes(policy: ResolvedDeliveryPolicy): string[] {
  return Array.from(new Set(Object.values(policy.process.branch.type_map))).filter(Boolean);
}

/** Read one trimmed line of stdout from a command, or null when it failed / was empty. */
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

/** True when the gh `statusCheckRollup` array carries at least one failing check. */
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

/**
 * Decide the delivery-convention findings for the current HEAD. Best-effort and
 * non-blocking: a disabled policy or a missing/detached branch yields `ran:false`
 * (nothing to check), and a gh that cannot answer degrades to skipping the PR/CI
 * checks (never a warning about gh itself).
 */
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
  // No branch, or a detached HEAD (`rev-parse` prints "HEAD"): nothing to check.
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
    // Branch-shape: the conventional template starts with a known {type} segment.
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

  // PR / CI is optional: gh may be absent, unauthenticated, or the branch may have no
  // PR yet. Any of those → skip the CI check gracefully (never warn about gh).
  let ghAvailable = false;
  const prView = await run('gh', [
    'pr',
    'view',
    branch,
    '--json',
    'number,url,state,statusCheckRollup',
  ]);
  if (prView.exitCode === 0) {
    ghAvailable = true;
    try {
      const pr = JSON.parse(prView.stdout) as { number?: number; statusCheckRollup?: unknown };
      if (policy.process.ci.gate === 'wait_for_green' && rollupHasFailure(pr.statusCheckRollup)) {
        const label = typeof pr.number === 'number' ? ` for PR #${pr.number}` : '';
        findings.push({
          code: 'ci-red',
          message: `CI is red${label} — the delivery policy gates merge on green (\`wait_for_green\`).`,
        });
      }
    } catch {
      // gh answered but the JSON was unexpected — treat as no CI signal, never crash.
      ghAvailable = false;
    }
  }

  return { ran: true, branch, commit, ghAvailable, findings };
}

/**
 * Render the delivery findings as the paqad-voice warn block. Delivery is warn-floor
 * (never blocking), so it always speaks in the 🟡 "Heads up" register. Empty findings
 * render to '' (the capability turns that into a NO_OP).
 */
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

/**
 * The full delivery capability behaviour, with the subprocess runner injected so every
 * branch is unit-reachable without spawning real git/gh. The kernel wrapper supplies an
 * execa-backed runner. Only evaluates at the completion seam; no-ops elsewhere.
 */
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
  // Best-effort evidence (recordProjectEvent swallows its own IO errors).
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

/**
 * The real subprocess runner for the delivery capability. `reject:false` so a non-zero
 * exit (or a missing binary — `gh` absent) resolves to a code instead of throwing; a
 * spawn failure leaves `exitCode` undefined, which we normalise to `1` so the check
 * reads it as "could not answer" and degrades gracefully.
 */
export const execaCommandRunner: CommandRunner = async (command, args) => {
  const result = await execa(command, args, { reject: false });
  return { stdout: result.stdout, exitCode: result.exitCode ?? 1 };
};
