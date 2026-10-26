import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  COST_SCHEMA,
  changeCostWindow,
  computeChangeCost,
  readChangeCost,
  readCostCache,
  updateCostCache,
  writeChangeCost,
  type ChangeCostRecord,
  type CostHookPayload,
} from '@/cost/change-cost.js';
import { hudCostCachePath } from '@/hud/files.js';
import { hudCostOf } from '@/hud/cost-view.js';
import { appendRouteTurn } from '@/pipeline/route-turns.js';
import { recordDoneRow } from '@/spec-pipeline/high-table.js';

import { DIR, SES, assistant, at, total, writeStageRows, writeTranscript } from './cost.fixture.js';

const roots: string[] = [];
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-change-cost-'));
  roots.push(root);
  return root;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

const NOW = () => new Date(at('11:00'));

function run(root: string, payloads: CostHookPayload[], chunkBytes?: number): ChangeCostRecord {
  const window = changeCostWindow(root, DIR, NOW)!;
  for (const payload of payloads) {
    updateCostCache({
      projectRoot: root,
      sessionId: SES,
      dirName: DIR,
      payload,
      floor: window.from,
      chunkBytes,
    });
  }
  return computeChangeCost(root, DIR, { now: NOW })!;
}

const sumTotals = (lines: Array<{ tokens: { total: number } }>) =>
  lines.reduce((sum, line) => sum + line.tokens.total, 0);

const STAGES: Array<[string, string, string?]> = [
  ['open', '10:00'],
  ['stage_start', '10:01', 'planning'],
  ['stage_end', '10:05', 'planning'],
  ['stage_start', '10:06', 'specification'],
  ['stage_end', '10:20', 'specification'],
  ['stage_start', '10:21', 'development'],
];

const A = { input: 10, output: 200, cacheRead: 3000, cacheWrite: 400 };
const B = { input: 20, output: 300, cacheRead: 5000, cacheWrite: 500 };
const C = { input: 30, output: 900, cacheRead: 9000, cacheWrite: 100 };
const D = { input: 5, output: 700, cacheRead: 12000, cacheWrite: 1000 };
const E = { input: 7, output: 1100, cacheRead: 20000, cacheWrite: 900 };
const S1 = { input: 3, output: 400, cacheRead: 6000, cacheWrite: 700 };
const S2 = { input: 2, output: 250, cacheRead: 4000, cacheWrite: 0 };
const X1 = { input: 4, output: 600, cacheRead: 7000, cacheWrite: 300 };
const K1 = { input: 6, output: 800, cacheRead: 8000, cacheWrite: 200 };

function fullChange(root: string) {
  writeStageRows(root, STAGES);
  const main = writeTranscript(root, 'main', [
    assistant('m1', '10:02', A),
    assistant('m2', '10:10', B),
    assistant('m3', '10:30', { ...C, output: 100 }),
    assistant('m3', '10:30', C),
    assistant('m3', '10:30', C),
    assistant('d1', '10:25', E),
  ]);
  const planning = writeTranscript(root, 'agent-plan', [
    assistant('p1', '10:03', D),
    assistant('p1', '10:03', D),
  ]);
  const development = writeTranscript(root, 'agent-dev', [assistant('d1', '10:25', E)]);
  const security = writeTranscript(root, 'agent-sec', [
    assistant('s1', '10:08', S1, {
      command: 'paqad-ai spec pipeline experts brief security-auditor',
    }),
    assistant('s2', '10:09', S2),
  ]);
  const db = writeTranscript(root, 'agent-db', [
    assistant('x1', '10:08', X1, { command: 'paqad-ai spec pipeline experts brief db-expert' }),
  ]);
  const chief = writeTranscript(root, 'agent-chief', [
    assistant('k1', '10:15', K1, { command: 'paqad-ai spec pipeline experts context' }),
  ]);
  const payloads: CostHookPayload[] = [
    { transcript_path: main },
    {
      transcript_path: main,
      agent_type: 'paqad-planning',
      agent_id: 'a1',
      agent_transcript_path: planning,
    },
    {
      transcript_path: main,
      agent_type: 'paqad:paqad-development',
      agent_id: 'a2',
      agent_transcript_path: development,
    },
    {
      transcript_path: main,
      agent_type: 'paqad-expert',
      agent_id: 'a3',
      agent_transcript_path: security,
    },
    {
      transcript_path: main,
      agent_type: 'paqad-expert',
      agent_id: 'a4',
      agent_transcript_path: db,
    },
    {
      transcript_path: main,
      agent_type: 'paqad-chief-architect',
      agent_id: 'a5',
      agent_transcript_path: chief,
    },
  ];
  return { main, payloads };
}

