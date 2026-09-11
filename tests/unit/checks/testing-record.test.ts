import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  deriveTestingForProfile,
  deriveTestingRecord,
  insertParallelFlag,
  upsertStackDocCommandRow,
} from '@/checks/testing-record.js';
import type { StackPackTestRunner } from '@/core/types/pack.js';

function commands(test: string) {
  return {
    install: '',
    dev: '',
    test,
    test_single: `${test} --filter="<pattern>"`,
    lint: '',
    format: '',
    migrate: '',
    build: '',
  };
}

const NOW = '2026-09-11T10:00:00.000Z';

const PEST: StackPackTestRunner = {
  runner_id: 'pest',
  structured_format: 'junit-xml',
  structured_flags: '--log-junit .paqad/test-results/pest.xml',
  output_source: 'file',
  output_path_pattern: '.paqad/test-results/pest.xml',
  single_test_selector: 'test_id',
  parallel: {
    mode: 'flag',
    flag: '--parallel --processes=<processes>',
    requires_package: 'brianium/paratest',
  },
};

describe('insertParallelFlag', () => {
  it('inserts the flag before the structured flags', () => {
    expect(
      insertParallelFlag(
        'mkdir -p .paqad/test-results && vendor/bin/sail test --log-junit .paqad/test-results/pest.xml',
        '--parallel --processes=<processes>',
        '--log-junit .paqad/test-results/pest.xml',
      ),
    ).toBe(
      'mkdir -p .paqad/test-results && vendor/bin/sail test --parallel --processes=<processes> --log-junit .paqad/test-results/pest.xml',
    );
  });

  it('appends the flag when there are no structured flags to anchor on', () => {
    expect(insertParallelFlag('bundle exec rspec', '-p', undefined)).toBe('bundle exec rspec -p');
  });
});

describe('deriveTestingRecord', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-testing-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('flag mode with the package present → available + a parallel command (AC-10)', () => {
    writeFileSync(
      join(root, 'composer.lock'),
      JSON.stringify({ 'packages-dev': [{ name: 'brianium/paratest' }] }),
    );
    const out = deriveTestingRecord({
      runner: PEST,
      sequentialTest:
        'mkdir -p .paqad/test-results && php artisan test --log-junit .paqad/test-results/pest.xml',
      projectRoot: root,
      ecosystem: 'composer',
      now: NOW,
    });
    expect(out.testing.parallel).toBe('available');
    expect(out.test_parallel).toContain('--parallel --processes=<processes> --log-junit');
    expect(out.testing.lockfile_hash).toMatch(/^sha256:/);
    expect(out.testing.detected_by).toBe('script');
  });

  it('flag mode with the package absent → unavailable + <package>-missing (AC-10)', () => {
    writeFileSync(join(root, 'composer.lock'), JSON.stringify({ packages: [] }));
    const out = deriveTestingRecord({
      runner: PEST,
      sequentialTest: 'php artisan test',
      projectRoot: root,
      ecosystem: 'composer',
      now: NOW,
    });
    expect(out.testing.parallel).toBe('unavailable');
    expect(out.testing.reason).toBe('brianium/paratest-missing');
    expect(out.test_parallel).toBeUndefined();
  });

  it('no lockfile → unknown', () => {
    const out = deriveTestingRecord({
      runner: PEST,
      sequentialTest: 'php artisan test',
      projectRoot: root,
      ecosystem: 'composer',
      now: NOW,
    });
    expect(out.testing.parallel).toBe('unknown');
  });

  it('native runner → native, no parallel command', () => {
    const out = deriveTestingRecord({
      runner: { runner_id: 'vitest', structured_format: 'tap', parallel: { mode: 'native' } },
      sequentialTest: 'pnpm test -- --reporter=tap',
      projectRoot: root,
      ecosystem: 'node',
      now: NOW,
    });
    expect(out.testing.parallel).toBe('native');
    expect(out.test_parallel).toBeUndefined();
  });

  it('unavailable runner keeps the pack reason', () => {
    const out = deriveTestingRecord({
      runner: {
        runner_id: 'rspec',
        structured_format: 'rspec-json',
        parallel: { mode: 'unavailable', reason: 'RSpec runs one example at a time' },
      },
      sequentialTest: 'bundle exec rspec',
      projectRoot: root,
      ecosystem: 'ruby',
      now: NOW,
    });
    expect(out.testing.parallel).toBe('unavailable');
    expect(out.testing.reason).toBe('RSpec runs one example at a time');
  });
});

