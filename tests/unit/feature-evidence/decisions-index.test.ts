// Issue #581 (FR-11, AC-15) — the bundle's decisions.json is an index of the tracked resolved
// packets linked to the change: id, category, tracked path and the sha256 of the tracked file.
// It never copies a packet body.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { sha256Hex } from '@/compliance/markdown.js';
import {
  collectFeatureDecisions,
  readFeatureDecisionsIndex,
  readIndexedDecisionViews,
  writeFeatureDecisionsIndex,
} from '@/feature-evidence/decisions-index.js';
import { updateFeatureRecord } from '@/feature-evidence/feature-record.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';

const SES = 'ses_decisions_index';
const ULID = '01JABCDEFGHJKMNPQRSTVWXYZ0';
const OTHER = '01JZZZZZZZZZZZZZZZZZZZZZZZ';
const RESOLVED = '.paqad/decisions/resolved';

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function project(): { root: string; dir: string } {
  const root = mkdtempSync(join(tmpdir(), 'paqad-decisions-index-'));
  roots.push(root);
  const dir = openFeatureChange(root, SES, {
    adapter: 'claude-code',
    title: 'decisions',
    issue: '581',
    ulid: ULID,
  });
  return { root, dir };
}

/** Write a tracked resolved packet and return its raw bytes. */
function packet(root: string, id: string, body: Record<string, unknown>): string {
  mkdirSync(join(root, RESOLVED), { recursive: true });
  const raw = `${JSON.stringify({ id, ...body }, null, 2)}\n`;
  writeFileSync(join(root, RESOLVED, `${id}.json`), raw, 'utf8');
  return raw;
}

/** Now, read after the change opened so it falls inside the change's window. */
const now = (): string => new Date(Date.now() + 1000).toISOString();