describe('computeChangeCost (AC-47)', () => {
  it('counts each message once and the stage, expert and chief splits add up to the total', () => {
    const root = tempRoot();
    const { payloads } = fullChange(root);
    const cost = run(root, payloads);

    const unique = [A, B, C, D, E, S1, S2, X1, K1].reduce((sum, usage) => sum + total(usage), 0);
    expect(cost.tokens.total).toBe(unique);
    expect(cost.tokens.output).toBe(
      [A, B, C, D, E, S1, S2, X1, K1].reduce((sum, usage) => sum + (usage.output ?? 0), 0),
    );
    expect(sumTotals(cost.by_stage)).toBe(cost.tokens.total);

    const stage = (name: string) => cost.by_stage.find((line) => line.stage === name)!;
    expect(stage('planning').tokens.total).toBe(total(A) + total(D));
    expect(stage('specification').tokens.total).toBe(
      total(B) + total(S1) + total(S2) + total(X1) + total(K1),
    );
    expect(stage('development').tokens.total).toBe(total(C) + total(E));
    expect(cost.by_stage.map((line) => line.stage)).toEqual([
      'planning',
      'specification',
      'development',
    ]);

    expect(cost.by_expert).toEqual([
      expect.objectContaining({ role: 'security-auditor', exact: true }),
      expect.objectContaining({ role: 'db-expert', exact: true }),
    ]);
    expect(cost.by_expert[0]!.tokens.total).toBe(total(S1) + total(S2));
    expect(cost.by_expert[1]!.tokens.total).toBe(total(X1));
    expect(cost.chief).toMatchObject({ exact: true, tokens: { total: total(K1) } });
    const table = sumTotals(cost.by_expert) + cost.chief!.tokens.total;
    expect(table + total(A) + total(B) + total(C) + total(D) + total(E)).toBe(cost.tokens.total);

    const stageUsd = cost.by_stage.reduce((sum, line) => sum + line.usd!, 0);
    expect(stageUsd).toBeCloseTo(cost.usd!, 3);
    expect(cost).toMatchObject({
      schema: COST_SCHEMA,
      price_table_date: '2026-10-19',
      basis: 'API-equivalent estimate',
      label: 'estimate at API prices (API-equivalent on a Pro or Max plan)',
      unpriced_models: [],
      sources: 6,
      window: { from: at('10:00'), to: at('11:00'), sealed: false, sealed_by: null },
    });
    expect(cost.not_counted.join(' ')).toMatch(/fast mode premium/);
  });

  it('charges main-session usage outside every stage to the orchestrator', () => {
    const root = tempRoot();
    writeStageRows(root, [
      ['open', '10:00'],
      ['stage_start', '10:05', 'planning'],
      ['stage_end', '10:06', 'planning'],
    ]);
    const main = writeTranscript(root, 'main', [
      assistant('m1', '10:02', A),
      assistant('m2', '10:05', B),
      assistant('m3', '10:30', C),
    ]);
    const cost = run(root, [{ transcript_path: main }]);
    expect(cost.by_stage).toEqual([
      expect.objectContaining({
        stage: 'planning',
        tokens: expect.objectContaining({ total: total(B) }),
      }),
      expect.objectContaining({
        stage: 'orchestrator',
        tokens: expect.objectContaining({ total: total(A) + total(C) }),
      }),
    ]);
  });

  it('lists an unpriced model, keeps its tokens and prices only the rest (AC-50)', () => {
    const root = tempRoot();
    writeStageRows(root, [['open', '10:00']]);
    const main = writeTranscript(root, 'main', [
      assistant('m1', '10:01', { input: 1_000_000, output: 1_000_000 }),
      assistant('m2', '10:02', A, { model: 'claude-future-9' }),
      assistant('m3', '10:03', {}, { model: '<synthetic>' }),
      assistant('m4', null, B),
    ]);
    const cost = run(root, [{ transcript_path: main }]);
    expect(cost.tokens.total).toBe(2_000_000 + total(A));
    expect(cost.usd).toBe(24);
    expect(cost.unpriced_models).toEqual(['claude-future-9']);
    expect(cost.by_model.find((line) => line.model === 'claude-future-9')?.usd).toBeNull();

    const onlyUnpriced = tempRoot();
    writeStageRows(onlyUnpriced, [['open', '10:00']]);
    const other = writeTranscript(onlyUnpriced, 'main', [
      assistant('m1', '10:01', A, { model: 'claude-future-9' }),
    ]);
    const none = run(onlyUnpriced, [{ transcript_path: other }]);
    expect(none.usd).toBeNull();
    expect(none.by_stage[0]!.usd).toBeNull();
  });

  it('shows a seat with only its own estimate as an estimate line, outside the total', () => {
    const root = tempRoot();
    writeStageRows(root, [['open', '10:00']]);
    recordDoneRow(
      root,
      DIR,
      { role: 'qa-engineer', findings: 1, tokens_estimate: 1800 },
      { sessionId: SES },
    );
    recordDoneRow(
      root,
      DIR,
      { role: 'chief-architect', findings: null, tokens_estimate: 900 },
      { sessionId: SES },
    );
    const main = writeTranscript(root, 'main', [assistant('m1', '10:01', A)]);
    const cost = run(root, [{ transcript_path: main }]);
    expect(cost.tokens.total).toBe(total(A));
    expect(cost.by_expert).toEqual([
      {
        role: 'qa-engineer',
        tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0, total: 1800 },
        usd: null,
        exact: false,
      },
    ]);
    expect(cost.chief).toEqual({
      tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0, total: 900 },
      usd: null,
      exact: false,
    });
  });

  it('has no record for a change with no open row', () => {
    const root = tempRoot();
    writeStageRows(root, [['stage_start', '10:00', 'planning']]);
    expect(changeCostWindow(root, DIR, NOW)).toBeNull();
    expect(computeChangeCost(root, DIR, { now: NOW })).toBeNull();
  });
});

