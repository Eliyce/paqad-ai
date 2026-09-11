import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { hasPackage } from '@/checks/prerequisites.js';

// Ecosystem-lockfile presence lookup (issue #554, Part B.2). true/false when a lockfile exists;
// null (unknown) when the ecosystem has no lockfile in the project.
describe('hasPackage', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-prereq-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns null when the ecosystem has no lockfile (unknown)', () => {
    expect(hasPackage(root, 'composer', 'brianium/paratest')).toBeNull();
    expect(hasPackage(root, 'python', 'pytest-xdist')).toBeNull();
  });

  it('finds a composer package by name in packages / packages-dev', () => {
    writeFileSync(
      join(root, 'composer.lock'),
      JSON.stringify({
        packages: [{ name: 'laravel/framework' }],
        'packages-dev': [{ name: 'brianium/paratest' }],
      }),
    );
    expect(hasPackage(root, 'composer', 'brianium/paratest')).toBe(true);
    expect(hasPackage(root, 'composer', 'phpunit/phpunit')).toBe(false);
  });

  it('matches a python package with - / _ equivalence, case-insensitive', () => {
    writeFileSync(join(root, 'requirements.txt'), 'PyTest_XDist==3.5.0\nrequests==2.0\n');
    expect(hasPackage(root, 'python', 'pytest-xdist')).toBe(true);
    expect(hasPackage(root, 'python', 'pytest-cov')).toBe(false);
  });

  it('reads pyproject.toml when it is the only python manifest', () => {
    writeFileSync(
      join(root, 'pyproject.toml'),
      '[tool.poetry.dependencies]\npytest-xdist = "^3"\n',
    );
    expect(hasPackage(root, 'python', 'pytest-xdist')).toBe(true);
  });

  it('finds a node package in a lockfile by substring', () => {
    writeFileSync(join(root, 'pnpm-lock.yaml'), "packages:\n  '@fast-check/vitest@1.0.0': {}\n");
    expect(hasPackage(root, 'node', '@fast-check/vitest')).toBe(true);
    mkdirSync(join(root, 'sub'), { recursive: true });
    expect(hasPackage(join(root, 'sub'), 'node', 'anything')).toBeNull();
  });

  it('finds a ruby gem in Gemfile.lock', () => {
    writeFileSync(join(root, 'Gemfile.lock'), 'GEM\n  specs:\n    parallel_tests (4.2.0)\n');
    expect(hasPackage(root, 'ruby', 'parallel-tests')).toBe(true);
    expect(hasPackage(root, 'ruby', 'rspec-rails')).toBe(false);
  });
});
