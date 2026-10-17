import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { execa } from 'execa';
import { describe, expect, it } from 'vitest';

// Issue #636 (bug 1) — the Claude Code plugin installs at USER scope, so its hooks run in EVERY repo.
// In a project that was never onboarded (no .paqad/framework-path.txt) every plugin-reached hook must
// be a pure no-op: exit 0, print nothing, create no .paqad/ folder. Enforcement in an onboarded repo
// is unchanged. These tests drive the REAL hook files named in runtime/claude-plugin/hooks.json.

const REPO = resolve(__dirname, '../../..');
const HOOKS_JSON = join(REPO, 'runtime', 'claude-plugin', 'hooks.json');

interface HookCmd {
  file: string;
  args: string[];
  event: string;
}

/** Every distinct hook command in the plugin's hooks.json, with its event and trailing argv. */
function pluginHookCommands(): HookCmd[] {
  const parsed = JSON.parse(readFileSync(HOOKS_JSON, 'utf8')) as {
    hooks: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>;
  };
  const out: HookCmd[] = [];
  const seen = new Set<string>();
  for (const [event, groups] of Object.entries(parsed.hooks)) {
    for (const group of groups) {
      for (const hook of group.hooks ?? []) {
        const command = hook.command ?? '';
        const m = command.match(/hooks\/([a-z-]+\.mjs)"(.*)$/);
        if (!m) continue;
        const file = m[1];
        const args = m[2].trim() ? m[2].trim().split(/\s+/) : [];
        const key = `${event}:${file}:${args.join(',')}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ file, args, event });
      }
    }
  }
  return out;
}

/** An event-appropriate hook payload, with cwd pinned to the pristine project. */
function payloadFor(event: string, projectDir: string): string {
  const base = { session_id: 's-noop', cwd: projectDir, hook_event_name: event };
  switch (event) {
    case 'PreToolUse':
      return JSON.stringify({
        ...base,
        tool_name: 'Edit',
        tool_input: { file_path: join(projectDir, 'a.ts') },
      });
    case 'UserPromptSubmit':
      return JSON.stringify({ ...base, prompt: 'create a file' });
    case 'SessionStart':
      return JSON.stringify({ ...base, source: 'startup' });
    case 'SubagentStop':
      return JSON.stringify({ ...base, agent_type: 'paqad-development' });
    default:
      return JSON.stringify(base);
  }
}

function pluginEnv(projectDir: string, home: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    PAQAD_FRAMEWORK_HOME: join(home, 'fw'),
    CLAUDE_PLUGIN_ROOT: REPO,
    CLAUDE_PROJECT_DIR: projectDir,
    CLAUDE_PLUGIN_DATA: join(home, 'plugin-data'),
    CLAUDE_ENV_FILE: join(home, 'env-file'),
  } as NodeJS.ProcessEnv;
}

describe('plugin hooks no-op in a project that was never onboarded (issue #636 bug 1)', () => {
  const commands = pluginHookCommands();

  it('every hook in hooks.json is discovered', () => {
    expect(commands.length).toBeGreaterThanOrEqual(11);
  });

  for (const { file, args, event } of commands) {
    const label = args.length ? `${file} ${args.join(' ')}` : file;
    it(`${label} (${event}) exits 0, prints nothing, and writes no .paqad/`, async () => {
      const dir = mkdtempSync(join(tmpdir(), 'paqad-pristine-'));
      const home = mkdtempSync(join(tmpdir(), 'paqad-home-'));
      try {
        const result = await execa(
          process.execPath,
          [join(REPO, 'runtime', 'hooks', file), ...args],
          {
            reject: false,
            input: payloadFor(event, dir),
            env: pluginEnv(dir, home),
          },
        );
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe('');
        expect(result.stderr).toBe('');
        expect(existsSync(join(dir, '.paqad'))).toBe(false);
      } finally {
        rmSync(dir, { recursive: true, force: true });
        rmSync(home, { recursive: true, force: true });
      }
    });
  }

  it('the entry gate still BLOCKS in an onboarded repo (enforcement unchanged)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'paqad-onboarded-'));
    const home = mkdtempSync(join(tmpdir(), 'paqad-home-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: dir });
      // Mark it onboarded.
      const paqadDir = join(dir, '.paqad');
      execFileSync('mkdir', ['-p', paqadDir]);
      // Write the onboarding pointer the way the bootstrap resolves it.
      await execa('node', [
        '-e',
        `require('fs').writeFileSync(${JSON.stringify(join(paqadDir, 'framework-path.txt'))}, '~/.paqad-ai/current')`,
      ]);
      const result = await execa(
        process.execPath,
        [join(REPO, 'runtime', 'hooks', 'agent-entry-gate.mjs')],
        {
          reject: false,
          input: payloadFor('PreToolUse', dir),
          env: pluginEnv(dir, home),
        },
      );
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('[paqad] Blocked');
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});
