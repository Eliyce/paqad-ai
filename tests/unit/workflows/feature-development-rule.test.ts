import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { stripRuleMarker } from '@/rule-scripts/rule-id.js';

/**
 * Strip every `<!-- @rule RL-… -->` marker so two rule files compare by their rule
 * TEXT, not their embedded ids. The dogfood copy under docs/instructions/rules/ is the
 * repo's ACTIVE rule file, so paqad's own rule-script compilation embeds stable ids
 * into it (issue #89); the shipped canonical template carries none, because each
 * onboarded project mints its own. Byte-identity is the wrong invariant once the repo
 * dogfoods rule compilation — identical text (markers removed) is the right one.
 */
function ruleText(doc: string): string {
  return doc
    .split('\n')
    .map((line) => stripRuleMarker(line).text)
    .join('\n');
}

/**
 * "Never break again" guard for the feature-development workflow procedure rule.
 *
 * feature-development is a workflow exactly like pentest/design-test, but unlike
 * them it had no activated procedure rule — so no LLM ever ran its stages. The
 * fix is a loaded rule (mirroring pentest.md) that turns the declarative
 * feature-development.yaml into a mandatory, ordered procedure the agent runs on
 * any code-change intent, on every provider (the prompt is the universal seam).
 *
 * This guard fails if that rule disappears, stops shipping to onboarded
 * projects, drops a mandatory stage, or loses the "do not improvise / never
 * skip" framing — any of which silently re-breaks the core workflow.
 */
const ROOT = resolve(__dirname, '../../..');

// The rule must exist BOTH as the shipped canonical source (so every onboarded
// project with the coding capability gets it) and as this repo's dogfood copy
// (so paqad-ai itself follows it).
const CANONICAL = resolve(ROOT, 'runtime/capabilities/coding/rules/feature-development.md');
const DOGFOOD = resolve(ROOT, 'docs/instructions/rules/coding/feature-development.md');

// Every stage of feature-development.yaml is mandatory. If a stage name drops
// out of the rule, the workflow can silently skip it.
const MANDATORY_STAGES = [
  'planning',
  'specification',
  'development',
  'review',
  'checks',
  'documentation_sync',
];

describe('feature-development workflow procedure rule', () => {
  it('ships as the canonical coding-capability rule', () => {
    expect(() => readFileSync(CANONICAL, 'utf8')).not.toThrow();
  });

  it('is mirrored into the dogfood contract, identical to canonical modulo @rule markers', () => {
    // The dogfood copy is the repo's active rule file, so rule-script compilation embeds
    // stable `<!-- @rule RL-… -->` ids into it that the shipped canonical never carries
    // (issue #89). Compare the rule TEXT with those markers stripped — the real mirror
    // invariant — not the raw bytes.
    const canonical = ruleText(readFileSync(CANONICAL, 'utf8'));
    const dogfood = ruleText(readFileSync(DOGFOOD, 'utf8'));
    expect(dogfood).toBe(canonical);
  });

  it('names every mandatory stage in order', () => {
    const doc = readFileSync(CANONICAL, 'utf8');
    let cursor = -1;
    for (const stage of MANDATORY_STAGES) {
      const at = doc.indexOf(stage, cursor + 1);
      expect(at, `stage "${stage}" missing or out of order`).toBeGreaterThan(cursor);
      cursor = at;
    }
  });

  it('points at the project workflow files (never inlines a frozen copy)', () => {
    const doc = readFileSync(CANONICAL, 'utf8');
    expect(doc).toContain('docs/instructions/workflows/feature-development.yaml');
    expect(doc).toContain('docs/instructions/workflows/delivery-policy.yaml');
  });

  it('carries the mandatory, intent-triggered, do-not-improvise framing', () => {
    const doc = readFileSync(CANONICAL, 'utf8');
    expect(doc).toContain('## Trigger');
    expect(doc.toLowerCase()).toContain('do **not** improvise');
    expect(doc.toLowerCase()).toContain('never skip a stage');
    // Triggered by code-change intent, not a fixed keyword list.
    expect(doc.toLowerCase()).toContain('intent to create or change code');
  });

  it('maps stage escalations onto the Decision Pause Contract', () => {
    const doc = readFileSync(CANONICAL, 'utf8');
    expect(doc).toContain('Decision Pause Contract');
    expect(doc).toContain('Decision Packet');
  });
});
