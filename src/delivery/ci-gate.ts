import type { ResolvedCi } from '@/git-workflow/types.js';
import type { ChecksState, ChecksStatus, HostProvider } from '@/providers/host-provider.js';

export type CiGateAction =
  'passed' | 'failed_stop' | 'failed_comment_and_stop' | 'timed_out' | 'warned' | 'skipped';

export interface CiGateResult {
  action: CiGateAction;
  state: ChecksState;
  message: string;
  evidenceCommentPosted?: boolean;
  checks?: CheckCounts;
}

export interface CheckCounts {
  done: number;
  total: number;
}

export function countChecks(status: ChecksStatus): CheckCounts {
  return {
    done: status.checks.filter((check) => check.state === 'green' || check.state === 'red').length,
    total: status.checks.length,
  };
}

export interface CiGateOptions {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  maxPolls?: number;
  evidenceComment?: string | null;
  onPoll?: (status: ChecksStatus) => void;
}

export const CI_REFRESH_INTERVAL_MS = 60_000;

export function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function pollBudget(timeoutMinutes: number, pollIntervalMs: number): number {
  return Math.ceil((timeoutMinutes * 60_000) / Math.max(1, pollIntervalMs)) + 1;
}

async function postEvidence(
  host: HostProvider,
  branch: string,
  body: string | null | undefined,
): Promise<boolean> {
  if (!body) return false;
  try {
    const result = await host.comment(branch, body);
    return result.ok;
  } catch {
    return false;
  }
}

export async function runCiGate(
  host: HostProvider,
  branch: string,
  ci: ResolvedCi,
  options: CiGateOptions = {},
): Promise<CiGateResult> {
  if (ci.gate === 'off') {
    return { action: 'skipped', state: 'unknown', message: 'CI gate is off.' };
  }

  if (ci.gate === 'warn_only') {
    const status = await host.getChecksStatus(branch);
    return {
      action: 'warned',
      state: status.state,
      message: `CI is ${status.state} (warn-only — not blocking).`,
      checks: countChecks(status),
    };
  }

  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? waitFor;
  const pollIntervalMs = options.pollIntervalMs ?? CI_REFRESH_INTERVAL_MS;
  const maxPolls = Math.max(1, options.maxPolls ?? pollBudget(ci.timeout_minutes, pollIntervalMs));
  const deadline = now() + ci.timeout_minutes * 60_000;
  let last: ChecksStatus = { state: 'unknown', checks: [] };

  for (let poll = 0; poll < maxPolls; poll += 1) {
    const status = await host.getChecksStatus(branch);
    last = status;
    options.onPoll?.(status);

    if (status.state === 'green') {
      const evidenceCommentPosted = await postEvidence(host, branch, options.evidenceComment);
      return {
        action: 'passed',
        state: 'green',
        message: 'CI is green.',
        evidenceCommentPosted,
        checks: countChecks(status),
      };
    }

    if (status.state === 'red') {
      const commentAndStop = ci.on_red === 'comment_and_stop';
      const action: CiGateAction = commentAndStop ? 'failed_comment_and_stop' : 'failed_stop';
      const evidenceCommentPosted = commentAndStop
        ? await postEvidence(host, branch, options.evidenceComment)
        : false;
      return {
        action,
        state: 'red',
        message: `CI failed (${
          status.checks
            .filter((c) => c.state === 'red')
            .map((c) => c.name)
            .join(', ') || 'unknown check'
        }). Stopping per on_red=${ci.on_red}.`,
        evidenceCommentPosted,
        checks: countChecks(status),
      };
    }

    if (now() >= deadline) {
      return {
        action: 'timed_out',
        state: status.state,
        message: `CI did not go green within ${ci.timeout_minutes} minute(s). Stopping.`,
        checks: countChecks(status),
      };
    }

    if (poll + 1 < maxPolls) await sleep(pollIntervalMs);
  }

  return {
    action: 'timed_out',
    state: last.state,
    message: `CI gate read the checks ${maxPolls} time(s) without a verdict. Stopping.`,
    checks: countChecks(last),
  };
}
