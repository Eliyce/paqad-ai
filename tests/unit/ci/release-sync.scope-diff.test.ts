import { chmodSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  cleanTempDirs,
  git,
  PR_HEAD,
  REQUIRED,
  greenRuns,
  writeFiles,
  packageJson,
  scopeFixture,
  versionPr,
} from './release-sync-harness.js';

afterEach(cleanTempDirs);

describe.skipIf(process.platform === 'win32')('release-sync scope', () => {
  it('AC-13: skips the matrix for a version-only pull request on a proven green base', () => {
    const { f, base, tree } = scopeFixture();

    const result = versionPr(f, base);

    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.outputs.skip_matrix).toBe('true');
    expect(result.outputs.skip_reason).toContain('version pull request');
    expect(result.stdout).toContain('only the version changed, 1.0.0 -> 1.1.0');
    expect(result.stdout).toContain(
      `Pull request 7 (https://pr/7), head ${PR_HEAD}, tree ${tree}.`,
    );
    for (const name of REQUIRED) expect(result.stdout).toContain(`${name}: success`);
    expect(result.stdout).toContain('Skipping the test matrix (rule: version pull request)');
  });

  it.each([
    [
      'an added changeset',
      (repo: string) =>
        writeFiles(repo, { 'package.json': packageJson('1.1.0'), '.changeset/new-dog.md': 'x\n' }),
      '.changeset/new-dog.md (A)',
    ],
    [
      'a modified changeset',
      (repo: string) =>
        writeFiles(repo, {
          'package.json': packageJson('1.1.0'),
          '.changeset/brave-cat.md': 'x\n',
        }),
      '.changeset/brave-cat.md (M)',
    ],
    [
      'a deleted .changeset/config.json',
      (repo: string) =>
        writeFiles(repo, { 'package.json': packageJson('1.1.0'), '.changeset/config.json': null }),
      '.changeset/config.json (D)',
    ],
    [
      'a deleted .changeset/README.md',
      (repo: string) =>
        writeFiles(repo, { 'package.json': packageJson('1.1.0'), '.changeset/README.md': null }),
      '.changeset/README.md (D)',
    ],
    [
      'a renamed file',
      (repo: string) => {
        writeFiles(repo, { 'package.json': packageJson('1.1.0') });
        git(repo, ['mv', '.changeset/brave-cat.md', '.changeset/brave-dog.md']);
      },
      '.changeset/brave-dog.md (A)',
    ],
    [
      'a mode change',
      (repo: string) => {
        writeFiles(repo, { 'package.json': packageJson('1.1.0') });
        chmodSync(join(repo, 'package.json'), 0o755);
      },
      'package.json is M with mode 100644 -> 100755',
    ],
    [
      'a pnpm-lock.yaml change',
      (repo: string) =>
        writeFiles(repo, {
          'package.json': packageJson('1.1.0'),
          'pnpm-lock.yaml': 'lockfileVersion: 10\n',
        }),
      'pnpm-lock.yaml (M)',
    ],
    [
      'a second package.json change',
      (repo: string) =>
        writeFiles(repo, { 'package.json': packageJson('1.1.0', { private: true }) }),
      'package.json changes more than its version',
    ],
    [
      'a version that is not a plain semver',
      (repo: string) => writeFiles(repo, { 'package.json': packageJson('1.1.0-beta.1') }),
      'the new version 1.1.0-beta.1 is not a plain semver',
    ],
    [
      'no version bump',
      (repo: string) => writeFiles(repo, { 'CHANGELOG.md': 'x\n' }),
      'package.json is unchanged',
    ],
  ])('AC-12: runs the matrix for %s', (_case, edit, reason) => {
    const { f, base } = scopeFixture();

    const result = versionPr(f, base, edit);

    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.outputs.skip_matrix).toBe('false');
    expect(result.outputs.skip_reason).toContain(reason);
  });

  it.each([
    ['is not green', { checkPages: [greenRuns().slice(1)] }, 'is missing'],
    ['does not match its pull request head', { headTree: 'd'.repeat(40) }, 'tree mismatch'],
    ['was pushed without a pull request', { pulls: [] }, 'no merged pull request'],
  ])('AC-13: runs the matrix when the base %s', (_case, options, reason) => {
    const { f, base } = scopeFixture(options);

    const result = versionPr(f, base);

    expect(result.outputs.skip_matrix).toBe('false');
    expect(result.outputs.skip_reason).toContain(reason);
  });

  it.each(['src/cli/index.ts', 'docs/site-map/journeys/release.md'])(
    'AC-23: runs the matrix when a version pull request also changes %s',
    (path) => {
      const { f, base } = scopeFixture();

      const result = versionPr(f, base, (repo) =>
        writeFiles(repo, { 'package.json': packageJson('1.1.0'), [path]: 'x\n' }),
      );

      expect(result.outputs.skip_matrix).toBe('false');
      expect(result.outputs.skip_reason).toContain(`${path} (A) is not a version-only change`);
    },
  );
});
