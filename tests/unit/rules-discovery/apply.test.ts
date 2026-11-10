import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DecisionStore } from '@/planning/decision-store.js';
import { applyRuleScriptMap } from '@/rule-scripts/apply.js';
import { assembleMap, scanAndEmbedIds, type RuleClassification } from '@/rule-scripts/analyzer.js';
import { loadRuleScriptMap } from '@/rule-scripts/map.js';
import { reconcileRuleScripts } from '@/rule-scripts/reconciler.js';
import { parseRuleMarker, parseRuleMarkerRun } from '@/rule-scripts/rule-id.js';
import {
  ApplyRefusedError,
  applyProposal,
  applyReport,
  readApplyJournal,
  scriptableOffer,
  traceDiscoveredRule,
} from '@/rules-discovery/apply.js';
import { readBaseline } from '@/rules-discovery/baseline.js';
import { listUnjudgedDecisions } from '@/rules-discovery/decisions.js';
import { atomicWriteJson } from '@/rules-discovery/files.js';
import { proposeStep, reviewStep, signoffStep } from '@/rules-discovery/flow.js';
import { RULES_DISCOVERY_BASELINE, absRunFile, runFilePath } from '@/rules-discovery/paths.js';
import { readProposal, type ProposalRow, type Verdict } from '@/rules-discovery/proposal.js';
import { readRun, updateRun } from '@/rules-discovery/run-store.js';
import { NOT_NOW, SIGN_OFF } from '@/rules-discovery/signoff.js';

import { NOW, RULE_FILE, flowProject, type FlowProject } from './flow-fixtures.js';

const NEW_FILE = 'docs/instructions/rules/project/validation.md';
let current: FlowProject | null = null;

afterEach(() => {
  current?.project.dispose();
  current = null;
});

function withMap(fp: FlowProject): void {
  const scan = scanAndEmbedIds(fp.project.root);
  const classes = new Map<string, RuleClassification>(
    scan.inventory.map((item) => [
      item.id,
      { id: item.id, verifiability: { kind: 'heuristic' as const }, enforced_by: [] },
    ]),
  );
  applyRuleScriptMap({
    projectRoot: fp.project.root,
    map: assembleMap(scan.inventory, classes, scan.rule_files_hash, null),
    via: 'test',
    event: { action: 'analyze', rule_ids: scan.inventory.map((item) => item.id) },
  });
}

interface SignedRunExtras {
  verdictOf?: (row: ProposalRow) => Verdict;
  fromDecisions?: unknown;
}

function signedRun(
  choice: string | null = SIGN_OFF,
  judgements?: unknown,
  extras: SignedRunExtras = {},
): FlowProject {
  const fp = flowProject();
  current = fp;
  withMap(fp);
  if (judgements !== undefined) {
    atomicWriteJson(absRunFile(fp.project.root, fp.runId, 'judgements'), judgements);
  }
  if (extras.fromDecisions !== undefined) {
    atomicWriteJson(absRunFile(fp.project.root, fp.runId, 'fromDecisions'), extras.fromDecisions);
  }
  proposeStep(fp.project.root, fp.runId, NOW);
  for (const row of readProposal(fp.project.root, fp.runId)!.rows) {
    reviewStep(
      fp.project.root,
      fp.runId,
      row.row_id,
      extras.verdictOf?.(row) ?? (row.change === 'conflict' ? 'take_new' : 'keep'),
    );
  }
  const { decision_id } = signoffStep(fp.project.root, fp.runId, NOW);
  if (choice === null) return fp;
  new DecisionStore(fp.project.root).resolve({
    decisionId: decision_id,
    humanResponse: {
      chosen_option_key: choice,
      intent: 'explicit',
      explanation_rounds_used: 0,
      responded_at: NOW.toISOString(),
      responded_by: 'human',
      carry_over_scope: 'none',
    },
  });
  return fp;
}

function packet(fp: FlowProject, id: string): Record<string, unknown> {
  return JSON.parse(fp.read(`.paqad/decisions/resolved/${id}.json`)) as Record<string, unknown>;
}

function runStep(fp: FlowProject): string | null {
  const run = readRun(fp.project.root, fp.runId);
  return run.state === 'ok' ? run.record.step : null;
}

