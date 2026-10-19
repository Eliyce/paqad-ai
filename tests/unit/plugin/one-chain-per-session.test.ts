import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { execa } from 'execa';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ensureBuiltDist } from '../../e2e/helpers/ensure-built';

// ─────────────────────────────────────────────────────────────────────────────
// One hook chain per session (issue #667, AC-1/AC-4/AC-7, INV-1/INV-3). Claude Code loads the
// SAME runtime/hooks/*.mjs scripts from two places when both copies are installed: the npm copy
// wired into the project's .claude/settings.json (no CLAUDE_PLUGIN_ROOT) and the plugin copy
// (CLAUDE_PLUGIN_ROOT set). This contract test runs the real hooks under both env shapes for ONE
// payload in a temp npm-wired, onboarded project and checks that exactly one copy does the work:
//   - passive (unclaimed session, live npm wiring): only the npm copy writes / blocks / injects;
//   - claimed (plugin-active marker for the session): only the plugin copy does.
// Every path is a temp dir: the project, the user Claude config dir (CLAUDE_CONFIG_DIR), and the
// "installed" npm hook script. HOME is sandboxed by tests/shared/isolate-home.ts and the child env
// is built from scratch, so the developer's real settings and markers are never read.
// ─────────────────────────────────────────────────────────────────────────────

const REPO = process.cwd();
const HOOKS = resolve(REPO, 'runtime/hooks');
const CLI = resolve(REPO, 'dist/cli/index.js');
const MARKER_PARSE = join(HOOKS, 'stage-marker-parse.mjs');
const VERIFICATION = join(HOOKS, 'verification-completion.mjs');
const AGENT_ENTRY = join(HOOKS, 'agent-entry-gate.mjs');
const PROMPT_GATE = join(HOOKS, 'agent-entry-prompt-gate.mjs');

beforeAll(async () => {
  await ensureBuiltDist();
}, 240_000);

const dirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

interface Fixture {
  root: string;
  userDir: string;
  session: string;
}

/** An onboarded project whose own .claude/settings.json wires a live (existing) paqad npm hook. */
function npmWiredProject(session: string): Fixture {
  const root = tempDir('paqad-one-chain-');
  const userDir = tempDir('claude-config-');
  const install = tempDir('paqad-npm-install-');
  mkdirSync(join(root, '.paqad'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'CLAUDE.md'), '# entry');
  writeFileSync(join(root, '.paqad/framework-path.txt'), '~/.paqad-ai/current\n');
  const script = join(install, 'hooks', 'capability-gate.mjs');
  mkdirSync(join(install, 'hooks'), { recursive: true });
  writeFileSync(script, '// npm hook\n');
  mkdirSync(join(root, '.claude'), { recursive: true });
  writeFileSync(
    join(root, '.claude', 'settings.json'),
    JSON.stringify({
      hooks: { Stop: [{ hooks: [{ type: 'command', command: `node "${script}" completion` }] }] },
    }),
  );
  return { root, userDir, session };
}

/** Claim the session for the plugin, exactly as plugin-session-start does. */
function claimForPlugin(fx: Fixture): void {
  const dir = join(fx.root, '.paqad', 'session', 'plugin-active.d');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, fx.session), 'claimed');
}

