import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runPreflight = vi.fn();
vi.mock('@/workflow-preflight/run.js', () => ({ runPreflight }));

const { createPreflightCommand } = await import('@/cli/commands/preflight.js');
const { createProgram } = await import('@/cli/program.js');

async function invoke(args: string[]): Promise<string[]> {
  const out: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((line: string) => out.push(String(line)));
  vi.spyOn(console, 'error').mockImplementation((line: string) => out.push(String(line)));
  await createPreflightCommand().parseAsync(args, { from: 'user' });
  return out;
}

describe('paqad-ai preflight command', () => {
  beforeEach(() => runPreflight.mockReset());
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('is registered on the program', () => {
    expect(createProgram().commands.map((c) => c.name())).toContain('preflight');
  });

  it('exits 0 and reports nothing to ask when the run may proceed (AC-4)', async () => {
    runPreflight.mockResolvedValue({ ok: true, requirements: [], questions: [] });
    const out = await invoke(['site-map', '--project-root', '/proj']);

    expect(process.exitCode).toBe(0);
    expect(out.some((l) => l.includes('Nothing to ask'))).toBe(true);
    expect(out.some((l) => l.includes('"ok":true'))).toBe(true);
  });

  it('exits 1 and lists the questions when there are things to settle (AC-4)', async () => {
    runPreflight.mockResolvedValue({
      ok: false,
      requirements: [
        { id: 'laravel-route-list', outcome: 'needs-decision' },
        { id: 'module-docs', outcome: 'unavailable' },
      ],
      questions: [
        {
          id: 'laravel-route-list',
          label: 'Laravel route list',
          why: 'The real router resolves modular routes a static scan cannot.',
          outcome: 'needs-decision',
          options: [{ id: 'run', label: 'Run it', recommended: true }],
        },
        {
          id: 'module-docs',
          label: 'Module documentation',
          why: 'The map labels screens from your module docs.',
          outcome: 'unavailable',
          options: [{ id: 'run-workflow', label: 'Run create module documentation' }],
        },
      ],
    });
    const out = await invoke(['site-map']);

    expect(process.exitCode).toBe(1);
    // Both glyphs render: 🟡 for needs-decision, 🔴 for unavailable.
    expect(out.some((l) => l.includes('🟡') && l.includes('Laravel route list'))).toBe(true);
    expect(out.some((l) => l.includes('🔴') && l.includes('Module documentation'))).toBe(true);
    expect(out.some((l) => l.includes('"ok":false'))).toBe(true);
  });

  it('suppresses the JSON line under --quiet', async () => {
    runPreflight.mockResolvedValue({ ok: true, requirements: [], questions: [] });
    const out = await invoke(['site-map', '--quiet']);

    expect(out.some((l) => l.trim().startsWith('{'))).toBe(false);
  });

  it('exits 2 on an unexpected error (AC-4)', async () => {
    runPreflight.mockRejectedValue(new Error('boom'));
    const out = await invoke(['site-map']);

    expect(process.exitCode).toBe(2);
    expect(out.some((l) => l.includes('preflight failed: boom'))).toBe(true);
  });
});
