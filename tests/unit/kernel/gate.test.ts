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

import { afterEach, describe, expect, it } from 'vitest';

import { hudLastBlockPath } from '@/hud/files.js';
import { markRuleStopAllowedOnce, readRuleStopRecord } from '@/hud/last-block.js';
import { ALLOW_ONCE_REASON, runCapabilityGate } from '@/kernel/gate.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import { writeWorkflowState } from '@/pipeline/workflow-state.js';
import { startStage } from '@/stage-evidence/recorder.js';
import { assembleMap, scanAndEmbedIds } from '@/rule-scripts/analyzer.js';
import { applyRuleScriptMap } from '@/rule-scripts/apply.js';
import { upsertScriptEntry } from '@/rule-scripts/mutate.js';

import { entryLoadedProbe } from '../../../runtime/hooks/capability-gate.mjs';
import { seedGitChangedFiles } from '../pipeline/changed-files.fixture.js';

function markFeatureDevelopment(root: string, session: string): string {
  const sessionId = resolveSessionId(root, session);
  writeWorkflowState(root, sessionId, { active: { workflow: 'feature-development' }, paused: [] });
  startStage(root, 'development', { sessionId, adapter: 'claude-code' });
  return session;
}

const MAP_REL = 'docs/instructions/rules/rule-script-map.yml';
const SCRIPT_REL = '.paqad/scripts/rules/coding/q/001-no-debugger.mjs';
const LOCK_REL = '.paqad/capability-lock.json';

const roots: string[] = [];

function write(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, 'utf8');
}

const SCRIPT = `// @paqad-rule-script
// rule_id: __RID__
// source: docs/instructions/rules/coding/q.md
// kind: deterministic
// scope: changed-files
// runtime: node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
for (const f of files) {
  const t = readFileSync(join(projectRoot, f), 'utf8');
  if (/\\bdebugger\\b/.test(t)) findings.push({ file: f, line: 1, message: 'debugger statement', severity: 'blocker' });
}
process.stdout.write(JSON.stringify({ rule_id: '__RID__', kind: 'deterministic', findings }));
`;

function setup(mode: 'off' | 'warn' | 'strict', targetBody: string): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-kernel-gate-'));
  roots.push(root);
  write(join(root, 'docs/instructions/rules/coding/q.md'), '- No debugger statements.\n');
  const scan = scanAndEmbedIds(root);
  const ruleId = scan.inventory[0].id;
  const scriptRel = '.paqad/scripts/rules/coding/q/001-no-debugger.mjs';
  write(join(root, scriptRel), SCRIPT.replaceAll('__RID__', ruleId));
  let map = assembleMap(
    scan.inventory,
    new Map([[ruleId, { id: ruleId, verifiability: { kind: 'deterministic' }, enforced_by: [] }]]),
    scan.rule_files_hash,
    null,
  );
  map = upsertScriptEntry(map, ruleId, {
    path: scriptRel,
    kind: 'deterministic',
    runtime: 'node',
    scope: 'changed-files',
    last_validated_at: '2026-05-29T00:00:00Z',
    fixtures_passed: true,
  });
  applyRuleScriptMap({
    projectRoot: root,
    map,
    via: 'test',
    event: { action: 'generate', rule_ids: [ruleId] },
  });
  write(join(root, '.paqad/configs/.config.policy'), `rule_compliance=${mode}\nstages_mode=off\n`);
  write(join(root, 'src/app.ts'), targetBody);
  return root;
}

function setupChanged(mode: 'off' | 'warn' | 'strict', targetBody: string): string {
  const root = setup(mode, targetBody);
  seedGitChangedFiles(root, ['src/app.ts']);
  return root;
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop()!, { recursive: true, force: true });
  }
});

