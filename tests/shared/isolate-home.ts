// Vitest setup file: give every test file its own throwaway home directory.
//
// Onboarding, `join`, update and the stage-agent writer all write under the user's home:
// the `~/.paqad-ai/current` framework symlink, `~/.claude/agents/paqad-*.md` and
// `~/.codex/agents/*.toml`. With the real home in place a local test run repointed the
// developer's global paqad at this checkout's `runtime/`, so the hooks in every project on
// the machine started running unreleased branch code. Pointing HOME (and USERPROFILE, which
// `os.homedir()` reads on Windows) at a temp dir keeps every one of those writes inside the
// test run. Child processes inherit the redirected env, so spawned CLIs stay contained too.

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll } from 'vitest';

// Remember the real home once per worker, so the guard test can prove it is not in use.
process.env.PAQAD_TEST_REAL_HOME ??= process.env.HOME ?? process.env.USERPROFILE ?? '';

// realpathSync.native expands a Windows 8.3 short name: GitHub's Windows runners report
// tmpdir() as `C:\Users\RUNNER~1\...`, and a `~` in the home path leaks into every absolute
// path built from it (a hook command, the framework symlink), which the real home never has.
const home = realpathSync.native(mkdtempSync(join(tmpdir(), 'paqad-test-home-')));
process.env.HOME = home;
process.env.USERPROFILE = home;

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});
