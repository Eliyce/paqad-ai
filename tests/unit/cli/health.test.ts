import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runHealthAudit = vi.fn();
const runHealthRetest = vi.fn();

vi.mock('@/codebase-health/run.js', () => ({ runHealthAudit }));
vi.mock('@/codebase-health/retest-run.js', () => ({ runHealthRetest }));

const { createHealthCommand } = await import('@/cli/commands/health.js');
const { createProgram } = await import('@/cli/program.js');

async function invoke(args: string[]): Promise<string[]> {
  const out: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((line: string) => out.push(String(line)));
  vi.spyOn(console, 'error').mockImplementation((line: string) => out.push(String(line)));
  await createHealthCommand().parseAsync(args, { from: 'user' });
  return out;
}

describe('paqad-ai health command', () => {
  beforeEach(() => {
    runHealthAudit.mockReset();
    runHealthRetest.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('is registered on the program', () => {
    expect(createProgram().commands.map((c) => c.name())).toContain('health');
  });

  it('run: reports findings, prints blocked checks + baseline, and exits 1', async () => {
    runHealthAudit.mockResolvedValue({
      report_id: 'HEALTH-x',
      report_path: 'docs/health/x.md',
      sidecar_path: 'docs/health/x.json',
      finding_count: 3,
      blocked_checks: [{ check: 'duplication', reason: 'no jscpd', install_hint: 'install' }],
      baseline_created: true,
      exit_code: 1,
    });
    const out = await invoke(['run', '--project-root', '/tmp/x', '--offline']);
    expect(process.exitCode).toBe(1);
    expect(out.join('\n')).toContain('worth a look');
    expect(out.join('\n')).toContain('duplication skipped');
    expect(out.join('\n')).toContain('Baseline recorded');
    expect(out.join('\n')).toContain('"findings":3');
  });

  it('run: clean report exits 0 and honours --quiet', async () => {
    runHealthAudit.mockResolvedValue({
      report_id: 'HEALTH-y',
      report_path: 'docs/health/y.md',
      sidecar_path: 'docs/health/y.json',
      finding_count: 0,
      blocked_checks: [],
      baseline_created: false,
      exit_code: 0,
    });
    const out = await invoke(['run', '--quiet']);
    expect(process.exitCode).toBe(0);
    expect(out.join('\n')).toContain('nothing to clean up');
    expect(out.join('\n')).not.toContain('"findings"');
  });

  it('run: an unexpected error exits 2', async () => {
    runHealthAudit.mockRejectedValue(new Error('boom'));
    const out = await invoke(['run']);
    expect(process.exitCode).toBe(2);
    expect(out.join('\n')).toContain('health run failed: boom');
  });

  it('retest: prints the reclassification and exits per still-open', async () => {
    runHealthRetest.mockResolvedValue({
      ok: true,
      report_id: 'RETEST-x',
      report_path: 'docs/health/x-retest-y.md',
      sidecar_path: 'docs/health/x-retest-y.json',
      fixed: 2,
      still_open: 1,
      needs_manual_verification: 0,
      exit_code: 1,
    });
    const out = await invoke(['retest']);
    expect(process.exitCode).toBe(1);
    expect(out.join('\n')).toContain('2 fixed, 1 still open');
    expect(out.join('\n')).toContain('"fixed":2');
  });

  it('retest: a not-ok result exits 2', async () => {
    runHealthRetest.mockResolvedValue({ ok: false, reason: 'no prior report' });
    const out = await invoke(['retest', '--sidecar', 'docs/health/z.json']);
    expect(process.exitCode).toBe(2);
    expect(out.join('\n')).toContain('no prior report');
  });

  it('retest: an unexpected error exits 2', async () => {
    runHealthRetest.mockRejectedValue(new Error('nope'));
    const out = await invoke(['retest']);
    expect(process.exitCode).toBe(2);
    expect(out.join('\n')).toContain('health retest failed: nope');
  });
});
