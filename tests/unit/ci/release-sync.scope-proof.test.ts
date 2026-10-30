import { afterEach, describe, expect, it } from 'vitest';

import {
  cleanTempDirs,
  git,
  run,
  REPO,
  PR_HEAD,
  REQUIRED,
  checkRun,
  greenRuns,
  proveFixture,
  scopeFixture,
  versionPr,
  STALE_BASE,
} from './release-sync-harness.js';

afterEach(cleanTempDirs);

describe.skipIf(process.platform === 'win32')('release-sync scope', () => {
  it('decides from the merge ref, ignoring the base sha in the event payload', () => {
    const { f, base } = scopeFixture();

    const result = versionPr(f, base);

    expect(result.outputs.skip_matrix).toBe('true');
    expect(result.stdout).toContain(`Diff from ${base} to `);
    expect(result.stdout).not.toContain(STALE_BASE);
  });

  it('runs the matrix when the merge ref does not merge the pull request head', () => {
    const { f, base } = scopeFixture();

    const result = versionPr(f, base, undefined, { GITHUB_SHA: base });

    expect(result.outputs.skip_matrix).toBe('false');
    expect(result.outputs.skip_reason).toContain(`the merge ref ${base} does not merge the head`);
  });

  it('runs the matrix when the branch does not contain the base', () => {
    const { f, base } = scopeFixture();
    git(f.repo, ['reset', '--quiet', '--hard', `${base}^`]);

    const result = versionPr(f, base);

    expect(result.outputs.skip_matrix).toBe('false');
    expect(result.outputs.skip_reason).toContain(`the branch does not contain the base ${base}`);
  });

  it('runs the matrix, never skips, when the lookup fails', () => {
    const { f, base } = scopeFixture({
      fail: `${REPO}/commits/${PR_HEAD}/check-runs?filter=all&per_page=100`,
    });

    const result = versionPr(f, base);

    expect(result.status).toBe(0);
    expect(result.outputs.skip_matrix).toBe('false');
    expect(result.stdout).toContain(
      '::notice::The full test matrix runs because the scope lookup failed:',
    );
    expect(result.outputs.skip_reason).toContain('lookup failed');
  });

  it('skips the matrix on a push to main whose tree is a green pull request head', () => {
    const { f, merge } = proveFixture();

    const result = run(f, 'scope', { GITHUB_EVENT_NAME: 'push', GITHUB_SHA: merge });

    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.outputs.skip_matrix).toBe('true');
    expect(result.outputs.skip_reason).toContain('main push');
  });

  it.each([
    ['no pull request', { pulls: [] }, 'no merged pull request'],
    ['a tree mismatch', { headTree: 'd'.repeat(40) }, 'tree mismatch'],
    [
      'a red check',
      {
        checkPages: [
          [checkRun(1, REQUIRED[0]!, { conclusion: 'failure' }), ...greenRuns().slice(1)],
        ],
      },
      'is failure',
    ],
  ])('runs the matrix on a push to main with %s', (_case, options, reason) => {
    const { f, merge } = proveFixture(options);

    const result = run(f, 'scope', { GITHUB_EVENT_NAME: 'push', GITHUB_SHA: merge });

    expect(result.outputs.skip_matrix).toBe('false');
    expect(result.outputs.skip_reason).toContain(reason);
  });

  it('runs the matrix for any other event', () => {
    const { f } = proveFixture();

    const result = run(f, 'scope', { GITHUB_EVENT_NAME: 'workflow_dispatch' });

    expect(result.outputs).toEqual({
      skip_matrix: 'false',
      skip_reason: 'event workflow_dispatch runs the full matrix',
    });
  });
});
