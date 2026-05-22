import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';

const SKILL = 'runtime/base/skills/sequence-planner';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('sequence-planner', () => {
  describe('lint-output.sh', () => {
    const path = sh('lint-output.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('passes a valid block with sequential Story numbering and required field lines', () => {
      const ok = [
        '## Implementation Sequence',
        '### Story 1 — schema migration',
        '- **Goal:** add column',
        '- **Dependencies:** none',
        '- **Verification:** migration test',
        '- **Reversibility:** medium',
        '- **Blast radius:** isolated',
        '### Story 2 — handler change',
        '- **Goal:** wire field',
        '- **Dependencies:** Story 1',
        '- **Verification:** route test',
        '- **Reversibility:** easy',
        '- **Blast radius:** isolated',
        '## Sequencing Risks',
        '- none',
      ].join('\n');
      expect(runScript(path, [], { input: ok }).status).toBe(0);
    });

    it('fails when Story numbering does not start at 1', () => {
      const bad = [
        '## Implementation Sequence',
        '### Story 2 — first',
        '- **Goal:** x',
        '- **Dependencies:** y',
        '- **Verification:** z',
        '## Sequencing Risks',
        '- none',
      ].join('\n');
      const r = runScript(path, [], { input: bad });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/numbering broken/);
    });

    it('fails on a numbering gap (1, 3 — missing 2)', () => {
      const bad = [
        '## Implementation Sequence',
        '### Story 1 — first',
        '- **Goal:** x',
        '- **Dependencies:** y',
        '- **Verification:** z',
        '### Story 3 — third',
        '- **Goal:** x',
        '- **Dependencies:** y',
        '- **Verification:** z',
        '## Sequencing Risks',
        '- none',
      ].join('\n');
      const r = runScript(path, [], { input: bad });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/numbering broken/);
    });

    it('fails when "## Implementation Sequence" missing', () => {
      const r = runScript(path, [], { input: '## Sequencing Risks\nnone\n' });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Implementation Sequence/);
    });

    it('fails when "## Sequencing Risks" missing', () => {
      const r = runScript(path, [], { input: '## Implementation Sequence\n### Story 1\n' });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Sequencing Risks/);
    });

    it('fails when a story is missing a required field', () => {
      const bad = [
        '## Implementation Sequence',
        '### Story 1 — first',
        '- **Goal:** x',
        '- **Dependencies:** y',
        '## Sequencing Risks',
        '- none',
      ].join('\n');
      const r = runScript(path, [], { input: bad });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Verification:/);
    });
  });

  describe('assets', () => {
    it('order-rules.txt is non-empty', async () => {
      const fs = await import('node:fs');
      const text = fs.readFileSync(join(SKILL, 'assets/order-rules.txt'), 'utf8');
      expect(text.split('\n').filter((l) => l.trim()).length).toBeGreaterThan(3);
    });
  });
});