describe('runCapabilityGate', () => {
  it('blocks a scripted-rule violation under strict at the pre-mutation seam', async () => {
    const root = setupChanged('strict', 'function f() {\n  debugger;\n}\n');
    const result = await runCapabilityGate({ projectRoot: root, seam: 'pre-mutation' });
    expect(result.block).toBe(true);
    expect(result.summary).toContain('Needs your attention');
  });

  it('also evaluates the rule-scripts capability at the completion seam (feature-development route)', async () => {
    const root = setup('strict', 'debugger;\n');
    const session = markFeatureDevelopment(root, 'sess-completion');
    seedGitChangedFiles(root, ['src/app.ts']);
    const result = await runCapabilityGate({
      projectRoot: root,
      seam: 'completion',
      payload: { sessionId: session },
    });
    expect(result.block).toBe(true);
    expect(result.summary).toContain('Needs your attention');
  });

  it('skips rule-scripts at the completion seam on a clean tree — no whole-tree block', async () => {
    const root = setup('strict', 'debugger;\n');
    const session = markFeatureDevelopment(root, 'sess-clean-tree');
    const result = await runCapabilityGate({
      projectRoot: root,
      seam: 'completion',
      payload: { sessionId: session },
    });
    expect(result.block).toBe(false);
  });

  it('skips rule-scripts at the completion seam when the session did not route to feature-development', async () => {
    const root = setup('strict', 'debugger;\n');
    const sessionId = resolveSessionId(root, 'sess-question');
    writeWorkflowState(root, sessionId, { active: { workflow: 'project-question' }, paused: [] });
    const result = await runCapabilityGate({
      projectRoot: root,
      seam: 'completion',
      payload: { sessionId: 'sess-question' },
    });
    expect(result.block).toBe(false);
    expect(result.summary).toBe('');
  });

  it('skips rule-scripts at completion for a session routed to feature-development that owns no change', async () => {
    const root = setup('strict', 'debugger;\n');
    const sessionId = resolveSessionId(root, 'sess-misrouted');
    writeWorkflowState(root, sessionId, {
      active: { workflow: 'feature-development', lane: 'fast' },
      paused: [],
    });
    const result = await runCapabilityGate({
      projectRoot: root,
      seam: 'completion',
      payload: { sessionId: 'sess-misrouted' },
    });
    expect(result.block).toBe(false);
    expect(result.summary).toBe('');
  });

  it('skips rule-scripts at completion for an owner on a detour that edited nothing this turn', async () => {
    const root = setup('strict', 'debugger;\n');
    const sessionId = resolveSessionId(root, 'sess-paused');
    startStage(root, 'development', {
      sessionId,
      adapter: 'claude-code',
      now: () => new Date('2026-03-01T09:00:00.000Z'),
    });
    writeWorkflowState(root, sessionId, {
      active: { workflow: 'project-question' },
      paused: [{ workflow: 'feature-development' }],
      turn_started_at: '2026-03-01T10:00:00.000Z',
    });
    const result = await runCapabilityGate({
      projectRoot: root,
      seam: 'completion',
      payload: { sessionId: 'sess-paused' },
    });
    expect(result.block).toBe(false);
  });

  it('skips rule-scripts at the pre-mutation seam for a docs-only edit', async () => {
    const root = setupChanged('strict', 'debugger;\n');
    const result = await runCapabilityGate({
      projectRoot: root,
      seam: 'pre-mutation',
      payload: { targetPath: 'docs/guide.md' },
    });
    expect(result.block).toBe(false);
    expect(result.summary).toBe('');
  });

  it('surfaces a warn finding without blocking', async () => {
    const root = setupChanged('warn', 'debugger;\n');
    const result = await runCapabilityGate({ projectRoot: root, seam: 'pre-mutation' });
    expect(result.block).toBe(false);
    expect(result.summary).toContain('Heads up');
  });

  it('is a clean no-op when a strict scan finds no violation (map present, ran but empty)', async () => {
    const root = setupChanged('strict', 'export const x = 1;\n');
    const result = await runCapabilityGate({ projectRoot: root, seam: 'pre-mutation' });
    expect(result.block).toBe(false);
    expect(result.summary).toBe('');
  });

  it('says "none armed" at the completion seam when no rule-scripts are armed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-kernel-gate-unarmed-'));
    roots.push(root);
    write(join(root, 'docs/instructions/rules/coding/q.md'), '- No debugger statements.\n');
    const scan = scanAndEmbedIds(root);
    const ruleId = scan.inventory[0].id;
    const map = assembleMap(
      scan.inventory,
      new Map([
        [ruleId, { id: ruleId, verifiability: { kind: 'deterministic' }, enforced_by: [] }],
      ]),
      scan.rule_files_hash,
      null,
    );
    applyRuleScriptMap({
      projectRoot: root,
      map,
      via: 'test',
      event: { action: 'generate', rule_ids: [ruleId] },
    });
    write(join(root, '.paqad/configs/.config.policy'), 'rule_compliance=strict\nstages_mode=off\n');
    const session = markFeatureDevelopment(root, 'sess-unarmed');
    const result = await runCapabilityGate({
      projectRoot: root,
      seam: 'completion',
      payload: { sessionId: session },
    });
    expect(result.block).toBe(false);
    expect(result.summary).toContain('none armed');
  });

  it('stays silent about "none armed" at the pre-mutation seam (no nagging every edit)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-kernel-gate-unarmed-pre-'));
    roots.push(root);
    write(join(root, 'docs/instructions/rules/coding/q.md'), '- No debugger statements.\n');
    const scan = scanAndEmbedIds(root);
    const ruleId = scan.inventory[0].id;
    const map = assembleMap(
      scan.inventory,
      new Map([
        [ruleId, { id: ruleId, verifiability: { kind: 'deterministic' }, enforced_by: [] }],
      ]),
      scan.rule_files_hash,
      null,
    );
    applyRuleScriptMap({
      projectRoot: root,
      map,
      via: 'test',
      event: { action: 'generate', rule_ids: [ruleId] },
    });
    write(join(root, '.paqad/configs/.config.policy'), 'rule_compliance=strict\nstages_mode=off\n');
    write(join(root, 'src/app.ts'), 'export const x = 1;\n');
    const result = await runCapabilityGate({
      projectRoot: root,
      seam: 'pre-mutation',
      payload: { targetPath: 'src/app.ts' },
    });
    expect(result.block).toBe(false);
    expect(result.summary).toBe('');
  });

  it('clamps a local rule_compliance=off below the strict team floor (cannot weaken)', async () => {
    const root = setupChanged('strict', 'debugger;\n');
    write(join(root, '.paqad/.config'), 'rule_compliance=off\n');
    const result = await runCapabilityGate({ projectRoot: root, seam: 'pre-mutation' });
    expect(result.block).toBe(true);
  });

  it('does not block when the team floors rule_compliance to off', async () => {
    const root = setupChanged('off', 'debugger;\n');
    const result = await runCapabilityGate({ projectRoot: root, seam: 'pre-mutation' });
    expect(result.block).toBe(false);
    expect(result.summary).toBe('');
  });

  it('is a clean no-op when the project has no rule-script map', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-kernel-gate-nomap-'));
    roots.push(root);
    write(join(root, '.paqad/configs/.config.policy'), 'stages_mode=off\n');
    const result = await runCapabilityGate({ projectRoot: root, seam: 'pre-mutation' });
    expect(result.block).toBe(false);
    expect(result.summary).toBe('');
  });

  it('writes the capability lock when the engine applies the map', () => {
    const root = setup('strict', 'export const x = 1;\n');
    const lock = JSON.parse(readFileSync(join(root, LOCK_REL), 'utf8')) as {
      capabilities: Record<string, { digest: string }>;
    };
    expect(typeof lock.capabilities['rule-scripts'].digest).toBe('string');
    expect(lock.capabilities['rule-scripts'].digest.length).toBeGreaterThan(0);
  });

  it('blocks under strict when a script is hand-edited outside the engine (tamper)', async () => {
    const root = setupChanged('strict', 'export const x = 1.0;\n');
    appendFileSync(join(root, SCRIPT_REL), '\n// hand-edit that the engine never blessed\n');
    const result = await runCapabilityGate({ projectRoot: root, seam: 'pre-mutation' });
    expect(result.block).toBe(true);
    expect(result.summary).toContain('changed outside the engine');
  });

  it('surfaces tamper without blocking under warn (map hand-edited)', async () => {
    const root = setupChanged('warn', 'export const x = 1;\n');
    const mapPath = join(root, MAP_REL);
    writeFileSync(
      mapPath,
      readFileSync(mapPath, 'utf8').replace('fixtures_passed: true', 'fixtures_passed: false'),
    );
    const result = await runCapabilityGate({ projectRoot: root, seam: 'pre-mutation' });
    expect(result.block).toBe(false);
    expect(result.summary).toContain('changed outside the engine');
    expect(result.summary).toContain('warn mode');
  });

  it('surfaces an advisory (never blocks) when the bindings have no lock yet', async () => {
    const root = setupChanged('strict', 'export const x = 1;\n');
    rmSync(join(root, LOCK_REL), { force: true });
    const result = await runCapabilityGate({ projectRoot: root, seam: 'pre-mutation' });
    expect(result.block).toBe(false);
    expect(result.summary).toContain('not yet attested');
  });

  it('a real violation still blocks when the lock is intact (no false tamper)', async () => {
    const root = setupChanged('strict', 'debugger;\n');
    const result = await runCapabilityGate({ projectRoot: root, seam: 'pre-mutation' });
    expect(result.block).toBe(true);
    expect(result.summary).toContain('Needs your attention');
    expect(result.summary).not.toContain('changed outside the engine');
  });

  it('refuses cleanly (no block) when the project was blessed by a newer paqad', async () => {
    const root = setupChanged('strict', 'debugger;\n');
    const lockPath = join(root, LOCK_REL);
    const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as {
      capabilities: Record<string, { policy_version: number }>;
    };
    lock.capabilities['rule-scripts'].policy_version += 1;
    writeFileSync(lockPath, JSON.stringify(lock), 'utf8');

    const result = await runCapabilityGate({ projectRoot: root, seam: 'pre-mutation' });
    expect(result.block).toBe(false);
    expect(result.summary).toContain('framework update pending');
  });
});

