import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  appendFeatureStageRow,
  closeActiveFeature,
  currentFeature,
  featureStagePath,
  foldFeature,
  openFeatureChange,
  readFeatureStageUnit,
  recordChangeConstants,
  resolveActiveFeature,
  resolveFeatureRef,
  resumeFeatureByRef,
} from '@/feature-evidence/stage-ledger.js';
import { readFeatureRecord } from '@/feature-evidence/feature-record.js';
import { validateStageEvidenceRow } from '@/stage-evidence/schema.js';
import { markDone, readSessionControl } from '@/feature-evidence/session-control.js';

import { appendLegacyStageRow } from '../../shared/legacy-stage-row.js';

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
    appendFeatureStageRow(root, 'ses_1', dir, { kind: 'open' }, clk);
    appendFeatureStageRow(
      root,
      'ses_1',
      dir,
      { kind: 'stage_start', stage: 'planning', event_status: 'started' },
      clk,
    );
    const rows = readFeatureStageUnit(root, dir);
    expect(rows.map((r) => r.kind)).toEqual(['open', 'stage_start']);
    expect(rows[0]).toMatchObject({ doc_type: 'paqad.stage-evidence', conversation_ordinal: 1 });
  });

  it('rejects an invalid row via the stage-evidence schema', () => {
    const root = tempRoot();
    expect(() => appendFeatureStageRow(root, 'ses_1', dir, { kind: 'not-a-kind' }, clock)).toThrow(
      /Invalid paqad.stage-evidence row/,
    );
  });

  it('folds a feature keyed by the dir name', () => {
    const root = tempRoot();
    let n = 0;
    const clk = () => new Date(1_700_000_000_000 + n++ * 1000);
    appendFeatureStageRow(root, 'ses_1', dir, { kind: 'open' }, clk);
    recordChangeConstants(root, dir, { lane: 'full' }, clk);
    const fold = foldFeature(root, 'ses_1', dir);
    expect(fold.change_key).toBe(dir);
    expect(fold.session_id).toBe('ses_1');
    expect(fold.lane).toBe('full');
  });

  it('folds the lane a pre-#581 open row stamped when feature.json has none (INV-8)', () => {
    const root = tempRoot();
    appendLegacyStageRow(root, dir, 'ses_1', { kind: 'open', lane: 'graduated' });
    expect(foldFeature(root, 'ses_1', dir).lane).toBe('graduated');
  });

  it('still validates a pre-#581 version-1 row that carries the constants (INV-8)', () => {
    const legacy = appendLegacyStageRow(tempRoot(), dir, 'ses_1', {
      kind: 'open',
      lane: 'full',
      branch: 'main',
    });
    expect(validateStageEvidenceRow(legacy)).toEqual([]);
    const noAdapter: Record<string, unknown> = { ...legacy };
    delete noAdapter.adapter;
    expect(validateStageEvidenceRow(noAdapter)).not.toEqual([]);
  });

  it('rejects a new row that carries a session constant (AC-6)', () => {
    const root = tempRoot();
    for (const constant of [{ adapter: 'claude-code' }, { lane: 'full' }, { branch: 'main' }]) {
      expect(() =>
        appendFeatureStageRow(root, 'ses_1', dir, { kind: 'open', ...constant }, clock),
      ).toThrow(/additional properties/);
    }
  });

  it('folds an absent feature as cannot-verify with the dir-name key', () => {
    const fold = foldFeature(tempRoot(), 'ses_1', dir);
    expect(fold.change_key).toBe(dir);
    expect(fold.completeness.verdict).toBe('cannot-verify');
  });
});

describe('active-change accessor', () => {
  it('currentFeature is null before any feature and never mints', () => {
    const root = tempRoot();
    expect(currentFeature(root, 'ses_1')).toBeNull();
    // A read must not create a feature — the control stays empty.
    expect(readSessionControl(root, 'ses_1').active).toBeNull();
  });

  it('openFeatureChange mints an untitled change with a single open row carrying the lane', () => {
    const root = tempRoot();
    const dir = openFeatureChange(root, 'ses_1', {
      adapter: 'claude-code',
      lane: 'full',
      ulid: '01JABCDEFGHJKMNPQRSTVWXYZ2',
      now: clock,
    });
    expect(dir).toBe('change-01JABCDEFGHJKMNPQRSTVWXYZ2');
    expect(currentFeature(root, 'ses_1')).toBe(dir);
    const rows = readFeatureStageUnit(root, dir);
    expect(rows.map((r) => r.kind)).toEqual(['open']);
    expect(rows[0]).toMatchObject({ kind: 'open' });
    expect(rows[0]).not.toHaveProperty('lane');
    expect(readFeatureRecord(root, dir)?.lane).toBe('full');
  });

  it('openFeatureChange is idempotent for an already-open change (no duplicate open row)', () => {
    const root = tempRoot();
    const first = openFeatureChange(root, 'ses_1', { adapter: 'claude-code', ulidSeed: 1 });
    const again = openFeatureChange(root, 'ses_1', { adapter: 'claude-code' });
    expect(again).toBe(first);
    expect(readFeatureStageUnit(root, first).filter((r) => r.kind === 'open')).toHaveLength(1);
  });

  it('openFeatureChange with a title opens a fresh named change with its own open row', () => {
    const root = tempRoot();
    const a = openFeatureChange(root, 'ses_1', { adapter: 'claude-code', ulidSeed: 1 });
    const b = openFeatureChange(root, 'ses_1', {
      adapter: 'claude-code',
      title: 'Second feature',
      issue: null,
      ulidSeed: 2,
    });
    expect(b).not.toBe(a);
    expect(currentFeature(root, 'ses_1')).toBe(b);
    expect(readSessionControl(root, 'ses_1').paused).toContain(a);
    expect(readFeatureStageUnit(root, b).map((r) => r.kind)).toEqual(['open']);
  });

  it('closeActiveFeature clears the active pointer so the next open mints fresh', () => {
    const root = tempRoot();
    const first = openFeatureChange(root, 'ses_1', { adapter: 'claude-code', ulidSeed: 1 });
    closeActiveFeature(root, 'ses_1');
    expect(currentFeature(root, 'ses_1')).toBeNull();
    const second = openFeatureChange(root, 'ses_1', { adapter: 'claude-code', ulidSeed: 2 });
    expect(second).not.toBe(first);
  });

  it('closeActiveFeature is a no-op when nothing is active', () => {
    const root = tempRoot();
    expect(() => closeActiveFeature(root, 'ses_1')).not.toThrow();
    expect(currentFeature(root, 'ses_1')).toBeNull();
  });
});

