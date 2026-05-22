import { RelevanceScorer } from '@/context/relevance-scorer.js';
import type { Chunk } from '@/context/types.js';
import type { ScoringContext } from '@/context/relevance-scorer.js';

function makeChunk(id: string, sourceFile: string, content: string): Chunk {
  return {
    id,
    source_file: sourceFile,
    ast_node_type: 'function',
    ast_node_path: id,
    exported_symbols: [],
    content,
    char_count: content.length,
    content_hash: id,
  };
}

const AUTH_CHUNK = makeChunk('auth', 'src/auth/service.ts', 'export function canAuth() {}');
const BILLING_CHUNK = makeChunk(
  'billing',
  'src/billing/invoice.ts',
  'export function runBilling() {}',
);
const SESSION_CHUNK = makeChunk(
  'session',
  'src/auth/session.ts',
  'export function getSession() {}',
);

const baseCtx: ScoringContext = {
  keywords: ['auth'],
  sessionStartMs: Date.now(),
};

describe('RelevanceScorer.filterAndRank', () => {
  it('returns chunks and fusion_strategy object', () => {
    const scorer = new RelevanceScorer();
    const result = scorer.filterAndRank([AUTH_CHUNK, BILLING_CHUNK], baseCtx);
    expect(result).toHaveProperty('chunks');
    expect(result).toHaveProperty('fusion_strategy');
    expect(Array.isArray(result.chunks)).toBe(true);
  });

  it('fusion_strategy includes the 4 scoring signals', () => {
    const scorer = new RelevanceScorer();
    const { fusion_strategy } = scorer.filterAndRank([AUTH_CHUNK], baseCtx);
    expect(fusion_strategy.signals).toContain('vector:0.55');
    expect(fusion_strategy.signals).toContain('keyword:0.25');
    expect(fusion_strategy.signals).toContain('symbol:0.10');
    expect(fusion_strategy.signals).toContain('path:0.10');
  });

  it('scores auth chunk higher than billing chunk for auth keywords', () => {
    const scorer = new RelevanceScorer(0);
    const { chunks } = scorer.filterAndRank([BILLING_CHUNK, AUTH_CHUNK], baseCtx);
    expect(chunks[0]?.id).toBe('auth');
  });

  it('filters chunks below threshold', () => {
    // With default threshold 0.15, billing chunk (no auth keyword match) may be filtered
    const scorer = new RelevanceScorer(0.5);
    const { chunks } = scorer.filterAndRank([BILLING_CHUNK], {
      keywords: ['auth'],
      sessionStartMs: Date.now(),
    });
    expect(chunks).toHaveLength(0);
  });

  it('applies metadata filters before scoring', () => {
    const scorer = new RelevanceScorer(0);
    const { chunks, fusion_strategy } = scorer.filterAndRank(
      [AUTH_CHUNK, BILLING_CHUNK, SESSION_CHUNK],
      baseCtx,
      [{ type: 'module_path_prefix', value: 'src/billing' }],
    );
    // Only billing passes the filter (1 chunk < min 3 → fallback to all)
    expect(fusion_strategy.filter_fallback).toBe(true);
    expect(fusion_strategy.filters_applied).toEqual([]);
    // After fallback, all chunks are in corpus
    expect(chunks.length).toBeGreaterThan(0);
  });

  it('records filters_applied when metadata filtering changes the returned corpus', () => {
    const scorer = new RelevanceScorer(0);
    const { chunks, fusion_strategy } = scorer.filterAndRank(
      [
        BILLING_CHUNK,
        makeChunk('billing-two', 'src/billing/payment.ts', 'export function authBillingTwo() {}'),
        makeChunk(
          'billing-three',
          'src/billing/refund.ts',
          'export function authBillingThree() {}',
        ),
        AUTH_CHUNK,
      ],
      baseCtx,
      [{ type: 'module_path_prefix', value: 'src/billing' }],
    );

    expect(fusion_strategy.filter_fallback).toBeUndefined();
    expect(fusion_strategy.filters_applied).toContain('module_path_prefix');
    expect(chunks.every((chunk) => chunk.source_file.startsWith('src/billing'))).toBe(true);
  });

  it('filters_applied is empty when no filters provided', () => {
    const scorer = new RelevanceScorer(0);
    const { fusion_strategy } = scorer.filterAndRank([AUTH_CHUNK], baseCtx);
    expect(fusion_strategy.filters_applied).toHaveLength(0);
    expect(fusion_strategy.filter_fallback).toBeUndefined();
  });

  it('filters_applied is empty when filters array is empty', () => {
    const scorer = new RelevanceScorer(0);
    const { fusion_strategy } = scorer.filterAndRank([AUTH_CHUNK], baseCtx, []);
    expect(fusion_strategy.filters_applied).toHaveLength(0);
  });

  it('is deterministic — same input yields same output', () => {
    const scorer = new RelevanceScorer(0);
    const a = scorer.filterAndRank([AUTH_CHUNK, BILLING_CHUNK], baseCtx);
    const b = scorer.filterAndRank([AUTH_CHUNK, BILLING_CHUNK], baseCtx);
    expect(a.chunks.map((c) => c.id)).toEqual(b.chunks.map((c) => c.id));
  });
});
