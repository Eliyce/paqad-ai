import { describe, expect, it } from 'vitest';

import { LEAN_RULE_CONTEXT_BUDGET_BYTES, composeRuleContext } from '@/context/rule-context.js';
import type { CompiledRule, CompiledRulesStore } from '@/core/types/planning.js';

// The product gate (issue #284): the resident rule footprint — the manifest plus the
// always-load rule text, with NO files in play — must stay under the documented byte
// budget. This fixture is a self-contained, deterministic stand-in for a realistic
// onboarded project's rule set (many rules, a handful always-on); the assertion does
// NOT read any live paqad-ai repo state, so the budget is a stable product contract,
// not a snapshot. Trigger-loaded rule text for the files in play rides on top and is
// bounded by the work, not by this budget.

function rule(partial: Partial<CompiledRule> & { rule_id: string }): CompiledRule {
  return {
    title: 'Representative rule title',
    source_path: `docs/instructions/rules/coding/${partial.rule_id}.md`,
    trigger_patterns: ['src/'],
    severity: 'should',
    summary: 'A one-line summary that the manifest caps to keep the resident slice compact.',
    raw_text: `# ${partial.rule_id}\nFull rule body text loaded only when this rule applies.`,
    ...partial,
  };
}

/** 40 rules total: 6 always-on (full text loads) + 34 scoped (manifest line only). */
function representativeStore(): CompiledRulesStore {
  const alwaysLoad: CompiledRule[] = Array.from({ length: 6 }, (_, i) =>
    rule({
      rule_id: `ALWAYS-${i + 1}`,
      trigger_patterns: ['**'],
      raw_text: `# ALWAYS-${i + 1}\n${'This always-on rule contributes its full body to every session. '.repeat(4)}`,
    }),
  );
  const scoped: CompiledRule[] = Array.from({ length: 34 }, (_, i) =>
    rule({ rule_id: `SCOPED-${i + 1}`, trigger_patterns: [`src/area-${i}/`] }),
  );
  return {
    schema_version: 1,
    generated_at: 'now',
    source_hash: 'sha256:fixture',
    rules: [...alwaysLoad, ...scoped],
  };
}

describe('lean rule context resident-footprint budget (issue #284)', () => {
  it('manifest + always-load slice stays under the documented byte budget', () => {
    const composed = composeRuleContext(representativeStore(), { changedPaths: [] });
    const bytes = Buffer.byteLength(composed, 'utf8');
    expect(bytes).toBeLessThanOrEqual(LEAN_RULE_CONTEXT_BUDGET_BYTES);
  });

  it('the budget constant is the documented ~4K-token ceiling (4 bytes/token)', () => {
    // A guard so the ceiling cannot be quietly loosened without an intentional edit here.
    expect(LEAN_RULE_CONTEXT_BUDGET_BYTES).toBe(16_384);
  });

  it('with no files in play, only always-load rule bodies are loaded (no scoped text)', () => {
    const composed = composeRuleContext(representativeStore(), { changedPaths: [] });
    // Always-on bodies present; scoped bodies absent (they appear only as manifest lines).
    expect(composed).toContain('ALWAYS-1');
    expect(composed).toContain('always-on rule contributes its full body');
    expect(composed).not.toContain('Full rule body text loaded only when this rule applies.');
  });
});