describe('collectFeatureDecisions — which packets belong to the change', () => {
  it('returns nothing when no packet was ever resolved', () => {
    const { root, dir } = project();
    expect(collectFeatureDecisions(root, dir)).toEqual([]);
  });

  it('links by the change field, a context token, or the time the change was open', () => {
    const { root, dir } = project();
    const named = packet(root, 'D-01JAAAAAAAAAAAAAAAAAAAAAA1', {
      category: 'architecture-path',
      change: ULID,
      rationale: 'secret body text',
      resolved_at: '2000-01-01T00:00:00.000Z',
    });
    packet(root, 'D-01JAAAAAAAAAAAAAAAAAAAAAA2', {
      category: 'architecture-path',
      change: OTHER,
      resolved_at: now(),
    });
    packet(root, 'D-01JAAAAAAAAAAAAAAAAAAAAAA3', {
      category: 'workflow-or-tool',
      context: `waive it [paqad-ve-readiness 581-decisions-${ULID}]`,
      resolved_at: '2000-01-01T00:00:00.000Z',
    });
    // An automated packet, resolved while the change was open.
    mkdirSync(join(root, RESOLVED), { recursive: true });
    writeFileSync(
      join(root, RESOLVED, 'D-01JAAAAAAAAAAAAAAAAAAAAAA4.json'),
      JSON.stringify({
        decision_id: 'D-01JAAAAAAAAAAAAAAAAAAAAAA4',
        category: 'delivery.open_pr',
        human_response: { chosen_option_key: 'yes', responded_at: now() },
      }),
      'utf8',
    );
    // Resolved long before the change opened, naming nothing: not this change's.
    packet(root, 'D-01JAAAAAAAAAAAAAAAAAAAAAA5', {
      category: 'ux-pattern',
      resolved_at: '2000-01-01T00:00:00.000Z',
    });
    // Only a creation time, inside the window; no category.
    packet(root, 'D-01JAAAAAAAAAAAAAAAAAAAAAA6', { created_at: now() });
    // No time at all, a malformed file, an array, and a stray non-packet file are skipped.
    packet(root, 'D-01JAAAAAAAAAAAAAAAAAAAAAA7', { category: 'ux-pattern' });
    writeFileSync(join(root, RESOLVED, 'D-01JAAAAAAAAAAAAAAAAAAAAAA8.json'), '{nope', 'utf8');
    writeFileSync(join(root, RESOLVED, 'D-01JAAAAAAAAAAAAAAAAAAAAAA9.json'), '[]', 'utf8');
    writeFileSync(join(root, RESOLVED, 'notes.txt'), 'x', 'utf8');

    const entries = collectFeatureDecisions(root, dir);
    expect(entries.map((entry) => [entry.id, entry.category])).toEqual([
      ['D-01JAAAAAAAAAAAAAAAAAAAAAA1', 'architecture-path'],
      ['D-01JAAAAAAAAAAAAAAAAAAAAAA3', 'workflow-or-tool'],
      ['D-01JAAAAAAAAAAAAAAAAAAAAAA4', 'delivery.open_pr'],
      ['D-01JAAAAAAAAAAAAAAAAAAAAAA6', 'unknown'],
    ]);
    expect(entries[0]).toEqual({
      id: 'D-01JAAAAAAAAAAAAAAAAAAAAAA1',
      category: 'architecture-path',
      path: `${RESOLVED}/D-01JAAAAAAAAAAAAAAAAAAAAAA1.json`,
      content_hash: sha256Hex(named),
    });
  });

  it('falls back to the file name for a packet with no id', () => {
    const { root, dir } = project();
    mkdirSync(join(root, RESOLVED), { recursive: true });
    writeFileSync(
      join(root, RESOLVED, 'D-01JAAAAAAAAAAAAAAAAAAAAAB1.json'),
      JSON.stringify({ category: 'ux-pattern', change: ULID }),
      'utf8',
    );
    expect(collectFeatureDecisions(root, dir)[0]?.id).toBe('D-01JAAAAAAAAAAAAAAAAAAAAAB1');
  });

  it('closes the window when the change is done', () => {
    const { root, dir } = project();
    updateFeatureRecord(root, dir, { status: 'done' }, () => new Date('2001-01-01T00:00:00Z'));
    packet(root, 'D-01JAAAAAAAAAAAAAAAAAAAAAC1', { category: 'ux-pattern', resolved_at: now() });
    expect(collectFeatureDecisions(root, dir)).toEqual([]);
  });

  it('links only by change field or token when the bundle has no feature.json', () => {
    const { root, dir } = project();
    rmSync(join(root, featureFilePath(dir, 'feature')));
    packet(root, 'D-01JAAAAAAAAAAAAAAAAAAAAAD1', { category: 'ux-pattern', resolved_at: now() });
    packet(root, 'D-01JAAAAAAAAAAAAAAAAAAAAAD2', { category: 'ux-pattern', change: ULID });
    expect(collectFeatureDecisions(root, dir).map((entry) => entry.id)).toEqual([
      'D-01JAAAAAAAAAAAAAAAAAAAAAD2',
    ]);
  });
});

describe('writeFeatureDecisionsIndex', () => {
  it('writes no file for a change with no linked decision', () => {
    const { root, dir } = project();
    expect(writeFeatureDecisionsIndex(root, dir)).toEqual({
      path: null,
      decisions: [],
      written: false,
    });
    expect(readFeatureDecisionsIndex(root, dir)).toBeNull();
  });

  it('writes an index with the envelope header and never copies a packet body (AC-15)', () => {
    const { root, dir } = project();
    packet(root, 'D-01JAAAAAAAAAAAAAAAAAAAAAE1', {
      category: 'architecture-path',
      change: ULID,
      title: 'Where the trace lives',
      context: 'a long context only the tracked file holds',
      rationale: 'owner picked the map',
    });
    const result = writeFeatureDecisionsIndex(root, dir, { sessionId: SES });
    expect(result.written).toBe(true);
    expect(result.path).toBe(featureFilePath(dir, 'decisions'));
    const text = readFileSync(join(root, result.path!), 'utf8');
    const doc = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(doc).slice(0, 6)).toEqual([
      'schema_version',
      'doc_type',
      'change',
      'session_id',
      'recorded_at',
      'content_hash',
    ]);
    expect(doc).toMatchObject({ doc_type: 'paqad.decisions', change: ULID, session_id: SES });
    expect(text).not.toContain('owner picked the map');
    expect(text).not.toContain('a long context');
    expect(readFeatureDecisionsIndex(root, dir)).toEqual(result.decisions);
  });

  it('leaves an unchanged index alone, and rewrites it when a packet changes', () => {
    const { root, dir } = project();
    packet(root, 'D-01JAAAAAAAAAAAAAAAAAAAAAF1', { category: 'ux-pattern', change: ULID });
    writeFeatureDecisionsIndex(root, dir);
    const abs = join(root, featureFilePath(dir, 'decisions'));
    const before = readFileSync(abs, 'utf8');
    expect(writeFeatureDecisionsIndex(root, dir).written).toBe(false);
    expect(readFileSync(abs, 'utf8')).toBe(before);

    // The packet's link moves to another change: the index is rewritten, now empty.
    packet(root, 'D-01JAAAAAAAAAAAAAAAAAAAAAF1', { category: 'ux-pattern', change: OTHER });
    const again = writeFeatureDecisionsIndex(root, dir);
    expect(again.written).toBe(true);
    expect(readFeatureDecisionsIndex(root, dir)).toEqual([]);
  });

  it('reads a malformed index as absent', () => {
    const { root, dir } = project();
    const abs = join(root, featureFilePath(dir, 'decisions'));
    writeFileSync(abs, JSON.stringify({ decisions: 'x' }), 'utf8');
    expect(readFeatureDecisionsIndex(root, dir)).toBeNull();
    writeFileSync(abs, '{nope', 'utf8');
    expect(readFeatureDecisionsIndex(root, dir)).toBeNull();
  });
});

