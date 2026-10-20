import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { main as agentEntryGateMain } from '../../../runtime/hooks/agent-entry-gate.mjs';
import { sentinelPath } from '../../../runtime/hooks/lib/agent-entry-sentinel.mjs';

describe('hook root resolution follows the worktree payload cwd', () => {
  let main: string;
  let worktree: string;
  let savedProjectDir: string | undefined;

  beforeEach(() => {
    main = mkdtempSync(join(tmpdir(), 'paqad-hook-main-'));
    worktree = mkdtempSync(join(tmpdir(), 'paqad-hook-wt-'));
    mkdirSync(join(main, '.paqad'), { recursive: true });
    mkdirSync(join(worktree, '.paqad'), { recursive: true });
    savedProjectDir = process.env.CLAUDE_PROJECT_DIR;
    process.env.CLAUDE_PROJECT_DIR = main;
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
      tool_input: { file_path: join(worktree, '.paqad', '.agent-entry-loaded') },
    };

    const code = agentEntryGateMain(JSON.stringify(payload));

    expect(code).toBe(0);
    expect(existsSync(sentinelPath(worktree, sessionId))).toBe(true);
    expect(existsSync(sentinelPath(main, sessionId))).toBe(false);
  });
});
