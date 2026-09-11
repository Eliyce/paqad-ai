import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createChecksCommand } from '@/cli/commands/checks.js';
import { createProgram } from '@/cli/program.js';
import { readChecksReport, readFeatureChecks } from '@/checks/report-store.js';
import { resolveActiveFeature } from '@/feature-evidence/stage-ledger.js';

// `paqad-ai checks run` end to end over real subprocesses (deterministic `node -e`
// exit codes), asserting the verb blocks on red and persists the report the
// completion backstop reads (issue #318).
describe('paqad-ai checks command', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-cli-checks-'));
    mkdirSync(join(root, '.paqad/session'), { recursive: true });
    writeFileSync(join(root, '.paqad/session/changed-files.json'), JSON.stringify(['src/app.ts']));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    delete process.env.CLAUDE_SESSION_ID;
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

  it('writes the report into the active feature bundle, not the global path (#528)', async () => {
    process.env.CLAUDE_SESSION_ID = 'ses-cli';
    const dir = resolveActiveFeature(root, 'ses-cli', { title: 'thing', issue: '528' });
    mapCommands({ format: 'node -e process.exitCode=0' });
    await run();

    expect(readFeatureChecks(root, dir)?.passed).toBe(true);
    expect(readChecksReport(root)).toBeNull();
  });

  it('reports Inconclusive and does not block when no command is mapped', async () => {
    mapCommands({ dev: 'node -e process.exitCode=0' });
    const out = await run();

    expect(process.exitCode).toBeUndefined();
    expect(out.join('\n')).toContain('Inconclusive');
    expect(readChecksReport(root)?.ran).toBe(false);
  });
});
