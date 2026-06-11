import type { DeliveryShell } from '@/delivery/runner.js';

import type {
  ChecksState,
  ChecksStatus,
  HostProvider,
  HostStepResult,
  OpenPrInput,
  PullRequest,
} from './host-provider.js';

/**
 * Issue #42 — the GitHub adapter. Git operations shell out to `git`; PR and
 * check-status operations shell out to `gh`. The shell is injected (same
 * `DeliveryShell` seam the delivery runner uses) so this is fully testable
 * without touching a real remote.
 */
export class GithubHostProvider implements HostProvider {
  readonly kind = 'github' as const;

  constructor(private readonly shell: DeliveryShell) {}

  async ensureBranch(name: string, base: string): Promise<HostStepResult> {
    // Cut the new branch from the configured base so the team's base-branch
    // convention is honored even when the working tree sits elsewhere.
    const result = await this.shell.run('git', ['checkout', '-b', name, base]);
    return {
      ok: result.exitCode === 0,
      output: result.stderr || result.stdout,
      remediation:
        result.exitCode === 0
          ? undefined
          : `Failed to create branch ${name} from ${base}. Resolve the conflicting state and re-run delivery.`,
    };
  }

  async commit(message: string): Promise<HostStepResult> {
    const result = await this.shell.run('git', ['commit', '-m', message]);
    return {
      ok: result.exitCode === 0,
      output: result.stderr || result.stdout,
      remediation:
        result.exitCode === 0
          ? undefined
          : 'git commit failed. Stage changes (git add) and re-run delivery; do not skip pre-commit hooks.',
    };
  }

  async push(branch: string): Promise<HostStepResult> {
    const result = await this.shell.run('git', ['push', '--set-upstream', 'origin', branch]);
    return {
      ok: result.exitCode === 0,
      output: result.stderr || result.stdout,
      remediation:
        result.exitCode === 0
          ? undefined
          : 'git push failed. Check remote auth and branch protection before retrying.',
    };
  }

  async openPR(input: OpenPrInput): Promise<HostStepResult & { pr?: PullRequest }> {
    const args = [
      'pr',
      'create',
      '--base',
      input.base,
      '--head',
      input.head,
      '--title',
      input.title,
      '--body',
      input.body,
    ];
    if (input.draft) {
      args.push('--draft');
    }
    for (const reviewer of input.reviewers) {
      args.push('--reviewer', reviewer);
    }
    for (const label of input.labels) {
      args.push('--label', label);
    }
    const result = await this.shell.run('gh', args);
    if (result.exitCode !== 0) {
      return {
        ok: false,
        output: result.stderr || result.stdout,
        remediation:
          'gh pr create failed. Ensure `gh auth status` is OK and the branch was pushed cleanly, then re-run delivery.',
      };
    }
    return {
      ok: true,
      output: result.stdout,
      pr: parsePrUrl(result.stdout),
    };
  }

  async getChecksStatus(prOrBranch: string): Promise<ChecksStatus> {
    // `gh pr checks <branch> --json name,state` returns one row per check run.
    const result = await this.shell.run('gh', ['pr', 'checks', prOrBranch, '--json', 'name,state']);
    // gh exits non-zero when checks are still pending or failing, but still
    // prints JSON on stdout — so parse stdout regardless of exit code.
    const checks = parseChecks(result.stdout);
    if (checks === null) {
      return { state: 'unknown', checks: [] };
    }
    return { state: aggregate(checks.map((c) => c.state)), checks };
  }
}

/** gh prints the created PR URL on stdout; pull the number out of it. */
export function parsePrUrl(stdout: string): PullRequest {
  const url =
    stdout
      .trim()
      .split(/\s+/)
      .find((token) => /^https?:\/\//.test(token)) ?? stdout.trim();
  const match = /\/pull\/(\d+)/.exec(url);
  return { number: match ? Number(match[1]) : null, url };
}

/** Map gh's per-check `state` strings onto our normalized ChecksState. */
export function normalizeCheckState(raw: string): ChecksState {
  const s = raw.toUpperCase();
  if (['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(s)) {
    return 'green';
  }
  if (['FAILURE', 'FAIL', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED'].includes(s)) {
    return 'red';
  }
  if (['PENDING', 'QUEUED', 'IN_PROGRESS', 'EXPECTED', 'REQUESTED', 'WAITING'].includes(s)) {
    return 'pending';
  }
  return 'unknown';
}

function parseChecks(stdout: string): { name: string; state: ChecksState }[] | null {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const rows = JSON.parse(trimmed) as { name?: string; state?: string }[];
    if (!Array.isArray(rows)) {
      return null;
    }
    return rows.map((r) => ({
      name: r.name ?? 'unknown',
      state: normalizeCheckState(r.state ?? ''),
    }));
  } catch {
    return null;
  }
}

/** Aggregate per-check states into one: red dominates, then pending, then green. */
export function aggregate(states: ChecksState[]): ChecksState {
  if (states.length === 0) {
    return 'unknown';
  }
  if (states.includes('red')) {
    return 'red';
  }
  if (states.includes('pending')) {
    return 'pending';
  }
  if (states.every((s) => s === 'green')) {
    return 'green';
  }
  return 'unknown';
}
