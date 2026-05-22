import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createModuleHealthCommand } from '@/cli/commands/module-health.js';

describe('module-health command', () => {
  let root: string;
  let stdout: string[];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-module-health-cli-'));
    stdout = [];
    vi.spyOn(console, 'log').mockImplementation((message) => {
      stdout.push(String(message));
    });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('syncs changed-file evidence and prints the result by default', async () => {
    writeFileSync(join(root, '.paqad-session-placeholder'), '');
    await mkdirChangedFiles(root, ['src/planning/cli.ts']);

    await createModuleHealthCommand().parseAsync(
      [
        'node',
        'module-health',
        'sync',
        '--project-root',
        root,
        '--provider',
        'codex-cli',
        '--session-id',
        's1',
        '--preflight',
      ],
      { from: 'node' },
    );

    expect(process.exitCode).toBe(0);
    expect(JSON.parse(stdout[0] ?? '{}')).toMatchObject({
      updated_profiles: ['planning'],
      skipped: false,
    });
  });

  it('records explicit failing evidence with coverage and syncs it silently', async () => {
    await createModuleHealthCommand().parseAsync(
      [
        'node',
        'module-health',
        'record',
        '--project-root',
        root,
        '--provider',
        'claude-code',
        '--session-id',
        's2',
        '--source',
        'verification-gate',
        '--file',
        'src/health/checker.ts',
        '--module',
        'health',
        '--verification-status',
        'fail',
        '--coverage',
        '72.5',
        '--failed-tests',
        '2.8',
      ],
      { from: 'node' },
    );

    const recorded = JSON.parse(stdout[0] ?? '{}') as { event_id: string };
    expect(recorded.event_id).toMatch(/^mh-/u);
    expect(
      existsSync(join(root, '.paqad/module-health-evidence', `${recorded.event_id}.json`)),
    ).toBe(true);

    await createModuleHealthCommand().parseAsync(
      ['node', 'module-health', 'sync', '--project-root', root, '--silent'],
      { from: 'node' },
    );

    const profile = JSON.parse(
      readFileSync(join(root, '.paqad/module-health/health.json'), 'utf8'),
    );
    expect(profile).toMatchObject({
      tier: 'moderate',
      metrics: { coverage_pct: 72.5, defect_frequency: 3 },
    });
  });

  it('records passing evidence without test signals when only verification status is provided', async () => {
    await createModuleHealthCommand().parseAsync(
      [
        'node',
        'module-health',
        'record',
        '--project-root',
        root,
        '--file',
        'src/planning/ok.ts',
        '--module',
        'planning',
        '--verification-status',
        'pass',
        '--coverage',
        'not-a-number',
      ],
      { from: 'node' },
    );

    const event = JSON.parse(stdout[0] ?? '{}');
    expect(event.signals.tests).toBeUndefined();
    expect(event.signals.verification).toMatchObject({
      status: 'pass',
      gates_passed: ['manual-record'],
    });
  });

  it('records file-only evidence without verification signals', async () => {
    await createModuleHealthCommand().parseAsync(
      [
        'node',
        'module-health',
        'record',
        '--project-root',
        root,
        '--file',
        'src/planning/only-file.ts',
        '--silent',
      ],
      { from: 'node' },
    );

    const files = await import('node:fs/promises');
    const entries = await files.readdir(join(root, '.paqad/module-health-evidence'));
    const event = JSON.parse(
      await files.readFile(join(root, '.paqad/module-health-evidence', entries[0]!), 'utf8'),
    );
    expect(event.signals.verification).toBeUndefined();
  });

  it('records coverage-only evidence with default file and module lists', async () => {
    await createModuleHealthCommand().parseAsync(
      ['node', 'module-health', 'record', '--project-root', root, '--coverage', '81', '--silent'],
      { from: 'node' },
    );

    const files = await import('node:fs/promises');
    const entries = await files.readdir(join(root, '.paqad/module-health-evidence'));
    const event = JSON.parse(
      await files.readFile(join(root, '.paqad/module-health-evidence', entries[0]!), 'utf8'),
    );
    expect(event.affected_files).toEqual([]);
    expect(event.affected_modules).toEqual([]);
    expect(event.signals.tests).toEqual({ coverage_pct: 81 });
  });

  it('records failed-test-only evidence without coverage', async () => {
    await createModuleHealthCommand().parseAsync(
      [
        'node',
        'module-health',
        'record',
        '--project-root',
        root,
        '--failed-tests',
        '2',
        '--silent',
      ],
      { from: 'node' },
    );

    const files = await import('node:fs/promises');
    const entries = await files.readdir(join(root, '.paqad/module-health-evidence'));
    const event = JSON.parse(
      await files.readFile(join(root, '.paqad/module-health-evidence', entries[0]!), 'utf8'),
    );
    expect(event.signals.tests).toEqual({ status: 'fail', failed: 2 });
  });
});

async function mkdirChangedFiles(root: string, files: string[]): Promise<void> {
  const fs = await import('node:fs/promises');
  await fs.mkdir(join(root, '.paqad/session'), { recursive: true });
  await fs.writeFile(
    join(root, '.paqad/session/changed-files.json'),
    JSON.stringify(files),
    'utf8',
  );
}
