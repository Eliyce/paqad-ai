import { runDelivery, type DeliveryShell } from '@/delivery/runner.js';

function makeShell(responses: Array<{ exitCode: number; stdout?: string; stderr?: string }>): {
  shell: DeliveryShell;
  calls: Array<{ command: string; args: string[] }>;
} {
  const calls: Array<{ command: string; args: string[] }> = [];
  let index = 0;
  return {
    calls,
    shell: {
      async run(command, args) {
        calls.push({ command, args });
        const response = responses[index];
        index += 1;
        return {
          stdout: response?.stdout ?? '',
          stderr: response?.stderr ?? '',
          exitCode: response?.exitCode ?? 0,
        };
      },
    },
  };
}

const RENDERED = {
  branch: 'feat/PAQ-1-thing',
  commit: 'feat(scope): thing\n\nRefs: PAQ-1',
  pr_title: 'feat(scope): thing [PAQ-1]',
  pr_body: '## Summary\nthing',
};

describe('delivery runner', () => {
  it('completes the happy path through branch / commit / push / pr', async () => {
    const { shell, calls } = makeShell([
      { exitCode: 0 },
      { exitCode: 0 },
      { exitCode: 0 },
      { exitCode: 0, stdout: 'https://github.com/org/repo/pull/1' },
    ]);

    const result = await runDelivery(shell, {
      rendered: RENDERED,
      base: 'main',
      draft: false,
      reviewers: ['alice'],
      labels: ['feat'],
      open_pr: 'yes',
    });

    expect(result.ok).toBe(true);
    expect(result.steps.map((step) => step.step)).toEqual(['branch', 'commit', 'push', 'pr']);
    expect(calls[0]).toEqual({ command: 'git', args: ['checkout', '-b', RENDERED.branch] });
    expect(calls[3].command).toBe('gh');
    expect(calls[3].args).toEqual(
      expect.arrayContaining(['pr', 'create', '--reviewer', 'alice', '--label', 'feat']),
    );
  });

  it('passes --draft when open_pr is draft', async () => {
    const { shell, calls } = makeShell([
      { exitCode: 0 },
      { exitCode: 0 },
      { exitCode: 0 },
      { exitCode: 0 },
    ]);
    await runDelivery(shell, {
      rendered: RENDERED,
      base: 'main',
      draft: true,
      reviewers: [],
      labels: [],
      open_pr: 'draft',
    });
    expect(calls[3].args).toContain('--draft');
  });

  it('stops after commit when open_pr is no', async () => {
    const { shell, calls } = makeShell([{ exitCode: 0 }, { exitCode: 0 }]);
    const result = await runDelivery(shell, {
      rendered: RENDERED,
      base: 'main',
      draft: false,
      reviewers: [],
      labels: [],
      open_pr: 'no',
    });
    expect(result.ok).toBe(true);
    expect(result.steps.map((step) => step.step)).toEqual(['branch', 'commit']);
    expect(calls).toHaveLength(2);
  });

  it('short-circuits and reports remediation when push fails', async () => {
    const { shell } = makeShell([
      { exitCode: 0 },
      { exitCode: 0 },
      { exitCode: 1, stderr: 'rejected: branch protection' },
    ]);
    const result = await runDelivery(shell, {
      rendered: RENDERED,
      base: 'main',
      draft: false,
      reviewers: [],
      labels: [],
      open_pr: 'yes',
    });
    expect(result.ok).toBe(false);
    expect(result.steps.at(-1)?.step).toBe('push');
    expect(result.steps.at(-1)?.remediation).toContain('branch protection');
    expect(result.steps.find((step) => step.step === 'pr')).toBeUndefined();
  });

  it('short-circuits when branch creation fails', async () => {
    const { shell } = makeShell([{ exitCode: 1, stderr: 'branch already exists' }]);
    const result = await runDelivery(shell, {
      rendered: RENDERED,
      base: 'main',
      draft: false,
      reviewers: [],
      labels: [],
      open_pr: 'yes',
    });
    expect(result.ok).toBe(false);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].remediation).toContain(RENDERED.branch);
  });
});
