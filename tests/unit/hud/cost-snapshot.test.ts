import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createStatusCommand, renderHudText } from '@/cli/commands/status.js';
import { PATHS } from '@/core/constants/paths.js';
import { readChangeCost } from '@/cost/change-cost.js';
import { refreshChangeCostFromHook } from '@/cost/hook-cost.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { hudCostOf } from '@/hud/cost-view.js';
import { hudSnapshotPath } from '@/hud/files.js';
import {
  buildHudSnapshot,
  TURN_END_SOURCES,
  writeHudSnapshot,
  writeHudSnapshotSafe,
} from '@/hud/snapshot.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import { appendRouteTurn } from '@/pipeline/route-turns.js';
import { writeWorkflowState } from '@/pipeline/workflow-state.js';
import { persistLedgerSessionId } from '@/rag-ledger/session.js';

import { costRecord } from '../../../runtime/claude-plugin/mod/test/fixtures.ts';
import { assistant } from '../cost/cost.fixture.js';

const S = 'ses-cost-hud';
const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function project(): { root: string; dir: string } {
  const root = mkdtempSync(join(tmpdir(), 'paqad-cost-hud-'));
  roots.push(root);
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(join(root, PATHS.FRAMEWORK_PATH), '~/.paqad-ai/current\n');
  const dir = openFeatureChange(root, S, {
    adapter: 'claude-code',
    title: 'ORD-501 csv export',
    issue: 'ORD-501',
    lane: 'full',
  });
  persistLedgerSessionId(root, S);
  writeWorkflowState(root, S, {
    active: { workflow: 'feature-development', lane: 'full', reason: 'a new export' },
    paused: [],
  });
  return { root, dir };
}

function writeMainTranscript(root: string): string {
  const path = join(root, 'main.jsonl');
  const line = JSON.stringify({
    type: 'assistant',
    timestamp: new Date().toISOString(),
    message: {
      id: 'msg_1',
      model: 'claude-opus-5-5',
      usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 },
    },
  });
  writeFileSync(path, `${line}\n`);
  return path;
}

describe('the snapshot cost', () => {
  it('is null until a hook wrote cost.json', () => {
    const { root } = project();
    expect(buildHudSnapshot(root, S).cost).toBeNull();
    expect(renderHudText(buildHudSnapshot(root, S))).not.toContain('cost:');
  });

  it('writes cost.json for the payload session when another session wrote the cache last', () => {
    const { root, dir } = project();
    persistLedgerSessionId(root, 'ses-wrote-cache-last');
    expect(
      refreshChangeCostFromHook({
        projectRoot: root,
        payload: { session_id: S, transcript_path: writeMainTranscript(root) },
      }),
    ).toBe('written');
    expect(readChangeCost(root, dir)).not.toBeNull();
  });

  it('reads cost.json: totals, by stage, by expert, the chief, labelled with its price date', () => {
    const { root, dir } = project();
    expect(
      refreshChangeCostFromHook({
        projectRoot: root,
        payload: { transcript_path: writeMainTranscript(root) },
      }),
    ).toBe('written');
    const snapshot = buildHudSnapshot(root, S);
    expect(snapshot.cost).toEqual(hudCostOf(readChangeCost(root, dir)!));
    expect(snapshot.cost).toMatchObject({
      price_table_date: '2026-10-19',
      label: 'estimate at API prices (API-equivalent on a Pro or Max plan)',
      usd: 24,
      unpriced_models: [],
      by_expert: [],
      chief: null,
    });
    expect(snapshot.cost!.tokens.total).toBe(2_000_000);
    expect(snapshot.cost!.not_counted.length).toBeGreaterThan(0);
    expect(Object.keys(costRecord()).sort()).toEqual(Object.keys(snapshot.cost!).sort());
    expect(renderHudText(snapshot)).toContain(
      'cost: 2,000,000 tokens; ~$24.00, estimate at API prices (API-equivalent on a Pro or Max plan), prices of 2026-10-19',
    );
  });

  it('says which models have no price in the text form', () => {
    const { root } = project();
    const path = join(root, 'main.jsonl');
    writeFileSync(
      path,
      `${JSON.stringify({
        type: 'assistant',
        timestamp: new Date().toISOString(),
        message: { id: 'm', model: 'claude-future-9', usage: { input_tokens: 10 } },
      })}\n`,
    );
    refreshChangeCostFromHook({ projectRoot: root, payload: { transcript_path: path } });
    const text = renderHudText(buildHudSnapshot(root, S));
    expect(text).toContain('cost: 10 tokens; no price for claude-future-9');
    expect(text).not.toContain('$');
  });
});

describe('status --hud --format json', () => {
  it('prints the same cost and table as the snapshot file', async () => {
    const { root } = project();
    refreshChangeCostFromHook({
      projectRoot: root,
      payload: { transcript_path: writeMainTranscript(root) },
    });
    writeHudSnapshot(root, S);
    const file = JSON.parse(readFileSync(hudSnapshotPath(root, S), 'utf8')) as Record<
      string,
      unknown
    >;

    const writes: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    });
    await createStatusCommand().parseAsync(
      ['--hud', '--format', 'json', '--session', S, '--project-root', root],
      { from: 'user' },
    );
    const printed = JSON.parse(writes.join('')) as Record<string, unknown>;
    expect(printed.cost).toEqual(file.cost);
    expect(printed.table).toEqual(file.table);
    expect(printed.cost).not.toBeNull();
  });
});

