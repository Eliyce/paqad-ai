import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runSiteMapAudit = vi.fn();
const runJourneyCuration = vi.fn();
const createSiteMapGatherer = vi.fn(() => ({}) as never);

vi.mock('@/site-map/run.js', () => ({ runSiteMapAudit }));
vi.mock('@/site-map/journey-curation.js', () => ({ runJourneyCuration }));
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
    runJourneyCuration.mockReset();
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
      trust_restamp: { status: 'stamped', path: 'docs/site-map/app-map.yaml' },
      exit_code: 1,
    });
    const out = await invoke(['run', '--project-root', '/tmp/app']);
    expect(process.exitCode).toBe(1);
    expect(createSiteMapGatherer).toHaveBeenCalledWith('/tmp/app');
    expect(out.join('\n')).toContain('worth a look');
    expect(out.join('\n')).toContain('web-surfaces skipped');
    expect(out.join('\n')).toContain(
      'Stamped earned trust and freshness into docs/site-map/app-map.yaml',
    );
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
      trust_restamp: { status: 'no-map' },
      exit_code: 0,
    });
    const out = await invoke(['run', '--quiet']);
    expect(process.exitCode).toBe(0);
    expect(out.join('\n')).toContain('the map matches the code');
    // no-map means nothing was stamped, so no stamped line is printed.
    expect(out.join('\n')).not.toContain('Stamped earned trust');
    expect(out.join('\n')).not.toContain('"findings"');
  });

  it('run: an unexpected error exits 2 (AC-8)', async () => {
    runSiteMapAudit.mockRejectedValue(new Error('boom'));
    const out = await invoke(['run']);
    expect(process.exitCode).toBe(2);
    expect(out.join('\n')).toContain('sitemap run failed: boom');
  });

  it('retest is retired: the subcommand no longer exists (ART-3)', async () => {
    const names = createSitemapCommand().commands.map((c) => c.name());
    expect(names).not.toContain('retest');
    expect(names).toEqual(expect.arrayContaining(['run', 'journey']));
  });

  it('journey confirm: reports success and exits 0', async () => {
    runJourneyCuration.mockReturnValue({
      ok: true,
      id: 'checkout',
      action: 'confirm',
      status: 'confirmed',
    });
    const out = await invoke(['journey', 'confirm', 'checkout', '--project-root', '/tmp/app']);
    expect(process.exitCode).toBe(0);
    expect(runJourneyCuration).toHaveBeenCalledWith(
      expect.objectContaining({ projectRoot: '/tmp/app', id: 'checkout', action: 'confirm' }),
    );
    expect(out.join('\n')).toContain('confirmed');
  });

  it('journey reject: reports removal and exits 0', async () => {
    runJourneyCuration.mockReturnValue({
      ok: true,
      id: 'abandoned',
      action: 'reject',
      status: 'removed',
    });
    const out = await invoke(['journey', 'reject', 'abandoned']);
    expect(process.exitCode).toBe(0);
    expect(out.join('\n')).toContain('rejected');
  });

  it('journey confirm: a refused transition exits 1', async () => {
    runJourneyCuration.mockReturnValue({
      ok: false,
      reason: 'journey "x" is locked, not proposed',
    });
    const out = await invoke(['journey', 'confirm', 'x']);
    expect(process.exitCode).toBe(1);
    expect(out.join('\n')).toContain('not proposed');
  });

  it('journey confirm: an unexpected error exits 2', async () => {
    runJourneyCuration.mockImplementation(() => {
      throw new Error('splat');
    });
    const out = await invoke(['journey', 'confirm', 'x']);
    expect(process.exitCode).toBe(2);
    expect(out.join('\n')).toContain('journey confirm failed: splat');
  });
});
