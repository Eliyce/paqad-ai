import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  appendFeatureStageRow,
  featureStagePath,
  foldFeature,
  readFeatureStageUnit,
  resolveActiveFeature,
} from '@/feature-evidence/stage-ledger.js';
import { readSessionControl } from '@/feature-evidence/session-control.js';

const roots: string[] = [];
function tempRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-feature-stage-'));
  roots.push(r);
  return r;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

const clock = () => new Date('2026-07-10T00:00:00.000Z');

describe('resolveActiveFeature', () => {
  it('mints a named feature and switches to it when a title is given', () => {
    const root = tempRoot();
    const dir = resolveActiveFeature(root, 'ses_1', {
      title: 'Route first workflows',
      issue: '339',
      lane: 'full',
      ulid: '01JABCDEFGHJKMNPQRSTVWXYZ0',
      now: clock,
    });
    expect(dir).toBe('339-route-first-workflows-01JABCDEFGHJKMNPQRSTVWXYZ0');
    const control = readSessionControl(root, 'ses_1');
    expect(control.active).toBe(dir);
    expect(control.lane).toBe('full');
  });

  it('returns the active feature when no title is given', () => {
    const root = tempRoot();
    const first = resolveActiveFeature(root, 'ses_1', { title: 'A', issue: null, ulidSeed: 1 });
    const again = resolveActiveFeature(root, 'ses_1', {});
    expect(again).toBe(first);
  });

  it('mints an untitled change feature when none is active', () => {
    const root = tempRoot();
    const dir = resolveActiveFeature(root, 'ses_1', { ulid: '01JABCDEFGHJKMNPQRSTVWXYZ1' });
    expect(dir).toBe('change-01JABCDEFGHJKMNPQRSTVWXYZ1');
    expect(readSessionControl(root, 'ses_1').active).toBe(dir);
  });

  it('a titled call while another feature is active pauses the prior one', () => {
    const root = tempRoot();
    const a = resolveActiveFeature(root, 'ses_1', { title: 'A', issue: null, ulidSeed: 1 });
    const b = resolveActiveFeature(root, 'ses_1', { title: 'B', issue: null, ulidSeed: 2 });
    const control = readSessionControl(root, 'ses_1');
    expect(control.active).toBe(b);
    expect(control.paused).toContain(a);
  });
});

describe('feature stage ledger append / read / fold', () => {
  const dir = '339-x-01JABCDEFGHJKMNPQRSTVWXYZ0';

  it('resolves the bundle path', () => {
    expect(featureStagePath(dir)).toBe(
      `.paqad/ledger/feature-evidence/${dir}/stage-evidence.jsonl`,
    );
  });

  it('appends validated rows and reads them back', () => {
    const root = tempRoot();
    let n = 0;
    const clk = () => new Date(1_700_000_000_000 + n++ * 1000);
    appendFeatureStageRow(root, 'ses_1', dir, { kind: 'open', adapter: 'claude-code' }, clk);
    appendFeatureStageRow(
      root,
      'ses_1',
      dir,
      { kind: 'stage_start', stage: 'planning', event_status: 'started', adapter: 'claude-code' },
      clk,
    );
    const rows = readFeatureStageUnit(root, dir);
    expect(rows.map((r) => r.kind)).toEqual(['open', 'stage_start']);
    expect(rows[0]).toMatchObject({ doc_type: 'paqad.stage-evidence', conversation_ordinal: 1 });
  });

  it('rejects an invalid row via the stage-evidence schema', () => {
    const root = tempRoot();
    expect(() =>
      appendFeatureStageRow(root, 'ses_1', dir, { kind: 'not-a-kind', adapter: 'x' }, clock),
    ).toThrow(/Invalid paqad.stage-evidence row/);
  });

  it('folds a feature keyed by the dir name', () => {
    const root = tempRoot();
    let n = 0;
    const clk = () => new Date(1_700_000_000_000 + n++ * 1000);
    appendFeatureStageRow(
      root,
      'ses_1',
      dir,
      { kind: 'open', adapter: 'claude-code', lane: 'full' },
      clk,
    );
    const fold = foldFeature(root, 'ses_1', dir);
    expect(fold.change_key).toBe(dir);
    expect(fold.session_id).toBe('ses_1');
    expect(fold.lane).toBe('full');
  });

  it('folds an absent feature as cannot-verify with the dir-name key', () => {
    const fold = foldFeature(tempRoot(), 'ses_1', dir);
    expect(fold.change_key).toBe(dir);
    expect(fold.completeness.verdict).toBe('cannot-verify');
  });
});
