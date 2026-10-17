import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { main as agentEntryGateMain } from '../../../runtime/hooks/agent-entry-gate.mjs';
import { sentinelPath } from '../../../runtime/hooks/lib/agent-entry-sentinel.mjs';

// Issue #615 (Part 1) — a worktree session sets CLAUDE_PROJECT_DIR to the MAIN checkout and
// puts the worktree path only in the hook payload's `cwd`. This asserts that a real
// PreToolUse gate (the entry gate) resolves the root from `cwd` and writes under the
// worktree's `.paqad/`, not the main checkout's.
describe('hook root resolution follows the worktree payload cwd (issue #615, Part 1)', () => {
  let main: string;
  let worktree: string;
  let savedProjectDir: string | undefined;

  beforeEach(() => {
    main = mkdtempSync(join(tmpdir(), 'paqad-hook-main-'));
    worktree = mkdtempSync(join(tmpdir(), 'paqad-hook-wt-'));
    mkdirSync(join(main, '.paqad'), { recursive: true });
    mkdirSync(join(worktree, '.paqad'), { recursive: true });
    savedProjectDir = process.env.CLAUDE_PROJECT_DIR;
    process.env.CLAUDE_PROJECT_DIR = main; // the main checkout, as Claude Code sets it
  });

  afterEach(() => {
    if (savedProjectDir === undefined) {
      delete process.env.CLAUDE_PROJECT_DIR;
    } else {
      process.env.CLAUDE_PROJECT_DIR = savedProjectDir;
    }
    rmSync(main, { recursive: true, force: true });
    rmSync(worktree, { recursive: true, force: true });
  });

  it('the entry gate stamps the sentinel under the worktree, not the main checkout', () => {
    const sessionId = 'sess-wt-1';
    const payload = {
      session_id: sessionId,
      cwd: worktree,
      tool_name: 'Write',
      // The bootstrap's own sentinel write — the gate promotes it into this session's keyed marker.
      tool_input: { file_path: join(worktree, '.paqad', '.agent-entry-loaded') },
    };

    const code = agentEntryGateMain(JSON.stringify(payload));

    expect(code).toBe(0);
    expect(existsSync(sentinelPath(worktree, sessionId))).toBe(true);
    expect(existsSync(sentinelPath(main, sessionId))).toBe(false);
  });
});
