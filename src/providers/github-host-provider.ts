import { appendHooksLog } from '@/core/logging/hooks-log.js';
import type { DeliveryShell } from '@/delivery/runner.js';

import {
  type RestTrigger,
  isCloudSession,
  restChecks,
  restComment,
  restOpenPr,
  restTrigger,
} from './github-rest-fallback.js';

import type {
  ChecksState,
  ChecksStatus,
  HostProvider,
  HostStepResult,
  OpenPrInput,
  PullRequest,
} from './host-provider.js';

export interface GithubHostOptions {
  env?: NodeJS.ProcessEnv;
  projectRoot?: string;
}

const PR_CREATE_REMEDIATION =
  'gh pr create failed. Ensure `gh auth status` is OK and the branch was pushed cleanly, then re-run delivery.';

let graphqlRefusedInProcess = false;

export function resetGraphqlRefusal(): void {
  graphqlRefusedInProcess = false;
}

export class GithubHostProvider implements HostProvider {
  readonly kind = 'github' as const;
  private readonly env: NodeJS.ProcessEnv;

  constructor(
    private readonly shell: DeliveryShell,
    private readonly options: GithubHostOptions = {},
  ) {
    this.env = options.env ?? process.env;
  }

  private fallbackTrigger(
    call: string,
    result: { exitCode: number; stderr: string },
  ): RestTrigger | null {
    const trigger = restTrigger(result, this.env);
    if (trigger !== null) {
      graphqlRefusedInProcess = true;
      if (this.options.projectRoot) {
        appendHooksLog(
          this.options.projectRoot,
          `delivery: ${call} retried through REST (${trigger})`,
        );
      }
    }
    return trigger;
  }

  async ensureBranch(name: string, base: string): Promise<HostStepResult> {
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
      const viaRest = this.fallbackTrigger('gh pr create', result)
        ? await restOpenPr(this.shell, input)
        : null;
      if (viaRest) return viaRest;
      return {
        ok: false,
        output: result.stderr || result.stdout,
        remediation: PR_CREATE_REMEDIATION,
      };
    }
    return {
      ok: true,
      output: result.stdout,
      pr: parsePrUrl(result.stdout),
    };
  }

  async comment(prOrBranch: string, body: string): Promise<HostStepResult> {
    const result = await this.shell.run('gh', ['pr', 'comment', prOrBranch, '--body', body]);
    if (result.exitCode !== 0 && this.fallbackTrigger('gh pr comment', result)) {
      const viaRest = await restComment(this.shell, prOrBranch, body);
      if (viaRest) return viaRest;
    }
    return {
      ok: result.exitCode === 0,
      output: result.stderr || result.stdout,
      remediation:
        result.exitCode === 0
          ? undefined
          : 'gh pr comment failed. Ensure `gh auth status` is OK and the PR exists for this branch, then re-run delivery.',
    };
  }

  async getChecksStatus(prOrBranch: string): Promise<ChecksStatus> {
    if (graphqlRefusedInProcess || isCloudSession(this.env)) {
      return this.checksViaRest(prOrBranch);
    }
    const result = await this.shell.run('gh', ['pr', 'checks', prOrBranch, '--json', 'name,state']);
    if (this.fallbackTrigger('gh pr checks', result)) {
      return this.checksViaRest(prOrBranch);
    }
    const checks = parseChecks(result.stdout);
    if (checks === null) {
      return { state: 'unknown', checks: [] };
    }
    return { state: aggregate(checks.map((c) => c.state)), checks };
  }

  private async checksViaRest(prOrBranch: string): Promise<ChecksStatus> {
    const viaRest = await restChecks(this.shell, prOrBranch);
    if (!viaRest) return { state: 'unknown', checks: [] };
    return { state: aggregate(viaRest.checks.map((c) => c.state)), checks: viaRest.checks };
  }
}

export function parsePrUrl(stdout: string): PullRequest {
  const url =
    stdout
      .trim()
      .split(/\s+/)
      .find((token) => /^https?:\/\//.test(token)) ?? stdout.trim();
  const match = /\/pull\/(\d+)/.exec(url);
  return { number: match ? Number(match[1]) : null, url };
}

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
