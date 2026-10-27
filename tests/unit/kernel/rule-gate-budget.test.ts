import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { RULE_GATE_BUDGET_CONTEXT } from '@/kernel/capability.js';
import { runCapabilityGate } from '@/kernel/gate.js';
import { writeWorkflowState } from '@/pipeline/workflow-state.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import { assembleMap, scanAndEmbedIds } from '@/rule-scripts/analyzer.js';
import { applyRuleScriptMap } from '@/rule-scripts/apply.js';
import { upsertScriptEntry } from '@/rule-scripts/mutate.js';
import { hasPendingPreMutation, pendingPreMutationPaths } from '@/rule-scripts/pending-marker.js';
import { runRuleScripts, runRuleScriptsAsync } from '@/rule-scripts/runner.js';
import { startStage } from '@/stage-evidence/recorder.js';

import { seedGitChangedFiles } from '../pipeline/changed-files.fixture.js';
import {
  GOLDEN_CHANGED_FILES,
  GOLDEN_NOW,
  buildGoldenProject,
} from '../../shared/rule-script-golden.js';

const roots: string[] = [];
const SESSION = 'sess-budget';
const BUDGET_MS = 6000;
const SCRIPT_REL = '.paqad/scripts/rules/coding/gate/001-no-debugger.mjs';

function write(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, 'utf8');
}

function policy(root: string, lines: string[]): void {
  write(
    join(root, '.paqad/configs/.config.policy'),
    ['rule_compliance=strict', 'stages_mode=off', ...lines, ''].join('\n'),
  );
}

function gateScript(ruleId: string, body: string): string {
  return [
    '// @paqad-rule-script',
    `// rule_id: ${ruleId}`,
    '// source: docs/instructions/rules/coding/gate.md',
    '// kind: deterministic',
    '// scope: changed-files',
    '// runtime: node',
    "import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';",
    "import { join } from 'node:path';",
    "const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));",
    "appendFileSync(join(projectRoot, 'ran.log'), 'ran\\n');",
    body,
    'const findings = [];',
    'for (const file of files) {',
    "  if (/debugger/.test(readFileSync(join(projectRoot, file), 'utf8'))) findings.push({ file, line: 1, message: 'debugger', severity: 'blocker' });",
    '}',
    `const done = () => process.stdout.write(JSON.stringify({ rule_id: '${ruleId}', kind: 'deterministic', findings }));`,
    "if (existsSync(join(projectRoot, 'slow.flag'))) {",
    "  writeFileSync(join(projectRoot, 'slow.pid'), String(process.pid));",
    '  setTimeout(done, 20000);',
    '} else done();',
    '',
  ].join('\n');
}

function gateProject(target = 'debugger;\n', extraBody = '', lines: string[] = []): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-rule-gate-'));
  roots.push(root);
  write(join(root, 'docs/instructions/rules/coding/gate.md'), '- No debugger.\n');
  const scanned = scanAndEmbedIds(root);
  const ruleId = scanned.inventory[0]!.id;
  write(join(root, SCRIPT_REL), gateScript(ruleId, extraBody));
  const map = upsertScriptEntry(
    assembleMap(
      scanned.inventory,
      new Map([
        [ruleId, { id: ruleId, verifiability: { kind: 'deterministic' }, enforced_by: [] }],
      ]),
      scanned.rule_files_hash,
      null,
    ),
    ruleId,
    {
      path: SCRIPT_REL,
      kind: 'deterministic',
      runtime: 'node',
      scope: 'changed-files',
      last_validated_at: '2026-10-27T00:00:00Z',
      fixtures_passed: true,
    },
  );
  applyRuleScriptMap({
    projectRoot: root,
    map,
    via: 'test',
    event: { action: 'generate', rule_ids: [ruleId] },
  });
  policy(root, lines);
  write(join(root, 'src/app.ts'), target);
  seedGitChangedFiles(root, ['src/app.ts']);
  return root;
}

function preEdit(
  root: string,
  extra: { startedAt?: number; now?: () => number; session?: string } = {},
) {
  return runCapabilityGate({
    projectRoot: root,
    seam: 'pre-mutation',
    env: {},
    payload: { sessionId: extra.session ?? SESSION, targetPath: join(root, 'src/app.ts') },
    ...(extra.startedAt === undefined ? {} : { startedAt: extra.startedAt }),
    ...(extra.now ? { now: extra.now } : {}),
  });
}

