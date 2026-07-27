import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runSiteMapAudit = vi.fn();
const createSiteMapGatherer = vi.fn(() => ({}) as never);

vi.mock('@/site-map/run.js', () => ({ runSiteMapAudit }));
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
});
