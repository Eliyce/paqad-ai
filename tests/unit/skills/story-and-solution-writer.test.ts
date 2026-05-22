import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';

const SKILL = 'runtime/base/skills/story-and-solution-writer';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('story-and-solution-writer', () => {
  describe('lint-output.sh', () => {
    const path = sh('lint-output.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('passes a valid 4-section block', () => {
      const ok =
        '## Story\nx\n## Constraints\n- y\n## Proposed Solution\n1. z\n## Verification Notes\n- w\n';
      expect(runScript(path, [], { input: ok }).status).toBe(0);
    });

    it('passes when optional Pending Decisions section is included', () => {
      const ok =
        '## Story\nx\n## Constraints\n- y\n## Proposed Solution\n1. z\n## Verification Notes\n- w\n## Pending Decisions\n- a\n';
      expect(runScript(path, [], { input: ok }).status).toBe(0);
    });

    it('fails when any of the 4 required sections missing', () => {
      const r1 = runScript(path, [], {
        input: '## Constraints\n## Proposed Solution\n## Verification Notes\n',
      });
      expect(r1.status).toBe(1);
      expect(r1.stderr).toMatch(/Story/);

      const r2 = runScript(path, [], {
        input: '## Story\n## Proposed Solution\n## Verification Notes\n',
      });
      expect(r2.status).toBe(1);
      expect(r2.stderr).toMatch(/Constraints/);

      const r3 = runScript(path, [], {
        input: '## Story\n## Constraints\n## Verification Notes\n',
      });
      expect(r3.status).toBe(1);
      expect(r3.stderr).toMatch(/Proposed Solution/);

      const r4 = runScript(path, [], { input: '## Story\n## Constraints\n## Proposed Solution\n' });
      expect(r4.status).toBe(1);
      expect(r4.stderr).toMatch(/Verification Notes/);
    });

    it('exits 2 on missing input file', () => {
      expect(runScript(path, ['/no/such/file']).status).toBe(2);
    });
  });
});