type Route = 'npm' | 'plugin';
async function runHook(
  script: string,
  fx: Fixture,
  route: Route,
  payload: unknown,
  extraEnv: NodeJS.ProcessEnv = {},
): Promise<{ exitCode: number; output: string }> {
  // A clean env (not process.env), so the real session's SE_SESSION / CLAUDE_* never leak in.
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    CLAUDE_PROJECT_DIR: fx.root,
    CLAUDE_CONFIG_DIR: fx.userDir,
    ...(route === 'plugin' ? { CLAUDE_PLUGIN_ROOT: REPO } : {}),
    ...extraEnv,
  };
  const result = await execa('node', [script], {
    input: JSON.stringify(payload),
    env,
    extendEnv: false,
    reject: false,
  });
  return { exitCode: result.exitCode ?? 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/** Open a titled feature bundle for the session through the real CLI. */
async function openBundle(fx: Fixture): Promise<string> {
  await execa(
    'node',
    [CLI, 'stage', 'start', 'planning', '--title', 'one chain', '--issue', '667'],
    {
      cwd: fx.root,
      env: { ...process.env, SE_SESSION: fx.session, CLAUDE_CONFIG_DIR: fx.userDir },
      reject: false,
    },
  );
  const base = join(fx.root, '.paqad/ledger/feature-evidence');
  const bundle = readdirSync(base).find((name) => name !== '_session');
  expect(bundle).toBeDefined();
  return join(base, bundle!);
}

/** The Stop payload both copies receive: a stage marker in the transcript + a background stage agent. */
function stopPayload(fx: Fixture): unknown {
  const transcript = join(fx.root, 'turn.jsonl');
  writeFileSync(
    transcript,
    `${JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: 'paqad:stage review start' },
    })}\n`,
  );
  return {
    session_id: fx.session,
    cwd: fx.root,
    transcript_path: transcript,
    hook_event_name: 'Stop',
    stop_hook_active: false,
    // A running stage agent makes verification-completion record one `completion-deferred` row
    // and exit, so its ledger effect is observable without running the full backstop.
    background_tasks: [{ agent_type: 'paqad-review', status: 'running' }],
  };
}

/** The Stop rows this test cares about: the parsed review marker and the completion breadcrumb. */
function stopRows(bundle: string): { markers: number; deferred: number } {
  const path = join(bundle, 'stage-evidence.jsonl');
  const rows = existsSync(path)
    ? readFileSync(path, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { kind?: string; stage?: string })
    : [];
  return {
    markers: rows.filter((r) => r.kind === 'stage_start' && r.stage === 'review').length,
    deferred: rows.filter((r) => r.kind === 'completion-deferred').length,
  };
}

async function runStop(fx: Fixture, route: Route, payload: unknown): Promise<void> {
  for (const script of [MARKER_PARSE, VERIFICATION]) {
    const r = await runHook(script, fx, route, payload);
    expect(r.exitCode).toBe(0);
  }
}

describe('one hook chain per session (issue #667)', () => {
  it('passive session: only the npm copy of the Stop hooks writes the ledger rows (AC-4)', async () => {
    const fx = npmWiredProject('ses-passive');
    const bundle = await openBundle(fx);
    const payload = stopPayload(fx);

    await runStop(fx, 'plugin', payload);
    expect(stopRows(bundle)).toEqual({ markers: 0, deferred: 0 }); // the plugin stood down

    await runStop(fx, 'npm', payload);
    expect(stopRows(bundle)).toEqual({ markers: 1, deferred: 1 }); // exactly one row set
  });

  it('claimed session: only the plugin copy of the Stop hooks writes the ledger rows (AC-4, AC-7)', async () => {
    const fx = npmWiredProject('ses-claimed');
    const bundle = await openBundle(fx);
    claimForPlugin(fx);
    const payload = stopPayload(fx);

    await runStop(fx, 'npm', payload);
    expect(stopRows(bundle)).toEqual({ markers: 0, deferred: 0 }); // the npm copy stepped aside

    await runStop(fx, 'plugin', payload);
    expect(stopRows(bundle)).toEqual({ markers: 1, deferred: 1 });
  });

  it('passive session: one PreToolUse block and one UserPromptSubmit injection, from npm (AC-1)', async () => {
    const fx = npmWiredProject('ses-edit');
    const edit = {
      session_id: fx.session,
      cwd: fx.root,
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: join(fx.root, 'src/x.ts') },
    };
    // No load sentinel yet, so the entry gate blocks: once, from the npm copy only.
    const pluginEdit = await runHook(AGENT_ENTRY, fx, 'plugin', edit);
    const npmEdit = await runHook(AGENT_ENTRY, fx, 'npm', edit);
    expect(pluginEdit).toEqual({ exitCode: 0, output: '' });
    expect(npmEdit.exitCode).toBe(2);
    expect(npmEdit.output).not.toBe('');

    const prompt = {
      session_id: fx.session,
      cwd: fx.root,
      hook_event_name: 'UserPromptSubmit',
      prompt: 'fix the login bug',
    };
    const pluginPrompt = await runHook(PROMPT_GATE, fx, 'plugin', prompt);
    const npmPrompt = await runHook(PROMPT_GATE, fx, 'npm', prompt);
    expect(pluginPrompt).toEqual({ exitCode: 0, output: '' });
    expect(npmPrompt.output).not.toBe('');
  });

  it('paqad disabled stays a no-op on both copies (INV-3)', async () => {
    const fx = npmWiredProject('ses-off');
    const bundle = await openBundle(fx);
    // No background task here; the disabled + background-task case is covered below (#673).
    const payload = { ...(stopPayload(fx) as object), background_tasks: [] };
    for (const route of ['npm', 'plugin'] as const) {
      for (const script of [MARKER_PARSE, VERIFICATION]) {
        const r = await runHook(script, fx, route, payload, { PAQAD_DISABLED: '1' });
        expect(r).toEqual({ exitCode: 0, output: '' });
      }
    }
    expect(stopRows(bundle)).toEqual({ markers: 0, deferred: 0 });
  });
});

/** The disabled-session audit rows recorded for a session on the shared session ledger. */
function disabledAuditRows(fx: Fixture): number {
  const dir = join(fx.root, '.paqad/ledger/disabled-session', fx.session);
  if (!existsSync(dir)) return 0;
  return readdirSync(dir)
    .filter((name) => name.endsWith('.jsonl'))
    .flatMap((name) => readFileSync(join(dir, name), 'utf8').trim().split('\n').filter(Boolean))
    .length;
}

describe('a disabled project writes no completion-deferred row (issue #673)', () => {
  it('disabled + a running stage agent: no deferred row, exactly one disabled audit row (AC-1)', async () => {
    const fx = npmWiredProject('ses-off-bg');
    const bundle = await openBundle(fx);
    const payload = stopPayload(fx); // carries a running paqad-review background task

    const first = await runHook(VERIFICATION, fx, 'npm', payload, { PAQAD_DISABLED: '1' });
    expect(first).toEqual({ exitCode: 0, output: '' });
    expect(stopRows(bundle).deferred).toBe(0);
    expect(disabledAuditRows(fx)).toBe(1);

    // A second disabled Stop in the same session still leaves exactly one audit row.
    await runHook(VERIFICATION, fx, 'npm', payload, { PAQAD_DISABLED: '1' });
    expect(stopRows(bundle).deferred).toBe(0);
    expect(disabledAuditRows(fx)).toBe(1);
  });

  it('enabled + the same payload still writes the completion-deferred row (AC-1)', async () => {
    const fx = npmWiredProject('ses-on-bg');
    const bundle = await openBundle(fx);

    const r = await runHook(VERIFICATION, fx, 'npm', stopPayload(fx));
    expect(r.exitCode).toBe(0);
    expect(stopRows(bundle).deferred).toBe(1);
    expect(disabledAuditRows(fx)).toBe(0);
  });
});
