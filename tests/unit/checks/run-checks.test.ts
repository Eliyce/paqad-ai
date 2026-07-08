import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runChecks } from '@/checks/run-checks.js';
import type { DeliveryShell } from '@/delivery/runner.js';

// The deterministic check runner (issue #318): it runs the project's mapped
// format/test/build commands and turns each exit code into a StructuredTestResult
// the code-tests-lint gate already understands. A stub shell keeps the test fast
// and free of real subprocesses while pinning the exit-code → result contract.
describe('runChecks', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-run-checks-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
    // Map the default checks commands (format / test / build) so the resolver
    // yields real commands to run.
    writeFileSync(
      join(root, '.paqad/project-profile.yaml'),
      ['commands:', '  format: pnpm format', '  test: pnpm test', '  build: pnpm build'].join('\n'),
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** A shell that maps each spawned command's first arg to a fixed exit code. */
  function stubShell(exitByLogical: Record<string, number>): DeliveryShell {
    return {
      async run(_bin, args) {
        // args[0] is `format` / `test` / `build` for `pnpm <cmd>`.
        const logical = args[0] ?? '';
        const exitCode = exitByLogical[logical] ?? 0;
        return { stdout: '', stderr: exitCode === 0 ? '' : `${logical} blew up`, exitCode };
      },
    };
  }

  it('runs every mapped command and yields one structured result each (AC-1)', async () => {
    const result = await runChecks({
      projectRoot: root,
      changedFiles: ['src/app.ts'],
      shell: stubShell({}),
      now: () => '2026-01-01T00:00:00.000Z',
    });

    expect(result.ran).toBe(true);
    expect(result.passed).toBe(true);
    expect(result.results.map((r) => r.summary.runner_id).sort()).toEqual([
      'build',
      'format',
      'test',
    ]);
    // Evidence scope maps the run to the changed code (strong test evidence).
    expect(result.results[0].evidence_scope?.related_paths).toEqual(['src/app.ts']);
    // Every result parsed structurally — never the degraded fallback.
    expect(result.results.every((r) => r.parse_metadata.parse_strategy === 'structured')).toBe(
      true,
    );
  });

  it('marks a non-zero command as a failed result carrying the stderr (AC-1)', async () => {
    const result = await runChecks({
      projectRoot: root,
      changedFiles: ['src/app.ts'],
      shell: stubShell({ test: 1 }),
      now: () => '2026-01-01T00:00:00.000Z',
    });

    expect(result.passed).toBe(false);
    const failed = result.results.find((r) => r.summary.runner_id === 'test');
    expect(failed?.summary.failed).toBe(1);
    expect(failed?.failures[0]?.message).toContain('test blew up');
    // The passing commands stay clean.
    expect(result.results.find((r) => r.summary.runner_id === 'build')?.summary.failed).toBe(0);
  });

  it('reports ran=false (Inconclusive) when no command is mapped', async () => {
    // A profile with no format/test/build commands ⇒ resolver returns nothing.
    writeFileSync(join(root, '.paqad/project-profile.yaml'), 'commands:\n  dev: pnpm dev\n');
    const result = await runChecks({ projectRoot: root, shell: stubShell({}) });

    expect(result.ran).toBe(false);
    expect(result.results).toHaveLength(0);
    // Vacuously "passed" — but `ran:false` is the honest Inconclusive signal.
    expect(result.passed).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