describe('resolveFeatureRef / resumeFeatureByRef', () => {
  /** Open two features (A paused, B active) and return their dir names. */
  function twoFeatures(root: string): { a: string; b: string } {
    const a = openFeatureChange(root, 'ses_1', {
      adapter: 'claude-code',
      title: 'Route first workflows',
      issue: '339',
      ulid: '01JABCDEFGHJKMNPQRSTVWXYZ0',
    });
    const b = openFeatureChange(root, 'ses_1', {
      adapter: 'claude-code',
      title: 'Second thing',
      issue: 'PQD-7',
      ulid: '01JABCDEFGHJKMNPQRSTVWXYZ1',
    });
    return { a, b };
  }

  it('matches by full dir name, ULID, issue, and slug', () => {
    const root = tempRoot();
    const { a } = twoFeatures(root);
    expect(resolveFeatureRef(root, 'ses_1', a)).toBe(a);
    expect(resolveFeatureRef(root, 'ses_1', '01JABCDEFGHJKMNPQRSTVWXYZ0')).toBe(a);
    expect(resolveFeatureRef(root, 'ses_1', '339')).toBe(a);
    expect(resolveFeatureRef(root, 'ses_1', 'route-first-workflows')).toBe(a);
  });

  it('matches a jira issue with the leading # stripped', () => {
    const root = tempRoot();
    const { b } = twoFeatures(root);
    expect(resolveFeatureRef(root, 'ses_1', 'PQD-7')).toBe(b);
  });

  it('falls back to a slug substring match', () => {
    const root = tempRoot();
    const { a } = twoFeatures(root);
    expect(resolveFeatureRef(root, 'ses_1', 'route')).toBe(a);
  });

  it('returns null for an unknown ref', () => {
    const root = tempRoot();
    twoFeatures(root);
    expect(resolveFeatureRef(root, 'ses_1', 'nope')).toBeNull();
  });

  it('resumeFeatureByRef reactivates a paused feature and returns its dir', () => {
    const root = tempRoot();
    const { a, b } = twoFeatures(root);
    expect(currentFeature(root, 'ses_1')).toBe(b); // B active, A paused
    const resumed = resumeFeatureByRef(root, 'ses_1', '339');
    expect(resumed).toBe(a);
    expect(currentFeature(root, 'ses_1')).toBe(a);
    expect(readSessionControl(root, 'ses_1').paused).toContain(b);
  });

  it('resumeFeatureByRef returns null when the ref matches nothing', () => {
    const root = tempRoot();
    twoFeatures(root);
    expect(resumeFeatureByRef(root, 'ses_1', 'missing')).toBeNull();
  });

  // Issue #540 — the session control is not the whole record. `markDone` drops a
  // finished change from it, so a control-only lookup left a complete bundle
  // unreachable through every supported command.
  it('resolves a ref against a bundle the session control has released (#540)', () => {
    const root = tempRoot();
    const { a } = twoFeatures(root);
    closeActiveFeature(root, 'ses_1'); // closes B, clearing `active`
    markDone(root, 'ses_1', a); // and drop A, so the control holds neither
    expect(readSessionControl(root, 'ses_1')).toMatchObject({ active: null, paused: [] });
    expect(resolveFeatureRef(root, 'ses_1', '339')).toBe(a);
    expect(resolveFeatureRef(root, 'ses_1', '01JABCDEFGHJKMNPQRSTVWXYZ0')).toBe(a);
    expect(resolveFeatureRef(root, 'ses_1', 'route')).toBe(a);
  });

  it('resolves a ref for a session that never saw the bundle (a rotated id) — #540', () => {
    const root = tempRoot();
    const { a } = twoFeatures(root);
    expect(resolveFeatureRef(root, 'ses_rotated', '339')).toBe(a);
  });

  it('prefers the session control over the on-disk sweep for the same ref (#540)', () => {
    const root = tempRoot();
    const { a, b } = twoFeatures(root);
    // Both slugs contain "thing"-free text, so make the substring ambiguous: `b` is
    // active (control tier) and `a` is only on disk, so the control tier must win.
    expect(resolveFeatureRef(root, 'ses_1', b)).toBe(b);
    markDone(root, 'ses_1', a);
    expect(resolveFeatureRef(root, 'ses_1', b)).toBe(b);
  });

  it('resumeFeatureByRef activates a released bundle and pauses the outgoing one (#540)', () => {
    const root = tempRoot();
    const { a, b } = twoFeatures(root);
    markDone(root, 'ses_1', a); // A is now on disk only; B stays active
    expect(currentFeature(root, 'ses_1')).toBe(b);

    expect(resumeFeatureByRef(root, 'ses_1', '339')).toBe(a);

    expect(currentFeature(root, 'ses_1')).toBe(a);
    // AC-2: replacing `active` never drops the outgoing change.
    expect(readSessionControl(root, 'ses_1').paused).toContain(b);
  });
});
