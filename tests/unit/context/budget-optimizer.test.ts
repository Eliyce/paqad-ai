import { describe, expect, it } from 'vitest';

import { ContextBudgetOptimizer } from '@/context/budget-optimizer.js';
import { ContextEvictor } from '@/context/context-evictor.js';
import { TurnSummarizer } from '@/context/turn-summarizer.js';
import { PriorityClassifier } from '@/context/priority-classifier.js';
import type { ContextSegmentPriority } from '@/core/types/context.js';

// ── TurnSummarizer ─────────────────────────────────────────────────────────

describe('TurnSummarizer', () => {
  const summarizer = new TurnSummarizer();

  it('extracts decisions from turn text', () => {
    const text = 'We decided to use Postgres as the primary database. Going with Prisma ORM.';
    const result = summarizer.summarize(text, 0, '2024-01-01T00:00:00Z');
    expect(result.decisions.length).toBeGreaterThan(0);
    expect(result.decisions.some((d) => d.toLowerCase().includes('postgres'))).toBe(true);
  });

  it('extracts files touched from turn text', () => {
    const text =
      'Updated src/context/budget-enforcer.ts and tests/unit/context/hit-tracker.test.ts';
    const result = summarizer.summarize(text, 1, '2024-01-01T00:00:00Z');
    expect(result.files_touched).toContain('src/context/budget-enforcer.ts');
    expect(result.files_touched).toContain('tests/unit/context/hit-tracker.test.ts');
  });

  it('extracts blockers from turn text', () => {
    const text =
      'Cannot proceed because of missing env variable. Blocked by auth service being down.';
    const result = summarizer.summarize(text, 2, '2024-01-01T00:00:00Z');
    expect(result.blockers.length).toBeGreaterThan(0);
  });

  it('extracts next steps from turn text', () => {
    const text = 'Next step: write the migration script. TODO: run tests after changes.';
    const result = summarizer.summarize(text, 3, '2024-01-01T00:00:00Z');
    expect(result.next_steps.length).toBeGreaterThan(0);
  });

  it('sets correct turn_index and timestamp', () => {
    const ts = '2024-06-15T12:00:00Z';
    const result = summarizer.summarize('some text', 7, ts);
    expect(result.turn_index).toBe(7);
    expect(result.timestamp).toBe(ts);
  });

  it('caps decisions at 3', () => {
    const text = [
      'decided to use A',
      'decided to use B B B B B B B B BB',
      'decided to use C C C C C C C C CC',
      'decided to use D D D D D D D D DD',
    ].join('. ');
    const result = summarizer.summarize(text, 0, '2024-01-01T00:00:00Z');
    expect(result.decisions.length).toBeLessThanOrEqual(3);
  });

  it('caps blockers at 2', () => {
    const text =
      'blocked by issue A A A A A A A A. blocked by issue B B B B B B B B. blocked by issue C C C C C C C.';
    const result = summarizer.summarize(text, 0, '2024-01-01T00:00:00Z');
    expect(result.blockers.length).toBeLessThanOrEqual(2);
  });

  it('estimates tokens as ceil(length / 4)', () => {
    const text = 'abcd'; // 4 chars → 1 token
    const result = summarizer.summarize(text, 0, '2024-01-01T00:00:00Z');
    expect(result.original_tokens).toBe(1);
  });

  it('records non-zero summary_tokens based on the summarized payload', () => {
    const result = summarizer.summarize(
      'Updated src/context/turn-summarizer.ts. Next step: verify handoff token accounting.',
      2,
      '2024-01-01T00:00:00Z',
    );

    expect(result.summary_tokens).toBeGreaterThan(0);
    expect(result.summary_tokens).toBe(
      summarizer.estimateTokens(JSON.stringify({ ...result, summary_tokens: 0 })),
    );
  });

  it('returns empty arrays when no patterns match', () => {
    const result = summarizer.summarize(
      'Hello world, no patterns here.',
      0,
      '2024-01-01T00:00:00Z',
    );
    expect(result.decisions).toEqual([]);
    expect(result.files_touched).toEqual([]);
    expect(result.blockers).toEqual([]);
    expect(result.next_steps).toEqual([]);
  });
});

// ── ContextEvictor ─────────────────────────────────────────────────────────

