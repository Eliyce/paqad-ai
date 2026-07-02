import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readSessionDoc } from '@/session-ledger/ledger.js';
import {
  ANALYTICS_TAG_DOC_TYPE,
  composeAnalyticsMap,
  extractAnalyticsMarkers,
  foldAnalyticsTagSession,
  openAnalyticsTagConversation,
  parseAndRecordAnalyticsTags,
  recordAnalyticsTag,
  recordLiveAnalyticsTags,
  reconcileAnalyticsMap,
  renderAnalyticsMapTable,
  validateAnalyticsTagRow,
  type AnalyticsTagRow,
} from '@/analytics-tag/index.js';

let tick = 0;
const clock = () => new Date(1_700_000_000_000 + tick++ * 1000);
let root: string;

beforeEach(() => {
  tick = 0;
  root = mkdtempSync(join(tmpdir(), 'paqad-analytics-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const CTX = (over: Record<string, unknown> = {}) => ({
  sessionId: 'ses_test',
  adapter: 'claude-code',
  analyticsEnabled: true,
  now: clock,
  ...over,
});

function rows(): AnalyticsTagRow[] {
  return readSessionDoc(root, ANALYTICS_TAG_DOC_TYPE, 'ses_test') as unknown as AnalyticsTagRow[];
}

function validRow(over: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    doc_type: ANALYTICS_TAG_DOC_TYPE,
    kind: 'tag_added',
    session_id: 'ses_test',
    conversation_ordinal: 1,
    ts: '2026-07-01T00:00:00.000Z',
    adapter: 'claude-code',
    tag_name: 'checkout_completed',
    tag_provider: 'ga4',
    source_path: 'src/checkout/analytics.ts',
    content_hash: 'abc',
    ...over,
  };
}

describe('validateAnalyticsTagRow', () => {
  it('accepts a well-formed row', () => {
    expect(validateAnalyticsTagRow(validRow())).toEqual([]);
  });
  it('rejects an unknown kind', () => {
    expect(validateAnalyticsTagRow(validRow({ kind: 'bogus' })).length).toBeGreaterThan(0);
  });
  it('rejects an unknown extra property (additionalProperties: false)', () => {
    expect(validateAnalyticsTagRow(validRow({ surprise: 1 })).length).toBeGreaterThan(0);
  });
  it('rejects a missing required envelope field', () => {
    const row = validRow();
    delete (row as Record<string, unknown>).session_id;
    expect(validateAnalyticsTagRow(row).length).toBeGreaterThan(0);
  });
});

describe('recordAnalyticsTag', () => {
  it('AC-3: records an open + tag_added row when enabled', () => {
    const row = recordAnalyticsTag(
      root,
      { tagName: 'checkout_completed', tagProvider: 'ga4', sourcePath: 'src/checkout.ts' },
      CTX(),
    );
    expect(row?.kind).toBe('tag_added');
    expect(row?.tag_name).toBe('checkout_completed');
    const all = rows();
    expect(all[0].kind).toBe('open');
    expect(all.some((r) => r.kind === 'tag_added' && r.tag_name === 'checkout_completed')).toBe(
      true,
    );
    expect(validateAnalyticsTagRow(row)).toEqual([]);
  });

  it('AC-2: OFF is silent — no row and no ledger dir when disabled', () => {
    const row = recordAnalyticsTag(root, { tagName: 'x' }, CTX({ analyticsEnabled: false }));
    expect(row).toBeNull();
    expect(rows()).toEqual([]);
  });

  it('defaults analyticsEnabled to off (silent) when the flag is omitted', () => {
    expect(recordAnalyticsTag(root, { tagName: 'x' }, { sessionId: 'ses_test' })).toBeNull();
  });

  it('AC-4: best-effort — returns null and never throws on an unwritable root', () => {
    const filePath = join(root, 'not-a-dir');
    writeFileSync(filePath, 'x', 'utf8');
    expect(() =>
      recordAnalyticsTag(filePath, { tagName: 'x' }, CTX({ sessionId: 'ses_z' })),
    ).not.toThrow();
    expect(recordAnalyticsTag(filePath, { tagName: 'x' }, CTX({ sessionId: 'ses_z' }))).toBeNull();
  });

  it('reuses the current open conversation ordinal across writes', () => {
    recordAnalyticsTag(root, { tagName: 'a' }, CTX());
    recordAnalyticsTag(root, { tagName: 'b' }, CTX());
    const ordinals = new Set(rows().map((r) => r.conversation_ordinal));
    expect(ordinals.size).toBe(1);
  });

  it('openAnalyticsTagConversation opens a unit when enabled and no-ops when disabled', () => {
    expect(openAnalyticsTagConversation(root, CTX({ analyticsEnabled: false }))).toBeNull();
    const opened = openAnalyticsTagConversation(root, CTX());
    expect(opened?.ordinal).toBeGreaterThan(0);
  });
});

describe('foldAnalyticsTagSession', () => {
  it('AC-5: folds tag counts without an LLM in the loop', () => {
    recordAnalyticsTag(root, { tagName: 'a', tagProvider: 'ga4', sourcePath: 'f.ts' }, CTX());
    recordAnalyticsTag(root, { tagName: 'a', tagProvider: 'ga4', sourcePath: 'f.ts' }, CTX());
    recordAnalyticsTag(root, { tagName: 'b', tagProvider: 'segment', sourcePath: 'g.ts' }, CTX());
    const fold = foldAnalyticsTagSession(root, 'ses_test');
    expect(fold.totals.tag_added_count).toBe(3);
    expect(fold.totals.distinct_tags).toBe(2);
    expect(fold.totals.providers).toEqual(['ga4', 'segment']);
    const a = fold.tags.find((t) => t.tag_name === 'a');
    expect(a?.occurrences).toBe(2);
  });

  it('returns an empty fold for a session with no rows', () => {
    expect(foldAnalyticsTagSession(root, 'nope').totals.tag_added_count).toBe(0);
  });
});

describe('extractAnalyticsMarkers', () => {
  it('parses name, optional provider and path', () => {
    const markers = extractAnalyticsMarkers(
      [
        'paqad:analytics-tag checkout_completed ga4 src/checkout.ts',
        '> paqad:analytics-tag signup_started',
      ].join('\n'),
    );
    expect(markers).toEqual([
      { tagName: 'checkout_completed', tagProvider: 'ga4', sourcePath: 'src/checkout.ts' },
      { tagName: 'signup_started', tagProvider: null, sourcePath: null },
    ]);
  });
});

describe('parseAndRecordAnalyticsTags', () => {
  const transcript = (text: string) =>
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: text } });

  it('AC-8: records from a marker, attributing the host adapter', () => {
    const n = parseAndRecordAnalyticsTags({
      projectRoot: root,
      transcriptText: transcript('paqad:analytics-tag checkout_completed ga4'),
      sessionId: 'ses_test',
      adapter: 'gemini-cli',
      analyticsEnabled: true,
      now: clock,
    });
    expect(n).toBe(1);
    const added = rows().find((r) => r.kind === 'tag_added');
    expect(added?.adapter).toBe('gemini-cli');
    expect(added?.tag_provider).toBe('ga4');
  });

  it('AC-9: idempotent — re-parsing the same marker records nothing new', () => {
    const args = {
      projectRoot: root,
      transcriptText: transcript('paqad:analytics-tag checkout_completed ga4'),
      sessionId: 'ses_test',
      analyticsEnabled: true,
      now: clock,
    };
    expect(parseAndRecordAnalyticsTags(args)).toBe(1);
    expect(parseAndRecordAnalyticsTags(args)).toBe(0);
  });

  it('records nothing when analytics is disabled', () => {
    expect(
      parseAndRecordAnalyticsTags({
        projectRoot: root,
        transcriptText: transcript('paqad:analytics-tag x'),
        sessionId: 'ses_test',
        analyticsEnabled: false,
      }),
    ).toBe(0);
  });

  it('ignores a marker quoted in non-assistant (user) transcript content', () => {
    const userLine = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: 'paqad:analytics-tag injected_by_user' },
    });
    expect(
      parseAndRecordAnalyticsTags({
        projectRoot: root,
        transcriptText: userLine,
        sessionId: 'ses_test',
        analyticsEnabled: true,
      }),
    ).toBe(0);
  });

  it('returns 0 on empty transcript', () => {
    expect(
      parseAndRecordAnalyticsTags({
        projectRoot: root,
        sessionId: 'ses_test',
        analyticsEnabled: true,
      }),
    ).toBe(0);
  });
});

