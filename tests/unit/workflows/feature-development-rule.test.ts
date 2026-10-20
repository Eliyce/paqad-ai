import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { stripRuleMarker } from '@/rule-scripts/rule-id.js';

function ruleText(doc: string): string {
  return doc
    .split('\n')
    .map((line) => stripRuleMarker(line).text)
    .join('\n');
}

const ROOT = resolve(__dirname, '../../..');

const CANONICAL = resolve(ROOT, 'runtime/capabilities/coding/rules/feature-development.md');
const DOGFOOD = resolve(ROOT, 'docs/instructions/rules/coding/feature-development.md');

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
    expect(doc.toLowerCase()).toContain('intent to create or change code');
  });

  it('maps stage escalations onto the Decision Pause Contract', () => {
    const doc = readFileSync(CANONICAL, 'utf8');
    expect(doc).toContain('Decision Pause Contract');
    expect(doc).toContain('Decision Packet');
  });
});