function turnEnd(root: string, session = SESSION) {
  return runCapabilityGate({
    projectRoot: root,
    seam: 'completion',
    env: {},
    payload: { sessionId: session },
  });
}

function ownFeatureChange(root: string): void {
  const sessionId = resolveSessionId(root, SESSION);
  writeWorkflowState(root, sessionId, { active: { workflow: 'feature-development' }, paused: [] });
  startStage(root, 'development', { sessionId, adapter: 'claude-code' });
}

function nearlySpent(): number {
  return Date.now() - (BUDGET_MS - 300);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

afterEach(() => {
  vi.useRealTimers();
  while (roots.length > 0) {
    rmSync(roots.pop()!, { recursive: true, force: true });
  }
});

describe('pre-edit rule gate seams', () => {
  it('AC-23: under strict a deterministic changed-files finding refuses the edit', async () => {
    const root = buildGoldenProject('paqad-gate-ac23-');
    roots.push(root);
    policy(root, []);
    seedGitChangedFiles(root, [...GOLDEN_CHANGED_FILES]);
    const result = await preEdit(root);
    expect(result.block).toBe(true);
    expect(result.summary).toContain('debugger statement');
  });

  it('AC-25: the pre-edit run is filtered to deterministic changed-files and the turn-end run is not', async () => {
    const root = buildGoldenProject('paqad-gate-ac25-');
    roots.push(root);
    policy(root, []);
    write(join(root, 'src/app.ts'), 'export const app = 1;\n');
    ownFeatureChange(root);
    seedGitChangedFiles(root, [...GOLDEN_CHANGED_FILES]);
    await preEdit(root);
    const preReport = JSON.parse(
      readFileSync(join(root, PATHS.RULE_SCRIPTS_PRE_MUTATION_REPORT), 'utf8'),
    ) as { filter: unknown; results: Array<{ kind: string }> };
    expect(preReport.filter).toEqual({ kinds: ['deterministic'], scopes: ['changed-files'] });
    expect(existsSync(join(root, PATHS.RULE_SCRIPTS_REPORT))).toBe(false);

    await turnEnd(root);
    const full = JSON.parse(readFileSync(join(root, PATHS.RULE_SCRIPTS_REPORT), 'utf8')) as {
      filter?: unknown;
      results: Array<{ kind: string }>;
    };
    expect(full.filter).toBeUndefined();
    expect(full.results.map((result) => result.kind)).toContain('heuristic');
  });

  it('AC-24: a failing whole-tree deterministic script does not stop the edit but blocks the turn end', async () => {
    const root = buildGoldenProject('paqad-gate-ac24-');
    roots.push(root);
    policy(root, []);
    write(join(root, 'src/app.ts'), 'export const app = 1;\n');
    ownFeatureChange(root);
    seedGitChangedFiles(root, ['src/app.ts']);
    expect((await preEdit(root)).block).toBe(false);

    const end = await turnEnd(root);
    expect(end.block).toBe(true);
    expect(end.summary).toContain('fixme marker');
  });

  it('AC-39: rule_gate_pre_edit=all with concurrency 1 runs the full set in map order, as the serial runner does', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(GOLDEN_NOW));
    const root = buildGoldenProject('paqad-gate-ac39-');
    roots.push(root);
    policy(root, ['rule_gate_pre_edit=all', 'rule_gate_concurrency=1']);
    seedGitChangedFiles(root, [...GOLDEN_CHANGED_FILES]);
    await preEdit(root);
    expect(readFileSync(join(root, PATHS.RULE_SCRIPTS_REPORT), 'utf8')).toBe(
      readFileSync(join(process.cwd(), 'tests/fixtures/rule-scripts/golden-report.json'), 'utf8'),
    );
    expect(existsSync(join(root, PATHS.RULE_SCRIPTS_PRE_MUTATION_REPORT))).toBe(false);
  });
});