describe('the window (AC-49)', () => {
  function sealedChange(root: string, seal: 'close' | 'receipt') {
    const rows: Array<[string, string, string?]> = [['open', '10:00']];
    if (seal === 'close') rows.push(['close', '10:40']);
    const dir = writeStageRows(root, rows);
    if (seal === 'receipt') {
      const payload = Buffer.from(
        JSON.stringify({ predicate: { time_verified: at('10:40') } }),
      ).toString('base64');
      writeFileSync(join(dir, 'receipt.json'), JSON.stringify({ payload }), 'utf8');
    }
    return writeTranscript(root, 'main', [
      assistant('before', '09:59', A),
      assistant('inside', '10:20', B),
      assistant('after', '10:41', C),
    ]);
  }

  it.each(['close', 'receipt'] as const)(
    'does not count usage before the open row or after the seal (%s)',
    (seal) => {
      const root = tempRoot();
      const main = sealedChange(root, seal);
      const cost = run(root, [{ transcript_path: main }]);
      expect(cost.tokens.total).toBe(total(B));
      expect(cost.window).toEqual({
        from: at('10:00'),
        to: at('10:40'),
        sealed: true,
        sealed_by: seal,
      });
    },
  );

  it('AC-6: a receipt followed by a later stage row does not seal; the window keeps counting', () => {
    const root = tempRoot();
    const dir = writeStageRows(root, [
      ['open', '10:00'],
      ['stage_start', '10:01', 'planning'],
      ['stage_start', '10:30', 'specification'],
    ]);
    const payload = Buffer.from(
      JSON.stringify({ predicate: { time_verified: at('10:02') } }),
    ).toString('base64');
    writeFileSync(join(dir, 'receipt.json'), JSON.stringify({ payload }), 'utf8');
    const main = writeTranscript(root, 'main', [
      assistant('inside', '10:01', A),
      assistant('after-receipt', '10:20', B),
    ]);
    const cost = run(root, [{ transcript_path: main }]);
    expect(cost.window).toMatchObject({ to: at('11:00'), sealed: false, sealed_by: null });
    expect(cost.tokens.total).toBe(total(A) + total(B));
  });

  it('a receipt after the last stage row still seals', () => {
    const root = tempRoot();
    const dir = writeStageRows(root, [
      ['open', '10:00'],
      ['stage_start', '10:01', 'planning'],
      ['stage_end', '10:10', 'planning'],
    ]);
    const payload = Buffer.from(
      JSON.stringify({ predicate: { time_verified: at('10:40') } }),
    ).toString('base64');
    writeFileSync(join(dir, 'receipt.json'), JSON.stringify({ payload }), 'utf8');
    expect(changeCostWindow(root, DIR, NOW)).toMatchObject({ to: at('10:40'), sealed: true });
  });

  it('a reopened change runs to now again', () => {
    const root = tempRoot();
    writeStageRows(root, [
      ['open', '10:00'],
      ['close', '10:10'],
      ['open', '10:20'],
    ]);
    expect(changeCostWindow(root, DIR, NOW)).toMatchObject({ to: at('11:00'), sealed: false });
  });
});

