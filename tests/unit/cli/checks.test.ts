import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createChecksCommand } from '@/cli/commands/checks.js';
import { createProgram } from '@/cli/program.js';
import { readChecksReport, readFeatureChecks } from '@/checks/report-store.js';
import { resolveActiveFeature } from '@/feature-evidence/stage-ledger.js';
import { seedGitChangedFiles } from '../pipeline/changed-files.fixture.js';

describe('paqad-ai checks command', () => {
  let root: string;
  let priorSeSession: string | undefined;

  beforeEach(() => {
    priorSeSession = process.env.SE_SESSION;
    delete process.env.SE_SESSION;
    root = mkdtempSync(join(tmpdir(), 'paqad-cli-checks-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
    seedGitChangedFiles(root, ['src/app.ts']);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    delete process.env.CLAUDE_SESSION_ID;
    if (priorSeSession === undefined) delete process.env.SE_SESSION;
    else process.env.SE_SESSION = priorSeSession;
    rmSync(root, { recursive: true, force: true });
  });

  function mapCommands(commands: Record<string, string>): void {
    const lines = ['commands:', ...Object.entries(commands).map(([k, v]) => `  ${k}: ${v}`)];
    writeFileSync(join(root, '.paqad/project-profile.yaml'), lines.join('\n'));
  }

  async function run(): Promise<string[]> {
    const out: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => out.push(String(line)));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await createChecksCommand().parseAsync(['run', '--project-root', root], { from: 'user' });
    return out;
  }

  it('is registered on the program', () => {
    const names = createProgram().commands.map((c) => c.name());
    expect(names).toContain('checks');
  });

  it('exits 0 and persists a green report when every command passes (AC-3)', async () => {
    mapCommands({
      format: 'node -e process.exitCode=0',
      test: 'node -e process.exitCode=0',
      build: 'node -e process.exitCode=0',
    });
    const out = await run();

    expect(process.exitCode).toBeUndefined();
    expect(out.join('\n')).toContain('Safe to merge');
    const report = readChecksReport(root);
    expect(report?.passed).toBe(true);
    expect(report?.ran).toBe(true);
    expect(report?.results).toHaveLength(3);
  });

  it('exits non-zero and persists a red report when a command fails (AC-2)', async () => {
    mapCommands({
      format: 'node -e process.exitCode=0',
      test: 'node -e process.exitCode=1',
      build: 'node -e process.exitCode=0',
    });
    const out = await run();

    expect(process.exitCode).toBe(1);
    expect(out.join('\n')).toContain('Needs your attention');
    const report = readChecksReport(root);
    expect(report?.passed).toBe(false);
    const failed = report?.results.find((r) => r.summary.runner_id === 'test');
    expect(failed?.summary.failed).toBe(1);
  });

  it('writes the report into the active feature bundle, not the global path', async () => {
    process.env.CLAUDE_SESSION_ID = 'ses-cli';
    const dir = resolveActiveFeature(root, 'ses-cli', { title: 'thing', issue: '528' });
    mapCommands({ format: 'node -e process.exitCode=0' });
    await run();

    expect(readFeatureChecks(root, dir)?.passed).toBe(true);
    expect(readChecksReport(root)).toBeNull();
  });

  it('stores inconclusive in checks.json when the test step exits 0 with nothing to read', async () => {
    writeFileSync(
      join(root, '.paqad/project-profile.yaml'),
      [
        'commands:',
        '  test: node -e process.exitCode=0',
        'stack_profile:',
        '  frameworks: [react]',
        '  traits: [vitest]',
        '  languages: []',
        '  runtimes: []',
      ].join('\n') + '\n',
    );
    const out = await run();

    expect(process.exitCode).toBeUndefined();
    expect(out.join('\n')).toContain('🟡 test ran, but no test results could be read');
    const report = readChecksReport(root);
    const test = report?.commands?.find((c) => c.logical_command === 'test');
    expect(test?.outcome).toBe('inconclusive');
    expect(report?.meaningful_green).toBe(false);
    expect(report?.results.every((r) => r.summary.timestamp !== '1970-01-01T00:00:00.000Z')).toBe(
      true,
    );
  });

  it('says once that it recorded the test runner in the profile', async () => {
    writeFileSync(
      join(root, '.paqad/project-profile.yaml'),
      [
        'commands:',
        '  format: node -e process.exitCode=0',
        'stack_profile:',
        '  frameworks: [react]',
        '  traits: [vitest]',
        '  languages: []',
        '  runtimes: []',
      ].join('\n') + '\n',
    );
    const note =
      'recorded the test runner in .paqad/project-profile.yaml (once per lockfile change)';
    const errors: string[] = [];
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation((line: string) => errors.push(String(line)));
    await createChecksCommand().parseAsync(['run', '--project-root', root], { from: 'user' });
    expect(errors).toContain(note);

    errors.length = 0;
    await createChecksCommand().parseAsync(['run', '--project-root', root], { from: 'user' });
    expect(errors).not.toContain(note);
  });

  it('reports Inconclusive and does not block when no command is mapped', async () => {
    mapCommands({ dev: 'node -e process.exitCode=0' });
    const out = await run();

    expect(process.exitCode).toBeUndefined();
    expect(out).toContain('**▸ paqad** · no checks mapped: Inconclusive');
    expect(out.join('\n')).not.toContain('—');
    expect(readChecksReport(root)?.ran).toBe(false);
  });
});
