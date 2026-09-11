import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runChecks } from '@/checks/run-checks.js';
import { renderReceipt } from '@/cli/commands/checks.js';
import type { DeliveryShell } from '@/delivery/runner.js';

const GiB = 1024 ** 3;
const CLOCK = { nowMs: () => Date.now(), now: () => '2026-01-01T00:00:00.000Z' };

describe('runChecks (issue #554)', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-run-checks-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function writeProfile(extra = ''): void {
    writeFileSync(
      join(root, '.paqad/project-profile.yaml'),
      ['commands:', '  format: pnpm format', '  test: pnpm test', '  build: pnpm build', extra]
        .filter(Boolean)
        .join('\n') + '\n',
    );
  }

  it('AC-1: runs mkdir -p in-process and spawns the real pest binary with its args', async () => {
    writeFileSync(
      join(root, '.paqad/project-profile.yaml'),
      [
        'commands:',
        '  format: pnpm format',
        '  test: mkdir -p .paqad/test-results && ./vendor/bin/pest --log-junit .paqad/test-results/pest.xml',
        '  build: pnpm build',
      ].join('\n') + '\n',
    );
    const spawns: { bin: string; args: string[] }[] = [];
    const shell: DeliveryShell = {
      async run(bin, args) {
        spawns.push({ bin, args });
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    };
    await runChecks({ projectRoot: root, shell, osFacts: { availableParallelism: 8, totalmem: 64 * GiB }, ...CLOCK });

    expect(spawns).toContainEqual({
      bin: './vendor/bin/pest',
      args: ['--log-junit', '.paqad/test-results/pest.xml'],
    });
    expect(spawns.some((s) => s.bin === 'mkdir')).toBe(false);
    expect(existsSync(join(root, '.paqad/test-results'))).toBe(true);
  });

  it('AC-2: parses per-test identity from a junit file and prints file:line › name', async () => {
    writeFileSync(
      join(root, '.paqad/project-profile.yaml'),
      [
        'commands:',
        '  test: mkdir -p .paqad/test-results && ./vendor/bin/pest --log-junit .paqad/test-results/pest.xml',
        '  test_single: ./vendor/bin/pest --filter="<pattern>" --log-junit .paqad/test-results/pest.xml',
        'stack_profile:',
        '  frameworks: [laravel]',
        '  traits: [pest]',
        '  languages: []',
        '  runtimes: []',
      ].join('\n') + '\n',
    );
    const junit = `<?xml version="1.0"?><testsuites><testsuite name="Feature"><testcase name="it totals the invoice" classname="Tests\\Feature\\InvoiceTest" file="tests/Feature/InvoiceTest.php" line="42"><failure>boom</failure></testcase></testsuite></testsuites>`;
    const shell: DeliveryShell = {
      async run(bin) {
        if (bin === './vendor/bin/pest') {
          writeFileSync(join(root, '.paqad/test-results/pest.xml'), junit);
          return { stdout: '', stderr: '', exitCode: 1 };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    };
    const result = await runChecks({
      projectRoot: root,
      shell,
      osFacts: { availableParallelism: 8, totalmem: 64 * GiB },
      flakyMode: 'warn',
      ...CLOCK,
    });

    const failing = result.test_result?.failures[0];
    expect(failing?.test_id).toContain('it totals the invoice');
    expect(failing?.file_path).toBe('tests/Feature/InvoiceTest.php');
    expect(failing?.line_number).toBe(42);
    const receipt = renderReceipt(result, 'warn').join('\n');
    expect(receipt).toContain('tests/Feature/InvoiceTest.php:42 › it totals the invoice');
  });

  it('AC-4: falls back to sequential when the parallel harness produces no result, and pins it', async () => {
    writeFileSync(
      join(root, 'composer.lock'),
      JSON.stringify({ 'packages-dev': [{ name: 'brianium/paratest' }] }),
    );
    writeFileSync(
      join(root, '.paqad/project-profile.yaml'),
      [
        'commands:',
        '  test: mkdir -p .paqad/test-results && php artisan test --log-junit .paqad/test-results/pest.xml',
        '  test_single: php artisan test --filter="<pattern>" --log-junit .paqad/test-results/pest.xml',
        '  test_parallel: mkdir -p .paqad/test-results && php artisan test --parallel --processes=<processes> --log-junit .paqad/test-results/pest.xml',
        'stack_profile:',
        '  frameworks: [laravel]',
        '  traits: [pest]',
        '  languages: []',
        '  runtimes: []',
        'testing:',
        '  runner_id: pest',
        '  parallel: available',
        '  detected_by: script',
        '  recorded_at: 2026-09-11T00:00:00.000Z',
      ].join('\n') + '\n',
    );
    const passingJunit = `<?xml version="1.0"?><testsuites><testsuite name="F"><testcase name="ok" classname="C" file="tests/OkTest.php" line="1"/></testsuite></testsuites>`;
    const shell: DeliveryShell = {
      async run(bin, args) {
        const isParallel = args.includes('--parallel');
        if (bin === 'php' && isParallel) return { stdout: '', stderr: 'paratest exploded', exitCode: 1 };
        if (bin === 'php') {
          writeFileSync(join(root, '.paqad/test-results/pest.xml'), passingJunit);
          return { stdout: '', stderr: '', exitCode: 0 };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    };
    const result = await runChecks({
      projectRoot: root,
      shell,
      osFacts: { availableParallelism: 12, totalmem: 64 * GiB },
      ...CLOCK,
    });

    expect(result.mode.test_mode).toBe('sequential');
    expect(result.mode.fallback_reason).toMatch(/^harness-failure:/);
    expect(result.passed).toBe(true);

    const profile = readFileSync(join(root, '.paqad/project-profile.yaml'), 'utf8');
    expect(profile).toContain('parallel: unavailable');

    // A second run now resolves sequential directly (testing pinned unavailable).
    let sawParallel = false;
    const shell2: DeliveryShell = {
      async run(bin, args) {
        if (args.includes('--parallel')) sawParallel = true;
        if (bin === 'php') {
          writeFileSync(join(root, '.paqad/test-results/pest.xml'), passingJunit);
          return { stdout: '', stderr: '', exitCode: 0 };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    };
    const second = await runChecks({
      projectRoot: root,
      shell: shell2,
      osFacts: { availableParallelism: 12, totalmem: 64 * GiB },
      ...CLOCK,
    });
    expect(second.mode.test_mode).toBe('sequential');
    expect(sawParallel).toBe(false);
  });

  it('reports ran=false (Inconclusive) when no command is mapped', async () => {
    writeFileSync(join(root, '.paqad/project-profile.yaml'), 'commands:\n  dev: pnpm dev\n');
    const shell: DeliveryShell = { async run() { return { stdout: '', stderr: '', exitCode: 0 }; } };
    const result = await runChecks({ projectRoot: root, shell, ...CLOCK });
    expect(result.ran).toBe(false);
    expect(result.results).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
