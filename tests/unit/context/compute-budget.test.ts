import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContextBudgetEnforcer } from '@/context/budget-enforcer.js';
import { clearTokenizerCache } from '@/context/tokenizer-cache.js';
import type { ComputeBudgetInput, ModelCatalogEntry } from '@/core/types/context.js';

// Mock @xenova/transformers so the native tokenizer path is deterministic: one
// token per character. The fallback path is exercised by rejecting the load.
const { fromPretrained } = vi.hoisted(() => ({ fromPretrained: vi.fn() }));
vi.mock('@xenova/transformers', () => ({
  AutoTokenizer: { from_pretrained: fromPretrained },
}));

const TOKENIZER = 'cl100k_base';

function model(overrides: Partial<ModelCatalogEntry> = {}): ModelCatalogEntry {
  return { context_window_tokens: 1000, tokenizer_version: TOKENIZER, ...overrides };
}

function input(overrides: Partial<ComputeBudgetInput> = {}): ComputeBudgetInput {
  return {
    system_prompt: '',
    project_knowledge: '',
    retrieved_chunks: [],
    rolling_summary: null,
    recent_turns: '',
    new_user_message: '',
    reserved_output_tokens: 0,
    model: model(),
    compression_policy: 'standard',
    ...overrides,
  };
}

/** Build a string of exactly `n` characters → `n` tokens under the mock. */
function chars(n: number): string {
  return 'a'.repeat(n);
}

describe('ContextBudgetEnforcer.computeBudget', () => {
  beforeEach(() => {
    clearTokenizerCache();
    fromPretrained.mockReset();
    fromPretrained.mockResolvedValue({ encode: (text: string) => text.split('') });
  });

  it('AC1: names every slice cost, the total, percentage, and a valid band', async () => {
    const result = await ContextBudgetEnforcer.computeBudget(
      input({
        system_prompt: chars(100),
        project_knowledge: chars(50),
        rolling_summary: chars(4),
        recent_turns: chars(40),
        new_user_message: chars(10),
        retrieved_chunks: [chars(2), chars(3)],
        model: model({ context_window_tokens: 1000 }),
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.system_prompt_tokens).toBe(100);
    expect(result.project_knowledge_tokens).toBe(50);
    expect(result.rolling_summary_tokens).toBe(4);
    expect(result.recent_turns_tokens).toBe(40);
    expect(result.new_user_message_tokens).toBe(10);
    expect(result.retrieved_chunks_tokens).toBe(5);
    expect(result.reserved_output_tokens).toBe(0);
    expect(result.total_used).toBe(209);
    expect(result.usage_pct).toBeCloseTo(0.209, 10);
    expect(['comfortable', 'tightening', 'compressed', 'force-summary']).toContain(result.band);
    expect(result.band).toBe('comfortable');
    expect(result.tokenizer_version).toBe(TOKENIZER);
    expect(result.dropped_chunk_count).toBe(0);
    expect(result.compression_audit).toBeUndefined();
  });

  it('AC2: reports the tokenizer version and reuses the cached tokenizer', async () => {
    const first = await ContextBudgetEnforcer.computeBudget(input({ new_user_message: chars(8) }));
    const second = await ContextBudgetEnforcer.computeBudget(input({ new_user_message: chars(8) }));

    expect(first.ok && first.tokenizer_version).toBe(TOKENIZER);
    expect(second.ok && second.tokenizer_version).toBe(TOKENIZER);
    expect(fromPretrained).toHaveBeenCalledTimes(1);
  });

  it('AC3: applies policy band thresholds (aggressive vs conservative vs standard)', async () => {
    // usage_pct === 0.55 via a single 550-char slice in a 1000-token window.
    const at55 = (policy: ComputeBudgetInput['compression_policy']) =>
      ContextBudgetEnforcer.computeBudget(
        input({ new_user_message: chars(550), compression_policy: policy }),
      );

    const aggressive = await at55('aggressive');
    const conservative = await at55('conservative');
    const standard = await at55('standard');

    expect(aggressive.ok && aggressive.usage_pct).toBeCloseTo(0.55, 10);
    expect(aggressive.ok && aggressive.band).toBe('tightening'); // 55 ≥ 50, < 70
    expect(conservative.ok && conservative.band).toBe('comfortable'); // 55 < 70
    expect(standard.ok && standard.band).toBe('comfortable'); // 55 < 60
  });

  it('AC3: maps the upper standard bands (compressed and force-summary)', async () => {
    const compressed = await ContextBudgetEnforcer.computeBudget(
      input({ new_user_message: chars(850), compression_policy: 'standard' }),
    );
    const forceSummary = await ContextBudgetEnforcer.computeBudget(
      input({ new_user_message: chars(960), compression_policy: 'standard' }),
    );

    expect(compressed.ok && compressed.band).toBe('compressed'); // 85 ≥ 80, < 95
    expect(forceSummary.ok && forceSummary.band).toBe('force-summary'); // 96 ≥ 95
  });

  it('AC4: drops an over-budget chunk and records a compression audit', async () => {
    const result = await ContextBudgetEnforcer.computeBudget(
      input({
        system_prompt: chars(10),
        retrieved_chunks: [chars(200), chars(5)],
        model: model({ context_window_tokens: 100 }),
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dropped_chunk_count).toBe(1);
    expect(result.retrieved_chunks_tokens).toBe(5); // the small chunk is kept
    expect(result.compression_audit).toEqual({
      event: 'context.compression_applied',
      reason: 'chunk_exceeds_budget',
      dropped_chunk_count: 1,
    });
  });

  it('AC5: returns an explicit error when context_window_tokens is absent', async () => {
    const result = await ContextBudgetEnforcer.computeBudget(
      input({
        model: {
          context_window_tokens: undefined as unknown as number,
          tokenizer_version: TOKENIZER,
        },
      }),
    );

    expect(result).toEqual({
      ok: false,
      error: 'Model catalog entry is missing context_window_tokens',
      missing_field: 'context_window_tokens',
    });
  });

  it('edge: total_used never exceeds the context window', async () => {
    const result = await ContextBudgetEnforcer.computeBudget(
      input({
        system_prompt: chars(40),
        reserved_output_tokens: 30,
        retrieved_chunks: [chars(50), chars(10)],
        model: model({ context_window_tokens: 100 }),
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.total_used).toBeLessThanOrEqual(100);
    expect(result.dropped_chunk_count).toBe(1); // the 50-token chunk overflows the 30 remaining
  });

  it('edge: rolling_summary_tokens is the "—" sentinel when no summary exists', async () => {
    const result = await ContextBudgetEnforcer.computeBudget(input({ rolling_summary: null }));
    expect(result.ok && result.rolling_summary_tokens).toBe('—');
  });

  it('edge: reserved output tokens are capped at max_output_tokens', async () => {
    const result = await ContextBudgetEnforcer.computeBudget(
      input({
        reserved_output_tokens: 8192,
        model: model({ context_window_tokens: 200000, max_output_tokens: 4096 }),
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reserved_output_tokens).toBe(4096);
    expect(result.total_used).toBe(4096);
  });

  it('falls back to the heuristic tokenizer when @xenova/transformers is unavailable', async () => {
    fromPretrained.mockRejectedValue(new Error('module not installed'));

    const result = await ContextBudgetEnforcer.computeBudget(
      input({ system_prompt: chars(8) }), // ceil(8 / 4) = 2 tokens under the heuristic
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tokenizer_version).toBe('heuristic');
    expect(result.system_prompt_tokens).toBe(2);
  });
});