describe('the workflow cost on another route', () => {
  function questionRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'paqad-workflow-cost-'));
    roots.push(root);
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(join(root, PATHS.FRAMEWORK_PATH), '~/.paqad-ai/current\n');
    return root;
  }

  it('counts the main transcript since this workflow started in this session', () => {
    const root = questionRoot();
    appendRouteTurn(root, S, { at: '2026-10-19T09:00:00.000Z', workflow: 'pentest' });
    appendRouteTurn(root, S, { at: '2026-10-19T10:00:00.000Z', workflow: 'project-question' });
    writeWorkflowState(root, S, { active: { workflow: 'project-question' }, paused: [] });
    const main = join(root, 'main.jsonl');
    writeFileSync(
      main,
      [
        assistant('p1', '09:30', { output: 1000 }),
        assistant('q1', '10:05', { input: 100, output: 200 }),
      ].join('\n') + '\n',
    );
    refreshChangeCostFromHook({
      projectRoot: root,
      payload: { session_id: S, transcript_path: main },
    });

    const snapshot = buildHudSnapshot(root, S);

    expect(snapshot.workflow).toMatchObject({
      name: 'project-question',
      started_at: '2026-10-19T10:00:00.000Z',
      tokens: 300,
      unpriced: [],
    });
    expect(snapshot.workflow!.usd).toBeGreaterThan(0);
    expect(snapshot.cost).toBeNull();
  });

  it('carries no workflow block on feature development, no workflow or no route', () => {
    const root = questionRoot();
    expect(buildHudSnapshot(root, S).workflow).toBeNull();
    writeWorkflowState(root, S, { active: { workflow: 'no-workflow' }, paused: [] });
    expect(buildHudSnapshot(root, S).workflow).toBeNull();
    writeWorkflowState(root, S, { active: { workflow: 'feature-development' }, paused: [] });
    expect(buildHudSnapshot(root, S).workflow).toBeNull();
  });

  it('reads tokens unknown before any turn start is known', () => {
    const root = questionRoot();
    writeWorkflowState(root, S, { active: { workflow: 'codebase-health' }, paused: [] });
    expect(buildHudSnapshot(root, S).workflow).toEqual({
      name: 'codebase-health',
      started_at: null,
      tokens: null,
      usd: null,
      unpriced: [],
    });
  });
});

describe('AC-27: the cost while the turn is still running', () => {
  function counted(): { root: string; dir: string } {
    const project_ = project();
    refreshChangeCostFromHook({
      projectRoot: project_.root,
      payload: { transcript_path: writeMainTranscript(project_.root) },
    });
    return project_;
  }

  const snapshotFile = (root: string) =>
    JSON.parse(readFileSync(hudSnapshotPath(root, S), 'utf8')) as {
      cost: { live: boolean } | null;
    };

  it('reads live while a turn runs on an unsealed record, and settled once the turn ends', () => {
    const { root } = counted();
    expect(buildHudSnapshot(root, S).cost?.live).toBe(false);
    expect(buildHudSnapshot(root, S, { turnRunning: true }).cost?.live).toBe(true);
    writeHudSnapshotSafe(root, S, 'hook:stage-writer');
    expect(snapshotFile(root).cost?.live).toBe(true);
    for (const source of TURN_END_SOURCES) {
      writeHudSnapshotSafe(root, S, source);
      expect(snapshotFile(root).cost?.live).toBe(false);
    }
  });

  it('never reads live once the record is sealed', () => {
    const { root, dir } = counted();
    const path = join(root, featureFilePath(dir, 'cost'));
    const record = JSON.parse(readFileSync(path, 'utf8')) as { window: { sealed: boolean } };
    record.window.sealed = true;
    writeFileSync(path, JSON.stringify(record));
    expect(buildHudSnapshot(root, S, { turnRunning: true }).cost?.live).toBe(false);
  });

  it('counts the first turn from the cost cache before cost.json exists', () => {
    const { root, dir } = counted();
    rmSync(join(root, featureFilePath(dir, 'cost')));
    expect(buildHudSnapshot(root, S).cost).toBeNull();
    const live = buildHudSnapshot(root, S, { turnRunning: true }).cost;
    expect(live).toMatchObject({ live: true, tokens: { total: 2_000_000 } });
  });

  it('leaves the cost out while the cache is empty, and with a logged reason while it cannot be read', () => {
    const { root } = project();
    expect(buildHudSnapshot(root, S, { turnRunning: true }).cost).toBeNull();
    mkdirSync(join(root, '.paqad', 'session'), { recursive: true });
    writeFileSync(join(root, PATHS.HUD_DIR), 'not a directory\n');
    expect(buildHudSnapshot(root, S, { turnRunning: true }).cost).toBeNull();
    expect(readFileSync(join(root, '.paqad/logs/hook-failures.log'), 'utf8')).toContain(
      'hud-snapshot (cost):',
    );
  });
});
