import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { execa } from 'execa';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { hudSnapshotPath } from '@/hud/files.js';

import { buildDesktopBand } from '../../runtime/claude-plugin/mod/desktop-view.ts';
import { parseSnapshot } from '../../runtime/claude-plugin/mod/model.ts';
import { NO_CONTEXT_REFRESH_ENV } from '../unit/runtime/temp-project.js';
import { ensureBuiltDist } from './helpers/ensure-built';

const REPO = process.cwd();
const CLI = resolve(REPO, 'dist/cli/index.js');
const PROMPT_GATE = resolve(REPO, 'runtime/hooks/agent-entry-prompt-gate.mjs');

const { threeSessionPrompt: FEATURE_PROMPT } = JSON.parse(
  readFileSync(join(REPO, 'tests/fixtures/pipeline/feature-prompts.json'), 'utf8'),
) as { threeSessionPrompt: string };

const SHOWN = { minimised: false, closed: false, hidden: false };

beforeAll(async () => {
  await ensureBuiltDist();
}, 240_000);

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

async function freshRepo(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'paqad-hud-first-turn-'));
  roots.push(root);
  const git = (...args: string[]) => execa('git', args, { cwd: root });
  await git('init', '-q', '-b', 'feat/first-turn');
  await git('config', 'user.email', 't@t.dev');
  await git('config', 'user.name', 'Test');
  mkdirSync(join(root, '.paqad'), { recursive: true });
  mkdirSync(join(root, 'docs/instructions'), { recursive: true });
  writeFileSync(join(root, '.gitignore'), '.paqad/\n');
  writeFileSync(join(root, 'CLAUDE.md'), '# entry');
  writeFileSync(join(root, '.paqad/framework-path.txt'), '~/.paqad-ai/current\n');
  await git('add', '-A');
  await git('commit', '-q', '-m', 'chore: base');
  return root;
}

class Replay {
  turnStartedAt: number | null = null;
  readonly seen: Array<[string, string]> = [];

  constructor(
    readonly root: string,
    readonly session: string,
  ) {}

  band(turnStartedAt: number | null) {
    const raw = readFileSync(hudSnapshotPath(this.root, this.session), 'utf8');
    return buildDesktopBand({
      snapshot: parseSnapshot(raw),
      unbound: false,
      unavailable: false,
      now: Date.now(),
      turnStartedAt,
      visibility: SHOWN,
      menuOpen: false,
      columns: 93,
      maxRows: 12,
    });
  }

  note(checkpoint: string): void {
    this.seen.push([checkpoint, this.band(this.turnStartedAt).kind]);
  }

  async prompt(checkpoint: string, text: string): Promise<void> {
    this.turnStartedAt = Date.now();
    await execa('node', [PROMPT_GATE], {
      input: JSON.stringify({ prompt: text, session_id: this.session }),
      env: { ...process.env, ...NO_CONTEXT_REFRESH_ENV, CLAUDE_PROJECT_DIR: this.root },
    });
    this.note(checkpoint);
  }

  async cli(checkpoint: string, ...args: string[]): Promise<void> {
    await execa('node', [CLI, ...args, '--project-root', this.root], {
      cwd: this.root,
      env: { ...process.env, SE_SESSION: this.session },
    });
    this.note(checkpoint);
  }

  async cliWithHostSessionOnly(checkpoint: string, ...args: string[]): Promise<void> {
    await execa('node', [CLI, ...args, '--project-root', this.root], {
      cwd: this.root,
      env: {
        ...process.env,
        SE_SESSION: undefined,
        CLAUDE_SESSION_ID: undefined,
        CLAUDE_CODE_SESSION_ID: this.session,
      },
    });
    this.note(checkpoint);
  }
}

describe('the first turn, measured from the first routed snapshot', { timeout: 180_000 }, () => {
  it('AC-3: a misrouted question, then a bare stage start, draws the feature band', async () => {
    const replay = new Replay(await freshRepo(), 'ses-misrouted');
    await replay.prompt('prompt hook', 'what does this project do');
    await replay.cliWithHostSessionOnly(
      'stage start',
      'stage',
      'start',
      'planning',
      '--title',
      'first turn',
    );

    expect(replay.seen).toEqual([
      ['prompt hook', 'workflow'],
      ['stage start', 'feature'],
    ]);
  });

  it('AC-7: session order A, from the prompt hook snapshot on, never draws Question or empty', async () => {
    const replay = new Replay(await freshRepo(), 'ses-order-a');
    await replay.prompt('prompt hook', FEATURE_PROMPT);
    await replay.cli('stage start', 'stage', 'start', 'planning', '--title', 'first turn');
    await replay.cli('lane set', 'lane', 'set', 'full');
    await replay.prompt('next prompt', 'implement the login page');

    expect(replay.seen).toEqual([
      ['prompt hook', 'ready-feature'],
      ['stage start', 'feature'],
      ['lane set', 'feature'],
      ['next prompt', 'feature'],
    ]);
  });

  it('AC-30: session order C, route set before stage start, keeps the same bands', async () => {
    const replay = new Replay(await freshRepo(), 'ses-order-c');
    await replay.prompt('prompt hook', FEATURE_PROMPT);
    await replay.cli('route set', 'route', 'set', 'feature-development');
    await replay.cli('stage start', 'stage', 'start', 'planning', '--title', 'first turn');
    await replay.cli('lane set', 'lane', 'set', 'full');
    await replay.prompt('next prompt', 'implement the login page');

    expect(replay.seen).toEqual([
      ['prompt hook', 'ready-feature'],
      ['route set', 'ready-feature'],
      ['stage start', 'feature'],
      ['lane set', 'feature'],
      ['next prompt', 'feature'],
    ]);
  });

  it('AC-15: stage start in that turn draws the full band with no further message', async () => {
    const replay = new Replay(await freshRepo(), 'ses-same-turn');
    await replay.prompt('prompt hook', FEATURE_PROMPT);
    const turn = replay.turnStartedAt;
    await replay.cli('stage start', 'stage', 'start', 'planning', '--title', 'first turn');
    expect(replay.turnStartedAt).toBe(turn);
    expect(replay.band(turn).kind).toBe('feature');
  });

  it('AC-16: the draw after Getting Ready is the feature card, with no frame between', async () => {
    const replay = new Replay(await freshRepo(), 'ses-order-frames');
    await replay.prompt('prompt hook', FEATURE_PROMPT);
    const ready = replay.band(replay.turnStartedAt);
    await replay.cli('stage start', 'stage', 'start', 'planning', '--title', 'first turn');
    const next = replay.band(replay.turnStartedAt);
    expect(ready).toMatchObject({ kind: 'ready-feature', mode: 'card' });
    expect(next).toMatchObject({ kind: 'feature', mode: 'card' });
    expect(replay.seen.map(([, kind]) => kind)).toEqual(['ready-feature', 'feature']);
  });

  it('AC-31: a turn that ends with no change keeps Getting Ready until a no-workflow message', async () => {
    const replay = new Replay(await freshRepo(), 'ses-between-turns');
    await replay.prompt('prompt hook', FEATURE_PROMPT);
    await replay.cli('refresh', 'route', 'set', 'feature-development');
    expect(replay.band(null)).toMatchObject({
      kind: 'ready-feature',
      headline: { text: 'Paqad Getting Ready', live: false },
    });
    await replay.prompt('next message', 'thanks');
    expect(replay.band(replay.turnStartedAt)).toEqual({ kind: 'none' });
  });
});
