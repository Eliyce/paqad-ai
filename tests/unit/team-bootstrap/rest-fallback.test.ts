import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import YAML from 'yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DeliveryShell } from '@/delivery/runner.js';
import { runDelivery } from '@/delivery/runner.js';
import {
  defaultFeatureDevelopmentPolicy,
  renderDefaultFeatureDevelopmentPolicyYaml,
} from '@/pipeline/feature-development-policy.js';
import { GithubHostProvider, resetGraphqlRefusal } from '@/providers/github-host-provider.js';
import {
  GRAPHQL_REFUSED_MESSAGE,
  parseOwnerRepo,
  restTrigger,
} from '@/providers/github-rest-fallback.js';

type Reply = { stdout?: string; stderr?: string; exitCode?: number };
type Route = (args: string[]) => Reply | undefined;

const REFUSED: Reply = {
  exitCode: 1,
  stderr: `${GRAPHQL_REFUSED_MESSAGE}. Use the REST API instead.\n`,
};
const ORIGIN = 'https://github.com/acme/widgets.git';
const PR_JSON = JSON.stringify({ html_url: 'https://github.com/acme/widgets/pull/7', number: 7 });
const OPEN_PRS = JSON.stringify([
  { html_url: 'https://github.com/acme/widgets/pull/7', number: 7, head: { sha: 'abc123' } },
]);

function fakeShell(routes: Route[]): DeliveryShell & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    async run(command, args) {
      calls.push([command, ...args]);
      for (const route of routes) {
        const reply = route([command, ...args]);
        if (reply)
          return {
            stdout: reply.stdout ?? '',
            stderr: reply.stderr ?? '',
            exitCode: reply.exitCode ?? 0,
          };
      }
      return { stdout: '', stderr: 'unexpected call', exitCode: 1 };
    },
  };
}

const origin: Route = (a) =>
  a[0] === 'git' && a[1] === 'remote' ? { stdout: `${ORIGIN}\n` } : undefined;
const refuse =
  (sub: string): Route =>
  (a) =>
    a[0] === 'gh' && a[1] === 'pr' && a[2] === sub ? REFUSED : undefined;
const api =
  (match: (path: string, a: string[]) => boolean, reply: Reply): Route =>
  (a) =>
    a[0] === 'gh' && a[1] === 'api' && match(a[2]!, a) ? reply : undefined;

const input = {
  title: 'feat: a "quoted" $(title)',
  body: 'body with -F and @file text',
  base: 'main',
  head: 'feat/x y',
  draft: true,
  reviewers: ['alice', 'bob'],
  labels: ['team'],
};