describe('ContextEvictor', () => {
  const evictor = new ContextEvictor();

  const makeSegments = (): ContextSegmentPriority[] => [
    { tier: 'critical', content_type: 'rule', token_estimate: 500 },
    { tier: 'high', content_type: 'current-file', token_estimate: 300 },
    { tier: 'medium', content_type: 'stack-doc', token_estimate: 200 },
    { tier: 'low', content_type: 'stale-chunk', token_estimate: 100 },
    { tier: 'low', content_type: 'tangent', token_estimate: 80 },
  ];

  it('evicts nothing on green tier', () => {
    const segments = makeSegments();
    const result = evictor.evict(segments, 'green');
    expect(result.evicted_count).toBe(0);
    expect(result.tokens_reclaimed).toBe(0);
    expect(result.evicted_sources).toEqual([]);
    expect(result.evicted_segments).toEqual([]);
    expect(result.remaining_segments).toEqual(segments);
  });

  it('evicts only low-priority segments on yellow tier', () => {
    const result = evictor.evict(makeSegments(), 'yellow');
    expect(result.evicted_count).toBe(2);
    expect(result.tokens_reclaimed).toBe(180);
    expect(result.evicted_sources).toEqual(['stale-chunk', 'tangent']);
    expect(result.evicted_segments.map((segment) => segment.content_type)).toEqual([
      'stale-chunk',
      'tangent',
    ]);
    expect(result.remaining_segments.map((segment) => segment.content_type)).toEqual([
      'rule',
      'current-file',
      'stack-doc',
    ]);
  });

  it('evicts low + medium segments on amber tier', () => {
    const result = evictor.evict(makeSegments(), 'amber');
    expect(result.evicted_count).toBe(3);
    expect(result.tokens_reclaimed).toBe(380);
    expect(result.evicted_sources).toContain('stack-doc');
    expect(result.evicted_sources).toContain('stale-chunk');
    expect(result.evicted_sources).toContain('tangent');
  });

  it('evicts low + medium segments on red tier (same as amber)', () => {
    const result = evictor.evict(makeSegments(), 'red');
    expect(result.evicted_count).toBe(3);
    expect(result.tokens_reclaimed).toBe(380);
  });

  it('never evicts critical or high segments', () => {
    const result = evictor.evict(makeSegments(), 'red');
    expect(result.evicted_sources).not.toContain('rule');
    expect(result.evicted_sources).not.toContain('current-file');
  });

  it('handles empty segments array', () => {
    const result = evictor.evict([], 'red');
    expect(result.evicted_count).toBe(0);
    expect(result.tokens_reclaimed).toBe(0);
    expect(result.evicted_sources).toEqual([]);
    expect(result.evicted_segments).toEqual([]);
    expect(result.remaining_segments).toEqual([]);
  });

  it('keeps the original input array unchanged while returning the retained list', () => {
    const segments = makeSegments();
    const snapshot = [...segments];

    const result = evictor.evict(segments, 'amber');

    expect(segments).toEqual(snapshot);
    expect(result.remaining_segments).not.toBe(segments);
    expect(result.remaining_segments).toHaveLength(2);
  });
});

// ── ContextBudgetOptimizer.classifyTier (via evaluate) ────────────────────

