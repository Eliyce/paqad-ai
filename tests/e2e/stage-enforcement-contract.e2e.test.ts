import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { execa } from 'execa';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ensureBuiltDist } from './helpers/ensure-built';

const REPO = process.cwd();
const HOOKS = resolve(REPO, 'runtime/hooks');
const CLI = resolve(REPO, 'dist/cli/index.js');

const AGENT_ENTRY = join(HOOKS, 'agent-entry-gate.mjs');
const CAPABILITY = join(HOOKS, 'capability-gate.mjs');
const DECISION_PAUSE = join(HOOKS, 'decision-pause-gate.mjs');
const SUBAGENT_COMPLETION = join(HOOKS, 'stage-agent-completion.mjs');
const VERIFICATION = join(HOOKS, 'verification-completion.mjs');

beforeAll(async () => {
  await ensureBuiltDist();
}, 240_000);

const roots: string[] = [];
function freshRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-contract-'));
  roots.push(root);
  mkdirSync(join(root, '.paqad'), { recursive: true });
  mkdirSync(join(root, 'docs/instructions'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'CLAUDE.md'), '# entry');
  writeFileSync(join(root, '.paqad/framework-path.txt'), '~/.paqad-ai/current\n');
  return root;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function freshSentinel(root: string, session: string): void {
  const dir = join(root, '.paqad/.agent-entry-loaded.d');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, session);
  writeFileSync(path, '{"loaded_at":"now"}');
  const future = new Date(Date.now() + 60_000);
  utimesSync(path, future, future);
}

interface Route {
  name: 'npm' | 'plugin';
  env: (root: string) => NodeJS.ProcessEnv;
}
const ROUTES: Route[] = [
  { name: 'npm', env: (root) => ({ CLAUDE_PROJECT_DIR: root, CLAUDE_PLUGIN_ROOT: '' }) },
  { name: 'plugin', env: (root) => ({ CLAUDE_PROJECT_DIR: root, CLAUDE_PLUGIN_ROOT: REPO }) },
];