describe('recordLiveAnalyticsTags', () => {
  it('records a tag_added row from an analytics call site in the edit', () => {
    const n = recordLiveAnalyticsTags({
      projectRoot: root,
      sessionId: 'ses_test',
      targetPath: 'src/checkout/track.ts',
      newText: "posthog.capture('checkout_completed', { total })",
      analyticsEnabled: true,
      now: clock,
    });
    expect(n).toBe(1);
    const added = rows().find((r) => r.kind === 'tag_added');
    expect(added?.tag_name).toBe('checkout_completed');
    expect(added?.tag_provider).toBe('posthog');
    expect(added?.source_path).toBe('src/checkout/track.ts');
  });

  it('is idempotent for the same call site on re-run', () => {
    const args = {
      projectRoot: root,
      sessionId: 'ses_test',
      targetPath: 'src/t.ts',
      newText: "analytics.track('signup_started')",
      analyticsEnabled: true,
      now: clock,
    };
    expect(recordLiveAnalyticsTags(args)).toBe(1);
    expect(recordLiveAnalyticsTags(args)).toBe(0);
  });

  it('skips framework-internal .paqad files and no-ops when disabled or empty', () => {
    expect(
      recordLiveAnalyticsTags({
        projectRoot: root,
        sessionId: 'ses_test',
        targetPath: '.paqad/whatever.ts',
        newText: "posthog.capture('x')",
        analyticsEnabled: true,
      }),
    ).toBe(0);
    expect(
      recordLiveAnalyticsTags({
        projectRoot: root,
        sessionId: 'ses_test',
        targetPath: 'src/a.ts',
        newText: "posthog.capture('x')",
        analyticsEnabled: false,
      }),
    ).toBe(0);
    expect(
      recordLiveAnalyticsTags({
        projectRoot: root,
        sessionId: 'ses_test',
        targetPath: 'src/a.ts',
        newText: 'const x = 1;',
        analyticsEnabled: true,
      }),
    ).toBe(0);
  });
});