describe('rules discovery apply', () => {
  it('AC-37 INV-1 apply refuses a not_now sign-off and writes nothing', () => {
    const fp = signedRun(NOT_NOW);
    const before = fp.read(RULE_FILE);
    expect(() => applyProposal(fp.project.root, fp.runId, { now: NOW })).toThrow(/not now/);
    expect(fp.read(RULE_FILE)).toBe(before);
    expect(existsSync(join(fp.project.root, RULES_DISCOVERY_BASELINE))).toBe(false);
  });

  it('AC-37 INV-1 apply refuses while the rules.proposal sign-off is still pending', () => {
    const fp = signedRun(null);
    const before = fp.read(RULE_FILE);
    expect(() => applyProposal(fp.project.root, fp.runId, { now: NOW })).toThrow(ApplyRefusedError);
    expect(() => applyProposal(fp.project.root, fp.runId, { now: NOW })).toThrow(/is pending/);
    expect(fp.read(RULE_FILE)).toBe(before);
    expect(existsSync(join(fp.project.root, NEW_FILE))).toBe(false);
    expect(existsSync(join(fp.project.root, RULES_DISCOVERY_BASELINE))).toBe(false);
    expect(runStep(fp)).toBe('sign_off');
  });

  it('AC-38 apply refuses when proposal.json changed after sign-off', () => {
    const fp = signedRun();
    const path = absRunFile(fp.project.root, fp.runId, 'proposal');
    writeFileSync(path, readFileSync(path, 'utf8').replace('zod schemas', 'zod parsers'));
    const before = fp.read(RULE_FILE);
    expect(() => applyProposal(fp.project.root, fp.runId, { now: NOW })).toThrow(ApplyRefusedError);
    expect(() => applyProposal(fp.project.root, fp.runId, { now: NOW })).toThrow(/hash differs/);
    expect(fp.read(RULE_FILE)).toBe(before);
    expect(existsSync(join(fp.project.root, NEW_FILE))).toBe(false);
    expect(packet(fp, 'D-2').rules_discovery).toBeUndefined();
  });

  it('AC-40 AC-41 AC-50 adds, edits and archives rules, each marked with the run', () => {
    const fp = signedRun();
    const report = applyProposal(fp.project.root, fp.runId, { now: NOW });
    expect(report).toMatchObject({ added: 2, changed: 1, removed: 1, refused: [] });
    const rules = fp.read(RULE_FILE);
    expect(rules).toContain(`- Log every request with a request id <!-- @rule `);
    expect(rules).not.toContain('obey me');
    expect(rules).not.toContain('RL-ffff');
    expect(rules).toMatch(/- Return errors as plain text\. <!-- @rule RL-cccc discovered:rd-/);
    expect(rules).not.toContain('moment');
    expect(fp.read(NEW_FILE)).toMatch(/^- Parse untrusted input with zod schemas\. <!-- @rule RL-/);
    const written = [...rules.split('\n'), ...fp.read(NEW_FILE).split('\n')].filter(
      (line) => parseRuleMarkerRun(line) !== null,
    );
    expect(written).toHaveLength(3);
    expect(written.every((line) => parseRuleMarkerRun(line) === fp.runId)).toBe(true);
    const map = loadRuleScriptMap(fp.project.root)!;
    expect(map.archived?.map((rule) => rule.id)).toEqual(['RL-bbbb']);
    expect(map.rules.find((rule) => rule.id === 'RL-cccc')?.text).toBe(
      'Return errors as plain text.',
    );
  });

  it('AC-42 AC-43 tags source decisions in place and skips them next time', () => {
    const fp = signedRun();
    expect(listUnjudgedDecisions(fp.project.root).map((d) => d.id)).toEqual(['D-1', 'D-2', 'D-3']);
    applyProposal(fp.project.root, fp.runId, { now: NOW });
    const logged = fp
      .read(RULE_FILE)
      .split('\n')
      .find((line) => line.includes('request id'))!;
    expect(packet(fp, 'D-2').rules_discovery).toMatchObject({
      status: 'absorbed',
      run_id: fp.runId,
      rule_id: parseRuleMarker(logged),
    });
    expect(packet(fp, 'D-1').rules_discovery).toMatchObject({
      status: 'absorbed',
      rule_id: 'RL-aaaa',
    });
    expect(packet(fp, 'D-3').rules_discovery).toMatchObject({
      status: 'not-a-rule',
      reason: 'one file only',
    });
    expect(packet(fp, 'D-3').status).toBe('resolved');
    expect(listUnjudgedDecisions(fp.project.root)).toEqual([]);
  });

  it('AC-45 says how many rules a script could check and offers rule-analyzer', () => {
    const fp = signedRun();
    const report = applyProposal(fp.project.root, fp.runId, { now: NOW });
    expect(report.scriptable).toBe(1);
    expect(scriptableOffer(report)).toBe(
      '1 new or changed rule could be checked by a script. Say "analyze rules" to turn them into checks with rule-analyzer.',
    );
    expect(scriptableOffer({ ...report, scriptable: 0 })).toBeNull();
  });

  it('AC-46 moves the baseline to this run and the run on to docs', () => {
    const fp = signedRun();
    applyProposal(fp.project.root, fp.runId, { now: NOW });
    const baseline = readBaseline(fp.project.root)!;
    expect(baseline.inventory).toBe(runFilePath(fp.runId, 'inventory'));
    expect(baseline.packages.map((p) => p.name).sort()).toEqual(['hono', 'zod']);
    expect(runStep(fp)).toBe('docs');
  });

  it('AC-47 AC-48 a failed write leaves whole files, stays at apply, and a rerun finishes once', () => {
    const fp = signedRun();
    expect(() =>
      applyProposal(fp.project.root, fp.runId, {
        now: NOW,
        beforeWrite: (what) => {
          if (what === 'tag:D-1') throw new Error('disk full');
        },
      }),
    ).toThrow(/disk full/);
    expect(runStep(fp)).toBe('apply');
    expect(existsSync(join(fp.project.root, RULES_DISCOVERY_BASELINE))).toBe(false);
    expect(fp.read(RULE_FILE).endsWith('\n')).toBe(true);
    const firstTag = packet(fp, 'D-2').rules_discovery;
    expect(firstTag).toBeDefined();

    const report = applyProposal(fp.project.root, fp.runId, {
      now: new Date('2026-11-02T00:00:00Z'),
    });
    expect(report).toMatchObject({ added: 2, changed: 1, removed: 1, tagged: 3 });
    expect(fp.read(RULE_FILE).match(/request id/g)).toHaveLength(1);
    expect(fp.read(NEW_FILE).match(/zod/g)).toHaveLength(1);
    expect(packet(fp, 'D-2').rules_discovery).toEqual(firstTag);
    expect(runStep(fp)).toBe('docs');
  });

  it('AC-47 a failed rule write stops before the baseline moves and the rerun skips done rows', () => {
    const fp = signedRun();
    let calls = 0;
    expect(() =>
      applyProposal(fp.project.root, fp.runId, {
        now: NOW,
        beforeWrite: (what) => {
          if (what.startsWith('rule:') && ++calls === 2) throw new Error('write failed');
        },
      }),
    ).toThrow(/write failed/);
    expect(runStep(fp)).toBe('apply');
    expect(readBaseline(fp.project.root)).toBeNull();
    applyProposal(fp.project.root, fp.runId, { now: NOW });
    expect(fp.read(RULE_FILE).match(/request id/g)).toHaveLength(1);
  });

  it('AC-49 the reconciler sees no added or removed rule after apply', () => {
    const fp = signedRun();
    applyProposal(fp.project.root, fp.runId, { now: NOW });
    const codes = reconcileRuleScripts(fp.project.root).findings.map((f) => f.code);
    expect(codes).not.toContain('RS-RULE-ADDED');
    expect(codes).not.toContain('RS-RULE-REMOVED');
  });

  it('AC-51 INV-8 refuses rows whose topic is not a slug or whose target leaves the rules folder', () => {
    const fp = signedRun(SIGN_OFF, {
      ideas: [
        { idea_id: 'RI-zod-1', outcome: 'new', target: null, topic: 'Bad Topic!', check: 'script' },
        { idea_id: 'DI-2', outcome: 'new', target: 'docs/instructions/rules/../../../evil.md' },
        { idea_id: 'RI-hono-1', outcome: 'new', target: 'docs/instructions/rules/coding/api.txt' },
      ],
    });
    const report = applyProposal(fp.project.root, fp.runId, { now: NOW });
    expect(report.refused.map((row) => row.row_id)).toHaveLength(3);
    expect(report.added).toBe(0);
    expect(existsSync(join(fp.project.root, 'evil.md'))).toBe(false);
    expect(existsSync(join(fp.project.root, 'docs/instructions/rules/project'))).toBe(false);
    expect(fp.read(RULE_FILE)).not.toContain('request id');
  });

  it('AC-69 an applied rule traces back to its run sources and sign-off decision', () => {
    const fp = signedRun();
    applyProposal(fp.project.root, fp.runId, { now: NOW });
    const line = fp.read(NEW_FILE).split('\n')[0]!;
    const trace = traceDiscoveredRule(fp.project.root, parseRuleMarker(line)!)!;
    const run = readRun(fp.project.root, fp.runId);
    expect(trace).toMatchObject({
      run_id: fp.runId,
      signoff_decision: run.state === 'ok' ? run.record.signoff_decision : 'x',
      sources: [
        { id: 'S-1', origin: 'https://zod.dev/', verified: '2026-10-01', date: '2026-10-01' },
      ],
    });
    expect(traceDiscoveredRule(fp.project.root, 'RL-aaaa')).toBeNull();
  });
});

