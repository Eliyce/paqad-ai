import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';

const SKILL = 'runtime/capabilities/coding/skills/ux-state-machine';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('ux-state-machine', () => {
  describe('lint-output.sh', () => {
    const path = sh('lint-output.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('passes valid block with canonical 4-col Transitions header', () => {
      const ok = [
        '## State Inventory',
        '- **idle** — ready — initial',
        '## Transitions',
        '| From | Trigger | To | Notes |',
        '| --- | --- | --- | --- |',
        '| idle | click | loading | none |',
        '## Gaps',
        '- none',
      ].join('\n');
      expect(runScript(path, [], { input: ok }).status).toBe(0);
    });

    it('fails when "## State Inventory" missing', () => {
      const r = runScript(path, [], {
        input: '## Transitions\n| From | Trigger | To | Notes |\n## Gaps\nnone\n',
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/State Inventory/);
    });

    it('fails when canonical 4-col Transitions header missing', () => {
      const r = runScript(path, [], {
        input: '## State Inventory\n- a\n## Transitions\n| From | To |\n## Gaps\nnone\n',
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/canonical 4-column header/);
    });
  });

  describe('assets', () => {
    it('canonical-states.txt enumerates expected vocabulary', async () => {
      const fs = await import('node:fs');
      const text = fs.readFileSync(join(SKILL, 'assets/canonical-states.txt'), 'utf8');
      const tokens = text
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => l.split(/\s+/, 1)[0]);
      // Should include at least the universal 5: idle, loading, success, empty, error
      for (const must of ['idle', 'loading', 'success', 'empty', 'error']) {
        expect(tokens, `state ${must}`).toContain(must);
      }
    });
  });
});
