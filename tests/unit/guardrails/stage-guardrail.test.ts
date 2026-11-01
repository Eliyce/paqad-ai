import { execFileSync } from 'node:child_process';
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
import { dirname, join } from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PAQAD_LIVE_HOOKS,
  PAQAD_STAGE_HELPER_MATCHER,
  PLUGIN_RUNTIME_ROOT,
  PLUGIN_SESSION_START_HOOK,
  type RenderedHook,
  buildHostHookChain,
  buildPluginHookChain,
} from '@/adapters/shared/paqad-hooks.js';
import { AdapterFactory } from '@/adapters';
import { mergeNativeHooks } from '@/adapters/shared/native-hook-config.js';
import { ADAPTER_TYPES } from '@/core/types/adapter.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import { hudSnapshotPath } from '@/hud/files.js';

import { printedCode } from '../../shared/printed-code.js';
import { ticketRef } from '../../shared/ticket-ref.js';
import { seedGitChangedFiles } from '../pipeline/changed-files.fixture.js';
import { writeSeatTranscript } from '../spec-pipeline/high-table.fixture.js';
import { openChange, writeSpec } from '../traceability/change-map.fixture.js';

const REPO = process.cwd();
const CONTRACT = 'tests/e2e/stage-enforcement-contract.e2e.test.ts';
const PLUGIN_HOOKS = 'runtime/claude-plugin/hooks.json';
const GOLDEN = 'tests/unit/adapters/__snapshots__/native-hook-config.golden.test.ts.snap';
const SEED_EVENT = 'SubagentStart';
const SEED_BLOCK = /^ {4}"SubagentStart": \[\n[\s\S]*?^ {4}\],\n/m;
const ACTIVATION_EVENT = 'PostToolUse';
const ACTIVATION_MATCHER = 'Skill|Read';
const ACTIVATION_HOOK = 'skill-activation.mjs';
const ACTIVATION_BLOCK = /,\n {4}"PostToolUse": \[\n(?: {6}.*\n)+? {4}\]/;

type HookGroups = Record<string, Array<{ matcher?: string; hooks: Array<{ command: string }> }>>;

interface PluginHooksFile {
  hooks: HookGroups;
  [key: string]: unknown;
}

function withoutSeedHook(hooks: HookGroups): HookGroups {
  return Object.fromEntries(
    Object.entries(hooks).filter(([event]) => event !== SEED_EVENT && event !== ACTIVATION_EVENT),
  );
}

function expectOnlyTheActivationEntry(hooks: HookGroups): void {
  expect(Object.keys(hooks).at(-1)).toBe(ACTIVATION_EVENT);
  expect(
    (hooks[ACTIVATION_EVENT] ?? []).map((group) => ({
      matcher: group.matcher,
      hooks: group.hooks.map((entry) => hookOf(entry.command)),
    })),
  ).toEqual([{ matcher: ACTIVATION_MATCHER, hooks: [ACTIVATION_HOOK] }]);
}

function isActivationLine(line: RenderedHook): boolean {
  return (
    line.nativeEvent === ACTIVATION_EVENT &&
    line.matcher === ACTIVATION_MATCHER &&
    hookOf(line.command) === ACTIVATION_HOOK
  );
}

interface PinnedRenderings {
  frameworkHome: string;
  chains: Record<'claude-code' | 'codex-cli', RenderedHook[]>;
  plugin: RenderedHook[];
  files: Record<string, Record<string, string>>;
}

const PINNED = JSON.parse(
  readFileSync(
    join(REPO, 'tests/fixtures/guardrails/hook-renderings-before-stage-seed.json'),
    'utf8',
  ),
) as PinnedRenderings;

function notSeed(line: RenderedHook): boolean {
  return line.nativeEvent !== SEED_EVENT && !isActivationLine(line);
}

function seedLine(hooksDir: string): RenderedHook {
  return {
    nativeEvent: SEED_EVENT,
    matcher: PAQAD_STAGE_HELPER_MATCHER,
    command: `node "${hooksDir}/stage-agent-start.mjs"`,
    timeout: 10,
  };
}

