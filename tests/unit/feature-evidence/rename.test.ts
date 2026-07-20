import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readFeaturePlan, writeFeaturePlan } from '@/feature-evidence/artifacts.js';
import { backfillFeatureSlug } from '@/feature-evidence/rename.js';
import { featureDir, featureFilePath, parseFeatureDirName } from '@/feature-evidence/paths.js';
import { readSessionControl } from '@/feature-evidence/session-control.js';
import {
  appendFeatureStageRow,
  openFeatureChange,
  readFeatureStageUnit,
} from '@/feature-evidence/stage-ledger.js';
import { computeSessionRowHash } from '@/session-ledger/ledger.js';

const roots: string[] = [];
function tempRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-fe-rename-'));
  roots.push(r);
  return r;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

const clock = () => new Date('2026-07-19T00:00:00.000Z');
const ULID = '01JABCDEFGHJKMNPQRSTVWXYZ0';

/** Open an untitled feature (the bare-marker flow) and return its `change-<ULID>` dir. */
function untitledFeature(root: string, sessionId = 'ses_1'): string {
  return openFeatureChange(root, sessionId, { adapter: 'claude-code', ulid: ULID, now: clock });
}

describe('backfillFeatureSlug', () => {
  it('renames a generic change-<ULID> dir to the descriptive slug, keeping the ULID (AC-1/AC-3)', () => {
    const root = tempRoot();
    const dir = untitledFeature(root);
    expect(dir).toBe(`change-${ULID}`);

    const result = backfillFeatureSlug(root, dir, 'fix(#403): back-fill generic slug', clock);
    expect(result.renamed).toBe(true);
    const parts = parseFeatureDirName(result.dirName);
    expect(parts).toMatchObject({ issue: '403', ulid: ULID });
    expect(parts?.slug).not.toBe('change');
    expect(existsSync(join(root, featureDir(result.dirName)))).toBe(true);
    expect(existsSync(join(root, featureDir(dir)))).toBe(false);
  });

  it('repoints the active pointer, paused entries, and other sessions (AC-2)', () => {
    const root = tempRoot();
    const dir = untitledFeature(root, 'ses_1');
    // A forked second session pointing at the same dir, and a third holding it paused.
    openFeatureChange(root, 'ses_2', {
      adapter: 'claude-code',
      title: 'other',
      ulid: ULID,
      now: clock,
    });
    // ses_2 got its own titled feature; make its paused stack carry the generic dir.
    const ses2 = readSessionControl(root, 'ses_2', clock);
    writeFileSync(
      join(root, '.paqad/ledger/feature-evidence/_session/ses_2.json'),
      `${JSON.stringify({ ...ses2, paused: [dir] }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      join(root, '.paqad/ledger/feature-evidence/_session/ses_3.json'),
      `${JSON.stringify({ ...readSessionControl(root, 'ses_3', clock), active: dir }, null, 2)}\n`,
      'utf8',
    );

    const result = backfillFeatureSlug(root, dir, 'add river agent project', clock);
    expect(result.renamed).toBe(true);
    expect(readSessionControl(root, 'ses_1', clock).active).toBe(result.dirName);
    expect(readSessionControl(root, 'ses_2', clock).paused).toContain(result.dirName);
    expect(readSessionControl(root, 'ses_3', clock).active).toBe(result.dirName);
  });

  it('rewrites artifact_paths carrying the old prefix and re-stamps the row hash (AC-2)', () => {
    const root = tempRoot();
    const dir = untitledFeature(root);
    appendFeatureStageRow(
      root,
      'ses_1',
      dir,
      {
        kind: 'stage_end',
        stage: 'specification',
        event_status: 'completed',
        evidence_source: 'live-mark',
        adapter: 'claude-code',
        artifact_paths: [`${featureDir(dir)}/specification.json`, 'docs/spec.md'],
        artifact_digest: 'd'.repeat(64),
      },
      clock,
    );

    const result = backfillFeatureSlug(root, dir, 'descriptive title here', clock);
    expect(result.renamed).toBe(true);
    const rows = readFeatureStageUnit(root, result.dirName);
    const end = rows.find((row) => row.kind === 'stage_end')!;
    expect(end.artifact_paths).toEqual([
      `${featureDir(result.dirName)}/specification.json`,
      'docs/spec.md',
    ]);
    // The rewritten row's content_hash was re-stamped by the script.
    expect(end.content_hash).toBe(computeSessionRowHash(end as Record<string, unknown>));
    // Untouched rows (no artifact_paths) survive verbatim.
    expect(rows.some((row) => row.kind === 'open')).toBe(true);
  });

  it('preserves an unparseable ledger line verbatim through the rewrite', () => {
    const root = tempRoot();
    const dir = untitledFeature(root);
    const ledger = join(root, featureFilePath(dir, 'stageEvidence'));
    const oldPath = `${featureDir(dir)}/plan.json`;
    writeFileSync(
      ledger,
      `not-json ${oldPath}\n${JSON.stringify({ artifact_paths: [oldPath] })}\n`,
      'utf8',
    );

    const result = backfillFeatureSlug(root, dir, 'a real title', clock);
    expect(result.renamed).toBe(true);
    const raw = readFileSync(join(root, featureFilePath(result.dirName, 'stageEvidence')), 'utf8');
    expect(raw).toContain(`not-json ${oldPath}`);
    expect(raw).toContain(`${featureDir(result.dirName)}/plan.json`);
  });

  it('is a no-op for a descriptive dir, an empty title, a generic-deriving title, and an unparseable name (AC-5)', () => {
    const root = tempRoot();
    const titled = openFeatureChange(root, 'ses_t', {
      adapter: 'claude-code',
      title: 'Route first workflows',
      issue: '339',
      ulid: ULID,
      now: clock,
    });
    expect(backfillFeatureSlug(root, titled, 'a new title', clock)).toEqual({
      dirName: titled,
      renamed: false,
    });
    const dir = untitledFeature(root);
    expect(backfillFeatureSlug(root, dir, '   ', clock).renamed).toBe(false);
    expect(backfillFeatureSlug(root, dir, 'Change!', clock).renamed).toBe(false);
    expect(backfillFeatureSlug(root, 'not-a-feature-dir', 'title', clock).renamed).toBe(false);
  });

  it('refuses to clobber an existing target dir (AC-5)', () => {
    const root = tempRoot();
    const dir = untitledFeature(root);
    mkdirSync(join(root, featureDir(`descriptive-title-${ULID}`)), { recursive: true });
    const result = backfillFeatureSlug(root, dir, 'descriptive title', clock);
    expect(result).toEqual({ dirName: dir, renamed: false });
    expect(readSessionControl(root, 'ses_1', clock).active).toBe(dir);
  });

  it('renames a bundle that has no _session controls at all', () => {
    const root = tempRoot();
    const dir = `change-${ULID}`;
    mkdirSync(join(root, featureDir(dir)), { recursive: true });
    const result = backfillFeatureSlug(root, dir, 'no controls yet', clock);
    expect(result.renamed).toBe(true);
    expect(existsSync(join(root, featureDir(result.dirName)))).toBe(true);
  });

  it('skips non-control files in _session and controls not referencing the dir', () => {
    const root = tempRoot();
    const dir = untitledFeature(root);
    const sessionDir = join(root, '.paqad/ledger/feature-evidence/_session');
    writeFileSync(join(sessionDir, 'README.txt'), 'not a control', 'utf8');
    writeFileSync(
      join(sessionDir, 'ses_other.json'),
      `${JSON.stringify({ ...readSessionControl(root, 'ses_other', clock), active: 'unrelated-dir' }, null, 2)}\n`,
      'utf8',
    );
    const result = backfillFeatureSlug(root, dir, 'skips unrelated controls', clock);
    expect(result.renamed).toBe(true);
    expect(readSessionControl(root, 'ses_other', clock).active).toBe('unrelated-dir');
  });

  it('leaves a row alone when the old prefix appears outside artifact_paths', () => {
    const root = tempRoot();
    const dir = untitledFeature(root);
    const ledger = join(root, featureFilePath(dir, 'stageEvidence'));
    const noteRow = JSON.stringify({ note: `${featureDir(dir)}/plan.json`, artifact_paths: null });
    writeFileSync(ledger, `${noteRow}\n`, 'utf8');
    const result = backfillFeatureSlug(root, dir, 'note only row', clock);
    expect(result.renamed).toBe(true);
    const raw = readFileSync(join(root, featureFilePath(result.dirName, 'stageEvidence')), 'utf8');
    expect(raw.trim()).toBe(noteRow);
  });

  it('repoints a rows-less feature that only lives in the session control', () => {
    const root = tempRoot();
    const dir = untitledFeature(root);
    // Simulate a control-only feature: drop the bundle dir but keep the pointer.
    rmSync(join(root, featureDir(dir)), { recursive: true, force: true });
    const result = backfillFeatureSlug(root, dir, 'pointer only feature', clock);
    expect(result.renamed).toBe(true);
    expect(readSessionControl(root, 'ses_1', clock).active).toBe(result.dirName);
  });
});

describe('writeFeaturePlan slug back-fill (issue #403)', () => {
  it('a titled compile on a generic feature renames the bundle and records the descriptive slug (AC-1/AC-3/AC-4)', () => {
    const root = tempRoot();
    const dir = untitledFeature(root);

    const result = writeFeaturePlan(root, 'ses_1', {
      summary: 'Back-fill the generic slug from the plan title',
      title: 'fix(#403): back-fill generic change bundle slug',
      reuse: {
        consulted: [{ source: 'grep', query: 'x', hits: 0 }],
        reusing: [],
        new_constructs: [],
      },
      now: clock,
    });
    expect(result.dirName).not.toBe(dir);
    expect(result.record.slug).not.toBe('change');
    expect(result.record).toMatchObject({ issue: '403', ulid: ULID });
    expect(result.path).toBe(featureFilePath(result.dirName, 'plan'));
    expect(readFeaturePlan(root, result.dirName)?.slug).toBe(result.record.slug);
    expect(readSessionControl(root, 'ses_1', clock).active).toBe(result.dirName);
    expect(existsSync(join(root, featureDir(dir)))).toBe(false);
  });

  it('an untitled compile leaves the generic dir in place (AC-5)', () => {
    const root = tempRoot();
    const dir = untitledFeature(root);
    const result = writeFeaturePlan(root, 'ses_1', {
      summary: 'no title given',
      reuse: {
        consulted: [{ source: 'grep', query: 'x', hits: 0 }],
        reusing: [],
        new_constructs: [],
      },
      now: clock,
    });
    expect(result.dirName).toBe(dir);
    expect(result.record.slug).toBe('change');
  });
});
