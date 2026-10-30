import { afterEach, describe, expect, it } from 'vitest';

import {
  cleanTempDirs,
  run,
  REPO,
  PR_HEAD,
  REQUIRED,
  CheckRun,
  checkRun,
  greenRuns,
  proveFixture,
} from './release-sync-harness.js';

afterEach(cleanTempDirs);

describe.skipIf(process.platform === 'win32')('release-sync ci-green', () => {
  it('AC-10: writes only the verified tree when all 4 checks are green on a head with the same tree', () => {
    const { f, tree } = proveFixture();

    const result = run(f, 'ci-green');

    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.githubEnv).toBe(`PAQAD_RELEASE_VERIFIED_TREE=${tree}\n`);
    expect(result.stdout).toContain(
      `Pull request 7 (https://pr/7), head ${PR_HEAD}, tree ${tree}.`,
    );
    for (const [index, name] of REQUIRED.entries()) {
      expect(result.stdout).toContain(
        `${name}: success https://github.com/Eliyce/paqad-ai/runs/${100 + index}`,
      );
    }
  });

  it('judges the newest attempt per name across every result page and logs earlier failures', () => {
    const [first, ...rest] = greenRuns();
    const failedEarlier = checkRun(50, first!.name, { conclusion: 'failure' });
    const { f } = proveFixture({ checkPages: [[failedEarlier, ...rest], [first!]] });

    const result = run(f, 'ci-green');

    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain(
      `earlier attempt of ${first!.name} was failure: https://github.com/Eliyce/paqad-ai/runs/50`,
    );
  });

  it.each([
    ['failure', { conclusion: 'failure' }],
    ['neutral', { conclusion: 'neutral' }],
    ['skipped', { conclusion: 'skipped' }],
    ['cancelled', { conclusion: 'cancelled' }],
    ['in_progress', { status: 'in_progress', conclusion: null }],
  ] as const)('AC-9 AC-21: refuses when the newest attempt is %s', (result, overrides) => {
    const runs = greenRuns();
    const older = { ...runs[2]!, id: 10 };
    runs[2] = checkRun(200, runs[2]!.name, overrides);
    const { f } = proveFixture({ checkPages: [[older, ...runs]] });

    const outcome = run(f, 'ci-green');

    expect(outcome.status).toBe(1);
    expect(outcome.stdout).toContain(`::error::Nothing is published: CI is not proven green on `);
    expect(outcome.stdout).toContain(`required check "${REQUIRED[2]}" is ${result} on ${PR_HEAD}`);
    expect(outcome.githubEnv).toBe('');
  });

  it.each([
    ['is missing', (runs: CheckRun[]) => runs.slice(1)],
    [
      'comes from another workflow',
      (runs: CheckRun[]) => [
        checkRun(100, REQUIRED[0]!, { check_suite: { id: 12 } }),
        ...runs.slice(1),
      ],
    ],
    [
      'comes from another app',
      (runs: CheckRun[]) => [
        checkRun(100, REQUIRED[0]!, { app: { slug: 'some-app' } }),
        ...runs.slice(1),
      ],
    ],
  ])('AC-9: refuses when a required check %s', (_case, edit) => {
    const { f } = proveFixture({ checkPages: [edit(greenRuns())] });

    const result = run(f, 'ci-green');

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(`required check "${REQUIRED[0]}" is missing`);
    expect(result.githubEnv).toBe('');
  });

  it('refuses when no merged pull request has the commit as its merge commit', () => {
    const { f, merge } = proveFixture({
      pulls: [
        {
          number: 8,
          html_url: 'https://pr/8',
          merged_at: '2026-10-30T00:00:00Z',
          merge_commit_sha: 'c'.repeat(40),
          head: { sha: PR_HEAD },
        },
      ],
    });

    const result = run(f, 'ci-green');

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(`no merged pull request has ${merge} as its merge commit`);
    expect(result.githubEnv).toBe('');
  });

  it('refuses on a tree mismatch', () => {
    const { f } = proveFixture({ headTree: 'd'.repeat(40) });

    const result = run(f, 'ci-green');

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      `tree mismatch: pull request 7 head ${PR_HEAD} has tree ${'d'.repeat(40)}`,
    );
    expect(result.githubEnv).toBe('');
  });

  it('AC-18: refuses when the pull request head does not contain the base it merged into', () => {
    const { f } = proveFixture({ behindBy: 2 });

    const result = run(f, 'ci-green');

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(`pull request 7 head ${PR_HEAD} does not contain the base`);
    expect(result.githubEnv).toBe('');
  });

  it('refuses at once, publishing nothing, when the lookup fails', () => {
    const { f } = proveFixture({
      fail: `${REPO}/commits/${PR_HEAD}/check-runs?filter=all&per_page=100`,
    });

    const result = run(f, 'ci-green');

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      '::error::Nothing is published: the CI lookup for HEAD failed:',
    );
    expect(result.stdout).toContain('rate limit exceeded');
    expect(result.githubEnv).toBe('');
  });
});
