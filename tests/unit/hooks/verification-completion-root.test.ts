import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// AC-1 (fix #1) — the completion Stop hook resolves the project root the host is
// operating on via CLAUDE_PROJECT_DIR, NOT raw process.cwd(). Regression guard:
// with paqad disabled in the *project* root but the hook launched from an
// unrelated cwd, the old code read the wrong directory, missed the disable flag,
// and blocked an OFF project. Now it must short-circuit to a silent allow.
const HOOK = join(process.cwd(), 'runtime/hooks/verification-completion.mjs');

describe('runtime/hooks/verification-completion.mjs — project-root resolution', () => {
  let disabledProject: string;
  let foreignCwd: string;

  beforeEach(() => {
    disabledProject = mkdtempSync(join(tmpdir(), 'paqad-vc-off-'));
    mkdirSync(join(disabledProject, '.paqad'), { recursive: true });
    writeFileSync(join(disabledProject, '.paqad', '.config'), 'paqad_enable=false\n');
    // A separate directory the hook is *launched* from — has no .paqad, so reading
    // it as the root would resolve paqad ON (default) and run the gate.
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

    // Disabled → the backstop short-circuits to a silent allow: exit 0, no verdict
    // on either stream. (The buggy cwd-based read would have run the gate and
    // printed a verdict / backstop-error line instead.)
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });
});