describe('deriveTestingForProfile against the real laravel pack (AC-10)', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-derive-profile-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('sail + pest + paratest → the parallel command and available', () => {
    writeFileSync(
      join(root, 'composer.lock'),
      JSON.stringify({ 'packages-dev': [{ name: 'brianium/paratest' }] }),
    );
    const out = deriveTestingForProfile({
      stackProfile: { frameworks: ['laravel'], traits: ['sail', 'pest'] },
      commands: commands(
        'mkdir -p .paqad/test-results && vendor/bin/sail test --log-junit .paqad/test-results/pest.xml',
      ),
      projectRoot: root,
      now: NOW,
    });
    expect(out.testing?.parallel).toBe('available');
    expect(out.testing?.runner_id).toBe('pest');
    expect(out.commands.test_parallel).toBe(
      'mkdir -p .paqad/test-results && vendor/bin/sail test --parallel --processes=<processes> --log-junit .paqad/test-results/pest.xml',
    );
  });

  it('without paratest → unavailable, brianium/paratest-missing', () => {
    writeFileSync(join(root, 'composer.lock'), JSON.stringify({ packages: [] }));
    const out = deriveTestingForProfile({
      stackProfile: { frameworks: ['laravel'], traits: ['pest'] },
      commands: commands('mkdir -p .paqad/test-results && php artisan test --log-junit .paqad/test-results/pest.xml'),
      projectRoot: root,
      now: NOW,
    });
    expect(out.testing?.parallel).toBe('unavailable');
    expect(out.testing?.reason).toBe('brianium/paratest-missing');
    expect(out.commands.test_parallel).toBeUndefined();
  });

  it('phpunit trait selects the phpunit runner', () => {
    writeFileSync(join(root, 'composer.lock'), JSON.stringify({ packages: [] }));
    const out = deriveTestingForProfile({
      stackProfile: { frameworks: ['laravel'], traits: ['phpunit'] },
      commands: commands('mkdir -p .paqad/test-results && php artisan test --log-junit .paqad/test-results/phpunit.xml'),
      projectRoot: root,
      now: NOW,
    });
    expect(out.testing?.runner_id).toBe('phpunit');
  });
});

describe('upsertStackDocCommandRow', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-stackdoc-'));
    mkdirSync(join(root, 'docs/instructions/stack'), { recursive: true });
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('appends a Test (parallel) row to the existing command table', () => {
    writeFileSync(
      join(root, 'docs/instructions/stack/overview.md'),
      '# Stack\n\n## Commands\n\n| Action | Command |\n|--------|---------|\n| Test | pnpm test |\n',
    );
    upsertStackDocCommandRow(root, 'Test (parallel)', 'pnpm test -- --parallel');
    const doc = readFileSync(join(root, 'docs/instructions/stack/overview.md'), 'utf8');
    expect(doc).toContain('| Test (parallel) | pnpm test -- --parallel |');
    expect(doc).toContain('| Test | pnpm test |');
  });

  it('replaces an existing Test (parallel) row instead of duplicating it', () => {
    writeFileSync(
      join(root, 'docs/instructions/stack/overview.md'),
      '| Action | Command |\n|--------|---------|\n| Test (parallel) | old |\n',
    );
    upsertStackDocCommandRow(root, 'Test (parallel)', 'new-command');
    const doc = readFileSync(join(root, 'docs/instructions/stack/overview.md'), 'utf8');
    expect(doc).toContain('| Test (parallel) | new-command |');
    expect(doc).not.toContain('old');
    expect(doc.match(/Test \(parallel\)/g)).toHaveLength(1);
  });

  it('creates a recorded-by-paqad section when there is no command table', () => {
    writeFileSync(join(root, 'docs/instructions/stack/overview.md'), '# Stack\n\nNo table here.\n');
    upsertStackDocCommandRow(root, 'Test (parallel)', 'pnpm test -- --parallel');
    const doc = readFileSync(join(root, 'docs/instructions/stack/overview.md'), 'utf8');
    expect(doc).toContain('## Test runner (recorded by paqad)');
    expect(doc).toContain('| Test (parallel) | pnpm test -- --parallel |');
  });

  it('skips silently when the stack docs directory does not exist', () => {
    const bare = mkdtempSync(join(tmpdir(), 'paqad-nostack-'));
    expect(() => upsertStackDocCommandRow(bare, 'Test (parallel)', 'x')).not.toThrow();
    rmSync(bare, { recursive: true, force: true });
  });
});