describe('runCapabilityGate rule-stop record', () => {
  const PAYLOAD = {
    sessionId: 'sess-stop',
    toolUseId: 'tu_9',
    toolInput: { old_string: 'a', new_string: 'b' },
  };

  it('writes the rule, title, file and tool use id on a rule-script deny', async () => {
    const root = setupChanged('strict', 'function f() {\n  debugger;\n}\n');
    const result = await runCapabilityGate({
      projectRoot: root,
      seam: 'pre-mutation',
      env: {},
      payload: PAYLOAD,
      entryLoaded: () => true,
    });
    expect(result.block).toBe(true);
    const record = readRuleStopRecord(root, 'sess-stop');
    expect(record).toMatchObject({
      title: 'No debugger statements.',
      file: 'src/app.ts',
      tool_use_id: 'tu_9',
      managed: false,
      sole: true,
      diff: '- a\n+ b',
      used: false,
    });
    expect(record?.rule).toMatch(/^RL-/);
  });

  it('marks the record not sole when another capability also blocks the same call', async () => {
    const root = setupChanged('strict', 'debugger;\n');
    write(join(root, '.paqad/configs/.config.policy'), 'rule_compliance=strict\n');
    const result = await runCapabilityGate({
      projectRoot: root,
      seam: 'pre-mutation',
      env: {},
      payload: PAYLOAD,
    });
    expect(result.block).toBe(true);
    expect(result.summary).toContain('planning');
    expect(readRuleStopRecord(root, 'sess-stop')).toMatchObject({ sole: false, used: false });
  });

  function hookInput(agentId?: string): string {
    return JSON.stringify({
      session_id: 'sess-stop',
      tool_name: 'Edit',
      ...(agentId ? { agent_id: agentId } : {}),
    });
  }

  async function stopFor(root: string, input: string) {
    const result = await runCapabilityGate({
      projectRoot: root,
      seam: 'pre-mutation',
      env: {},
      payload: PAYLOAD,
      entryLoaded: entryLoadedProbe(root, input),
    });
    return { result, record: readRuleStopRecord(root, 'sess-stop') };
  }

  it('marks a subagent stop sole when that subagent loaded the framework itself', async () => {
    const root = setupChanged('strict', 'debugger;\n');
    write(join(root, '.paqad/.agent-entry-loaded.d/sess-stop'), '{}\n');
    write(join(root, '.paqad/session/agent-entry/agent-a1'), '{}\n');
    const { result, record } = await stopFor(root, hookInput('agent-a1'));
    expect(result.block).toBe(true);
    expect(record).toMatchObject({ sole: true, used: false });
  });

  it('keeps a subagent stop not sole when only the main session loaded the framework', async () => {
    const root = setupChanged('strict', 'debugger;\n');
    write(join(root, '.paqad/.agent-entry-loaded.d/sess-stop'), '{}\n');
    const { result, record } = await stopFor(root, hookInput('agent-a1'));
    expect(result.block).toBe(true);
    expect(record).toMatchObject({ sole: false, used: false });
  });

  it('marks a main-session stop sole only while its session sentinel is in place', async () => {
    const root = setupChanged('strict', 'debugger;\n');
    const missing = await stopFor(root, hookInput());
    expect(missing.result.block).toBe(true);
    expect(missing.record?.sole).toBe(false);
    write(join(root, '.paqad/.agent-entry-loaded.d/sess-stop'), '{}\n');
    const fresh = await stopFor(root, hookInput());
    expect(fresh.record?.sole).toBe(true);
  });

  it('keeps the deny and marks the stop not sole when the entry check throws', async () => {
    const root = setupChanged('strict', 'debugger;\n');
    const plain = await runCapabilityGate({
      projectRoot: root,
      seam: 'pre-mutation',
      env: {},
      payload: PAYLOAD,
      entryLoaded: () => true,
    });
    const thrown = await runCapabilityGate({
      projectRoot: root,
      seam: 'pre-mutation',
      env: {},
      payload: PAYLOAD,
      entryLoaded: () => {
        throw new Error('stat failed');
      },
    });
    expect(thrown).toEqual(plain);
    expect(readRuleStopRecord(root, 'sess-stop')?.sole).toBe(false);
  });

  it('marks the stop not sole when the caller gives no entry check', async () => {
    const root = setupChanged('strict', 'debugger;\n');
    await runCapabilityGate({ projectRoot: root, seam: 'pre-mutation', env: {}, payload: PAYLOAD });
    expect(readRuleStopRecord(root, 'sess-stop')?.sole).toBe(false);
  });

  it('marks the record managed on the managed route', async () => {
    const root = setupChanged('strict', 'debugger;\n');
    await runCapabilityGate({
      projectRoot: root,
      seam: 'pre-mutation',
      env: { PAQAD_MANAGED: '1' },
      payload: PAYLOAD,
    });
    expect(readRuleStopRecord(root, 'sess-stop')?.managed).toBe(true);
  });

  it('clears the record once an edit is allowed again', async () => {
    const root = setupChanged('strict', 'debugger;\n');
    await runCapabilityGate({ projectRoot: root, seam: 'pre-mutation', env: {}, payload: PAYLOAD });
    expect(readRuleStopRecord(root, 'sess-stop')).not.toBeNull();
    write(join(root, 'src/app.ts'), 'export const x = 1;\n');
    const allowed = await runCapabilityGate({
      projectRoot: root,
      seam: 'pre-mutation',
      env: {},
      payload: PAYLOAD,
    });
    expect(allowed.block).toBe(false);
    expect(readRuleStopRecord(root, 'sess-stop')).toBeNull();
  });

  it('writes nothing without a session id', async () => {
    const root = setupChanged('strict', 'debugger;\n');
    await runCapabilityGate({ projectRoot: root, seam: 'pre-mutation', env: {} });
    expect(existsSync(join(root, '.paqad/session/hud'))).toBe(false);
  });

  it('keeps the gate result identical and logs one line when the record cannot be written', async () => {
    const healthy = setupChanged('strict', 'debugger;\n');
    const expected = await runCapabilityGate({
      projectRoot: healthy,
      seam: 'pre-mutation',
      env: {},
      payload: PAYLOAD,
    });
    const root = setupChanged('strict', 'debugger;\n');
    write(join(root, '.paqad/session/hud'), 'not a directory');
    const result = await runCapabilityGate({
      projectRoot: root,
      seam: 'pre-mutation',
      env: {},
      payload: PAYLOAD,
    });
    expect(result).toEqual(expected);
    const log = readFileSync(join(root, '.paqad/logs/hooks.log'), 'utf8').trim().split('\n');
    expect(log).toHaveLength(1);
    expect(log[0]).toMatch(/rule-stop record not written: E[A-Z]+ /);
    expect(log[0]).not.toContain('- a');
  });
});

