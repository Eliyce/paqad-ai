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
    await runChecks({
      projectRoot: root,
      shell,
      osFacts: { availableParallelism: 8, totalmem: 64 * GiB },
      ...CLOCK,
    });

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
        if (bin === 'php' && isParallel)
          return { stdout: '', stderr: 'paratest exploded', exitCode: 1 };
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
    const shell: DeliveryShell = {
      async run() {
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    };
    const result = await runChecks({ projectRoot: root, shell, ...CLOCK });
    expect(result.ran).toBe(false);
    expect(result.results).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('a red non-test command makes the run fail and records an output tail', async () => {
    writeFileSync(
      join(root, '.paqad/project-profile.yaml'),
      ['commands:', '  format: pnpm format', '  build: pnpm build'].join('\n') + '\n',
    );
    const shell: DeliveryShell = {
      async run(bin, args) {
        if (args[0] === 'format')
          return { stdout: '', stderr: 'prettier found issues', exitCode: 2 };
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    };
    const result = await runChecks({
      projectRoot: root,
      shell,
      osFacts: { availableParallelism: 8, totalmem: 64 * 1024 ** 3 },
      ...CLOCK,
    });
    expect(result.passed).toBe(false);
    const format = result.commands.find((c) => c.logical_command === 'format');
    expect(format?.passed).toBe(false);
    expect(format?.output_tail?.join('\n')).toContain('prettier found issues');
    expect(result.mode.test_mode).toBe('sequential');
  });

  it('runs a native runner in native mode without a parallel command', async () => {
    writeFileSync(
      join(root, '.paqad/project-profile.yaml'),
      [
        'commands:',
        '  test: pnpm test -- --reporter=tap',
        '  test_single: pnpm test -- <pattern>',
        'stack_profile:',
        '  frameworks: [react]',
        '  traits: [vitest]',
        '  languages: []',
        '  runtimes: []',
      ].join('\n') + '\n',
    );
    const shell: DeliveryShell = {
      async run() {
        return { stdout: 'TAP version 13\n1..0\n', stderr: '', exitCode: 0 };
      },
    };
    const result = await runChecks({
      projectRoot: root,
      shell,
      osFacts: { availableParallelism: 8, totalmem: 64 * 1024 ** 3 },
      ...CLOCK,
    });
    expect(result.mode.test_mode).toBe('native');
    expect(result.passed).toBe(true);
  });

  it('reports an unsupported-syntax test command red without spawning it', async () => {
    root = mkdtempSync(join(tmpdir(), 'paqad-run-checks-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(
      join(root, '.paqad/project-profile.yaml'),
      ['commands:', '  test: node -e process.exit(0)'].join('\n') + '\n',
    );
    const shell: DeliveryShell = {
      async run() {
        throw new Error('must not spawn');
      },
    };
    const result = await runChecks({
      projectRoot: root,
      shell,
      osFacts: { availableParallelism: 8, totalmem: 64 * 1024 ** 3 },
      ...CLOCK,
    });
    expect(result.passed).toBe(false);
    const test = result.commands.find((c) => c.logical_command === 'test');
    expect(test?.output_tail?.join('\n')).toContain('Unsupported shell syntax');
  });

  it('runs parallel, confirms a failure alone, and sets aside a recovered flaky test', async () => {
    root = mkdtempSync(join(tmpdir(), 'paqad-run-checks-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
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
    const padding = Array.from(
      { length: 30 },
      (_, i) => `<testcase name="ok ${i}" classname="C" file="tests/OkTest.php" line="1"/>`,
    ).join('');
    const failing = `<?xml version="1.0"?><testsuites><testsuite name="F"><testcase name="flaky one" classname="C" file="tests/FlakyTest.php" line="7"><failure>crowd</failure></testcase>${padding}</testsuite></testsuites>`;
    const passing =
      '<?xml version="1.0"?><testsuites><testsuite name="F"><testcase name="flaky one" classname="C" file="tests/FlakyTest.php" line="7"/></testsuite></testsuites>';
    const shell: DeliveryShell = {
      async run(bin, args) {
        if (bin === 'php') {
          const single = args.includes('--filter=flaky one');
          // Write the junit to whatever --log-junit path this invocation names (the re-run
          // redirects it to rerun-0.xml so the main result is never overwritten).
          const outPath = args[args.indexOf('--log-junit') + 1] ?? '.paqad/test-results/pest.xml';
          writeFileSync(join(root, outPath), single ? passing : failing);
          return { stdout: '', stderr: '', exitCode: single ? 0 : 1 };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    };
    const result = await runChecks({
      projectRoot: root,
      shell,
      osFacts: { availableParallelism: 12, totalmem: 64 * 1024 ** 3 },
      flakyMode: 'warn',
      ...CLOCK,
    });
    expect(result.mode.test_mode).toBe('parallel');
    expect(result.mode.processes).toBe(11);
    expect(result.flaky_under_parallel).toHaveLength(1);
    expect(result.recovered).toBe(1);
    expect(result.passed).toBe(true);
  });

  it('a failing test with no resolvable runner reads red via the plain-text fallback', async () => {
    root = mkdtempSync(join(tmpdir(), 'paqad-run-checks-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(
      join(root, '.paqad/project-profile.yaml'),
      ['commands:', '  test: some-runner'].join('\n') + '\n',
    );
    const shell: DeliveryShell = {
      async run() {
        return { stdout: '', stderr: 'suite failed', exitCode: 1 };
      },
    };
    const result = await runChecks({
      projectRoot: root,
      shell,
      osFacts: { availableParallelism: 8, totalmem: 64 * 1024 ** 3 },
      ...CLOCK,
    });
    expect(result.passed).toBe(false);
    expect(result.test_result?.parse_metadata.parse_strategy).toBe('plain-text-fallback');
    expect(result.isolation_reruns.performed).toBe(false);
  });
});
