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
  PLUGIN_SESSION_START_HOOK,
  buildHostHookChain,
  buildPluginHookChain,
} from '@/adapters/shared/paqad-hooks.js';
import { mergeNativeHooks } from '@/adapters/shared/native-hook-config.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import { hudSnapshotPath } from '@/hud/files.js';

import { printedCode } from '../../shared/printed-code.js';
import { ticketRef } from '../../shared/ticket-ref.js';
import { seedGitChangedFiles } from '../pipeline/changed-files.fixture.js';
import { writeSeatTranscript } from '../spec-pipeline/high-table.fixture.js';
import { openChange, writeSpec } from '../traceability/change-map.fixture.js';

// Issue #639, guardrails (INV-1 to INV-5, NFR-2): the stage enforcement every change relies on
// is left exactly as the base branch shipped it, and nothing #639 added to a hook can change
// what that hook decides or prints.

const REPO = process.cwd();
const CONTRACT = 'tests/e2e/stage-enforcement-contract.e2e.test.ts';
const PLUGIN_HOOKS = 'runtime/claude-plugin/hooks.json';
const HOOKS_SOURCE = 'src/adapters/shared/paqad-hooks.ts';

/** The merge base with origin/main, or null when this checkout has no origin/main. */
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

interface HookLine {
  event: string;
  matcher: string;
  hook: string;
}

/** The hook file and its arguments, with whatever install root precedes its `hooks/` dir. */
function hookOf(command: string): string {
  return command.replace(/^node "[^"]*\/hooks\/([^"]+)"/, '$1');
}

/** A hooks.json `hooks` object as one ordered list of (event, matcher, hook). */
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

describe('the stage enforcement guardrails (#639)', () => {
  it('AC-66: the stage enforcement contract test is unchanged from the base branch', (ctx) => {
    if (!BASE) return ctx.skip(NO_BASE);
    expect(working(CONTRACT)).toBe(atBase(CONTRACT));
  });

  it('AC-67: hook events, matchers, commands and order are identical to the base branch', (ctx) => {
    if (!BASE) return ctx.skip(NO_BASE);
    const baseText = atBase(PLUGIN_HOOKS);
    expect(working(PLUGIN_HOOKS)).toBe(baseText);
    const strip = { stripIssueRefs: true };
    expect(printedCode(working(HOOKS_SOURCE), strip)).toEqual(
      printedCode(atBase(HOOKS_SOURCE), strip),
    );

    const base = JSON.parse(baseText) as { hooks: Parameters<typeof flatten>[0] };
    // The plugin chain the builder renders today is the base file's chain, entry for entry.
    const built = mergeNativeHooks({}, buildPluginHookChain()) as {
      hooks: Parameters<typeof flatten>[0];
    };
    expect(built.hooks).toEqual(base.hooks);
    const baseLines = flatten(base.hooks);
    expect(flatten(built.hooks)).toEqual(baseLines);

    // The npm install's Claude chain is the same chain under its own root: same events,
    // matchers, hook files, arguments and order, less the plugin's bootstrap and plus the npm
    // copy's self-updater.
    const host = buildHostHookChain('claude-code')
      .map((line) => ({
        event: line.nativeEvent,
        matcher: line.matcher ?? '',
        hook: hookOf(line.command),
      }))
      .filter((line) => !line.hook.startsWith('silent-update.mjs'));
    const withoutBootstrap = baseLines.filter((line) => line.hook !== PLUGIN_SESSION_START_HOOK);
    const byEvent = (lines: HookLine[]) =>
      [...new Set(lines.map((line) => line.event))].map((event) =>
        lines.filter((line) => line.event === event),
      );
    expect(byEvent(host).sort((a, b) => a[0]!.event.localeCompare(b[0]!.event))).toEqual(
      byEvent(withoutBootstrap).sort((a, b) => a[0]!.event.localeCompare(b[0]!.event)),
    );
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

      // Every fail-closed edit gate the chain renders is driven the same way by the gate test.
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

// ── AC-69: a failed record-only write inside a hook ─────────────────────────────

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

/** Make `path` unwritable as a file by putting a non-empty directory there. */
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

/** Run a hook healthy, inject the fault, run it again: same exit code and stdout, one log line. */
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
    // The High Table row: a seat's SubagentStop with high-table.jsonl unwritable.
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

    // The cost write and the HUD snapshot (which carries the High Table and the cost): a stage
    // agent's SubagentStop with cost.json and the session's snapshot file unwritable.
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

    // The acceptance-criteria map: the Stop verification with a frozen spec and the map file
    // unwritable. The map is still built in memory, so the verdict and its output do not move.
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