describe('the offset cache (AC-48)', () => {
  it('reads only the appended bytes and matches a full recompute', () => {
    const root = tempRoot();
    writeStageRows(root, [['open', '10:00']]);
    const first = [assistant('m1', '10:01', A), assistant('m2', '10:02', B)];
    const main = writeTranscript(root, 'main', first);
    const payload = { transcript_path: main };
    const once = run(root, [payload], 64);
    expect(once.tokens.total).toBe(total(A) + total(B));
    const cachePath = hudCostCachePath(root, SES);
    const stored = readCostCache(cachePath, SES).sources[main]!;
    expect(stored.offset).toBe(statSync(main).size);

    const original = readFileSync(main, 'utf8');
    writeFileSync(main, original.replace(/[^\n]/g, ' '), 'utf8');
    const appended = [assistant('m3', '10:03', C), assistant('m2', '10:02', B)];
    appendFileSync(main, appended.join('\n') + '\n', 'utf8');
    const twice = run(root, [payload], 64);

    const fresh = tempRoot();
    writeStageRows(fresh, [['open', '10:00']]);
    const whole = writeTranscript(fresh, 'main', [...first, ...appended]);
    const full = run(fresh, [{ transcript_path: whole }]);
    expect(twice.tokens).toEqual(full.tokens);
    expect(twice.usd).toBe(full.usd);
    expect(twice.tokens.total).toBe(total(A) + total(B) + total(C));
    expect(readCostCache(cachePath, SES).sources[main]!.offset).toBe(statSync(main).size);
  });

  it('reads a transcript again from the start when it shrank', () => {
    const root = tempRoot();
    writeStageRows(root, [['open', '10:00']]);
    const main = writeTranscript(root, 'main', [
      assistant('m1', '10:01', A),
      assistant('m2', '10:02', B),
    ]);
    run(root, [{ transcript_path: main }]);
    writeTranscript(root, 'main', [assistant('m9', '10:05', C)]);
    expect(run(root, [{ transcript_path: main }]).tokens.total).toBe(total(C));
  });

  it('reads again from the start when an earlier window is asked for, and skips a missing file', () => {
    const root = tempRoot();
    writeStageRows(root, [['open', '10:00']]);
    const main = writeTranscript(root, 'main', [
      assistant('early', '09:30', A),
      assistant('m1', '10:01', B),
    ]);
    updateCostCache({
      projectRoot: root,
      sessionId: SES,
      dirName: DIR,
      payload: { transcript_path: main },
      floor: at('10:00'),
    });
    expect(
      Object.keys(readCostCache(hudCostCachePath(root, SES), SES).sources[main]!.messages),
    ).toEqual(['m1']);
    updateCostCache({
      projectRoot: root,
      sessionId: SES,
      dirName: 'other-change',
      payload: { transcript_path: main },
      floor: at('09:00'),
    });
    const source = readCostCache(hudCostCachePath(root, SES), SES).sources[main]!;
    expect(Object.keys(source.messages).sort()).toEqual(['early', 'm1']);
    expect(source.changes).toEqual([DIR, 'other-change']);

    rmSync(main);
    expect(run(root, [{ transcript_path: main }]).tokens.total).toBe(total(B));
  });

  it('reads a broken cache as empty and adds up a change resumed in another session', () => {
    const root = tempRoot();
    writeStageRows(root, [['open', '10:00']]);
    const cachePath = hudCostCachePath(root, SES);
    mkdirSync(join(root, '.paqad/session/hud'), { recursive: true });
    writeFileSync(cachePath, '{not json', 'utf8');
    expect(readCostCache(cachePath, SES).sources).toEqual({});
    writeFileSync(cachePath, JSON.stringify({ schema: 'other' }), 'utf8');
    expect(readCostCache(cachePath, SES).sources).toEqual({});

    const first = writeTranscript(root, 'first', [assistant('m1', '10:01', A)]);
    const second = writeTranscript(root, 'second', [assistant('m2', '10:30', B)]);
    const window = changeCostWindow(root, DIR, NOW)!;
    updateCostCache({
      projectRoot: root,
      sessionId: 'ses_one',
      dirName: DIR,
      payload: { transcript_path: first },
      floor: window.from,
    });
    updateCostCache({
      projectRoot: root,
      sessionId: 'ses_two',
      dirName: DIR,
      payload: { transcript_path: second },
      floor: window.from,
    });
    const cost = computeChangeCost(root, DIR, { now: NOW })!;
    expect(cost.tokens.total).toBe(total(A) + total(B));
    expect(cost.sources).toBe(2);
  });
});

