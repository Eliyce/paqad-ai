import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createChecksCommand } from '@/cli/commands/checks.js';
import { readTraceabilityMap } from '@/traceability/index.js';

import { seedGitChangedFiles } from '../pipeline/changed-files.fixture.js';
import { openChange, writeSpec } from '../traceability/change-map.fixture.js';

// Issue #639, Part 11 — `paqad-ai checks run` writes the change's acceptance-criteria map
// beside the check report.
describe('paqad-ai checks run writes the acceptance-criteria map', () => {
  let root: string;
  let priorSeSession: string | undefined;
  let priorClaudeSession: string | undefined;

  beforeEach(() => {
    priorSeSession = process.env.SE_SESSION;
    priorClaudeSession = process.env.CLAUDE_SESSION_ID;
    delete process.env.CLAUDE_SESSION_ID;
    root = mkdtempSync(join(tmpdir(), 'paqad-cli-checks-map-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    if (priorSeSession === undefined) delete process.env.SE_SESSION;
    else process.env.SE_SESSION = priorSeSession;
    if (priorClaudeSession === undefined) delete process.env.CLAUDE_SESSION_ID;
    else process.env.CLAUDE_SESSION_ID = priorClaudeSession;
    rmSync(root, { recursive: true, force: true });
  });

  function write(rel: string, body: string): void {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }

  async function run(): Promise<string[]> {
    const errors: string[] = [];
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation((line: string) => errors.push(String(line)));
    await createChecksCommand().parseAsync(['run', '--project-root', root], { from: 'user' });
    return errors;
  }

  it('AC-29: a changed test naming the criterion in its title proves it in the written map', async () => {
    write('src/export.ts', 'export const rows = 1;\n');
    write('tests/export.test.ts', "it('AC-1: exports the rows as CSV', () => {});\n");
    seedGitChangedFiles(root, ['src/export.ts', 'tests/export.test.ts']);
    write('.paqad/project-profile.yaml', 'commands:\n  format: node -e process.exitCode=0\n');
    process.env.SE_SESSION = 'ses-cli-29';
    const dir = openChange(root, 'ses-cli-29', 'graduated');
    writeSpec(root, dir, [
      { id: 'AC-1', proof: 'automated' },
      { id: 'AC-2', proof: 'automated' },
      { id: 'AC-3', proof: 'manual' },
    ]);

    await run();

    const map = await readTraceabilityMap(root);
    expect(map).toMatchObject({ scope: 'change', change: dir, lane: 'graduated' });
    expect(map?.forward.find((link) => link.promise_id === 'AC-1')).toMatchObject({
      source: 'acceptance-criterion',
      proving_checks: ['tests/export.test.ts'],
      proven: true,
    });
    expect(map?.forward.find((link) => link.promise_id === 'AC-2')?.proven).toBe(false);
    expect(map?.forward.some((link) => link.promise_id === 'AC-3')).toBe(false);
  });

  it('writes no map when no change is open, and the checks still run', async () => {
    seedGitChangedFiles(root, ['src/app.ts']);
    write('.paqad/project-profile.yaml', 'commands:\n  format: node -e process.exitCode=0\n');
    delete process.env.SE_SESSION;

    await run();

    expect(process.exitCode).toBeUndefined();
    expect(await readTraceabilityMap(root)).toBeNull();
  });

  it('a map that cannot be written is a warning, never a failed checks run', async () => {
    write('tests/export.test.ts', "it('AC-1 works', () => {});\n");
    seedGitChangedFiles(root, ['tests/export.test.ts']);
    write('.paqad/project-profile.yaml', 'commands:\n  format: node -e process.exitCode=0\n');
    process.env.SE_SESSION = 'ses-cli-warn';
    const dir = openChange(root, 'ses-cli-warn');
    writeSpec(root, dir, [{ id: 'AC-1', proof: 'automated' }]);
    write('.paqad/traceability', 'a file where the map directory should be');

    const errors = await run();

    expect(process.exitCode).toBeUndefined();
    expect(errors.join('\n')).toContain('could not write the acceptance-criteria map');
  });
});