interface HookResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}
async function runHook(
  script: string,
  payload: unknown,
  routeEnv: NodeJS.ProcessEnv,
  argv: string[] = [],
): Promise<HookResult> {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME, ...routeEnv };
  if (env.CLAUDE_PLUGIN_ROOT === '') delete env.CLAUDE_PLUGIN_ROOT;
  const result = await execa('node', [script, ...argv], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    env,
    reject: false,
    extendEnv: false,
  });
  return {
    exitCode: result.exitCode ?? 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function editPayload(root: string, session: string, file = 'src/x.ts', tool = 'Edit'): unknown {
  return {
    session_id: session,
    cwd: root,
    hook_event_name: 'PreToolUse',
    tool_name: tool,
    tool_input: { file_path: join(root, file) },
  };
}

async function recordPlanning(root: string, session: string, issue: string): Promise<string> {
  await execa(
    'node',
    [CLI, 'stage', 'start', 'planning', '--title', 'contract', '--issue', issue],
    {
      cwd: root,
      env: { ...process.env, SE_SESSION: session },
      reject: false,
    },
  );
  const bundle = bundleDir(root);
  const tmpl = join(root, '.paqad/plan-template.json');
  writeFileSync(
    tmpl,
    JSON.stringify({
      summary: 'contract plan',
      steps: [{ id: 's1', description: 'edit source' }],
      modules_touched: ['x'],
      decisions: [],
      risks: [],
      reuse: {
        consulted: [{ source: 'grep', query: 'x', hits: 1 }],
        reusing: [],
        new_constructs: [],
      },
    }),
  );
  await execa('node', [CLI, 'plan', 'compile', tmpl], {
    cwd: root,
    env: { ...process.env, SE_SESSION: session },
    reject: false,
  });
  await execa('node', [CLI, 'stage', 'end', 'planning', '--artifact', join(bundle, 'plan.json')], {
    cwd: root,
    env: { ...process.env, SE_SESSION: session },
    reject: false,
  });
  return bundle;
}

async function setLane(root: string, session: string, lane: 'fast' | 'graduated'): Promise<void> {
  await execa('node', [CLI, 'lane', 'set', lane], {
    cwd: root,
    env: { ...process.env, SE_SESSION: session },
    reject: false,
  });
}

function bundleDir(root: string): string {
  const base = join(root, '.paqad/ledger/feature-evidence');
  const dirs = readdirSync(base).filter((name) => name !== '_session');
  return join(base, dirs[0]!);
}

describe('contract: load-check (agent-entry-gate)', () => {
  for (const route of ROUTES) {
    it(`[${route.name}] blocks a source edit before the session load sentinel exists`, async () => {
      const root = freshRepo();
      const r = await runHook(AGENT_ENTRY, editPayload(root, 'ses1'), route.env(root));
      expect(r.exitCode).toBe(2);
      expect(r.stderr).toContain('CLAUDE.md');
    });

    it(`[${route.name}] allows the edit once a fresh sentinel exists`, async () => {
      const root = freshRepo();
      freshSentinel(root, 'ses1');
      const r = await runHook(AGENT_ENTRY, editPayload(root, 'ses1'), route.env(root));
      expect(r.exitCode).toBe(0);
    });
  }
});

describe('contract: planning gate (capability-gate pre-mutation)', () => {
  for (const route of ROUTES) {
    it(`[${route.name}] blocks a source edit before planning is recorded, naming planning`, async () => {
      const root = freshRepo();
      freshSentinel(root, 'ses2');
      const r = await runHook(CAPABILITY, editPayload(root, 'ses2'), route.env(root), [
        'pre-mutation',
      ]);
      expect(r.exitCode).toBe(2);
      expect(r.stderr.toLowerCase()).toContain('planning');
    });
  }
});

describe('contract: spec gate by lane (capability-gate pre-mutation)', () => {
  it('after planning, a graduated-lane source edit is blocked naming specification', async () => {
    const root = freshRepo();
    freshSentinel(root, 'ses3g');
    await recordPlanning(root, 'ses3g', '621');
    await setLane(root, 'ses3g', 'graduated');
    const r = await runHook(CAPABILITY, editPayload(root, 'ses3g'), ROUTES[0]!.env(root), [
      'pre-mutation',
    ]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr.toLowerCase()).toContain('specification');
  });

  it('after planning, a fast-lane source edit is allowed (no frozen spec required)', async () => {
    const root = freshRepo();
    freshSentinel(root, 'ses3f');
    await recordPlanning(root, 'ses3f', '621');
    await setLane(root, 'ses3f', 'fast');
    const r = await runHook(CAPABILITY, editPayload(root, 'ses3f'), ROUTES[0]!.env(root), [
      'pre-mutation',
    ]);
    expect(r.exitCode).toBe(0);
  });
});

describe('contract: pending decision packet (decision-pause-gate)', () => {
  for (const route of ROUTES) {
    it(`[${route.name}] blocks the edit while a decision packet is pending, allows once cleared`, async () => {
      const root = freshRepo();
      const pending = join(root, '.paqad/decisions/pending');
      mkdirSync(pending, { recursive: true });
      writeFileSync(join(pending, 'D-contract.json'), '{"category":"architecture-path"}');
      const blocked = await runHook(DECISION_PAUSE, editPayload(root, 'ses5'), route.env(root));
      expect(blocked.exitCode).toBe(2);

      rmSync(join(pending, 'D-contract.json'));
      const allowed = await runHook(DECISION_PAUSE, editPayload(root, 'ses5'), route.env(root));
      expect(allowed.exitCode).toBe(0);
    });
  }
});

describe('contract: feature-bundle write (capability-gate pre-mutation)', () => {
  for (const route of ROUTES) {
    it(`[${route.name}] blocks a hand write inside the feature evidence bundle`, async () => {
      const root = freshRepo();
      freshSentinel(root, 'ses6');
      const bundle = await recordPlanning(root, 'ses6', '621');
      const payload = {
        session_id: 'ses6',
        cwd: root,
        tool_name: 'Write',
        tool_input: { file_path: join(bundle, 'plan.json') },
      };
      const r = await runHook(CAPABILITY, payload, route.env(root), ['pre-mutation']);
      expect(r.exitCode).toBe(2);
      expect(r.stderr).toContain('feature');
    });
  }
});

describe('contract: gates fail closed (never silently allow on bad input)', () => {
  for (const route of ROUTES) {
    it(`[${route.name}] agent-entry-gate blocks (exit 2) on a malformed payload`, async () => {
      const root = freshRepo();
      const r = await runHook(AGENT_ENTRY, 'not-json-at-all', route.env(root));
      expect(r.exitCode).toBe(2);
      expect(r.stderr).toContain('load the paqad framework');
    });
  }
});

describe('contract: Stop verdict with an incomplete change (verification-completion)', () => {
  it('does not report "Safe to merge" when an open bundle is missing mandatory stages', async () => {
    const root = freshRepo();
    freshSentinel(root, 'ses8');
    await recordPlanning(root, 'ses8', '621');
    const payload = {
      session_id: 'ses8',
      cwd: root,
      hook_event_name: 'Stop',
      stop_hook_active: false,
    };
    const r = await runHook(VERIFICATION, payload, ROUTES[0]!.env(root));
    expect([0, 2]).toContain(r.exitCode);
    expect(`${r.stdout}${r.stderr}`).not.toContain('Safe to merge');
  });
});

describe('contract: SubagentStop records a stage-agent row (stage-agent-completion)', () => {
  it('appends exactly one stage-agent row and exits 0', async () => {
    const root = freshRepo();
    await recordPlanning(root, 'ses9', '567');
    const transcript = join(root, 'sub.jsonl');
    writeFileSync(
      transcript,
      `${JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'work' } })}\n`,
    );
    const payload = {
      session_id: 'sub9',
      cwd: root,
      transcript_path: transcript,
      agent_id: 'agent9',
      agent_type: 'paqad-development',
      hook_event_name: 'SubagentStop',
    };
    const r = await runHook(SUBAGENT_COMPLETION, payload, { CLAUDE_PROJECT_DIR: root });
    expect(r.exitCode).toBe(0);
    const rows = readFileSync(join(bundleDir(root), 'stage-evidence.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { kind?: string })
      .filter((row) => row.kind === 'stage-agent');
    expect(rows).toHaveLength(1);
  });
});

describe('contract: disabled and un-onboarded no-op', () => {
  it('every edit gate exits 0 when PAQAD_DISABLED=1', async () => {
    const root = freshRepo();
    const env = { CLAUDE_PROJECT_DIR: root, PAQAD_DISABLED: '1' };
    for (const [script, argv] of [
      [AGENT_ENTRY, []],
      [CAPABILITY, ['pre-mutation']],
      [DECISION_PAUSE, []],
    ] as const) {
      const r = await runHook(script, editPayload(root, 'ses10'), env, argv as string[]);
      expect(r.exitCode).toBe(0);
    }
  });

  it('under the plugin, every edit gate no-ops in a repo that was never onboarded', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-contract-bare-'));
    roots.push(root);
    const env = { CLAUDE_PROJECT_DIR: root, CLAUDE_PLUGIN_ROOT: REPO };
    for (const [script, argv] of [
      [AGENT_ENTRY, []],
      [CAPABILITY, ['pre-mutation']],
      [DECISION_PAUSE, []],
    ] as const) {
      const r = await runHook(script, editPayload(root, 'ses10b'), env, argv as string[]);
      expect(r.exitCode).toBe(0);
    }
  });
});
