import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createChecksCommand, renderReceipt } from '@/cli/commands/checks.js';
import type { ChecksRunResult } from '@/checks/run-checks.js';

function baseResult(over: Partial<ChecksRunResult>): ChecksRunResult {
  return {
    ran: true,
    passed: true,
    results: [],
    warnings: [],
    mode: { parallel_commands: true, test_mode: 'parallel', processes: 11, fallback_reason: null },
    commands: [
      {
        logical_command: 'format',
        command: 'pnpm format',
        exit_code: 0,
        passed: true,
        stage: 1,
        started_at: '',
        ended_at: '',
        duration_ms: 13000,
      },
      {
        logical_command: 'test',
        command: 'pnpm test',
        exit_code: 0,
        passed: true,
        stage: 3,
        started_at: '',
        ended_at: '',
        duration_ms: 122000,
      },
    ],
    isolation_reruns: { performed: true, skipped_reason: null, rerun_count: 3, entries: [] },
    flaky_under_parallel: [],
    meaningful_green: true,
    critical_path: { logical_command: 'test', duration_ms: 122000 },
    recovered: 0,
    duration_ms: 135000,
    sequential_reason: null,
    test_total: 8998,
    parallel_failures: 0,
    test_result: {
      schema_version: '1.0.0',
      summary: {
        total: 8998,
        passed: 8998,
        failed: 0,
        skipped: 0,
        errored: 0,
        duration_ms: 122000,
        timestamp: '',
        runner_id: 'vitest',
      },
      failures: [],
      warnings: [],
      parse_metadata: {
        raw_byte_size: 0,
        structured_byte_size: 0,
        compression_ratio: 1,
        original_size: 0,
        compact_size: 0,
        reduction_ratio: 0,
        delta_mode_used: false,
        escalation_occurred: false,
        escalation_reason: null,
        delta_summary: null,
        parse_strategy: 'structured',
        parse_warnings: [],
      },
      errors: [],
      evidence_scope: {},
    },
    ...over,
  };
}

describe('renderReceipt (issue #554)', () => {
  it('green parallel run shows tests + parallel ×N + critical path', () => {
    const lines = renderReceipt(baseResult({}), 'warn').join('\n');
    expect(lines).toContain('checks green — Safe to merge');
    expect(lines).toContain('parallel ×11');
    expect(lines).toContain('Critical path: test');
    expect(lines).toContain('2 m 15 s');
  });

  it('shows the flaky line under warn, hides it under pass, blocks under fail', () => {
    const withFlaky = baseResult({
      recovered: 2,
      flaky_under_parallel: [
        { test_id: 'a', file_path: 'x', line_number: 1, suspected_causes: [] },
        { test_id: 'b', file_path: 'y', line_number: 2, suspected_causes: [] },
      ],
    });
    expect(renderReceipt(withFlaky, 'warn').join('\n')).toContain(
      'passed alone; recorded, not blocking',
    );
    expect(renderReceipt(withFlaky, 'pass').join('\n')).not.toContain('passed alone');
    expect(renderReceipt(withFlaky, 'fail').join('\n')).toContain(
      'checks_flaky_under_parallel=fail',
    );
  });

  it('native mode prints native parallel', () => {
    const native = baseResult({
      mode: {
        parallel_commands: true,
        test_mode: 'native',
        processes: null,
        fallback_reason: null,
      },
    });
    expect(renderReceipt(native, 'warn').join('\n')).toContain('native parallel');
  });

  it('renders the sequential-fallback reasons in plain language', () => {
    for (const [reason, text] of [
      ['brianium/paratest-missing', 'paratest missing (brianium/paratest)'],
      ['too-few-cores', 'fewer than 4 cores'],
      ['harness-failure:x', 'the parallel harness failed'],
      ['unknown', 'run the test-runner-discovery skill'],
      ['no-parallel-command', 'no-parallel-command'],
    ] as const) {
      const seq = baseResult({
        mode: {
          parallel_commands: true,
          test_mode: 'sequential',
          processes: null,
          fallback_reason: null,
        },
        sequential_reason: reason,
      });
      expect(renderReceipt(seq, 'warn').join('\n')).toContain(text);
    }
  });

  it('a red run lists each failing test by file:line', () => {
    const red = baseResult({
      passed: false,
      parallel_failures: 2,
      test_result: {
        ...baseResult({}).test_result!,
        summary: { ...baseResult({}).test_result!.summary, failed: 1 },
        failures: [
          {
            test_id: 'C::it totals the invoice',
            suite: null,
            message: 'boom',
            stack_trace: null,
            file_path: 'tests/InvoiceTest.php',
            line_number: 42,
            category: 'assertion',
            duration_ms: null,
          },
        ],
      },
    });
    const lines = renderReceipt(red, 'warn').join('\n');
    expect(lines).toContain('Needs your attention');
    expect(lines).toContain('tests/InvoiceTest.php:42 › it totals the invoice');
  });
});

