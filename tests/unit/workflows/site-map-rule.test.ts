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
 * "Never break again" guard for the site-map workflow procedure rule (S10, D1).
 *
 * D1 was a stale rulebook that named the wrong map folder
 * (`docs/instructions/site-map/`) and claimed the verb authored the whole map. S10
 * rewrote the rule to the resumable Step 0 → 6 flow the S3–S9 tasks built. This guard
 * fails if the rewritten rule regresses: if the mirror drifts from the shipped pack, if
 * Step 0 (`sitemap status`) or the draft verb disappears, or if the wrong-folder path
 * name creeps back in.
 */
const ROOT = resolve(__dirname, '../../..');

// The rule must exist BOTH as the shipped canonical pack (so every onboarded project
// with the coding capability gets it) and as this repo's dogfood mirror (so paqad-ai
// itself follows it). `refresh --rules --force` clobbers the mirror from the pack, so
// the two must stay identical.
const PACK = resolve(ROOT, 'runtime/capabilities/coding/rules/site-map.md');
const MIRROR = resolve(ROOT, 'docs/instructions/rules/coding/site-map.md');

// The rebuilt workflow is an ordered set of steps. If a step verb drops out of the
// rule, the workflow can silently skip it.
const ORDERED_STEPS = [
  'sitemap status',
  'preflight site-map',
  'sitemap inventory',
  'sitemap draft',
  'sitemap run',
];

describe('site-map workflow procedure rule', () => {
  it('ships as the canonical coding-capability rule', () => {
    expect(() => readFileSync(PACK, 'utf8')).not.toThrow();
  });

  it('is mirrored into the dogfood contract, identical to the pack modulo @rule markers', () => {
    const pack = ruleText(readFileSync(PACK, 'utf8'));
    const mirror = ruleText(readFileSync(MIRROR, 'utf8'));
    expect(mirror).toBe(pack);
  });

  it('names Step 0 status and the draft verb', () => {
    const doc = readFileSync(PACK, 'utf8');
    // Step 0 is the resumable guarantee: a run never starts from zero when progress exists.
    expect(doc).toContain('sitemap status');
    // The engine drafts the skeleton; the agent adds the meaning.
    expect(doc).toContain('sitemap draft');
  });

  it('never names the stale (nonexistent) docs/instructions/site-map folder', () => {
    const doc = readFileSync(PACK, 'utf8');
    // D1's stale rulebook sent people to `docs/instructions/site-map/`. The map lives at
    // `docs/site-map/`; that wrong path must never reappear.
    expect(doc).not.toContain('docs/instructions/site-map');
  });

  it('walks the resumable steps in order', () => {
    const doc = readFileSync(PACK, 'utf8');
    let cursor = -1;
    for (const step of ORDERED_STEPS) {
      const at = doc.indexOf(step, cursor + 1);
      expect(at, `step "${step}" missing or out of order`).toBeGreaterThan(cursor);
      cursor = at;
    }
  });

  it('carries the do-not-improvise, resume-first framing', () => {
    const doc = readFileSync(PACK, 'utf8');
    expect(doc).toContain('## Trigger');
    expect(doc.toLowerCase()).toContain('do **not** improvise');
    // The resumable guarantee, stated in prose.
    expect(doc.toLowerCase()).toContain('never start from zero');
  });
});