describe('tracking-map registry', () => {
  it('AC-10: reconcile rewrites the table from rows and preserves the preamble', () => {
    recordAnalyticsTag(
      root,
      { tagName: 'checkout_completed', tagProvider: 'ga4', sourcePath: 'src/checkout.ts' },
      CTX(),
    );
    const first = reconcileAnalyticsMap(root);
    expect(first.tagCount).toBe(1);
    expect(first.content).toContain('checkout_completed');
    expect(first.content).toContain('Generated — do not hand-edit');

    // Hand-edit the preamble, then reconcile again: preamble preserved, table regenerated.
    const edited = first.content.replace(
      'How analytics is used here',
      'How analytics is used here\n\nWe use snake_case verb_object everywhere.',
    );
    writeFileSync(join(root, first.path), edited, 'utf8');
    recordAnalyticsTag(root, { tagName: 'signup_started', tagProvider: 'segment' }, CTX());
    const second = reconcileAnalyticsMap(root);
    expect(second.content).toContain('We use snake_case verb_object everywhere.');
    expect(second.content).toContain('signup_started');
    expect(second.tagCount).toBe(2);
  });

  it('renders an empty-state table when nothing is recorded', () => {
    expect(renderAnalyticsMapTable(root)).toContain('no tags recorded yet');
  });

  it('composeAnalyticsMap escapes pipes in cells', () => {
    const table = composeAnalyticsMap('pre', '| a\\|b |');
    expect(table).toContain('a\\|b');
    expect(table).toContain('pre');
  });
});

