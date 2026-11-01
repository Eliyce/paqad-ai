import type { DeliveryShell } from '@/delivery/runner.js';

import type {
  ChecksState,
  CheckRun,
  HostStepResult,
  OpenPrInput,
  PullRequest,
} from './host-provider.js';

export const GRAPHQL_REFUSED_MESSAGE = 'GitHub GraphQL is not available from Claude Code sessions';

const SEGMENT = /^[A-Za-z0-9._-]+$/;
const CHECK_RUNS_PAGE_SIZE = 100;
const CHECK_RUNS_MAX_PAGES = 50;
const PASSING_CONCLUSIONS = new Set(['success', 'neutral', 'skipped']);

export type RestTrigger = 'graphql-refused' | 'cloud-403';

export interface OwnerRepo {
  owner: string;
  repo: string;
}

export function isCloudSession(env: NodeJS.ProcessEnv): boolean {
  return env.CLAUDE_CODE_REMOTE?.trim().toLowerCase() === 'true';
}

export function restTrigger(
  result: { exitCode: number; stderr: string },
  env: NodeJS.ProcessEnv,
): RestTrigger | null {
  if (result.exitCode === 0) return null;
  const lines = result.stderr.split(/\r?\n/).map((line) => line.trim());
  if (
    lines.some((line) =>
      line.replace(/^(?:GraphQL|error):\s*/i, '').startsWith(GRAPHQL_REFUSED_MESSAGE),
    )
  ) {
    return 'graphql-refused';
  }
  if (isCloudSession(env) && /\bHTTP 403\b/.test(result.stderr)) return 'cloud-403';
  return null;
}

export function parseOwnerRepo(remoteUrl: string): OwnerRepo | null {
  const url = remoteUrl.trim();
  if (url === '') return null;
  let path: string;
  const scp = /^[^@/\s]+@[^:/\s]+:(.+)$/.exec(url);
  if (scp) {
    path = scp[1]!;
  } else {
    try {
      path = new URL(url).pathname;
    } catch {
      return null;
    }
  }
  const segments = path.split('/').filter((part) => part !== '');
  if (segments.length < 2) return null;
  const owner = segments[segments.length - 2]!;
  const repo = segments[segments.length - 1]!.replace(/\.git$/, '');
  return SEGMENT.test(owner) && SEGMENT.test(repo) ? { owner, repo } : null;
}