describe('readIndexedDecisionViews', () => {
  it('is empty without an index', () => {
    const { root, dir } = project();
    expect(readIndexedDecisionViews(root, dir)).toEqual([]);
  });

  it('joins each entry with the chosen option and rationale of its tracked file', () => {
    const { root, dir } = project();
    packet(root, 'D-01JAAAAAAAAAAAAAAAAAAAAAG1', {
      category: 'architecture-path',
      change: ULID,
      title: 'Where the trace lives',
      options: [{ option_key: 'map', label: 'A trace map' }],
      chosen: 'map',
      rationale: 'no reader churn',
    });
    mkdirSync(join(root, RESOLVED), { recursive: true });
    writeFileSync(
      join(root, RESOLVED, 'D-01JAAAAAAAAAAAAAAAAAAAAAG2.json'),
      JSON.stringify({
        decision_id: 'D-01JAAAAAAAAAAAAAAAAAAAAAG2',
        category: 'delivery.open_pr',
        change: ULID,
        question: 'Open a PR?',
        human_response: { chosen_option_key: 'draft', note: 'not ready' },
      }),
      'utf8',
    );
    packet(root, 'D-01JAAAAAAAAAAAAAAAAAAAAAG3', { category: 'ux-pattern', change: ULID });
    packet(root, 'D-01JAAAAAAAAAAAAAAAAAAAAAG4', { category: 'ux-pattern', change: ULID });
    writeFeatureDecisionsIndex(root, dir);
    // One tracked file is edited after indexing, one is deleted, one is no longer JSON.
    packet(root, 'D-01JAAAAAAAAAAAAAAAAAAAAAG3', { category: 'ux-pattern', change: ULID, x: 1 });
    rmSync(join(root, RESOLVED, 'D-01JAAAAAAAAAAAAAAAAAAAAAG4.json'));

    const views = readIndexedDecisionViews(root, dir);
    expect(views.map((view) => [view.id, view.state])).toEqual([
      ['D-01JAAAAAAAAAAAAAAAAAAAAAG1', 'current'],
      ['D-01JAAAAAAAAAAAAAAAAAAAAAG2', 'current'],
      ['D-01JAAAAAAAAAAAAAAAAAAAAAG3', 'changed'],
      ['D-01JAAAAAAAAAAAAAAAAAAAAAG4', 'missing'],
    ]);
    expect(views[0]).toMatchObject({
      title: 'Where the trace lives',
      chosen: 'map',
      chosen_label: 'A trace map',
      rationale: 'no reader churn',
    });
    expect(views[1]).toMatchObject({
      title: 'Open a PR?',
      chosen: 'draft',
      chosen_label: null,
      rationale: 'not ready',
    });
    expect(views[3]).toMatchObject({ title: null, chosen: null, rationale: null });

    writeFileSync(join(root, RESOLVED, 'D-01JAAAAAAAAAAAAAAAAAAAAAG3.json'), '{nope', 'utf8');
    expect(readIndexedDecisionViews(root, dir)[2]).toMatchObject({
      title: null,
      chosen: null,
      state: 'changed',
    });
  });
});