describe('coverage edges', () => {
  it('redacts a note and keeps it off the identity hash', () => {
    const a = recordAnalyticsTag(root, { tagName: 't', note: 'plain note' }, CTX());
    const b = recordAnalyticsTag(root, { tagName: 't', note: 'different note' }, CTX());
    expect(a?.note).toBe('plain note');
    // note is excluded from the hash, so two writes with the same identity match.
    expect(a?.content_hash).toBe(b?.content_hash);
  });

  it('openAnalyticsTagConversation is best-effort on an unwritable root', () => {
    const filePath = join(root, 'file');
    writeFileSync(filePath, 'x', 'utf8');
    expect(openAnalyticsTagConversation(filePath, CTX({ sessionId: 'ses_q' }))).toBeNull();
  });

  it('fold sorts same-name tags by source path and tolerates null paths', () => {
    recordAnalyticsTag(root, { tagName: 'evt', tagProvider: 'ga4', sourcePath: 'b.ts' }, CTX());
    recordAnalyticsTag(root, { tagName: 'evt', tagProvider: 'ga4', sourcePath: 'a.ts' }, CTX());
    recordAnalyticsTag(root, { tagName: 'evt', tagProvider: null, sourcePath: null }, CTX());
    const fold = foldAnalyticsTagSession(root, 'ses_test');
    const paths = fold.tags.map((t) => t.source_path);
    expect(paths).toEqual([null, 'a.ts', 'b.ts']);
  });

  it('validateAnalyticsTagRow reports root-level and nested-field errors', () => {
    expect(validateAnalyticsTagRow(null).length).toBeGreaterThan(0);
    expect(validateAnalyticsTagRow({}).length).toBeGreaterThan(0);
    // A nested type error yields a non-root instancePath (the other side of `||`).
    const errs = validateAnalyticsTagRow(validRow({ conversation_ordinal: 'nope' }));
    expect(errs.some((e) => e.includes('conversation_ordinal'))).toBe(true);
  });

  it('defaults the adapter to "unknown" when none is supplied', () => {
    const row = recordAnalyticsTag(
      root,
      { tagName: 'na' },
      { sessionId: 'ses_na', analyticsEnabled: true, now: clock },
    );
    expect(row?.adapter).toBe('unknown');
    expect(
      openAnalyticsTagConversation(root, { sessionId: 'ses_na2', analyticsEnabled: true }),
    ).not.toBeNull();
  });

  it('records against an explicitly supplied ordinal', () => {
    const opened = openAnalyticsTagConversation(root, CTX({ sessionId: 'ses_ord' }));
    const row = recordAnalyticsTag(
      root,
      { tagName: 'z' },
      CTX({ sessionId: 'ses_ord', ordinal: opened?.ordinal }),
    );
    expect(row?.conversation_ordinal).toBe(opened?.ordinal);
  });

  it('marker parse skips a malformed JSON line and still records the valid one', () => {
    const mixed = [
      '{ not valid json',
      JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: 'paqad:analytics-tag evt_mixed ga4' },
      }),
    ].join('\n');
    expect(
      parseAndRecordAnalyticsTags({
        projectRoot: root,
        transcriptText: mixed,
        sessionId: 'ses_mixed',
        analyticsEnabled: true,
        now: clock,
      }),
    ).toBe(1);
  });

  it('marker parse handles array content blocks and a raw (non-JSON) transcript', () => {
    const arrayContent = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'paqad:analytics-tag evt_a ga4' },
          { type: 'tool_use', id: 'x' },
        ],
      },
    });
    expect(
      parseAndRecordAnalyticsTags({
        projectRoot: root,
        transcriptText: arrayContent,
        sessionId: 'ses_arr',
        analyticsEnabled: true,
        now: clock,
      }),
    ).toBe(1);
    // A plain-text (non-JSON) transcript falls back to a raw scan.
    expect(
      parseAndRecordAnalyticsTags({
        projectRoot: root,
        transcriptText: 'paqad:analytics-tag evt_b segment',
        sessionId: 'ses_raw',
        analyticsEnabled: true,
        now: clock,
      }),
    ).toBe(1);
  });

  it('live writer de-dupes against an open row and a prior tag row', () => {
    // First edit records checkout_completed and opens the unit (an `open` row exists).
    recordLiveAnalyticsTags({
      projectRoot: root,
      sessionId: 'ses_live',
      targetPath: 'src/a.ts',
      newText: "posthog.capture('checkout_completed')",
      analyticsEnabled: true,
      now: clock,
    });
    // A second edit that re-adds the same call plus a new one records only the new one.
    const n = recordLiveAnalyticsTags({
      projectRoot: root,
      sessionId: 'ses_live',
      targetPath: 'src/a.ts',
      newText: "posthog.capture('checkout_completed'); posthog.capture('checkout_failed')",
      analyticsEnabled: true,
      now: clock,
    });
    expect(n).toBe(1);
  });

  it('live writer accepts an absolute target path and an explicit adapter', () => {
    const n = recordLiveAnalyticsTags({
      projectRoot: root,
      sessionId: 'ses_abs',
      targetPath: join(root, 'src/abs.ts'),
      newText: "mixpanel.track('purchase_made')",
      adapter: 'codex-cli',
      analyticsEnabled: true,
      now: clock,
    });
    expect(n).toBe(1);
    const added = readSessionDoc(
      root,
      ANALYTICS_TAG_DOC_TYPE,
      'ses_abs',
    ) as unknown as AnalyticsTagRow[];
    const tag = added.find((r) => r.kind === 'tag_added');
    expect(tag?.source_path).toBe('src/abs.ts');
    expect(tag?.adapter).toBe('codex-cli');
  });

  it('marker parse reads a top-level role/content transcript shape', () => {
    const topLevel = JSON.stringify({
      role: 'assistant',
      content: 'paqad:analytics-tag top_level_evt',
    });
    expect(
      parseAndRecordAnalyticsTags({
        projectRoot: root,
        transcriptText: topLevel,
        sessionId: 'ses_top',
        analyticsEnabled: true,
        now: clock,
      }),
    ).toBe(1);
  });

  it('marker parse de-dupes a provider-less marker on re-parse', () => {
    const args = {
      projectRoot: root,
      transcriptText: JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: 'paqad:analytics-tag bare_marker' },
      }),
      sessionId: 'ses_bm',
      analyticsEnabled: true,
      now: clock,
    };
    expect(parseAndRecordAnalyticsTags(args)).toBe(1);
    expect(parseAndRecordAnalyticsTags(args)).toBe(0);
  });
});
