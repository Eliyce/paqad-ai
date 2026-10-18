import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { execa } from 'execa';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ensureBuiltDist } from './helpers/ensure-built.js';

// Issue #639, Part 7 — the HUD snapshot written by the real hooks from the built dist.
// - A hook refreshes the snapshot after its decision is final, and prints nothing new.
// - A plugin-reached hook in a repo that was never onboarded writes nothing (decision 5).
// - Two writers at once never leave a broken file (atomic rename).

const REPO = process.cwd();
const STAGE_WRITER = resolve(REPO, 'runtime/hooks/stage-writer.mjs');
// A file URL, not a path: `import()` rejects a bare Windows path such as C:\... .
const REFRESH = pathToFileURL(resolve(REPO, 'dist/hud/refresh.js')).href;

beforeAll(async () => {
  await ensureBuiltDist();
}, 240_000);

const roots: string[] = [];
function repo(onboarded: boolean): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-hud-e2e-'));
  roots.push(root);
  if (onboarded) {
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(join(root, '.paqad/framework-path.txt'), '~/.paqad-ai/current\n');
  }
  return root;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function hudPath(root: string, session: string): string {
  return join(root, '.paqad/session/hud', `${session}.json`);
}

async function runStageWriter(root: string, session: string, pluginRoot?: string) {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    CLAUDE_PROJECT_DIR: root,
    ...(pluginRoot ? { CLAUDE_PLUGIN_ROOT: pluginRoot } : {}),
  };
  return execa('node', [STAGE_WRITER], {
    input: JSON.stringify({
      session_id: session,
      cwd: root,
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: join(root, 'docs/notes.md') },
    }),
    env,
    extendEnv: false,
    reject: false,
  });
}

describe('HUD snapshot from the real hooks (#639 Part 7)', () => {
  it('a hook refreshes the snapshot after deciding, and prints nothing new', async () => {
    const root = repo(true);
    const result = await runStageWriter(root, 'ses-e2e');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
    const snapshot = JSON.parse(readFileSync(hudPath(root, 'ses-e2e'), 'utf8'));
    expect(snapshot).toMatchObject({ schema: 'paqad.hud/2', session_id: 'ses-e2e' });
  });

  it('a plugin hook in a repo that was never onboarded writes nothing at all', async () => {
    const root = repo(false);
    const result = await runStageWriter(root, 'ses-e2e', REPO);

    expect(result.exitCode).toBe(0);
    expect(existsSync(join(root, '.paqad'))).toBe(false);
  });

  it('two writers at once never leave a broken file', async () => {
    const root = repo(true);
    const script = `
      const { refreshHudSnapshot } = await import(${JSON.stringify(REFRESH)});
      for (let i = 0; i < 40; i++) refreshHudSnapshot(${JSON.stringify(root)}, 'ses-race', 'race');
    `;
    const writers = [1, 2].map(() =>
      execa('node', ['--input-type=module', '-e', script], { reject: false }),
    );
    let reads = 0;
    let broken = 0;
    let running = true;
    const done = Promise.all(writers).finally(() => {
      running = false;
    });
    while (running) {
      const path = hudPath(root, 'ses-race');
      if (existsSync(path)) {
        let text: string | null = null;
        try {
          text = readFileSync(path, 'utf8');
        } catch {
          // Windows can refuse a read that lands mid-rename (EPERM/EBUSY). That is a missed
          // read, not a broken file, so it is skipped rather than counted.
        }
        if (text !== null) {
          reads += 1;
          try {
            JSON.parse(text);
          } catch {
            broken += 1;
          }
        }
      }
      await new Promise((r) => setTimeout(r, 1));
    }
    const results = await done;

    expect(results.map((r) => r.exitCode)).toEqual([0, 0]);
    expect(broken).toBe(0);
    expect(reads).toBeGreaterThan(0);
    expect(JSON.parse(readFileSync(hudPath(root, 'ses-race'), 'utf8')).schema).toBe('paqad.hud/2');
  }, 60_000);
});