describe('AC-5 rules discovery apply edges', () => {
  it('AC-5: refuses a run whose run.json is gone', () => {
    const fp = signedRun();
    rmSync(absRunFile(fp.project.root, fp.runId, 'run'));
    expect(() => applyProposal(fp.project.root, fp.runId, { now: NOW })).toThrow(
      /has a missing run\.json; nothing was written/,
    );
  });

  it('AC-5: refuses a run that already moved past apply', () => {
    const fp = signedRun();
    applyProposal(fp.project.root, fp.runId, { now: NOW });
    expect(() => applyProposal(fp.project.root, fp.runId, { now: NOW })).toThrow(
      /is open at docs; apply needs a run waiting at sign-off/,
    );
  });

  it('AC-5: refuses a run that lost its sign-off decision', () => {
    const fp = signedRun();
    const run = readRun(fp.project.root, fp.runId);
    if (run.state !== 'ok') throw new Error('run not readable');
    updateRun(fp.project.root, fp.runId, run.record.revision, { signoff_decision: null }, NOW);
    expect(() => applyProposal(fp.project.root, fp.runId, { now: NOW })).toThrow(
      /has no sign-off decision; nothing was written/,
    );
  });

  it('AC-5: an edit whose rule left the file is refused and a removal of a gone rule is noted', () => {
    const fp = signedRun();
    const path = join(fp.project.root, RULE_FILE);
    writeFileSync(
      path,
      readFileSync(path, 'utf8')
        .split('\n')
        .filter((line) => !line.includes('RL-cccc') && !line.includes('RL-bbbb'))
        .join('\n'),
    );
    const report = applyProposal(fp.project.root, fp.runId, { now: NOW });
    expect(report.changed).toBe(0);
    expect(report.refused).toEqual([
      expect.objectContaining({ why: 'rule RL-cccc is no longer on disk' }),
    ]);
    const journal = readApplyJournal(fp.project.root, fp.runId);
    expect(Object.values(journal.rows)).toContainEqual({
      write: 'remove',
      rule_id: 'RL-bbbb',
      why: 'already removed',
    });
  });

  it('AC-5: a rerun finds a rule it wrote before its journal entry was lost', () => {
    const fp = signedRun();
    expect(() =>
      applyProposal(fp.project.root, fp.runId, {
        now: NOW,
        beforeWrite: (what) => {
          if (what === 'tag:D-1') throw new Error('disk full');
        },
      }),
    ).toThrow(/disk full/);
    const journal = readApplyJournal(fp.project.root, fp.runId);
    const added = Object.entries(journal.rows).filter(([, row]) => row.write === 'add');
    for (const [rowId] of added) delete journal.rows[rowId];
    atomicWriteJson(absRunFile(fp.project.root, fp.runId, 'apply'), journal);
    const report = applyProposal(fp.project.root, fp.runId, { now: NOW });
    expect(report.added).toBe(2);
    expect(fp.read(RULE_FILE).match(/request id/g)).toHaveLength(1);
    expect(fp.read(NEW_FILE).match(/zod/g)).toHaveLength(1);
    const again = readApplyJournal(fp.project.root, fp.runId);
    for (const [rowId, row] of added) expect(again.rows[rowId]?.rule_id).toBe(row.rule_id);
  });

  it('AC-5: a broken journal reads as empty and a refused row without a reason says refused', () => {
    const fp = signedRun();
    writeFileSync(absRunFile(fp.project.root, fp.runId, 'apply'), '{"rows": null}');
    const journal = readApplyJournal(fp.project.root, fp.runId);
    expect(journal).toEqual({
      schema_version: 1,
      run_id: fp.runId,
      rows: {},
      tagged: [],
      finished_at: null,
    });
    const proposal = readProposal(fp.project.root, fp.runId)!;
    const first = proposal.rows[0]!.row_id;
    const report = applyReport(
      proposal,
      { ...journal, rows: { [first]: { write: 'refused', rule_id: null } } },
      null,
    );
    expect(report.refused).toEqual([{ row_id: first, why: 'refused' }]);
  });

  it('AC-5: tracing an id no rule file carries finds nothing', () => {
    const fp = signedRun();
    expect(traceDiscoveredRule(fp.project.root, 'RL-0000')).toBeNull();
  });
});