describe('runCapabilityGate allowed once', () => {
  const PAYLOAD = {
    sessionId: 'sess-once',
    toolUseId: 'tu_1',
    toolInput: { old_string: 'a', new_string: 'b' },
  };

  function gate(root: string, overrides: Partial<Parameters<typeof runCapabilityGate>[0]> = {}) {
    return runCapabilityGate({
      projectRoot: root,
      seam: 'pre-mutation',
      env: {},
      payload: PAYLOAD,
      entryLoaded: () => true,
      ...overrides,
    });
  }

  async function allowedOnceRoot(policy?: string): Promise<string> {
    const root = setupChanged('strict', 'debugger;\n');
    if (policy) write(join(root, '.paqad/configs/.config.policy'), policy);
    expect((await gate(root)).block).toBe(true);
    markRuleStopAllowedOnce(root, readRuleStopRecord(root, 'sess-once')!);
    return root;
  }

  function hooksLog(root: string): string {
    const path = join(root, '.paqad/logs/hooks.log');
    return existsSync(path) ? readFileSync(path, 'utf8') : '';
  }

  it('AC-7: answers ask once for the exact call, consumes the mark and blocks the same call after', async () => {
    const root = await allowedOnceRoot();
    const marked = readRuleStopRecord(root, 'sess-once')!;
    const result = await gate(root);
    expect(result).toMatchObject({ block: false, ask: ALLOW_ONCE_REASON, summary: '' });
    expect(readRuleStopRecord(root, 'sess-once')).toEqual({ ...marked, allowed_once: false });
    expect(hooksLog(root)).toContain(`allowed once: asked for ${marked.rule} on src/app.ts`);
    expect(hooksLog(root)).toContain('tool_use_id tu_1');
    const again = await gate(root);
    expect(again.block).toBe(true);
    expect(again.ask).toBeUndefined();
  });

  it('AC-8: a leftover mark never answers another tool_use_id or a call with none', async () => {
    for (const payload of [
      { ...PAYLOAD, toolUseId: 'tu_2' },
      { ...PAYLOAD, toolUseId: undefined },
    ]) {
      const root = await allowedOnceRoot();
      const result = await gate(root, { payload });
      expect(result.block).toBe(true);
      expect(result.ask).toBeUndefined();
      expect(hooksLog(root)).not.toContain('allowed once');
    }
  });

  it('AC-8: a mark for another rule or file is not consumed', async () => {
    for (const change of [{ rule: 'RL-other' }, { file: 'src/other.ts' }]) {
      const root = await allowedOnceRoot();
      const record = readRuleStopRecord(root, 'sess-once')!;
      markRuleStopAllowedOnce(root, { ...record, ...change });
      const result = await gate(root);
      expect(result.block).toBe(true);
      expect(result.ask).toBeUndefined();
      expect(hooksLog(root)).not.toContain('allowed once');
    }
  });

  it('AC-9: two blocking capabilities or two violations never answer ask', async () => {
    const twoGates = await allowedOnceRoot('rule_compliance=strict\n');
    const both = await gate(twoGates);
    expect(both.block).toBe(true);
    expect(both.ask).toBeUndefined();

    const twoFiles = await allowedOnceRoot();
    write(join(twoFiles, 'src/b.ts'), 'debugger;\n');
    seedGitChangedFiles(twoFiles, ['src/app.ts', 'src/b.ts']);
    const two = await gate(twoFiles);
    expect(two.block).toBe(true);
    expect(two.ask).toBeUndefined();
    expect(hooksLog(twoGates) + hooksLog(twoFiles)).not.toContain('allowed once');
  });

  it('AC-9: paqad managed mode and a Codex hook never answer ask', async () => {
    for (const overrides of [
      { env: { PAQAD_MANAGED: '1' } },
      { payload: { ...PAYLOAD, adapter: 'codex-cli' } },
    ]) {
      const root = await allowedOnceRoot();
      const result = await gate(root, overrides);
      expect(result.block).toBe(true);
      expect(result.ask).toBeUndefined();
      expect(hooksLog(root)).not.toContain('allowed once');
    }
    const claude = await allowedOnceRoot();
    expect((await gate(claude, { payload: { ...PAYLOAD, adapter: 'claude-code' } })).ask).toBe(
      ALLOW_ONCE_REASON,
    );
  });

  it('AC-9: a missing, unparseable or pre-change record blocks', async () => {
    const root = setupChanged('strict', 'debugger;\n');
    expect((await gate(root)).ask).toBeUndefined();
    const path = hudLastBlockPath(root, 'sess-once');
    const record = readRuleStopRecord(root, 'sess-once')!;
    const preChange: Record<string, unknown> = { ...record, used: true };
    delete preChange.allowed_once;
    for (const text of ['{not json', JSON.stringify(preChange)]) {
      writeFileSync(path, text);
      const result = await gate(root);
      expect(result.block).toBe(true);
      expect(result.ask).toBeUndefined();
    }
  });

  it('AC-10: two gate runs for the same call at once answer ask at most once', async () => {
    const root = await allowedOnceRoot();
    const results = await Promise.all([gate(root), gate(root), gate(root)]);
    expect(results.filter((result) => result.ask === ALLOW_ONCE_REASON)).toHaveLength(1);
    expect(results.filter((result) => result.block)).toHaveLength(2);
  });
});
