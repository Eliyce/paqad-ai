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
import { buildHudSnapshot, writeHudSnapshot } from '@/hud/snapshot.js';
import { writeWorkflowState } from '@/pipeline/workflow-state.js';
import { persistLedgerSessionId } from '@/rag-ledger/session.js';

import { costRecord } from '../../../runtime/claude-plugin/mod/test/fixtures.ts';

// Issue #639, Part 23 (FR-22, AC-65): the snapshot's `cost` is read from the change's cost.json
// only, and `paqad-ai status --hud --format json` prints the same `cost` and `table` as the
// snapshot file.

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

describe('the snapshot cost (FR-22)', () => {
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
    // The mod's fixture carries exactly the fields paqad writes.
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

describe('status --hud --format json (AC-65)', () => {
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
