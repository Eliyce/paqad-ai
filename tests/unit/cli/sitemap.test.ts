import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runSiteMapAudit = vi.fn();
const runSiteMapRetest = vi.fn();
const createSiteMapGatherer = vi.fn(() => ({}) as never);

vi.mock('@/site-map/run.js', () => ({ runSiteMapAudit }));
vi.mock('@/site-map/retest-run.js', () => ({ runSiteMapRetest }));
vi.mock('@/site-map/gatherer.js', () => ({ createSiteMapGatherer }));

const { createSitemapCommand } = await import('@/cli/commands/sitemap.js');
const { createProgram } = await import('@/cli/program.js');

async function invoke(args: string[]): Promise<string[]> {
  const out: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((line: string) => out.push(String(line)));
  vi.spyOn(console, 'error').mockImplementation((line: string) => out.push(String(line)));
  await createSitemapCommand().parseAsync(args, { from: 'user' });
  return out;
}

describe('paqad-ai sitemap command', () => {
  beforeEach(() => {
    runSiteMapAudit.mockReset();
    runSiteMapRetest.mockReset();
    createSiteMapGatherer.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('is registered on the program', () => {
    expect(createProgram().commands.map((c) => c.name())).toContain('sitemap');
  });

  it('run: reports findings, prints blocked checks + baseline, and exits 1 (AC-8)', async () => {
    runSiteMapAudit.mockResolvedValue({
      report_id: 'SITEMAP-x',
      report_path: 'docs/site-map/x.md',
      sidecar_path: 'docs/site-map/x.json',
      bundle_dir: '.paqad/site-map/runs/x',
      finding_count: 2,
      blocked_checks: [
        { check: 'web-surfaces', reason: 'no extractor', install_hint: 'hand-author' },
      ],
      baseline_created: true,
      exit_code: 1,
    });
    const out = await invoke(['run', '--project-root', '/tmp/app']);
    expect(process.exitCode).toBe(1);
    expect(createSiteMapGatherer).toHaveBeenCalledWith('/tmp/app');
    expect(out.join('\n')).toContain('worth a look');
    expect(out.join('\n')).toContain('web-surfaces skipped');
    expect(out.join('\n')).toContain('Baseline recorded');
    expect(out.join('\n')).toContain('"findings":2');
  });

  it('run: a matching map exits 0 and honours --quiet (AC-8)', async () => {
    runSiteMapAudit.mockResolvedValue({
      report_id: 'SITEMAP-y',
      report_path: 'docs/site-map/y.md',
      sidecar_path: 'docs/site-map/y.json',
      bundle_dir: '.paqad/site-map/runs/y',
      finding_count: 0,
      blocked_checks: [],
      baseline_created: false,
      exit_code: 0,
    });
    const out = await invoke(['run', '--quiet']);
    expect(process.exitCode).toBe(0);
    expect(out.join('\n')).toContain('the map matches the code');
    expect(out.join('\n')).not.toContain('"findings"');
  });

  it('run: an unexpected error exits 2 (AC-8)', async () => {
    runSiteMapAudit.mockRejectedValue(new Error('boom'));
    const out = await invoke(['run']);
    expect(process.exitCode).toBe(2);
    expect(out.join('\n')).toContain('sitemap run failed: boom');
  });

  it('retest: still-open findings exit 1 and pass through the sidecar flag', async () => {
    runSiteMapRetest.mockResolvedValue({
      ok: true,
      report_id: 'RETEST-z',
      report_path: 'docs/site-map/z-retest.md',
      sidecar_path: 'docs/site-map/z-retest.json',
      fixed: 1,
      still_open: 2,
      needs_manual_verification: 0,
      exit_code: 1,
    });
    const out = await invoke([
      'retest',
      '--project-root',
      '/tmp/app',
      '--sidecar',
      'docs/site-map/src.json',
    ]);
    expect(process.exitCode).toBe(1);
    expect(runSiteMapRetest).toHaveBeenCalledWith(
      expect.objectContaining({ projectRoot: '/tmp/app', sidecar: 'docs/site-map/src.json' }),
    );
    expect(out.join('\n')).toContain('2 still open');
    expect(out.join('\n')).toContain('"still_open":2');
  });

  it('retest: nothing still open exits 0 and honours --quiet', async () => {
    runSiteMapRetest.mockResolvedValue({
      ok: true,
      report_id: 'RETEST-w',
      report_path: 'docs/site-map/w-retest.md',
      sidecar_path: 'docs/site-map/w-retest.json',
      fixed: 3,
      still_open: 0,
      needs_manual_verification: 1,
      exit_code: 0,
    });
    const out = await invoke(['retest', '--quiet']);
    expect(process.exitCode).toBe(0);
    expect(out.join('\n')).toContain('nothing still open');
    expect(out.join('\n')).not.toContain('"still_open"');
  });

  it('retest: a missing source report exits 2', async () => {
    runSiteMapRetest.mockResolvedValue({ ok: false, reason: 'no prior site-map report found' });
    const out = await invoke(['retest']);
    expect(process.exitCode).toBe(2);
    expect(out.join('\n')).toContain('no prior site-map report');
  });

  it('retest: an unexpected error exits 2', async () => {
    runSiteMapRetest.mockRejectedValue(new Error('kaboom'));
    const out = await invoke(['retest']);
    expect(process.exitCode).toBe(2);
    expect(out.join('\n')).toContain('sitemap retest failed: kaboom');
  });
});