async function renderHookFiles(): Promise<Record<string, Record<string, string>>> {
  const prior = process.env.PAQAD_FRAMEWORK_HOME;
  process.env.PAQAD_FRAMEWORK_HOME = PINNED.frameworkHome;
  const out: Record<string, Record<string, string>> = {};
  try {
    for (const type of ADAPTER_TYPES) {
      const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-guardrail-render-'));
      temps.push(projectRoot);
      const files = await AdapterFactory.create(type).generateConfig({
        frameworkPath: '.paqad/framework-path.txt',
        rulesPath: 'docs/instructions/rules',
        projectRoot,
      });
      for (const file of files) {
        const content = file.content.split(projectRoot).join('<root>');
        if (content.includes('/hooks/') || content.includes('/.paqad/hook.mjs')) {
          (out[type] ??= {})[file.path] = content;
        }
      }
    }
  } finally {
    if (prior === undefined) delete process.env.PAQAD_FRAMEWORK_HOME;
    else process.env.PAQAD_FRAMEWORK_HOME = prior;
  }
  return out;
}

function mergeBase(): string | null {
  try {
    return execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], {
      cwd: REPO,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

const BASE = mergeBase();
const NO_BASE = 'origin/main is not available in this checkout, so there is no base to compare';

function atBase(file: string): string {
  return execFileSync('git', ['show', `${BASE}:${file}`], { cwd: REPO, encoding: 'utf8' });
}

function working(file: string): string {
  return readFileSync(join(REPO, file), 'utf8');
}

const LAUNCHER_PREFIX = 'node "$CLAUDE_PROJECT_DIR/.paqad/hook.mjs" ';
const GOLDEN_HOME = '/fake/home/.paqad-ai/current';

function launcherToHost(command: string, frameworkHome: string): string {
  if (!command.startsWith(LAUNCHER_PREFIX)) return command;
  const [script, ...args] = command.slice(LAUNCHER_PREFIX.length).split(' ');
  return [`node "${frameworkHome}/hooks/${script}"`, ...args].join(' ');
}

function teamSettingsAsHost(content: string, frameworkHome: string): string {
  const parsed = JSON.parse(content) as { hooks: HookGroups; [key: string]: unknown };
  delete parsed.extraKnownMarketplaces;
  delete parsed.enabledPlugins;
  for (const [event, groups] of Object.entries(parsed.hooks)) {
    for (const group of groups) {
      for (const hook of group.hooks as Array<{ command: string; timeout?: number }>) {
        hook.command = launcherToHost(hook.command, frameworkHome);
        if (event === 'SessionStart' && hook.timeout === 600) delete hook.timeout;
      }
    }
  }
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

function goldenAsHost(text: string): string {
  return text
    .replace(
      /node \\\\"\$CLAUDE_PROJECT_DIR\/\.paqad\/hook\.mjs\\\\" ([\w.-]+\.mjs)/g,
      `node \\\\"${GOLDEN_HOME}/hooks/$1\\\\"`,
    )
    .replace(/,\n {12}"timeout": 600/g, '')
    .replace(
      / {2}"extraKnownMarketplaces": \{\n[\s\S]*?\n {2}"enabledPlugins": \{\n[^}]*\},\n/,
      '',
    );
}

const LAUNCHER_ROUTE_ADDITIONS: ReadonlyArray<readonly [string, string]> = [
  [
    `import {
  copyFileSync,
  cpSync,
  mkdirSync,`,
    `import {
  mkdirSync,`,
  ],
  [
    `import { basename, join, resolve } from 'node:path';`,
    `import { join, resolve } from 'node:path';`,
  ],
  [
    `import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';`,
    `import { afterEach, beforeAll, describe, expect, it } from 'vitest';`,
  ],
  [
    `const LAUNCHER_TEMPLATE = resolve(REPO, 'runtime/templates/team-bootstrap/hook.mjs');
const LAUNCHER_ROUTE = '__PAQAD_CONTRACT_LAUNCHER_ROUTE';

let launcherHome = '';
`,
    ``,
  ],
  [
    `  await ensureBuiltDist();
  launcherHome = mkdtempSync(join(tmpdir(), 'paqad-contract-home-'));
  const copy = join(launcherHome, '.paqad-ai', 'team-plugin');
  mkdirSync(copy, { recursive: true });
  copyFileSync(join(REPO, 'package.json'), join(copy, 'package.json'));
  for (const part of ['dist', 'runtime']) {
    cpSync(join(REPO, part), join(copy, part), { recursive: true });
  }
`,
    `  await ensureBuiltDist();
`,
  ],
  [
    `afterAll(() => {
  if (launcherHome) rmSync(launcherHome, { recursive: true, force: true });
});

`,
    ``,
  ],
  [
    `  name: 'npm' | 'plugin' | 'launcher then npm' | 'launcher then team copy';`,
    `  name: 'npm' | 'plugin';`,
  ],
  [
    `function launcherEnv(root: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    CLAUDE_PROJECT_DIR: root,
    CLAUDE_PLUGIN_ROOT: '',
    HOME: launcherHome,
    USERPROFILE: launcherHome,
    CLAUDE_CONFIG_DIR: join(launcherHome, '.claude'),
    [LAUNCHER_ROUTE]: '1',
    ...extra,
  };
}
`,
    ``,
  ],
  [
    `  {
    name: 'launcher then npm',
    env: (root) => launcherEnv(root, { PAQAD_FRAMEWORK_HOME: resolve(REPO, 'runtime') }),
  },
  { name: 'launcher then team copy', env: (root) => launcherEnv(root) },
`,
    ``,
  ],
  [
    `  let command = [script, ...argv];
  if (env[LAUNCHER_ROUTE]) {
    delete env[LAUNCHER_ROUTE];
    const launcher = join(env.CLAUDE_PROJECT_DIR!, '.paqad', 'hook.mjs');
    copyFileSync(LAUNCHER_TEMPLATE, launcher);
    command = [launcher, basename(script), ...argv];
  }
  const result = await execa('node', command, {`,
    `  const result = await execa('node', [script, ...argv], {`,
  ],
];

function contractWithoutLauncherRoutes(source: string): string {
  let text = source;
  for (const [added, original] of LAUNCHER_ROUTE_ADDITIONS) {
    expect(text).toContain(added);
    text = text.replace(added, original);
  }
  return text;
}

interface HookLine {
  event: string;
  matcher: string;
  hook: string;
}

function hookOf(command: string): string {
  return command.replace(/^node "[^"]*\/hooks\/([^"]+)"/, '$1');
}

function flatten(
  hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ command: string }> }>>,
) {
  const lines: HookLine[] = [];
  for (const [event, groups] of Object.entries(hooks)) {
    for (const group of groups) {
      for (const entry of group.hooks) {
        lines.push({ event, matcher: group.matcher ?? '', hook: hookOf(entry.command) });
      }
    }
  }
  return lines;
}

describe('the stage enforcement guardrails', () => {
  it('AC-66: the stage enforcement contract test is unchanged from the base branch apart from the two launcher routes', (ctx) => {
    if (!BASE) return ctx.skip(NO_BASE);
    expect(printedCode(contractWithoutLauncherRoutes(working(CONTRACT)))).toEqual(
      printedCode(atBase(CONTRACT)),
    );
  });

  it('AC-32: the contract runs every case on npm, plugin, launcher then npm and launcher then team copy, from a temp HOME with no network', () => {
    const contract = working(CONTRACT);
    for (const name of ['npm', 'plugin', 'launcher then npm', 'launcher then team copy']) {
      expect(contract).toContain(`name: '${name}'`);
    }
    for (const part of ["'package.json'", "['dist', 'runtime']", 'HOME: launcherHome']) {
      expect(contract).toContain(part);
    }
    expect(contract).not.toMatch(/git clone|https:\/\//);
  });

  it('AC-67: hook events, matchers, commands and order are identical to the base branch apart from the stage seed hook and the appended skill activation entry', (ctx) => {
    if (!BASE) return ctx.skip(NO_BASE);
    const base = JSON.parse(atBase(PLUGIN_HOOKS)) as PluginHooksFile;
    const work = JSON.parse(working(PLUGIN_HOOKS)) as PluginHooksFile;
    const { hooks: baseHooks, ...baseRest } = base;
    const { hooks: workHooks, ...workRest } = work;
    expect(workRest).toEqual(baseRest);
    expect(Object.keys(withoutSeedHook(workHooks))).toEqual(
      Object.keys(withoutSeedHook(baseHooks)),
    );
    expect(withoutSeedHook(workHooks)).toEqual(withoutSeedHook(baseHooks));
    expect(flatten({ [SEED_EVENT]: workHooks[SEED_EVENT] ?? [] })).toEqual([
      { event: SEED_EVENT, matcher: PAQAD_STAGE_HELPER_MATCHER, hook: 'stage-agent-start.mjs' },
    ]);
    expectOnlyTheActivationEntry(workHooks);
    expect(
      Object.keys(workHooks)
        .filter((event) => event !== ACTIVATION_EVENT)
        .at(-1),
    ).toBe('SubagentStop');
    const golden = goldenAsHost(working(GOLDEN));
    expect(ACTIVATION_BLOCK.exec(golden)?.[0]).toContain(ACTIVATION_HOOK);
    expect(golden.replace(SEED_BLOCK, '').replace(ACTIVATION_BLOCK, '')).toBe(
      atBase(GOLDEN).replace(SEED_BLOCK, '').replace(ACTIVATION_BLOCK, ''),
    );
    expect(
      PAQAD_LIVE_HOOKS.filter((spec) => spec.failClosed === true).map((spec) => spec.hookFile),
    ).toEqual(['agent-entry-gate.mjs', 'decision-pause-gate.mjs', 'capability-gate.mjs']);

    const built = mergeNativeHooks({}, buildPluginHookChain()) as {
      hooks: Parameters<typeof flatten>[0];
    };
    expect(built.hooks).toEqual(workHooks);
    const baseLines = flatten(withoutSeedHook(baseHooks));
    expect(flatten(withoutSeedHook(built.hooks))).toEqual(baseLines);

    const host = buildHostHookChain('claude-code')
      .filter((line) => !isActivationLine(line))
      .map((line) => ({
        event: line.nativeEvent,
        matcher: line.matcher ?? '',
        hook: hookOf(line.command),
      }))
      .filter((line) => !line.hook.startsWith('silent-update.mjs') && line.event !== SEED_EVENT);
    const withoutBootstrap = baseLines.filter((line) => line.hook !== PLUGIN_SESSION_START_HOOK);
    const byEvent = (lines: HookLine[]) =>
      [...new Set(lines.map((line) => line.event))].map((event) =>
        lines.filter((line) => line.event === event),
      );
    expect(byEvent(host).sort((a, b) => a[0]!.event.localeCompare(b[0]!.event))).toEqual(
      byEvent(withoutBootstrap).sort((a, b) => a[0]!.event.localeCompare(b[0]!.event)),
    );
  });

  it('AC-67: every host and plugin hook rendering matches the main branch capture apart from the Claude Code seed block and the skill activation entry', async () => {
    const env = { PAQAD_FRAMEWORK_HOME: PINNED.frameworkHome };
    expect(buildHostHookChain('codex-cli', env)).toEqual(PINNED.chains['codex-cli']);
    expect(buildHostHookChain('claude-code', env).filter(notSeed)).toEqual(
      PINNED.chains['claude-code'],
    );
    expect(buildPluginHookChain(env).filter(notSeed)).toEqual(PINNED.plugin);
    expect(
      buildHostHookChain('claude-code', env).filter((line) => line.nativeEvent === SEED_EVENT),
    ).toEqual([seedLine(`${PINNED.frameworkHome}/hooks`)]);
    expect(buildPluginHookChain(env).filter((line) => line.nativeEvent === SEED_EVENT)).toEqual([
      seedLine(`${PLUGIN_RUNTIME_ROOT}/hooks`),
    ]);
    expect(buildHostHookChain('claude-code', env).filter(isActivationLine)).toHaveLength(1);
    expect(buildPluginHookChain(env).filter(isActivationLine)).toHaveLength(1);
    expect(buildHostHookChain('codex-cli', env).filter(isActivationLine)).toEqual([]);

    const rendered = await renderHookFiles();
    expect(Object.keys(rendered).sort()).toEqual(Object.keys(PINNED.files).sort());
    for (const [adapter, files] of Object.entries(PINNED.files)) {
      expect(Object.keys(rendered[adapter]!)).toEqual(Object.keys(files));
      for (const [path, content] of Object.entries(files)) {
        const now = rendered[adapter]![path]!;
        if (adapter !== 'claude-code') {
          expect(now).toBe(content);
          continue;
        }
        const parsed = JSON.parse(teamSettingsAsHost(now, PINNED.frameworkHome)) as {
          hooks: HookGroups;
        };
        const events = Object.keys(parsed.hooks);
        expect(events.indexOf(SEED_EVENT)).toBe(events.indexOf('SubagentStop') - 1);
        expect(flatten({ [SEED_EVENT]: parsed.hooks[SEED_EVENT]! })).toEqual([
          { event: SEED_EVENT, matcher: PAQAD_STAGE_HELPER_MATCHER, hook: 'stage-agent-start.mjs' },
        ]);
        expectOnlyTheActivationEntry(parsed.hooks);
        parsed.hooks = withoutSeedHook(parsed.hooks);
        expect(`${JSON.stringify(parsed, null, 2)}\n`).toBe(content);
      }
    }
  });

  it('AC-67: only the fail-closed gates and the seed hook render a timeout, and only the gates block on failure', () => {
    const env = { PAQAD_FRAMEWORK_HOME: PINNED.frameworkHome };
    const guarded = (chain: RenderedHook[]) =>
      chain
        .filter((line) => line.timeout !== undefined || line.onFailure !== undefined)
        .map((line) => ({
          hook: hookOf(line.command),
          timeout: line.timeout,
          onFailure: line.onFailure,
        }));
    expect(guarded(buildHostHookChain('claude-code', env))).toEqual([
      { hook: 'agent-entry-gate.mjs', timeout: 10, onFailure: 'block' },
      { hook: 'decision-pause-gate.mjs', timeout: 10, onFailure: 'block' },
      { hook: 'capability-gate.mjs pre-mutation', timeout: 10, onFailure: 'block' },
      { hook: 'stage-agent-start.mjs', timeout: 10, onFailure: undefined },
    ]);
    expect(guarded(buildHostHookChain('codex-cli', env))).toEqual([]);
    expect(guarded(buildPluginHookChain(env))).toEqual([
      { hook: 'stage-agent-start.mjs', timeout: 10, onFailure: undefined },
    ]);
    expect(
      PAQAD_LIVE_HOOKS.filter((spec) => spec.timeoutSec !== undefined).map((spec) => [
        spec.id,
        spec.timeoutSec,
        spec.failClosed === true,
      ]),
    ).toEqual([
      ['agent-entry-gate', 10, true],
      ['decision-pause-gate', 10, true],
      ['capability-gate-pre-mutation', 10, true],
      ['stage-agent-start', 10, false],
    ]);
  });

  it('AC-67: the hook source comparison ignores comments and issue references and catches any code change', () => {
    const source = [
      "const MATCHER = 'Edit|Write';",
      'const pattern = /^node "([^"]+)"/u;',
      'const label = `hook ${MATCHER} at ${pattern.source}`;',
      'export const total = 4 / 2;',
    ].join('\n');
    const commented = [
      '/** The matcher every edit gate uses. */',
      "const MATCHER = 'Edit|Write'; // gate",
      'const pattern = /^node "([^"]+)"/u;',
      '',
      'const label = `hook ${MATCHER} at ${pattern.source}`;',
      '/* the total */ export const total = 4 / 2;',
    ].join('\n');
    const strip = { stripIssueRefs: true };
    const described = (text: string) => `const description = '${text}';`;
    const plain = printedCode(described('Block mutating tools while a packet is open.'), strip);
    expect(printedCode(commented)).toEqual(printedCode(source));
    expect(printedCode(source.replace("'Edit|Write'", "'Edit|Write|Bash'"))).not.toEqual(
      printedCode(source),
    );
    expect(printedCode(source.replace('([^"]+)', '([^"]*)'))).not.toEqual(printedCode(source));
    expect(printedCode(source.replace('hook ${', 'gate ${'))).not.toEqual(printedCode(source));
    expect(printedCode(source.replace('4 / 2', '4 / 3'))).not.toEqual(printedCode(source));
    const tagged = [
      `Block mutating tools while a packet is open (${ticketRef(117)} C-3).`,
      `Block mutating tools while a packet is open (${ticketRef(567)}, ${ticketRef(581)}).`,
      `Block mutating tools while a packet is open ${ticketRef(336)}.`,
    ];
    for (const text of tagged) {
      expect(printedCode(described(text), strip)).toEqual(plain);
      expect(printedCode(described(text))).not.toEqual(printedCode(described(text), strip));
    }
    expect(
      printedCode(described(`Inject the context block (Part 0, ${ticketRef(336)}).`), strip),
    ).toEqual(printedCode(described('Inject the context block (Part 0).'), strip));
    expect(
      printedCode(described('Block mutating tools while a packet is shut.'), strip),
    ).not.toEqual(plain);
    expect(
      printedCode(
        described(`Block mutating tools (${ticketRef(117)}) while a packet is open.`),
        strip,
      ),
    ).toEqual(plain);
    expect(printedCode(source.replace("'Edit|Write'", "'Edit|Write|Bash'"), strip)).not.toEqual(
      printedCode(source, strip),
    );
  });

  describe('AC-68', () => {
    const DISABLED_MOD = '../../../runtime/hooks/lib/paqad-disabled.mjs';
    afterEach(() => {
      vi.doUnmock(DISABLED_MOD);
      vi.resetModules();
      vi.restoreAllMocks();
    });

    it('AC-68: a throwing edit gate blocks with exit 2', async () => {
      vi.resetModules();
      vi.doMock(DISABLED_MOD, async (importOriginal) => ({
        ...((await importOriginal()) as Record<string, unknown>),
        resolveProjectRoot: () => {
          throw new Error('injected fault');
        },
      }));
      vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const { main } = (await import('../../../runtime/hooks/capability-gate.mjs')) as {
        main: (input: string, seam: string) => Promise<number>;
      };
      expect(await main('{}', 'pre-mutation')).toBe(2);

      const gateTest = working('tests/unit/hooks/gate-fail-closed.test.ts');
      const gates = PAQAD_LIVE_HOOKS.filter((spec) => spec.failClosed === true);
      expect(gates.length).toBeGreaterThan(0);
      for (const spec of gates) {
        expect(gateTest).toContain(`runtime/hooks/${spec.hookFile}`);
      }
      expect(gateTest.match(/toBe\(2\)/g)?.length ?? 0).toBeGreaterThanOrEqual(gates.length);
    });
  });

  it('AC-71: plugin validate and plugin test run in CI over terminal and desktop', () => {
    const pkg = JSON.parse(working('package.json')) as { scripts: Record<string, string> };
    const ci = pkg.scripts.ci!.split('&&').map((step) => step.trim());
    expect(ci).toContain('pnpm run plugin:validate');
    expect(ci).toContain('pnpm run plugin:test');
    expect(ci.indexOf('pnpm run plugin:validate')).toBeGreaterThan(ci.indexOf('pnpm run build'));
    expect(pkg.scripts['plugin:validate']).toBe('node scripts/validate-plugin.mjs');
    expect(pkg.scripts['plugin:test']).toBe('node scripts/test-plugin.mjs');
    const register = working('runtime/claude-plugin/mod/register.test.ts');
    expect(register).toContain("const SURFACES = ['terminal', 'desktop'] as const;");
    expect(register).toMatch(/for \(const surface of SURFACES\)/);
  });
});

const CLI = join(REPO, 'dist/cli/index.js');
const STOP = join(REPO, 'runtime/hooks/verification-completion.mjs');
const SUBAGENT_STOP = join(REPO, 'runtime/hooks/stage-agent-completion.mjs');

const temps: string[] = [];
afterEach(() => {
  while (temps.length > 0) rmSync(temps.pop()!, { recursive: true, force: true });
});

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-guardrail-'));
  temps.push(root);
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(join(root, '.paqad/framework-path.txt'), '~/.paqad-ai/current\n');
  return root;
}

function block(path: string): void {
  rmSync(path, { recursive: true, force: true });
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'keep'), 'x');
}

