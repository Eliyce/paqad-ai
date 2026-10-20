import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const HOOK = join(process.cwd(), 'runtime/hooks/verification-completion.mjs');

describe('runtime/hooks/verification-completion.mjs — project-root resolution', () => {
  let disabledProject: string;
  let foreignCwd: string;

  beforeEach(() => {
    disabledProject = mkdtempSync(join(tmpdir(), 'paqad-vc-off-'));
    mkdirSync(join(disabledProject, '.paqad'), { recursive: true });
    writeFileSync(join(disabledProject, '.paqad', '.config'), 'paqad_enable=false\n');
    foreignCwd = mkdtempSync(join(tmpdir(), 'paqad-vc-cwd-'));
  });

  afterEach(() => {
    rmSync(disabledProject, { recursive: true, force: true });
    rmSync(foreignCwd, { recursive: true, force: true });
  });

  it('respects OFF from CLAUDE_PROJECT_DIR even when cwd is a different directory', async () => {
    const result = await execa('node', [HOOK], {
      cwd: foreignCwd,
      reject: false,
      input: JSON.stringify({ session_id: 'vc-root', hook_event_name: 'Stop' }),
      env: { ...process.env, CLAUDE_PROJECT_DIR: disabledProject, PAQAD_PROJECT_ROOT: '' },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });
});
