import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');

const SKILL = resolve(ROOT, 'runtime/capabilities/coding/skills/site-map/SKILL.md');

const ORDERED_STEPS = [
  'sitemap status',
  'preflight site-map',
  'sitemap inventory',
  'sitemap draft',
  'sitemap run',
];

describe('site-map skill procedure', () => {
  it('ships as a coding-capability skill', () => {
    expect(() => readFileSync(SKILL, 'utf8')).not.toThrow();
  });

  it('names Step 0 status and the draft verb', () => {
    const doc = readFileSync(SKILL, 'utf8');
    expect(doc).toContain('sitemap status');
    expect(doc).toContain('sitemap draft');
  });

  it('never names the stale (nonexistent) docs/instructions/site-map folder', () => {
    const doc = readFileSync(SKILL, 'utf8');
    expect(doc).not.toContain('docs/instructions/site-map');
  });

  it('walks the resumable steps in order', () => {
    const doc = readFileSync(SKILL, 'utf8');
    let cursor = -1;
    for (const step of ORDERED_STEPS) {
      const at = doc.indexOf(step, cursor + 1);
      expect(at, `step "${step}" missing or out of order`).toBeGreaterThan(cursor);
      cursor = at;
    }
  });

  it('carries the do-not-improvise, resume-first framing', () => {
    const doc = readFileSync(SKILL, 'utf8');
    expect(doc).toContain('## Procedure');
    expect(doc.toLowerCase()).toContain('do **not** improvise');
    expect(doc.toLowerCase()).toContain('never start from zero');
  });

  it('re-checks a stored map in its Retest mode through the site-map-retest helper', () => {
    const doc = readFileSync(SKILL, 'utf8');
    const retest = doc.slice(doc.indexOf('### Retest mode'), doc.indexOf('## Output Contract'));
    expect(retest).toContain('site-map-retest');
    expect(retest).toContain('anchors_broken');
  });
});