export async function readOwnerRepo(shell: DeliveryShell): Promise<OwnerRepo | null> {
  const result = await shell.run('git', ['remote', 'get-url', 'origin']);
  return result.exitCode === 0 ? parseOwnerRepo(result.stdout) : null;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function prFrom(value: unknown): PullRequest | null {
  const record = asRecord(value);
  const url = record?.html_url;
  const number = record?.number;
  return typeof url === 'string' && typeof number === 'number' ? { url, number } : null;
}

function repoPath({ owner, repo }: OwnerRepo): string {
  return `repos/${owner}/${repo}`;
}

async function findOpenPr(
  shell: DeliveryShell,
  target: OwnerRepo,
  branch: string,
): Promise<(PullRequest & { headSha?: string }) | null> {
  const head = encodeURIComponent(`${target.owner}:${branch}`);
  const result = await shell.run('gh', [
    'api',
    `${repoPath(target)}/pulls?head=${head}&state=open`,
  ]);
  if (result.exitCode !== 0) return null;
  const rows = parseJson(result.stdout);
  const first = Array.isArray(rows) ? rows[0] : undefined;
  const pr = prFrom(first);
  if (!pr) return null;
  const sha = asRecord(asRecord(first)?.head)?.sha;
  return typeof sha === 'string' ? { ...pr, headSha: sha } : pr;
}

async function resolvePr(
  shell: DeliveryShell,
  target: OwnerRepo,
  prOrBranch: string,
): Promise<(PullRequest & { headSha?: string }) | null> {
  if (!/^\d+$/.test(prOrBranch)) return findOpenPr(shell, target, prOrBranch);
  const result = await shell.run('gh', ['api', `${repoPath(target)}/pulls/${prOrBranch}`]);
  if (result.exitCode !== 0) return null;
  const parsed = parseJson(result.stdout);
  const pr = prFrom(parsed);
  const sha = asRecord(asRecord(parsed)?.head)?.sha;
  return pr && typeof sha === 'string' ? { ...pr, headSha: sha } : pr;
}

export async function restOpenPr(
  shell: DeliveryShell,
  input: OpenPrInput,
): Promise<(HostStepResult & { pr?: PullRequest }) | null> {
  const target = await readOwnerRepo(shell);
  if (!target) return null;
  const args = [
    'api',
    `${repoPath(target)}/pulls`,
    '-f',
    `title=${input.title}`,
    '-f',
    `body=${input.body}`,
    '-f',
    `base=${input.base}`,
    '-f',
    `head=${input.head}`,
  ];
  if (input.draft) args.push('-F', 'draft=true');
  const created = await shell.run('gh', args);
  let pr = created.exitCode === 0 ? prFrom(parseJson(created.stdout)) : null;
  if (!pr && /A pull request already exists/i.test(`${created.stdout}\n${created.stderr}`)) {
    pr = await findOpenPr(shell, target, input.head);
  }
  if (!pr) return null;
  if (input.reviewers.length > 0) {
    await shell.run('gh', [
      'api',
      `${repoPath(target)}/pulls/${pr.number}/requested_reviewers`,
      ...input.reviewers.flatMap((reviewer) => ['-f', `reviewers[]=${reviewer}`]),
    ]);
  }
  if (input.labels.length > 0) {
    await shell.run('gh', [
      'api',
      `${repoPath(target)}/issues/${pr.number}/labels`,
      ...input.labels.flatMap((label) => ['-f', `labels[]=${label}`]),
    ]);
  }
  return { ok: true, output: pr.url, pr: { number: pr.number, url: pr.url } };
}

export async function restComment(
  shell: DeliveryShell,
  prOrBranch: string,
  body: string,
): Promise<HostStepResult | null> {
  const target = await readOwnerRepo(shell);
  if (!target) return null;
  const pr = await resolvePr(shell, target, prOrBranch);
  if (!pr) return null;
  const result = await shell.run('gh', [
    'api',
    `${repoPath(target)}/issues/${pr.number}/comments`,
    '-f',
    `body=${body}`,
  ]);
  return result.exitCode === 0 ? { ok: true, output: pr.url } : null;
}

function checkRunState(run: Record<string, unknown>): ChecksState {
  if (run.status !== 'completed') return 'pending';
  return PASSING_CONCLUSIONS.has(String(run.conclusion)) ? 'green' : 'red';
}

function statusState(state: unknown): ChecksState {
  if (state === 'success') return 'green';
  if (state === 'pending') return 'pending';
  return 'red';
}

async function readCheckRuns(
  shell: DeliveryShell,
  target: OwnerRepo,
  sha: string,
): Promise<CheckRun[] | null> {
  const runs: CheckRun[] = [];
  for (let page = 1; page <= CHECK_RUNS_MAX_PAGES; page += 1) {
    const result = await shell.run('gh', [
      'api',
      `${repoPath(target)}/commits/${sha}/check-runs?per_page=${CHECK_RUNS_PAGE_SIZE}&page=${page}`,
    ]);
    if (result.exitCode !== 0) return null;
    const rows = asRecord(parseJson(result.stdout))?.check_runs;
    if (!Array.isArray(rows)) return null;
    for (const row of rows) {
      const run = asRecord(row) ?? {};
      runs.push({ name: String(run.name ?? 'unknown'), state: checkRunState(run) });
    }
    if (rows.length < CHECK_RUNS_PAGE_SIZE) break;
  }
  return runs;
}

const COMBINED_FAILURE = new Set(['failure', 'error']);

async function readCommitStatuses(
  shell: DeliveryShell,
  target: OwnerRepo,
  sha: string,
): Promise<CheckRun[]> {
  const rows: CheckRun[] = [];
  let combined: unknown;
  for (let page = 1; page <= CHECK_RUNS_MAX_PAGES; page += 1) {
    const result = await shell.run('gh', [
      'api',
      `${repoPath(target)}/commits/${sha}/status?per_page=${CHECK_RUNS_PAGE_SIZE}&page=${page}`,
    ]);
    if (result.exitCode !== 0) break;
    const body = asRecord(parseJson(result.stdout));
    if (page === 1) combined = body?.state;
    const statuses = body?.statuses;
    if (!Array.isArray(statuses)) break;
    for (const row of statuses) {
      const status = asRecord(row) ?? {};
      rows.push({ name: String(status.context ?? 'unknown'), state: statusState(status.state) });
    }
    if (statuses.length < CHECK_RUNS_PAGE_SIZE) break;
  }
  const combinedFailed = typeof combined === 'string' && COMBINED_FAILURE.has(combined);
  if (combinedFailed && !rows.some((row) => row.state === 'red')) {
    rows.push({ name: 'combined commit status', state: 'red' });
  }
  return rows;
}

export async function restChecks(
  shell: DeliveryShell,
  prOrBranch: string,
): Promise<{ checks: CheckRun[] } | null> {
  const target = await readOwnerRepo(shell);
  if (!target) return null;
  const pr = await resolvePr(shell, target, prOrBranch);
  if (!pr?.headSha) return null;
  const runs = await readCheckRuns(shell, target, pr.headSha);
  if (runs === null) return null;
  return { checks: [...runs, ...(await readCommitStatuses(shell, target, pr.headSha))] };
}
