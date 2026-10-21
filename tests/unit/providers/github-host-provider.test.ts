import { describe, expect, it, vi } from 'vitest';

import type { DeliveryShell } from '@/delivery/runner.js';
import { aggregate, GithubHostProvider } from '@/providers/github-host-provider.js';

function shellReturning(
  ...results: { stdout?: string; stderr?: string; exitCode: number }[]
): DeliveryShell & { run: ReturnType<typeof vi.fn> } {
  const run = vi.fn();
  for (const result of results) {
    run.mockResolvedValueOnce({
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      ...result,
    });
  }
  return { run } as DeliveryShell & { run: ReturnType<typeof vi.fn> };
}

describe('GithubHostProvider', () => {
  it('reports success with stdout when git has nothing on stderr', async () => {
    const shell = shellReturning(
      { stdout: 'switched', exitCode: 0 },
      { stdout: '1 file changed', exitCode: 0 },
      { stdout: 'pushed', exitCode: 0 },
      { stdout: 'commented', exitCode: 0 },
    );
    const host = new GithubHostProvider(shell);

    expect(await host.ensureBranch('feat/x', 'main')).toEqual({
      ok: true,
      output: 'switched',
      remediation: undefined,
    });
    expect(await host.commit('feat: x')).toMatchObject({ ok: true, output: '1 file changed' });
    expect(await host.push('feat/x')).toMatchObject({ ok: true, output: 'pushed' });
    expect(await host.comment('12', 'hello')).toMatchObject({ ok: true, output: 'commented' });
  });

  it('reports stderr and a remediation when a step fails', async () => {
    const shell = shellReturning(
      { stderr: 'branch exists', exitCode: 1 },
      { stderr: 'nothing to commit', exitCode: 1 },
      { stderr: 'denied', exitCode: 1 },
      { stderr: 'no pr', exitCode: 1 },
      { stdout: 'not authenticated', exitCode: 1 },
    );
    const host = new GithubHostProvider(shell);

    expect(await host.ensureBranch('feat/x', 'main')).toMatchObject({
      ok: false,
      output: 'branch exists',
      remediation: expect.stringContaining('Failed to create branch feat/x from main'),
    });
    expect((await host.commit('m')).remediation).toContain('git commit failed');
    expect((await host.push('feat/x')).remediation).toContain('git push failed');
    expect((await host.comment('feat/x', 'b')).remediation).toContain('gh pr comment failed');
    expect(
      await host.openPR({
        base: 'main',
        head: 'feat/x',
        title: 't',
        body: 'b',
        draft: false,
        reviewers: [],
        labels: [],
      }),
    ).toMatchObject({ ok: false, output: 'not authenticated' });
  });

  it('opens a draft pull request with reviewers and labels', async () => {
    const shell = shellReturning({
      stdout: 'https://github.com/o/r/pull/42\n',
      exitCode: 0,
    });
    const host = new GithubHostProvider(shell);

    const result = await host.openPR({
      base: 'main',
      head: 'feat/x',
      title: 'Add x',
      body: 'Body',
      draft: true,
      reviewers: ['alice'],
      labels: ['security'],
    });

    expect(result.pr).toEqual({ number: 42, url: 'https://github.com/o/r/pull/42' });
    expect(shell.run).toHaveBeenCalledWith('gh', [
      'pr',
      'create',
      '--base',
      'main',
      '--head',
      'feat/x',
      '--title',
      'Add x',
      '--body',
      'Body',
      '--draft',
      '--reviewer',
      'alice',
      '--label',
      'security',
    ]);
  });

  it.each([
    ['', 'unknown', []],
    ['not json', 'unknown', []],
    ['{"name":"x"}', 'unknown', []],
    ['[{}]', 'unknown', [{ name: 'unknown', state: 'unknown' }]],
    [
      '[{"name":"lint","state":"SUCCESS"},{"name":"test","state":"PENDING"}]',
      'pending',
      [
        { name: 'lint', state: 'green' },
        { name: 'test', state: 'pending' },
      ],
    ],
  ])('reads checks output %j as %s', async (stdout, state, checks) => {
    const host = new GithubHostProvider(shellReturning({ stdout, exitCode: 0 }));
    expect(await host.getChecksStatus('feat/x')).toEqual({ state, checks });
  });

  it('aggregates mixed green and unknown states as unknown', () => {
    expect(aggregate(['green', 'unknown'])).toBe('unknown');
    expect(aggregate(['green', 'green'])).toBe('green');
    expect(aggregate(['green', 'red'])).toBe('red');
  });
});
