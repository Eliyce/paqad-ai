import type { ResolvedDeliveryCi } from '@/core/types/delivery-policy.js';

import type { ChecksState, HostProvider } from '@/providers/host-provider.js';

/**
 * Issue #42 — the delivery CI gate. Per `process.ci.gate`:
 *  - `wait_for_green` polls until checks are green (bounded by timeout_minutes);
 *    on red it applies `on_red`; on green it reports the `transition_on_green`.
 *  - `warn_only` reads once, surfaces status, never blocks.
 *  - `off` skips entirely.
 *
 * The clock + sleep are injected so the polling loop is unit-testable without
 * real waiting.
 */
export type CiGateAction =
  | 'passed'
  | 'failed_stop'
  | 'failed_comment_and_stop'
  | 'timed_out'
  | 'warned'
  | 'skipped';

export interface CiGateResult {
  action: CiGateAction;
  state: ChecksState;
  /** Ticket status to move to on green, when configured (else null). */
  transitionTo: string | null;
  message: string;
}

export interface CiGateOptions {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  /** Hard cap on poll iterations — a safety net independent of the clock. */
  maxPolls?: number;
}

export async function runCiGate(
  host: HostProvider,
  branch: string,
  ci: ResolvedDeliveryCi,
  options: CiGateOptions = {},
): Promise<CiGateResult> {
  const transitionOnGreen = ci.transition_on_green ? ci.transition_on_green : null;

  if (ci.gate === 'off') {
    return { action: 'skipped', state: 'unknown', transitionTo: null, message: 'CI gate is off.' };
  }

  if (ci.gate === 'warn_only') {
    const status = await host.getChecksStatus(branch);
    return {
      action: 'warned',
      state: status.state,
      transitionTo: status.state === 'green' ? transitionOnGreen : null,
      message: `CI is ${status.state} (warn-only — not blocking).`,
    };
  }

  // wait_for_green
  const now = options.now ?? (() => 0);
  const sleep = options.sleep ?? (async () => {});
  const pollIntervalMs = options.pollIntervalMs ?? 15_000;
  const maxPolls = options.maxPolls ?? 10_000;
  const deadline = now() + ci.timeout_minutes * 60_000;

  for (let poll = 0; poll < maxPolls; poll += 1) {
    const status = await host.getChecksStatus(branch);

    if (status.state === 'green') {
      return {
        action: 'passed',
        state: 'green',
        transitionTo: transitionOnGreen,
        message: 'CI is green.',
      };
    }

    if (status.state === 'red') {
      const action: CiGateAction =
        ci.on_red === 'comment_and_stop' ? 'failed_comment_and_stop' : 'failed_stop';
      return {
        action,
        state: 'red',
        transitionTo: null,
        message: `CI failed (${
          status.checks
            .filter((c) => c.state === 'red')
            .map((c) => c.name)
            .join(', ') || 'unknown check'
        }). Stopping per on_red=${ci.on_red}.`,
      };
    }

    if (now() >= deadline) {
      return {
        action: 'timed_out',
        state: status.state,
        transitionTo: null,
        message: `CI did not go green within ${ci.timeout_minutes} minute(s). Stopping.`,
      };
    }

    await sleep(pollIntervalMs);
  }

  /* v8 ignore next 6 -- safety backstop: the timeout check returns first in every real run; only reachable if maxPolls is hit before the deadline */
  return {
    action: 'timed_out',
    state: 'unknown',
    transitionTo: null,
    message: `CI gate exceeded the poll cap without a verdict. Stopping.`,
  };
}
