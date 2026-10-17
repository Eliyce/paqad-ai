import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const RUNTIME_HOOKS = resolve(__dirname, '../../../runtime/hooks');
const TRIGGER = join(RUNTIME_HOOKS, 'context-refresh-trigger.mjs');
const MARKER_REL = '.paqad/locks/rule-context.marker';

function run(projectRoot: string, env: NodeJS.ProcessEnv = {}): number {
  try {
    execFileSync('node', [TRIGGER], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return 0;
  } catch (error) {
    return (error as { status: number }).status ?? 1;
  }
}

describe('runtime/hooks/context-refresh-trigger.mjs', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-trigger-'));
    mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('exits 0 and stamps the debounce marker when rag is on', () => {
    expect(run(projectRoot, { PAQAD_RAG_ENABLED: 'true' })).toBe(0);
    expect(existsSync(join(projectRoot, MARKER_REL))).toBe(true);
  });

  // Issue #284 — lean rule loading is on by default, so the trigger now fires (to
  // refresh the rule slice) even with rag off, unless BOTH are turned off.
  it('fires by default (lean on) even when rag is off', () => {
    expect(run(projectRoot)).toBe(0);
    expect(existsSync(join(projectRoot, MARKER_REL))).toBe(true);
  });

  it('is a no-op (no marker) only when both lean_rules and rag are off', () => {
    expect(run(projectRoot, { PAQAD_LEAN_RULES: 'false', PAQAD_RAG_ENABLED: 'false' })).toBe(0);
    expect(existsSync(join(projectRoot, MARKER_REL))).toBe(false);
  });

  it('is a no-op (no marker) when paqad is disabled', () => {
    writeFileSync(join(projectRoot, '.paqad/.config'), 'paqad_enable=false\n');
    expect(run(projectRoot, { PAQAD_RAG_ENABLED: 'true' })).toBe(0);
    expect(existsSync(join(projectRoot, MARKER_REL))).toBe(false);
  });

  it('never errors and stays silent (stdout empty)', () => {
    const out = execFileSync('node', [TRIGGER], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot, PAQAD_RAG_ENABLED: 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString('utf8');
    expect(out).toBe('');
  });

  // Issue #582 — the prompt gate passes the session id; the trigger forwards it as --session so
  // the worker reads that session's route. Issue #616 Part 6 — the trigger now runs THIS copy's
  // own CLI (`node <pkg>/dist/cli/index.js`), two levels above the hook, not a `paqad-ai` on PATH.
  // Stage a fake package with a stub dist/cli that records the argv it is spawned with.
  it.skipIf(process.platform === 'win32')(
    'runs its own dist/cli and forwards the session id as --session',
    async () => {
      const pkg = mkdtempSync(join(tmpdir(), 'paqad-trigger-pkg-'));
      const hookDir = join(pkg, 'runtime', 'hooks');
      mkdirSync(hookDir, { recursive: true });
      // Copy the trigger (its realpath must live under the fake package so dist resolves there),
      // and symlink its relative deps back to the real runtime tree.
      copyFileSync(TRIGGER, join(hookDir, 'context-refresh-trigger.mjs'));
      symlinkSync(join(RUNTIME_HOOKS, 'lib'), join(hookDir, 'lib'));
      symlinkSync(resolve(RUNTIME_HOOKS, '../scripts'), join(pkg, 'runtime', 'scripts'));
      // The stub CLI records the argv it received.
      const argsFile = join(pkg, 'args.txt');
      const cli = join(pkg, 'dist', 'cli', 'index.js');
      mkdirSync(dirname(cli), { recursive: true });
      writeFileSync(
        cli,
        `require('node:fs').writeFileSync(process.env.ARGS_FILE, process.argv.slice(2).join(' '));\n`,
      );

      execFileSync('node', [join(hookDir, 'context-refresh-trigger.mjs'), 'ses-582'], {
        env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot, ARGS_FILE: argsFile },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      await vi.waitFor(() => expect(existsSync(argsFile)).toBe(true), { timeout: 5000 });
      await vi.waitFor(
        () => expect(readFileSync(argsFile, 'utf8')).toContain('--session ses-582'),
        {
          timeout: 5000,
        },
      );
      rmSync(pkg, { recursive: true, force: true });
    },
  );
});