let root: string;
beforeEach(() => {
  resetGraphqlRefusal();
  root = mkdtempSync(join(tmpdir(), 'paqad-rest-fallback-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function apiCalls(shell: { calls: string[][] }): string[][] {
  return shell.calls.filter((call) => call[0] === 'gh' && call[1] === 'api');
}

describe('opening a pull request when GraphQL is refused', () => {
  it('creates it through REST with -f fields, then reviewers and labels, and keeps the result shape', async () => {
    const shell = fakeShell([
      refuse('create'),
      origin,
      api((p) => p === 'repos/acme/widgets/pulls', { stdout: PR_JSON }),
      api((p) => p.endsWith('/requested_reviewers'), { stdout: '{}' }),
      api((p) => p.endsWith('/labels'), { stdout: '[]' }),
    ]);
    const result = await new GithubHostProvider(shell, { env: {}, projectRoot: root }).openPR(
      input,
    );

    expect(result).toEqual({
      ok: true,
      output: 'https://github.com/acme/widgets/pull/7',
      pr: { number: 7, url: 'https://github.com/acme/widgets/pull/7' },
    });
    expect(apiCalls(shell)).toEqual([
      [
        'gh',
        'api',
        'repos/acme/widgets/pulls',
        '-f',
        `title=${input.title}`,
        '-f',
        `body=${input.body}`,
        '-f',
        'base=main',
        '-f',
        'head=feat/x y',
        '-F',
        'draft=true',
      ],
      [
        'gh',
        'api',
        'repos/acme/widgets/pulls/7/requested_reviewers',
        '-f',
        'reviewers[]=alice',
        '-f',
        'reviewers[]=bob',
      ],
      ['gh', 'api', 'repos/acme/widgets/issues/7/labels', '-f', 'labels[]=team'],
    ]);
    const log = readFileSync(join(root, '.paqad/logs/hooks.log'), 'utf8');
    expect(log).toContain('gh pr create retried through REST (graphql-refused)');
    expect(log).not.toContain(ORIGIN);
  });

  it('finds the existing pull request when REST answers 422', async () => {
    const shell = fakeShell([
      refuse('create'),
      origin,
      api((p) => p === 'repos/acme/widgets/pulls', {
        exitCode: 1,
        stderr: 'gh: Validation Failed (HTTP 422)',
        stdout:
          '{"message":"Validation Failed","errors":[{"message":"A pull request already exists for acme:feat/x y."}]}',
      }),
      api((p) => p.startsWith('repos/acme/widgets/pulls?head='), { stdout: OPEN_PRS }),
    ]);
    const result = await new GithubHostProvider(shell, { env: {} }).openPR({
      ...input,
      draft: false,
      reviewers: [],
      labels: [],
    });
    expect(result.pr).toEqual({ number: 7, url: 'https://github.com/acme/widgets/pull/7' });
    expect(apiCalls(shell)[1]).toEqual([
      'gh',
      'api',
      'repos/acme/widgets/pulls?head=acme%3Afeat%2Fx%20y&state=open',
    ]);
  });

  it("keeps today's remediation when the fallback fails too, and tries REST once", async () => {
    const shell = fakeShell([
      refuse('create'),
      origin,
      api((p) => p === 'repos/acme/widgets/pulls', { exitCode: 1, stderr: 'HTTP 500' }),
    ]);
    const result = await new GithubHostProvider(shell, { env: {} }).openPR(input);
    expect(result.ok).toBe(false);
    expect(result.remediation).toContain('gh pr create failed');
    expect(apiCalls(shell)).toHaveLength(1);
  });

  it('never falls back on a different gh failure', async () => {
    const shell = fakeShell([
      (a) => (a[1] === 'pr' ? { exitCode: 1, stderr: 'HTTP 401: Bad credentials' } : undefined),
    ]);
    const result = await new GithubHostProvider(shell, { env: {} }).openPR(input);
    expect(result.ok).toBe(false);
    expect(shell.calls).toHaveLength(1);
  });

  it('a 403 in a cloud session also falls back, a 403 on a laptop does not', async () => {
    const forbidden = (a: string[]) =>
      a[1] === 'pr' ? { exitCode: 1, stderr: 'HTTP 403: Forbidden' } : undefined;
    const laptop = fakeShell([forbidden]);
    await new GithubHostProvider(laptop, { env: {} }).openPR(input);
    expect(laptop.calls).toHaveLength(1);
    const cloud = fakeShell([
      forbidden,
      origin,
      api((p) => p === 'repos/acme/widgets/pulls', { stdout: PR_JSON }),
      api(() => true, { stdout: '{}' }),
    ]);
    const result = await new GithubHostProvider(cloud, {
      env: { CLAUDE_CODE_REMOTE: 'true' },
    }).openPR(input);
    expect(result.ok).toBe(true);
  });

  it("an origin it cannot parse keeps today's remediation without guessing", async () => {
    const shell = fakeShell([
      refuse('create'),
      (a) => (a[0] === 'git' ? { stdout: 'not a url' } : undefined),
    ]);
    const result = await new GithubHostProvider(shell, { env: {} }).openPR(input);
    expect(result.ok).toBe(false);
    expect(apiCalls(shell)).toEqual([]);
  });

  it('runDelivery opens its pull request through the provider, so it falls back too', async () => {
    const shell = fakeShell([
      (a) => (a[0] === 'git' && a[1] !== 'remote' ? { stdout: 'ok' } : undefined),
      refuse('create'),
      origin,
      api((p) => p === 'repos/acme/widgets/pulls', { stdout: PR_JSON }),
    ]);
    const run = await runDelivery(shell, {
      rendered: { branch: 'feat/x', commit: 'feat: x', pr_title: 'T', pr_body: 'B' } as never,
      base: 'main',
      draft: false,
      reviewers: [],
      labels: [],
      open_pr: 'yes',
    });
    expect(run.ok).toBe(true);
    expect(run.steps.at(-1)).toMatchObject({ step: 'pr', ok: true, pr: { number: 7 } });
  });
});

describe('commenting when GraphQL is refused', () => {
  it('finds the open pull request by branch and comments through REST', async () => {
    const shell = fakeShell([
      refuse('comment'),
      origin,
      api((p) => p.startsWith('repos/acme/widgets/pulls?head='), { stdout: OPEN_PRS }),
      api((p) => p === 'repos/acme/widgets/issues/7/comments', { stdout: '{}' }),
    ]);
    const result = await new GithubHostProvider(shell, { env: {} }).comment(
      'feat/x',
      'evidence "here"',
    );
    expect(result).toEqual({ ok: true, output: 'https://github.com/acme/widgets/pull/7' });
    expect(apiCalls(shell).at(-1)).toEqual([
      'gh',
      'api',
      'repos/acme/widgets/issues/7/comments',
      '-f',
      'body=evidence "here"',
    ]);
  });

  it('accepts a pull request number', async () => {
    const shell = fakeShell([
      refuse('comment'),
      origin,
      api((p) => p === 'repos/acme/widgets/pulls/7', {
        stdout: JSON.stringify({ html_url: 'u/pull/7', number: 7, head: { sha: 's' } }),
      }),
      api((p) => p.endsWith('/comments'), { stdout: '{}' }),
    ]);
    expect((await new GithubHostProvider(shell, { env: {} }).comment('7', 'b')).ok).toBe(true);
  });

  it("with no open pull request it keeps today's remediation", async () => {
    const shell = fakeShell([
      refuse('comment'),
      origin,
      api((p) => p.startsWith('repos/acme/widgets/pulls?head='), { stdout: '[]' }),
    ]);
    const result = await new GithubHostProvider(shell, { env: {} }).comment('feat/x', 'b');
    expect(result.ok).toBe(false);
    expect(result.remediation).toContain('gh pr comment failed');
  });

  it("a failing comment call keeps today's remediation", async () => {
    const shell = fakeShell([
      refuse('comment'),
      origin,
      api((p) => p.startsWith('repos/acme/widgets/pulls?head='), { stdout: OPEN_PRS }),
      api((p) => p.endsWith('/comments'), { exitCode: 1, stderr: 'HTTP 500' }),
    ]);
    expect((await new GithubHostProvider(shell, { env: {} }).comment('feat/x', 'b')).ok).toBe(
      false,
    );
  });
});

describe('reading checks when GraphQL is refused', () => {
  function checkRuns(count: number, conclusion = 'success'): string {
    return JSON.stringify({
      total_count: count,
      check_runs: Array.from({ length: count }, (_, i) => ({
        name: `c${i}`,
        status: 'completed',
        conclusion,
      })),
    });
  }

  it('reads every page of check runs and the legacy statuses, failing on a failed status', async () => {
    const shell = fakeShell([
      refuse('checks'),
      origin,
      api((p) => p.startsWith('repos/acme/widgets/pulls?head='), { stdout: OPEN_PRS }),
      api((p) => p.endsWith('check-runs?per_page=100&page=1'), { stdout: checkRuns(100) }),
      api((p) => p.endsWith('check-runs?per_page=100&page=2'), { stdout: checkRuns(5, 'neutral') }),
      api((p) => p.includes('/commits/abc123/status'), {
        stdout: JSON.stringify({ statuses: [{ context: 'legacy', state: 'failure' }] }),
      }),
    ]);
    const status = await new GithubHostProvider(shell, { env: {} }).getChecksStatus('feat/x');
    expect(status.state).toBe('red');
    expect(status.checks).toHaveLength(106);
    expect(status.checks.at(-1)).toEqual({ name: 'legacy', state: 'red' });
  });

  it('maps unfinished runs to pending and passing conclusions to green', async () => {
    const shell = fakeShell([
      origin,
      api((p) => p.startsWith('repos/acme/widgets/pulls?head='), { stdout: OPEN_PRS }),
      api((p) => p.includes('check-runs'), {
        stdout: JSON.stringify({
          check_runs: [
            { name: 'a', status: 'in_progress', conclusion: null },
            { name: 'b', status: 'completed', conclusion: 'skipped' },
          ],
        }),
      }),
      api((p) => p.includes('/status?'), {
        stdout: JSON.stringify({
          statuses: [
            { context: 'l', state: 'pending' },
            { context: 'm', state: 'success' },
          ],
        }),
      }),
    ]);
    const status = await new GithubHostProvider(shell, {
      env: { CLAUDE_CODE_REMOTE: 'true' },
    }).getChecksStatus('feat/x');
    expect(status).toEqual({
      state: 'pending',
      checks: [
        { name: 'a', state: 'pending' },
        { name: 'b', state: 'green' },
        { name: 'l', state: 'pending' },
        { name: 'm', state: 'green' },
      ],
    });
    expect(shell.calls.some((call) => call[1] === 'pr')).toBe(false);
  });

  it('after one refusal, later polls go straight to REST', async () => {
    const routes = [
      refuse('checks'),
      origin,
      api((p) => p.startsWith('repos/acme/widgets/pulls?head='), { stdout: OPEN_PRS }),
      api((p) => p.includes('check-runs'), { stdout: checkRuns(1) }),
      api((p) => p.includes('/status?'), { exitCode: 1 }),
    ];
    const shell = fakeShell(routes);
    const host = new GithubHostProvider(shell, { env: {} });
    expect((await host.getChecksStatus('feat/x')).state).toBe('green');
    const before = shell.calls.filter((call) => call[1] === 'pr').length;
    await host.getChecksStatus('feat/x');
    expect(shell.calls.filter((call) => call[1] === 'pr').length).toBe(before);
  });

  it("zero check runs, no pull request or a failing call give today's unknown result", async () => {
    const cases: Route[][] = [
      [
        api((p) => p.startsWith('repos/acme/widgets/pulls?head='), { stdout: OPEN_PRS }),
        api((p) => p.includes('check-runs'), { stdout: checkRuns(0) }),
        api((p) => p.includes('/status?'), { stdout: '{}' }),
      ],
      [api((p) => p.startsWith('repos/acme/widgets/pulls?head='), { stdout: '[]' })],
      [
        api((p) => p.startsWith('repos/acme/widgets/pulls?head='), { stdout: OPEN_PRS }),
        api((p) => p.includes('check-runs'), { exitCode: 1 }),
      ],
      [
        api((p) => p.startsWith('repos/acme/widgets/pulls?head='), { stdout: OPEN_PRS }),
        api((p) => p.includes('check-runs'), { stdout: '{}' }),
      ],
      [api((p) => p.startsWith('repos/acme/widgets/pulls?head='), { exitCode: 1 })],
    ];
    for (const extra of cases) {
      resetGraphqlRefusal();
      const shell = fakeShell([refuse('checks'), origin, ...extra]);
      expect(await new GithubHostProvider(shell, { env: {} }).getChecksStatus('feat/x')).toEqual({
        state: 'unknown',
        checks: [],
      });
    }
  });

  it('a pull request number resolves its head commit', async () => {
    const shell = fakeShell([
      origin,
      api((p) => p === 'repos/acme/widgets/pulls/9', {
        stdout: JSON.stringify({ html_url: 'u/pull/9', number: 9, head: { sha: 'feed' } }),
      }),
      api((p) => p === 'repos/acme/widgets/commits/feed/check-runs?per_page=100&page=1', {
        stdout: checkRuns(1, 'failure'),
      }),
      api((p) => p.includes('/status?'), { stdout: '{"statuses":[]}' }),
    ]);
    expect(
      (
        await new GithubHostProvider(shell, {
          env: { CLAUDE_CODE_REMOTE: 'true' },
        }).getChecksStatus('9')
      ).state,
    ).toBe('red');
  });
});

describe('legacy commit statuses', () => {
  function statuses(count: number, state: string, combined = state): string {
    return JSON.stringify({
      state: combined,
      statuses: Array.from({ length: count }, (_, i) => ({ context: `s${i}`, state })),
    });
  }
  function shellWith(...pages: Reply[]) {
    return fakeShell([
      origin,
      api((p) => p.startsWith('repos/acme/widgets/pulls?head='), { stdout: OPEN_PRS }),
      api((p) => p.includes('check-runs'), { stdout: JSON.stringify({ check_runs: [] }) }),
      ...pages.map((reply, i) =>
        api((p) => p.endsWith(`/status?per_page=100&page=${i + 1}`), reply),
      ),
    ]);
  }
  const cloud = { CLAUDE_CODE_REMOTE: 'true' } as NodeJS.ProcessEnv;

  it('reads every page of statuses', async () => {
    const shell = shellWith(
      { stdout: statuses(100, 'success') },
      { stdout: statuses(3, 'failure', 'failure') },
    );
    const status = await new GithubHostProvider(shell, { env: cloud }).getChecksStatus('feat/x');
    expect(status.checks).toHaveLength(103);
    expect(status.state).toBe('red');
  });

  it('trusts a failed combined state even when the listed statuses look green', async () => {
    const shell = shellWith({ stdout: statuses(1, 'success', 'failure') });
    const status = await new GithubHostProvider(shell, { env: cloud }).getChecksStatus('feat/x');
    expect(status.state).toBe('red');
    expect(status.checks.at(-1)).toEqual({ name: 'combined commit status', state: 'red' });
  });

  it('a failing later page keeps what was read', async () => {
    const shell = shellWith({ stdout: statuses(100, 'success') }, { exitCode: 1 });
    const status = await new GithubHostProvider(shell, { env: cloud }).getChecksStatus('feat/x');
    expect(status).toMatchObject({ state: 'green' });
    expect(status.checks).toHaveLength(100);
  });
});

describe('odd REST answers', () => {
  it("a failing git remote keeps today's remediation", async () => {
    const shell = fakeShell([
      refuse('comment'),
      (a) => (a[0] === 'git' ? { exitCode: 2 } : undefined),
    ]);
    expect((await new GithubHostProvider(shell, { env: {} }).comment('feat/x', 'b')).ok).toBe(
      false,
    );
  });

  it("a pull request number that cannot be read keeps today's results", async () => {
    const shell = fakeShell([
      origin,
      api((p) => p === 'repos/acme/widgets/pulls/9', { exitCode: 1 }),
    ]);
    const host = new GithubHostProvider(shell, { env: { CLAUDE_CODE_REMOTE: 'true' } });
    expect(await host.getChecksStatus('9')).toEqual({ state: 'unknown', checks: [] });
  });

  it('a pull request without a head commit has no checks to read', async () => {
    const shell = fakeShell([
      origin,
      api((p) => p === 'repos/acme/widgets/pulls/9', {
        stdout: JSON.stringify({ html_url: 'u', number: 9 }),
      }),
      api((p) => p.startsWith('repos/acme/widgets/pulls?head='), {
        stdout: JSON.stringify([{ html_url: 'u', number: 9 }]),
      }),
    ]);
    const host = new GithubHostProvider(shell, { env: { CLAUDE_CODE_REMOTE: 'true' } });
    expect(await host.getChecksStatus('9')).toEqual({ state: 'unknown', checks: [] });
    expect(await host.getChecksStatus('feat/x')).toEqual({ state: 'unknown', checks: [] });
  });

  it('nameless runs and statuses read as unknown names, and unreadable JSON creates nothing', async () => {
    const shell = fakeShell([
      origin,
      api((p) => p.startsWith('repos/acme/widgets/pulls?head='), { stdout: OPEN_PRS }),
      api((p) => p.includes('check-runs'), {
        stdout: JSON.stringify({ check_runs: [7, { status: 'completed', conclusion: 'success' }] }),
      }),
      api((p) => p.includes('/status?'), { stdout: JSON.stringify({ statuses: [null] }) }),
    ]);
    const status = await new GithubHostProvider(shell, {
      env: { CLAUDE_CODE_REMOTE: 'true' },
    }).getChecksStatus('feat/x');
    expect(status.checks).toEqual([
      { name: 'unknown', state: 'pending' },
      { name: 'unknown', state: 'green' },
      { name: 'unknown', state: 'red' },
    ]);
    const broken = fakeShell([
      refuse('create'),
      origin,
      api((p) => p === 'repos/acme/widgets/pulls', { stdout: 'not json' }),
    ]);
    expect((await new GithubHostProvider(broken, { env: {} }).openPR(input)).ok).toBe(false);
  });
});

describe('the origin parser', () => {
  it.each([
    ['https://github.com/acme/widgets.git', { owner: 'acme', repo: 'widgets' }],
    ['git@github.com:acme/widgets.git', { owner: 'acme', repo: 'widgets' }],
    ['ssh://git@github.com/acme/wid.gets', { owner: 'acme', repo: 'wid.gets' }],
    ['http://local_proxy@127.0.0.1:34567/git/acme/widgets', { owner: 'acme', repo: 'widgets' }],
    ['https://github.com/acme', null],
    ['https://github.com/ac me/widgets', null],
    ['https://github.com/acme/wid;gets', null],
    ['', null],
    ['nonsense', null],
  ])('%s', (url, expected) => {
    expect(parseOwnerRepo(url)).toEqual(expected);
  });

  it('only the exact refusal or a cloud 403 triggers the fallback', () => {
    expect(restTrigger({ exitCode: 1, stderr: `GraphQL: ${GRAPHQL_REFUSED_MESSAGE}` }, {})).toBe(
      'graphql-refused',
    );
    expect(restTrigger({ exitCode: 0, stderr: GRAPHQL_REFUSED_MESSAGE }, {})).toBeNull();
    expect(restTrigger({ exitCode: 1, stderr: `see: ${GRAPHQL_REFUSED_MESSAGE}` }, {})).toBeNull();
    expect(restTrigger({ exitCode: 1, stderr: 'HTTP 403' }, { CLAUDE_CODE_REMOTE: 'TRUE' })).toBe(
      'cloud-403',
    );
    expect(restTrigger({ exitCode: 1, stderr: 'HTTP 403' }, {})).toBeNull();
  });
});

describe('the manual delivery instruction', () => {
  it('names the gh api fallback for cloud sessions in both rendered forms', () => {
    const policy = defaultFeatureDevelopmentPolicy();
    const text = JSON.stringify(policy);
    expect(text).toContain('gh api repos/<owner>/<repo>/issues/<pr-number>/comments -f body=');
    expect(YAML.stringify(policy)).toContain('cloud session');
    const rendered = JSON.stringify(YAML.parse(renderDefaultFeatureDevelopmentPolicyYaml()));
    expect(rendered).toContain(
      'gh api repos/<owner>/<repo>/issues/<pr-number>/comments -f body=\\"$(cat /tmp/paqad-evidence.md)\\"',
    );
  });
});