describe('cost.json', () => {
  it('is written atomically into the bundle with the envelope, and read back', () => {
    const root = tempRoot();
    const { payloads } = fullChange(root);
    const cost = run(root, payloads);
    const path = writeChangeCost(root, DIR, cost, SES);
    expect(path.endsWith(join(DIR, 'cost.json'))).toBe(true);
    const doc = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    expect(doc).toMatchObject({
      doc_type: 'paqad.cost',
      change: '01M5AZ6RTF8YZ1MY304KZ2BPJ3',
      session_id: SES,
    });
    expect(readChangeCost(root, DIR)?.tokens).toEqual(cost.tokens);
  });

  it('reads a missing or foreign file as null', () => {
    const root = tempRoot();
    const dir = writeStageRows(root, [['open', '10:00']]);
    expect(readChangeCost(root, DIR)).toBeNull();
    writeFileSync(join(dir, 'cost.json'), JSON.stringify({ schema: 'other' }), 'utf8');
    expect(readChangeCost(root, DIR)).toBeNull();
    expect(existsSync(join(dir, 'cost.json'))).toBe(true);
  });
});

describe('cost scoped to the change turns', () => {
  function questionDetour(root: string) {
    writeStageRows(root, [
      ['open', '10:00'],
      ['stage_start', '10:01', 'planning'],
      ['stage_end', '10:40', 'planning'],
    ]);
    const main = writeTranscript(root, 'main', [
      assistant('f1', '10:05', A),
      assistant('q1', '10:15', B),
      assistant('q2', '10:20', C),
      assistant('f2', '10:35', D),
    ]);
    return main;
  }

  it('AC-17: leaves out main-transcript turns routed to another workflow and says change', () => {
    const root = tempRoot();
    const main = questionDetour(root);
    appendRouteTurn(root, SES, { at: at('09:59'), workflow: 'feature-development' });
    appendRouteTurn(root, SES, { at: at('10:10'), workflow: 'project-question' });
    appendRouteTurn(root, SES, { at: at('10:30'), workflow: 'feature-development' });
    const cost = run(root, [{ transcript_path: main }]);
    expect(cost.scope).toBe('change');
    expect(cost.tokens.total).toBe(total(A) + total(D));
  });

  it('AC-18: says whole session when a contributing session has no route-turn log', () => {
    const root = tempRoot();
    const main = questionDetour(root);
    const cost = run(root, [{ transcript_path: main }]);
    expect(cost.scope).toBe('whole-session');
    expect(cost.tokens.total).toBe(total(A) + total(B) + total(C) + total(D));
    expect(hudCostOf(cost).scope).toBe('whole-session');
  });

  it('says whole session when the log starts after a counted message', () => {
    const root = tempRoot();
    const main = questionDetour(root);
    const cost = computeChangeCost(root, DIR, {
      now: NOW,
      caches: [
        (() => {
          updateCostCache({
            projectRoot: root,
            sessionId: SES,
            dirName: DIR,
            payload: { transcript_path: main },
            floor: at('10:00'),
          });
          return readCostCache(hudCostCachePath(root, SES), SES);
        })(),
      ],
      routeTurns: () => [{ at: at('10:30'), workflow: 'feature-development' }],
    })!;
    expect(cost.scope).toBe('whole-session');
  });

  it('counts agent sources of the change in full whatever the route was', () => {
    const root = tempRoot();
    const main = questionDetour(root);
    const agent = writeTranscript(root, 'agent-plan', [assistant('p1', '10:15', E)]);
    appendRouteTurn(root, SES, { at: at('09:59'), workflow: 'project-question' });
    const cost = run(root, [
      {
        transcript_path: main,
        agent_type: 'paqad-planning',
        agent_id: 'a1',
        agent_transcript_path: agent,
      },
    ]);
    expect(cost.scope).toBe('change');
    expect(cost.tokens.total).toBe(total(E));
  });

  it('reads a cost.json written before the scope existed as whole session', () => {
    const legacy = { ...run(tempRoot(), []) } as ChangeCostRecord;
    delete legacy.scope;
    expect(hudCostOf(legacy).scope).toBe('whole-session');
  });
});
