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
import { basename, join, resolve } from 'node:path';

import { execa } from 'execa';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ensureBuiltDist } from './helpers/ensure-built';

const REPO = process.cwd();
const HOOKS = resolve(REPO, 'runtime/hooks');
const CLI = resolve(REPO, 'dist/cli/index.js');
const CONTRACT = resolve(REPO, 'tests/e2e/stage-enforcement-contract.e2e.test.ts');

const CAPABILITY = join(HOOKS, 'capability-gate.mjs');
const DECISION_PAUSE = join(HOOKS, 'decision-pause-gate.mjs');
const MANAGED_NAMES = new Map([
  [CAPABILITY, 'capability-gate'],
  [DECISION_PAUSE, 'decision-pause-gate'],
]);
const ORG_LINE = "This rule is enforced by your organization's settings.";

beforeAll(async () => {
  await ensureBuiltDist();
}, 240_000);

const roots: string[] = [];
function freshRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-managed-contract-'));
  roots.push(root);
  mkdirSync(join(root, '.paqad'), { recursive: true });
  mkdirSync(join(root, 'docs/instructions'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'CLAUDE.md'), '# entry');
  writeFileSync(join(root, '.paqad/framework-path.txt'), '~/.paqad-ai/current\n');
  return root;
}
function bareRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-managed-contract-bare-'));
  roots.push(root);
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

type RouteName = 'npm' | 'managed';