describe('checks plan / record-runner verbs', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-verbs-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    rmSync(root, { recursive: true, force: true });
  });

  async function run(args: string[]): Promise<string[]> {
    const out: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((l: string) => out.push(String(l)));
    vi.spyOn(console, 'error').mockImplementation((l: string) => out.push(String(l)));
    await createChecksCommand().parseAsync(args, { from: 'user' });
    return out;
  }

  it('checks plan prints a human plan and a --json plan', async () => {
    writeFileSync(
      join(root, '.paqad/project-profile.yaml'),
      [
        'commands:',
        '  format: pnpm format',
        '  test: pnpm test -- --reporter=tap',
        '  build: pnpm build',
        'stack_profile:',
        '  frameworks: [react]',
        '  traits: [vitest]',
        '  languages: []',
        '  runtimes: []',
      ].join('\n') + '\n',
    );
    expect((await run(['plan', '--project-root', root])).join('\n')).toContain('test: native');
    expect((await run(['plan', '--project-root', root, '--json'])).join('\n')).toContain(
      '"test_mode":"native"',
    );
  });

  it('checks record-runner writes the profile + stack-doc row for an accepted discovery', async () => {
    writeFileSync(join(root, 'package.json'), '{}');
    writeFileSync(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
    mkdirSync(join(root, 'docs/instructions/stack'), { recursive: true });
    writeFileSync(
      join(root, 'docs/instructions/stack/overview.md'),
      '| Action | Command |\n|--------|---------|\n| Test | pnpm test |\n',
    );
    writeFileSync(
      join(root, '.paqad/project-profile.yaml'),
      [
        'commands:',
        '  test: pnpm test -- --reporter=tap',
        'stack_profile:',
        '  frameworks: [react]',
        '  traits: []',
        '  languages: []',
        '  runtimes: []',
      ].join('\n') + '\n',
    );
    writeFileSync(
      join(root, 'disc.json'),
      JSON.stringify({
        schema_version: 1,
        runner_id: 'mocha',
        parallel: 'available',
        reason: null,
        test_parallel: 'pnpm test -- --parallel --jobs=<processes>',
        single_test_selector: 'file',
        evidence: ['package.json'],
      }),
    );
    const out = await run(['record-runner', join(root, 'disc.json'), '--project-root', root]);
    expect(out.join('\n')).toContain('recorded testing.parallel=available');
    const profile = readFileSync(join(root, '.paqad/project-profile.yaml'), 'utf8');
    expect(profile).toContain('test_parallel: pnpm test -- --parallel --jobs=<processes>');
    expect(readFileSync(join(root, 'docs/instructions/stack/overview.md'), 'utf8')).toContain(
      '| Test (parallel) | pnpm test -- --parallel --jobs=<processes> |',
    );
  });

  it('checks record-runner exits 2 and writes nothing for a rejected discovery', async () => {
    writeFileSync(join(root, 'package.json'), '{}');
    writeFileSync(
      join(root, '.paqad/project-profile.yaml'),
      ['commands:', '  test: pnpm test -- --reporter=tap'].join('\n') + '\n',
    );
    writeFileSync(
      join(root, 'bad.json'),
      JSON.stringify({
        schema_version: 1,
        runner_id: 'mocha',
        parallel: 'available',
        reason: null,
        test_parallel: 'pnpm test -- --parallel --jobs=<processes> && rm -rf /',
        single_test_selector: 'file',
        evidence: ['package.json'],
      }),
    );
    const out = await run(['record-runner', join(root, 'bad.json'), '--project-root', root]);
    expect(process.exitCode).toBe(2);
    expect(out.join('\n')).toContain('rm');
  });

  it('checks record-runner exits 2 on an unparseable discovery file', async () => {
    writeFileSync(join(root, '.paqad/project-profile.yaml'), 'commands:\n  test: pnpm test\n');
    writeFileSync(join(root, 'bad.json'), 'not json{');
    const out = await run(['record-runner', join(root, 'bad.json'), '--project-root', root]);
    expect(process.exitCode).toBe(2);
    expect(out.join('\n')).toContain('could not read or parse');
  });

  it('checks record-runner records a native discovery with no test_parallel', async () => {
    writeFileSync(join(root, 'package.json'), '{}');
    writeFileSync(
      join(root, '.paqad/project-profile.yaml'),
      [
        'commands:',
        '  test: go test ./...',
        'stack_profile:',
        '  frameworks: [go-web]',
        '  traits: []',
        '  languages: []',
        '  runtimes: []',
      ].join('\n') + '\n',
    );
    writeFileSync(
      join(root, 'disc.json'),
      JSON.stringify({
        schema_version: 1,
        runner_id: 'go-test',
        parallel: 'native',
        reason: null,
        test_parallel: null,
        single_test_selector: 'test_id',
        evidence: ['package.json'],
      }),
    );
    const out = await run(['record-runner', join(root, 'disc.json'), '--project-root', root]);
    expect(out.join('\n')).toContain('recorded testing.parallel=native');
    expect(readFileSync(join(root, '.paqad/project-profile.yaml'), 'utf8')).not.toContain(
      'test_parallel:',
    );
  });

  it('checks record-runner exits 2 when there is no project profile', async () => {
    writeFileSync(join(root, 'x.json'), '{}');
    const out = await run(['record-runner', join(root, 'x.json'), '--project-root', root]);
    expect(process.exitCode).toBe(2);
    expect(out.join('\n')).toContain('no project profile');
  });

  it('checks plan handles a project with no profile', async () => {
    const out = await run(['plan', '--project-root', root]);
    expect(out.join('\n')).toContain('test: sequential');
  });

  it('checks plan does not re-derive when the profile already records testing', async () => {
    writeFileSync(
      join(root, '.paqad/project-profile.yaml'),
      [
        'commands:',
        '  test: pnpm test -- --reporter=tap',
        'stack_profile:',
        '  frameworks: [react]',
        '  traits: [vitest]',
        '  languages: []',
        '  runtimes: []',
        'testing:',
        '  runner_id: vitest',
        '  parallel: native',
        '  detected_by: script',
        '  recorded_at: 2026-09-11T00:00:00.000Z',
      ].join('\n') + '\n',
    );
    expect((await run(['plan', '--project-root', root])).join('\n')).toContain('test: native');
  });

  it('checks record-runner rejects a metacharacter token after the prefix', async () => {
    writeFileSync(join(root, 'package.json'), '{}');
    writeFileSync(
      join(root, '.paqad/project-profile.yaml'),
      ['commands:', '  test: pnpm test -- --reporter=tap'].join('\n') + '\n',
    );
    writeFileSync(
      join(root, 'm.json'),
      JSON.stringify({
        schema_version: 1,
        runner_id: 'x',
        parallel: 'available',
        reason: null,
        test_parallel: 'pnpm test -- --jobs=<processes> `evil`',
        single_test_selector: 'file',
        evidence: ['package.json'],
      }),
    );
    await run(['record-runner', join(root, 'm.json'), '--project-root', root]);
    expect(process.exitCode).toBe(2);
  });
});
