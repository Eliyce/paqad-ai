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

const PACK = resolve(ROOT, 'runtime/capabilities/coding/rules/site-map.md');
const MIRROR = resolve(ROOT, 'docs/instructions/rules/coding/site-map.md');

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
    expect(doc).toContain('sitemap status');
    expect(doc).toContain('sitemap draft');
  });

  it('never names the stale (nonexistent) docs/instructions/site-map folder', () => {
    const doc = readFileSync(PACK, 'utf8');
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
    expect(doc.toLowerCase()).toContain('never start from zero');
  });
});