interface HookResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runGate(
  route: RouteName,
  script: string,
  payload: unknown,
  root: string,
  argv: string[] = [],
  extraEnv: NodeJS.ProcessEnv = {},
): Promise<HookResult> {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    CLAUDE_PROJECT_DIR: root,
    ...extraEnv,
  };
  const command =
    route === 'managed'
      ? [CLI, 'hook', '--managed', MANAGED_NAMES.get(script)!, ...argv]
      : [script, ...argv];
  const result = await execa('node', command, {
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

async function recordPlanning(root: string, session: string): Promise<string> {
  const env = { ...process.env, SE_SESSION: session };
  await execa('node', [CLI, 'stage', 'start', 'planning', '--title', 'contract', '--issue', '1'], {
    cwd: root,
    env,
    reject: false,
  });
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
  await execa('node', [CLI, 'plan', 'compile', tmpl], { cwd: root, env, reject: false });
  await execa('node', [CLI, 'stage', 'end', 'planning', '--artifact', join(bundle, 'plan.json')], {
    cwd: root,
    env,
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

function normalize(text: string, root: string, bundle?: string): string {
  const named = bundle ? text.replaceAll(basename(bundle), '<bundle>') : text;
  return named.replaceAll(root, '<root>');
}

interface Pair {
  npm: HookResult;
  managed: HookResult;
  npmRoot: string;
  managedRoot: string;
}

function expectManagedBlockMatchesNpm(pair: Pair, npmBundle?: string, managedBundle?: string) {
  expect(pair.npm.exitCode).toBe(2);
  expect(pair.managed.exitCode).toBe(pair.npm.exitCode);
  expect(normalize(pair.managed.stdout, pair.managedRoot, managedBundle)).toBe(
    normalize(pair.npm.stdout, pair.npmRoot, npmBundle),
  );
  expect(normalize(pair.managed.stderr, pair.managedRoot, managedBundle)).toBe(
    `${normalize(pair.npm.stderr, pair.npmRoot, npmBundle)}\n${ORG_LINE}`,
  );
}

function expectIdentical(pair: Pair) {
  expect(pair.managed.exitCode).toBe(pair.npm.exitCode);
  expect(normalize(pair.managed.stdout, pair.managedRoot)).toBe(
    normalize(pair.npm.stdout, pair.npmRoot),
  );
  expect(normalize(pair.managed.stderr, pair.managedRoot)).toBe(
    normalize(pair.npm.stderr, pair.npmRoot),
  );
}

const PLANNING_GATE = 'contract: planning gate (capability-gate pre-mutation)';
const SPEC_GATE = 'contract: spec gate by lane (capability-gate pre-mutation)';
const DECISION_GATE = 'contract: pending decision packet (decision-pause-gate)';
const BUNDLE_WRITE = 'contract: feature-bundle write (capability-gate pre-mutation)';
const NO_OP = 'contract: disabled and un-onboarded no-op';
const LOAD_CHECK = 'contract: load-check (agent-entry-gate)';

const caseKey = (group: string, title: string) => `${group} > ${title}`;

const MANAGED_CASES = {
  planningBlock: caseKey(
    PLANNING_GATE,
    'blocks a source edit before planning is recorded, naming planning',
  ),
  specGraduated: caseKey(
    SPEC_GATE,
    'after planning, a graduated-lane source edit is blocked naming specification',
  ),
  specFast: caseKey(
    SPEC_GATE,
    'after planning, a fast-lane source edit is allowed (no frozen spec required)',
  ),
  decisionPause: caseKey(
    DECISION_GATE,
    'blocks the edit while a decision packet is pending, allows once cleared',
  ),
  bundleWrite: caseKey(BUNDLE_WRITE, 'blocks a hand write inside the feature evidence bundle'),
  disabled: caseKey(NO_OP, 'every edit gate exits 0 when PAQAD_DISABLED=1'),
  unOnboarded: caseKey(
    NO_OP,
    'under the plugin, every edit gate no-ops in a repo that was never onboarded',
  ),
} as const;

const NOT_APPLICABLE = [
  caseKey(LOAD_CHECK, 'blocks a source edit before the session load sentinel exists'),
  caseKey(LOAD_CHECK, 'allows the edit once a fresh sentinel exists'),
  caseKey(
    'contract: gates fail closed (never silently allow on bad input)',
    'agent-entry-gate blocks (exit 2) on a malformed payload',
  ),
  caseKey(
    'contract: Stop verdict with an incomplete change (verification-completion)',
    'does not report "Safe to merge" when an open bundle is missing mandatory stages',
  ),
  caseKey(
    'contract: SubagentStop records a stage-agent row (stage-agent-completion)',
    'appends exactly one stage-agent row and exits 0',
  ),
];

interface ContractCase {
  key: string;
  body: string;
}

function contractCases(): ContractCase[] {
  const lines = readFileSync(CONTRACT, 'utf8').split('\n');
  const cases: ContractCase[] = [];
  let group = '';
  let current: { key: string; body: string[] } | undefined;
  const flush = () => {
    if (current) cases.push({ key: current.key, body: current.body.join('\n') });
    current = undefined;
  };
  for (const line of lines) {
    const describeMatch = /^describe\('(.+)', \(\) => \{/.exec(line);
    if (describeMatch) {
      flush();
      group = describeMatch[1]!;
      continue;
    }
    const itMatch = /^\s*it\((['`])(.*?)\1,/.exec(line);
    if (itMatch) {
      flush();
      const title = itMatch[2]!.replace(/^\[\$\{route\.name\}\] /, '');
      current = { key: caseKey(group, title), body: [] };
      continue;
    }
    current?.body.push(line);
  }
  flush();
  return [...new Map(cases.map((entry) => [entry.key, entry])).values()];
}

describe('managed route: parity with the stage enforcement contract', () => {
  it('covers every contract case that runs a managed gate and lists the rest as not applicable', () => {
    const cases = contractCases();
    const covered: string[] = Object.values(MANAGED_CASES);
    expect(cases.length).toBeGreaterThan(0);
    expect(covered.filter((key) => NOT_APPLICABLE.includes(key))).toEqual([]);
    expect(cases.map((entry) => entry.key).sort()).toEqual([...covered, ...NOT_APPLICABLE].sort());

    const touchesManagedGate = (body: string) => /\b(CAPABILITY|DECISION_PAUSE)\b/.test(body);
    for (const entry of cases) {
      if (touchesManagedGate(entry.body)) expect(covered).toContain(entry.key);
      else expect(NOT_APPLICABLE).toContain(entry.key);
    }
  });
});

describe('managed route: planning gate', () => {
  it(MANAGED_CASES.planningBlock, async () => {
    const npmRoot = freshRepo();
    const managedRoot = freshRepo();
    freshSentinel(npmRoot, 'ses2');
    freshSentinel(managedRoot, 'ses2');
    const pair: Pair = {
      npm: await runGate('npm', CAPABILITY, editPayload(npmRoot, 'ses2'), npmRoot, [
        'pre-mutation',
      ]),
      managed: await runGate('managed', CAPABILITY, editPayload(managedRoot, 'ses2'), managedRoot, [
        'pre-mutation',
      ]),
      npmRoot,
      managedRoot,
    };
    expectManagedBlockMatchesNpm(pair);
    expect(pair.managed.stderr.toLowerCase()).toContain('planning');
  });
});

describe('managed route: spec gate by lane', () => {
  async function laneCase(session: string, lane: 'fast' | 'graduated'): Promise<Pair> {
    const npmRoot = freshRepo();
    const managedRoot = freshRepo();
    for (const root of [npmRoot, managedRoot]) {
      freshSentinel(root, session);
      await recordPlanning(root, session);
      await setLane(root, session, lane);
    }
    return {
      npm: await runGate('npm', CAPABILITY, editPayload(npmRoot, session), npmRoot, [
        'pre-mutation',
      ]),
      managed: await runGate(
        'managed',
        CAPABILITY,
        editPayload(managedRoot, session),
        managedRoot,
        ['pre-mutation'],
      ),
      npmRoot,
      managedRoot,
    };
  }

  it(MANAGED_CASES.specGraduated, async () => {
    const pair = await laneCase('ses3g', 'graduated');
    expectManagedBlockMatchesNpm(pair, bundleDir(pair.npmRoot), bundleDir(pair.managedRoot));
    expect(pair.managed.stderr.toLowerCase()).toContain('specification');
  });

  it(MANAGED_CASES.specFast, async () => {
    const pair = await laneCase('ses3f', 'fast');
    expect(pair.managed.exitCode).toBe(0);
    expectIdentical(pair);
  });
});

describe('managed route: pending decision packet', () => {
  it(MANAGED_CASES.decisionPause, async () => {
    const root = freshRepo();
    const pending = join(root, '.paqad/decisions/pending');
    mkdirSync(pending, { recursive: true });
    writeFileSync(join(pending, 'D-contract.json'), '{"category":"architecture-path"}');
    const blocked: Pair = {
      npm: await runGate('npm', DECISION_PAUSE, editPayload(root, 'ses5'), root),
      managed: await runGate('managed', DECISION_PAUSE, editPayload(root, 'ses5'), root),
      npmRoot: root,
      managedRoot: root,
    };
    expect(blocked.managed.exitCode).toBe(2);
    expectIdentical(blocked);

    rmSync(join(pending, 'D-contract.json'));
    const allowed: Pair = {
      npm: await runGate('npm', DECISION_PAUSE, editPayload(root, 'ses5'), root),
      managed: await runGate('managed', DECISION_PAUSE, editPayload(root, 'ses5'), root),
      npmRoot: root,
      managedRoot: root,
    };
    expect(allowed.managed.exitCode).toBe(0);
    expectIdentical(allowed);
  });
});

describe('managed route: feature-bundle write', () => {
  it(MANAGED_CASES.bundleWrite, async () => {
    const npmRoot = freshRepo();
    const managedRoot = freshRepo();
    freshSentinel(npmRoot, 'ses6');
    freshSentinel(managedRoot, 'ses6');
    const npmBundle = await recordPlanning(npmRoot, 'ses6');
    const managedBundle = await recordPlanning(managedRoot, 'ses6');
    const write = (root: string, bundle: string) => ({
      session_id: 'ses6',
      cwd: root,
      tool_name: 'Write',
      tool_input: { file_path: join(bundle, 'plan.json') },
    });
    const pair: Pair = {
      npm: await runGate('npm', CAPABILITY, write(npmRoot, npmBundle), npmRoot, ['pre-mutation']),
      managed: await runGate(
        'managed',
        CAPABILITY,
        write(managedRoot, managedBundle),
        managedRoot,
        ['pre-mutation'],
      ),
      npmRoot,
      managedRoot,
    };
    expectManagedBlockMatchesNpm(pair, npmBundle, managedBundle);
    expect(pair.managed.stderr).toContain('feature');
  });
});

describe('managed route: the local off switch does not turn off an organization gate', () => {
  it(MANAGED_CASES.disabled, async () => {
    const root = freshRepo();
    const env = { PAQAD_DISABLED: '1' };
    const payload = editPayload(root, 'ses10');
    const npmCapability = await runGate('npm', CAPABILITY, payload, root, ['pre-mutation'], env);
    expect(npmCapability.exitCode).toBe(0);
    const managedCapability = await runGate(
      'managed',
      CAPABILITY,
      payload,
      root,
      ['pre-mutation'],
      env,
    );
    expect(managedCapability.exitCode).toBe(2);
    expect(managedCapability.stderr.trimEnd().endsWith(ORG_LINE)).toBe(true);

    const pending = join(root, '.paqad/decisions/pending');
    mkdirSync(pending, { recursive: true });
    writeFileSync(join(pending, 'D-contract.json'), '{"category":"architecture-path"}');
    const npmPause = await runGate('npm', DECISION_PAUSE, payload, root, [], env);
    expect(npmPause.exitCode).toBe(0);
    const managedPause = await runGate('managed', DECISION_PAUSE, payload, root, [], env);
    expect(managedPause.exitCode).toBe(2);
  });

  it('keeps blocking under PAQAD_DISABLED and paqad_enable=false', async () => {
    const root = freshRepo();
    freshSentinel(root, 'ses13');
    writeFileSync(join(root, '.paqad/.config'), 'paqad_enable=false\n');
    const env = { PAQAD_DISABLED: '1' };
    const payload = editPayload(root, 'ses13');
    const managed = await runGate('managed', CAPABILITY, payload, root, ['pre-mutation'], env);
    expect(managed.exitCode).toBe(2);
    expect(managed.stderr.trimEnd().endsWith(ORG_LINE)).toBe(true);
    const npm = await runGate('npm', CAPABILITY, payload, root, ['pre-mutation'], env);
    expect(npm.exitCode).toBe(0);
  });

  it('keeps blocking under paqad_enable=false alone', async () => {
    const root = freshRepo();
    freshSentinel(root, 'ses15');
    writeFileSync(join(root, '.paqad/.config'), 'paqad_enable=false\n');
    const payload = editPayload(root, 'ses15');
    const managed = await runGate('managed', CAPABILITY, payload, root, ['pre-mutation']);
    expect(managed.exitCode).toBe(2);
    expect(managed.stderr.trimEnd().endsWith(ORG_LINE)).toBe(true);
    const npm = await runGate('npm', CAPABILITY, payload, root, ['pre-mutation']);
    expect(npm.exitCode).toBe(0);
  });
});

describe('managed route: a project with no .paqad/', () => {
  it(MANAGED_CASES.unOnboarded, async () => {
    const root = bareRepo();
    for (const [script, argv] of [
      [CAPABILITY, ['pre-mutation']],
      [DECISION_PAUSE, []],
    ] as const) {
      const r = await runGate('managed', script, editPayload(root, 'ses14'), root, [...argv]);
      expect(r).toEqual({ exitCode: 0, stdout: '', stderr: '' });
    }
  });
});