describe('pre-edit rule gate budget', () => {
  it('AC-30: past the budget the edit is allowed, the scripts are killed and the turn end blocks', async () => {
    const root = gateProject();
    write(join(root, 'slow.flag'), '');
    const edit = await preEdit(root, { startedAt: nearlySpent() });
    expect(edit.block).toBe(false);
    expect(edit.context.split('\n')).toContain(RULE_GATE_BUDGET_CONTEXT);
    expect(hasPendingPreMutation(root, SESSION)).toBe(true);
    const pid = Number(readFileSync(join(root, 'slow.pid'), 'utf8'));
    expect(isAlive(pid)).toBe(false);
    expect(existsSync(join(root, PATHS.RULE_SCRIPTS_PRE_MUTATION_REPORT))).toBe(false);

    rmSync(join(root, 'slow.flag'));
    const end = await turnEnd(root);
    expect(end.block).toBe(true);
    expect(end.summary).toContain('debugger');
    expect(hasPendingPreMutation(root, SESSION)).toBe(false);
    expect(readFileSync(join(root, 'src/app.ts'), 'utf8')).toBe('debugger;\n');
  });

  it('clears the marker after a turn end that finds nothing', async () => {
    const root = gateProject('export const ok = 1;\n');
    write(join(root, 'slow.flag'), '');
    expect((await preEdit(root, { startedAt: nearlySpent() })).block).toBe(false);
    rmSync(join(root, 'slow.flag'));
    expect((await turnEnd(root)).block).toBe(false);
    expect(hasPendingPreMutation(root, SESSION)).toBe(false);
  });

  it('AC-31: the budget is counted from the hook start the caller passes, read through the injected clock', async () => {
    const root = gateProject('export const ok = 1;\n');
    const hookStart = 1_000_000;
    const spent = await preEdit(root, { startedAt: hookStart, now: () => hookStart + BUDGET_MS });
    expect(spent.context).toContain(RULE_GATE_BUDGET_CONTEXT);
    expect(existsSync(join(root, 'ran.log'))).toBe(false);

    const fresh = await preEdit(root, {
      startedAt: hookStart,
      now: () => hookStart + BUDGET_MS - 5000,
    });
    expect(fresh.context).not.toContain(RULE_GATE_BUDGET_CONTEXT);
    expect(existsSync(join(root, 'ran.log'))).toBe(true);
  });

  it('AC-32: a pending marker makes the turn end run the checks even when the session would be skipped', async () => {
    const root = gateProject();
    write(join(root, 'slow.flag'), '');
    await preEdit(root, { startedAt: nearlySpent() });
    rmSync(join(root, 'slow.flag'));
    const sessionId = resolveSessionId(root, SESSION);
    writeWorkflowState(root, sessionId, { active: { workflow: 'project-question' }, paused: [] });
    const end = await turnEnd(root);
    expect(end.block).toBe(true);
    expect(readFileSync(join(root, 'src/app.ts'), 'utf8')).toBe('debugger;\n');
  });

  it('AC-33: deleting the marker file does not skip the turn-end checks', async () => {
    const root = gateProject();
    write(join(root, 'slow.flag'), '');
    await preEdit(root, { startedAt: nearlySpent() });
    rmSync(join(root, 'slow.flag'));
    rmSync(pendingPreMutationPaths(root, SESSION)[0]!);
    const end = await turnEnd(root);
    expect(end.block).toBe(true);
    expect(hasPendingPreMutation(root, SESSION)).toBe(false);
  });

  it('AC-34: a marker from an interrupted turn is still enforced at the next turn end', async () => {
    const root = gateProject();
    write(join(root, 'slow.flag'), '');
    await preEdit(root, { startedAt: nearlySpent() });
    rmSync(join(root, 'slow.flag'));
    const sessionId = resolveSessionId(root, SESSION);
    writeWorkflowState(root, sessionId, {
      active: { workflow: 'project-question' },
      paused: [],
      turn_started_at: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(hasPendingPreMutation(root, SESSION)).toBe(true);
    expect((await turnEnd(root)).block).toBe(true);
  });

  it("AC-35: one session's marker never blocks another session's turn end", async () => {
    const root = gateProject();
    write(join(root, 'slow.flag'), '');
    await preEdit(root, { startedAt: nearlySpent(), session: 'sess-a' });
    rmSync(join(root, 'slow.flag'));
    const other = await turnEnd(root, 'sess-b');
    expect(other.block).toBe(false);
    expect(hasPendingPreMutation(root, 'sess-a')).toBe(true);
    expect((await turnEnd(root, 'sess-a')).block).toBe(true);
  });

  it('AC-36: a marker that cannot be written refuses the edit', async () => {
    const root = gateProject();
    write(join(root, PATHS.RULE_SCRIPTS_PENDING_DIR), 'not a directory');
    write(join(root, 'slow.flag'), '');
    const edit = await preEdit(root, { startedAt: nearlySpent() });
    expect(edit.block).toBe(true);
    expect(edit.summary).toContain('could not record');
    expect(readFileSync(join(root, PATHS.LOGS_DIR, 'hooks.log'), 'utf8')).toMatch(
      new RegExp(`pending-unwritable [A-Z]+ session=${SESSION} files=1`),
    );
  });

  it('AC-36: a crash or malformed output keeps the serial outcome and never takes the budget path', async () => {
    for (const body of [
      "throw new Error('kaboom');",
      "process.stdout.write('nope'); process.exit(0);",
    ]) {
      const root = gateProject('debugger;\n', body);
      const edit = await preEdit(root);
      const serial = runRuleScripts({
        projectRoot: root,
        mode: 'strict',
        changedFiles: ['src/app.ts'],
      });
      expect(edit.block).toBe(serial.blocking);
      expect(serial.results[0]!.skipped).toMatch(/^error: /);
      expect(edit.context).not.toContain(RULE_GATE_BUDGET_CONTEXT);
      expect(hasPendingPreMutation(root, SESSION)).toBe(false);
    }
  });

  it("AC-36: a script's own timeout reads as an error, not as an aborted run", async () => {
    const root = gateProject();
    write(join(root, 'slow.flag'), '');
    const report = await runRuleScriptsAsync({
      projectRoot: root,
      mode: 'strict',
      changedFiles: ['src/app.ts'],
      scriptTimeoutMs: 200,
    });
    expect(report.aborted).toBeUndefined();
    expect(report.results[0]!.skipped).toBe('error: script timed out after 200ms');
  });

  it('AC-36: a tampered script still blocks before the budget is considered', async () => {
    const root = gateProject('export const ok = 1;\n');
    appendFileSync(join(root, SCRIPT_REL), '\n');
    const edit = await preEdit(root, { startedAt: 0 });
    expect(edit.block).toBe(true);
    expect(edit.summary).toContain('edited outside paqad');
    expect(hasPendingPreMutation(root, SESSION)).toBe(false);
  });

  it('AC-37: under rule_gate_pre_edit=all the budget still allows the edit with the marker', async () => {
    const root = gateProject('debugger;\n', '', ['rule_gate_pre_edit=all']);
    write(join(root, 'slow.flag'), '');
    const edit = await preEdit(root, { startedAt: nearlySpent() });
    expect(edit.block).toBe(false);
    expect(edit.context).toContain(RULE_GATE_BUDGET_CONTEXT);
    expect(hasPendingPreMutation(root, SESSION)).toBe(true);
  });

  it('AC-38: bad gate settings fall back to the defaults and the gate still decides', async () => {
    const root = gateProject();
    policy(root, ['rule_gate_budget_ms=abc', 'rule_gate_concurrency=x', 'rule_gate_pre_edit=some']);
    const edit = await preEdit(root);
    expect(edit.block).toBe(true);
    expect(existsSync(join(root, PATHS.RULE_SCRIPTS_PRE_MUTATION_REPORT))).toBe(true);
    policy(root, ['rule_gate_budget_ms=0', 'rule_gate_concurrency=0']);
    expect((await preEdit(root, { startedAt: Date.now() - 5000 })).block).toBe(true);
    policy(root, ['rule_gate_budget_ms=-1']);
    expect((await preEdit(root)).block).toBe(true);
  });

  it('logs the budget exhaustion with only a reason, the session and a file count', async () => {
    const root = gateProject();
    write(join(root, 'slow.flag'), '');
    await preEdit(root, { startedAt: nearlySpent() });
    const log = readFileSync(join(root, PATHS.LOGS_DIR, 'hooks.log'), 'utf8');
    expect(log).toMatch(
      new RegExp(`capability-gate rule-scripts budget-exhausted session=${SESSION} files=1\\n$`),
    );
  });
});
