import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const RULES = [
  resolve(ROOT, 'docs/instructions/rules/coding/feature-development.md'),
  resolve(ROOT, 'runtime/capabilities/coding/rules/feature-development.md'),
];

describe('feature-development enforcement-tier honesty', () => {
  for (const path of RULES) {
    it(`${path.slice(ROOT.length + 1)} documents the enforcement tiers`, () => {
      const text = readFileSync(path, 'utf8');
      expect(text).toContain('Enforcement tiers');
      expect(text).toMatch(/SCRIPT-ENFORCED[\s\S]*block_on_failure/);
      expect(text).toMatch(/AGENT-RAISED -> DECISION-PAUSE-ENFORCED[\s\S]*review_findings: stop/);
      expect(text).toMatch(/AGENT-RAISED -> DECISION-PAUSE-ENFORCED[\s\S]*stale_docs: stop/);
    });
  }
});
