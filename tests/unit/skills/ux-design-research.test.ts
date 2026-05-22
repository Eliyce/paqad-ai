import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';

const SKILL = 'runtime/capabilities/coding/skills/ux-design-research';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('ux-design-research', () => {
  describe('lint-output.sh', () => {
    const path = sh('lint-output.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('passes a valid 3-section block', () => {
      const ok =
        '## Research Targets\n- x\n## Reference Findings\n- y\n## Recommended Directions\n- z\n';
      expect(runScript(path, [], { input: ok }).status).toBe(0);
    });

    it('fails when any section missing', () => {
      const r = runScript(path, [], { input: '## Research Targets\n## Reference Findings\n' });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Recommended Directions/);
    });
  });
});