describe('AC-5 rules discovery apply verdicts and tags', () => {
  it('AC-5: dropped rows are skipped, keep their rule id, and tag no decision', () => {
    const fp = signedRun(SIGN_OFF, undefined, {
      verdictOf: (row) => (row.change === 'conflict' ? 'keep_existing' : 'drop'),
    });
    const report = applyProposal(fp.project.root, fp.runId);
    expect(report).toMatchObject({ added: 0, changed: 0, removed: 0, refused: [] });
    const journal = readApplyJournal(fp.project.root, fp.runId);
    const skipped = Object.values(journal.rows).filter((row) => row.write === 'skip');
    expect(skipped.map((row) => row.rule_id).sort()).toEqual(
      [null, null, 'RL-bbbb', 'RL-cccc'].sort(),
    );
    expect(packet(fp, 'D-2').rules_discovery).toBeUndefined();
    expect(packet(fp, 'D-1').rules_discovery).toMatchObject({ rule_id: 'RL-aaaa' });
    expect(fp.read(RULE_FILE)).toContain('RL-bbbb');
  });

  it('AC-5: a decision tagged by a written row is not retagged by a fold or a not-a-rule entry', () => {
    const fp = signedRun(SIGN_OFF, undefined, {
      fromDecisions: {
        ideas: [
          {
            idea_id: 'DI-1',
            text: 'Validate request bodies at the route boundary.',
            why: 'twice',
            source_decisions: ['D-1', 'D-2'],
            scope: 'project',
          },
          {
            idea_id: 'DI-2',
            text: 'Log every request with a request id',
            why: 'ops',
            source_decisions: ['D-2'],
            scope: 'project',
          },
        ],
        not_rules: [{ id: 'D-2', reason: 'one file only' }],
      },
    });
    applyProposal(fp.project.root, fp.runId, { now: NOW });
    const logged = fp
      .read(RULE_FILE)
      .split('\n')
      .find((line) => line.includes('request id'))!;
    expect(packet(fp, 'D-2').rules_discovery).toMatchObject({
      status: 'absorbed',
      rule_id: parseRuleMarker(logged),
    });
    expect(packet(fp, 'D-1').rules_discovery).toMatchObject({ rule_id: 'RL-aaaa' });
  });

  it('AC-5: without an inventory the baseline stays put and the report names none', () => {
    const fp = signedRun();
    rmSync(absRunFile(fp.project.root, fp.runId, 'inventory'));
    const report = applyProposal(fp.project.root, fp.runId, { now: NOW });
    expect(report.baseline).toBeNull();
    expect(readBaseline(fp.project.root)).toBeNull();
    expect(runStep(fp)).toBe('docs');
  });

  it('AC-5: offers checks for several rules in the plural', () => {
    const fp = signedRun();
    const report = applyProposal(fp.project.root, fp.runId, { now: NOW });
    expect(scriptableOffer({ ...report, scriptable: 2 })).toMatch(
      /^2 new or changed rules could be checked by a script\./,
    );
  });

  it('AC-5: a trace survives a lost run, journal and sources file', () => {
    const fp = signedRun();
    applyProposal(fp.project.root, fp.runId, { now: NOW });
    const line = fp.read(NEW_FILE).split('\n')[0]!;
    rmSync(absRunFile(fp.project.root, fp.runId, 'run'));
    rmSync(absRunFile(fp.project.root, fp.runId, 'apply'));
    writeFileSync(absRunFile(fp.project.root, fp.runId, 'sources'), '{"not":"a list"}');
    expect(traceDiscoveredRule(fp.project.root, parseRuleMarker(line)!)).toEqual({
      rule_id: parseRuleMarker(line),
      run_id: fp.runId,
      signoff_decision: null,
      sources: [],
      source_decisions: [],
    });
  });
});