function hooksLogOf(root: string): string {
  const log = join(root, '.paqad/logs/hooks.log');
  return existsSync(log) ? readFileSync(log, 'utf8') : '';
}

function hook(file: string, root: string, payload: Record<string, unknown>) {
  return execa('node', [file], {
    input: JSON.stringify({ cwd: root, ...payload }),
    env: { PAQAD_PROJECT_ROOT: root, CLAUDE_PROJECT_DIR: root },
    reject: false,
  });
}

async function faultLeavesHookUnchanged(
  file: string,
  root: string,
  payload: Record<string, unknown>,
  inject: () => void,
  logged: RegExp,
): Promise<void> {
  const healthy = await hook(file, root, payload);
  expect(hooksLogOf(root)).not.toMatch(logged);
  inject();
  const faulted = await hook(file, root, payload);
  expect(faulted.exitCode).toBe(healthy.exitCode);
  expect(faulted.stdout).toBe(healthy.stdout);
  expect(faulted.stderr).not.toMatch(logged);
  expect(hooksLogOf(root)).toMatch(logged);
}

describe('AC-69', () => {
  const SES = 'ses_guardrail';

  async function stageAgentChange(): Promise<{ root: string; bundle: string; agent: string }> {
    const root = scratch();
    await execa(
      'node',
      [CLI, 'stage', 'start', 'planning', '--title', 'ord501', '--issue', '501'],
      {
        cwd: root,
        env: { SE_SESSION: SES },
        reject: false,
      },
    );
    const evidence = join(root, '.paqad/ledger/feature-evidence');
    const name = readdirSync(evidence).find((entry) => entry !== '_session')!;
    const stamp = new Date().toISOString();
    const agent = join(root, 'transcripts/agent.jsonl');
    mkdirSync(dirname(agent), { recursive: true });
    writeFileSync(
      agent,
      `${JSON.stringify({
        type: 'assistant',
        timestamp: stamp,
        message: {
          id: 'g1',
          model: 'claude-opus-5-5',
          role: 'assistant',
          content: [{ type: 'text', text: 'done' }],
          usage: { input_tokens: 10, output_tokens: 20 },
        },
      })}\n`,
    );
    return { root, bundle: join(evidence, name), agent };
  }

  it('AC-69: a failing high-table row, snapshot or AC-map write inside a hook leaves exit code and output unchanged and is logged to hooks.log', async () => {
    const seat = await stageAgentChange();
    const seatPayload = {
      session_id: 'sub_guardrail',
      hook_event_name: 'SubagentStop',
      agent_id: 'agent_qa',
      agent_type: 'paqad-expert',
      agent_transcript_path: writeSeatTranscript(
        join(seat.root, 'subagents'),
        'qa',
        'paqad-ai spec pipeline experts brief qa-engineer',
        [{ input: 4, output: 310, cacheRead: 1200, cacheWrite: 700 }],
      ),
    };
    await faultLeavesHookUnchanged(
      SUBAGENT_STOP,
      seat.root,
      seatPayload,
      () => block(join(seat.bundle, 'high-table.jsonl')),
      /stage-agent-completion: high-table usage not recorded/,
    );

    const stage = await stageAgentChange();
    const stagePayload = {
      session_id: SES,
      hook_event_name: 'SubagentStop',
      agent_id: 'agent_dev',
      agent_type: 'paqad-development',
      agent_transcript_path: stage.agent,
    };
    await faultLeavesHookUnchanged(
      SUBAGENT_STOP,
      stage.root,
      stagePayload,
      () => block(join(stage.bundle, 'cost.json')),
      /stage-agent-completion: cost not recorded/,
    );
    await faultLeavesHookUnchanged(
      SUBAGENT_STOP,
      stage.root,
      stagePayload,
      () => block(hudSnapshotPath(stage.root, SES)),
      /hud-snapshot \(hook:stage-agent-completion\): not written/,
    );

    const root = scratch();
    seedGitChangedFiles(root, []);
    const dir = openChange(root, SES);
    writeSpec(root, dir, [{ id: 'AC-1', proof: 'automated' }]);
    expect(existsSync(join(root, featureFilePath(dir, 'specification')))).toBe(true);
    const mapFile = join(root, '.paqad/traceability/map.json');
    await faultLeavesHookUnchanged(
      STOP,
      root,
      { session_id: SES, hook_event_name: 'Stop' },
      () => {
        expect(existsSync(mapFile)).toBe(true);
        block(mapFile);
      },
      /verification: could not write the acceptance-criteria map/,
    );
  }, 120_000);
});