describe('ContextBudgetOptimizer.evaluate', () => {
  function makeOptimizer(strategy: 'aggressive' | 'balanced' | 'conservative') {
    return new ContextBudgetOptimizer(
      new TurnSummarizer(),
      new PriorityClassifier(),
      new ContextEvictor(),
      '/tmp/test-project',
      { strategy, summarize_after_turns: 15 },
    );
  }

  // ── balanced strategy ───────────────────────────────────────────────────

  it('balanced: returns green + continue at 50% usage', async () => {
    const opt = makeOptimizer('balanced');
    const { action, tier } = await opt.evaluate(5000, 10000);
    expect(tier).toBe('green');
    expect(action).toBe('continue');
  });

  it('balanced: returns yellow + continue at 65% usage', async () => {
    const opt = makeOptimizer('balanced');
    const { action, tier } = await opt.evaluate(6500, 10000);
    expect(tier).toBe('yellow');
    expect(action).toBe('continue');
  });

  it('balanced: returns amber + warn at 85% usage', async () => {
    const opt = makeOptimizer('balanced');
    const { action, tier } = await opt.evaluate(8500, 10000);
    expect(tier).toBe('amber');
    expect(action).toBe('warn');
  });

  it('balanced: returns red + compact at 95% usage', async () => {
    const opt = makeOptimizer('balanced');
    const { action, tier } = await opt.evaluate(9500, 10000);
    expect(tier).toBe('red');
    expect(action).toBe('compact');
  });

  it('forces compact when hit rate falls below the configured target', async () => {
    const opt = makeOptimizer('balanced');
    const { action, tier } = await opt.evaluate(5000, 10000, {
      current_hit_rate: 0.5,
      target_hit_rate: 0.7,
    });
    expect(tier).toBe('red');
    expect(action).toBe('compact');
  });

  // ── aggressive strategy ─────────────────────────────────────────────────

  it('aggressive: returns yellow at 55% usage', async () => {
    const opt = makeOptimizer('aggressive');
    const { tier } = await opt.evaluate(5500, 10000);
    expect(tier).toBe('yellow');
  });

  it('aggressive: returns amber at 75% usage', async () => {
    const opt = makeOptimizer('aggressive');
    const { tier } = await opt.evaluate(7500, 10000);
    expect(tier).toBe('amber');
  });

  it('aggressive: returns red at 90% usage', async () => {
    const opt = makeOptimizer('aggressive');
    const { tier } = await opt.evaluate(9000, 10000);
    expect(tier).toBe('red');
  });

  // ── conservative strategy ───────────────────────────────────────────────

  it('conservative: returns green at 65% usage', async () => {
    const opt = makeOptimizer('conservative');
    const { tier } = await opt.evaluate(6500, 10000);
    expect(tier).toBe('green');
  });

  it('conservative: returns yellow at 75% usage', async () => {
    const opt = makeOptimizer('conservative');
    const { tier } = await opt.evaluate(7500, 10000);
    expect(tier).toBe('yellow');
  });

  it('conservative: returns red at 97% usage', async () => {
    const opt = makeOptimizer('conservative');
    const { tier } = await opt.evaluate(9700, 10000);
    expect(tier).toBe('red');
  });
});

// ── ContextBudgetOptimizer.summarizeTurns ─────────────────────────────────

describe('ContextBudgetOptimizer.summarizeTurns', () => {
  const optimizer = new ContextBudgetOptimizer(
    new TurnSummarizer(),
    new PriorityClassifier(),
    new ContextEvictor(),
    '/tmp/test-project',
  );

  const turns = [
    { text: 'decided to use Postgres for storage', timestamp: '2024-01-01T00:00:00Z' },
    { text: 'chose React as the UI framework framework', timestamp: '2024-01-01T01:00:00Z' },
    { text: 'Next step: deploy to staging', timestamp: '2024-01-01T02:00:00Z' },
  ];

  it('only summarizes turns before olderThanIndex', async () => {
    const result = await optimizer.summarizeTurns(turns, 2);
    expect(result).toHaveLength(2);
  });

  it('returns all turns when olderThanIndex equals length', async () => {
    const result = await optimizer.summarizeTurns(turns, turns.length);
    expect(result).toHaveLength(3);
  });

  it('returns empty array when olderThanIndex is 0', async () => {
    const result = await optimizer.summarizeTurns(turns, 0);
    expect(result).toHaveLength(0);
  });

  it('summarized turns have correct turn_index values', async () => {
    const result = await optimizer.summarizeTurns(turns, 3);
    expect(result[0].turn_index).toBe(0);
    expect(result[1].turn_index).toBe(1);
    expect(result[2].turn_index).toBe(2);
  });

  it('computes the summarize cutoff from auto_summarize_interval semantics', () => {
    expect(optimizer.summarizeBeforeIndex(3)).toBe(0);
    expect(optimizer.summarizeBeforeIndex(20)).toBe(5);
  });
});

describe('ContextBudgetOptimizer.fromProfile', () => {
  it('uses efficiency strategy, summarize interval, and model-aware max tokens from profile', async () => {
    const projectRoot = '/tmp/test-project-profile';
    const optimizer = ContextBudgetOptimizer.fromProfile(projectRoot, {
      efficiency: {
        context_budget_strategy: 'aggressive',
        auto_summarize_interval: 4,
      },
      model_routing: {
        default_model: 'gpt-5',
        fast_model: 'gpt-5-mini',
        reasoning_model: 'gpt-5-thinking',
      },
    });

    expect(optimizer.summarizeBeforeIndex(10)).toBe(6);
    expect(
      optimizer.resolveMaxTokens({
        model_routing: {
          default_model: 'gpt-5',
          fast_model: 'gpt-5-mini',
          reasoning_model: 'gpt-5-thinking',
        },
      }),
    ).toBe(30000);

    const result = await optimizer.evaluate(16000, 30000, { summarized_turn_count: 6 });
    expect(result).toEqual({ action: 'continue', tier: 'yellow' });
  });
});
