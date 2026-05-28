import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';

const SKILL = 'runtime/capabilities/coding/skills/motion-review';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('motion-review', () => {
  describe('lint-findings.sh', () => {
    const path = sh('lint-findings.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('accepts a motion finding citing motion.md', () => {
      const body = [
        '## Findings',
        '- **high** (motion.md → reduced-motion) — auth / motion: Toast ignores reduced-motion. Evidence: `src/Toast.tsx:42`. Required action: gate with `@media (prefers-reduced-motion: reduce)`.',
      ].join('\n');
      expect(runScript(path, [], { input: body }).status).toBe(0);
    });

    it('rejects a finding missing severity', () => {
      const body = [
        '## Findings',
        '- (motion.md → reduced-motion) — motion: bad. Evidence: `src/Toast.tsx:42`. Required action: fix.',
      ].join('\n');
      expect(runScript(path, [], { input: body }).status).toBe(1);
    });
  });
});
