import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { lines, runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/base/skills/adversarial-review';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('adversarial-review', () => {
  describe('digest-evidence.sh', () => {
    const path = sh('digest-evidence.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('exits 1 with stderr when evidence file is missing', () => {
      const r = runScript(path, ['/no/such/evidence.json']);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/evidence file not found/i);
    });

    it('exits 1 on invalid JSON', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'evidence.json', 'not json{');
        const r = runScript(path, [f]);
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/invalid JSON/i);
      });
    });

    it('emits "(no failures)" when evidence has no failures', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'e.json', JSON.stringify({ overall_status: 'pass', gates: [] }));
        const r = runScript(path, [f]);
        expect(r.status).toBe(0);
        expect(r.stdout).toMatch(/^gate \| category \| file:line \| ac_id \| message/);
        expect(r.stdout).toMatch(/\(no failures\)/);
      });
    });

    it('emits one row per failure with the canonical 5-column shape', () => {
      withTempDir((dir) => {
        const f = writeFile(
          dir,
          'e.json',
          JSON.stringify({
            gates: [
              {
                name: 'code-tests-lint',
                failures: [
                  {
                    category: 'test-failure',
                    file: 'src/a.ts',
                    line: 42,
                    ac_id: 'AC-1.1',
                    message: 'expected 200',
                  },
                  {
                    category: 'test-failure',
                    file: 'src/b.ts',
                    line: 7,
                    ac_id: 'AC-2.1',
                    message: 'expected 401',
                  },
                ],
              },
            ],
          }),
        );
        const r = runScript(path, [f]);
        expect(r.status).toBe(0);
        const rows = lines(r.stdout);
        expect(rows[0]).toBe('gate | category | file:line | ac_id | message');
        expect(rows.length).toBe(3);
        // Sorted by joined columns, so a.ts (line 42) comes before b.ts (line 7)
        expect(rows[1]).toContain('src/a.ts:42');
        expect(rows[1]).toContain('AC-1.1');
        expect(rows[2]).toContain('src/b.ts:7');
      });
    });

    it('skips gates whose status is "pass" by including only their failures (none)', () => {
      withTempDir((dir) => {
        const f = writeFile(
          dir,
          'e.json',
          JSON.stringify({
            gates: [
              { name: 'lint', status: 'pass', failures: [] },
              {
                name: 'tests',
                status: 'fail',
                failures: [
                  {
                    category: 'test-failure',
                    file: 'x.ts',
                    line: 1,
                    ac_id: 'AC-1.1',
                    message: 'm',
                  },
                ],
              },
            ],
          }),
        );
        const r = runScript(path, [f]);
        const rows = lines(r.stdout);
        // Header + the one failure row.
        expect(rows.length).toBe(2);
        expect(rows[1]).toContain('tests');
        expect(rows[1]).not.toContain('lint');
      });
    });

    it('truncates messages over 240 chars', () => {
      withTempDir((dir) => {
        const longMsg = 'x'.repeat(500);
        const f = writeFile(
          dir,
          'e.json',
          JSON.stringify({
            gates: [{ name: 'g', failures: [{ message: longMsg, file: 'x', line: 1 }] }],
          }),
        );
        const r = runScript(path, [f]);
        const lastRow = lines(r.stdout).at(-1)!;
        // Message is the last column; isolate it
        const msg = lastRow.split(' | ').at(-1)!;
        expect(msg.length).toBeLessThanOrEqual(240);
      });
    });
  });

  describe('lint-findings.sh', () => {
    const path = sh('lint-findings.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('passes a valid block in canonical (Critical → Low) order', () => {
      const valid = [
        '## Findings',
        '- **Critical** — bad. Evidence: `src/a.ts:1`. Required action: fix.',
        '- **High** — meh. Evidence: `src/b.ts:2`. Required action: fix.',
        '- **Medium** — ok. Evidence: `src/c.ts:3`. Required action: fix.',
        '- **Low** — nit. Evidence: `src/d.ts:4`. Required action: fix.',
      ].join('\n');
      const r = runScript(path, [], { input: valid });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('ok');
    });

    it('fails when "## Findings" heading missing', () => {
      const r = runScript(path, [], { input: '- **High** — x. Required action: fix.\n' });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/## Findings/);
    });

    it('fails when no finding bullets exist', () => {
      const r = runScript(path, [], { input: '## Findings\n\n## Open Questions\n- none\n' });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/no finding bullets/);
    });

    it('fails when severity tag missing', () => {
      const r = runScript(path, [], {
        input: '## Findings\n- some prose without a severity. Required action: fix.\n',
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/missing severity tag/);
    });

    it('fails when severity is out of order (Low before Critical)', () => {
      const out = [
        '## Findings',
        '- **Low** — nit. Required action: fix.',
        '- **Critical** — boom. Required action: fix.',
      ].join('\n');
      const r = runScript(path, [], { input: out });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/severity out of order/);
    });

    it('fails when "Required action:" segment missing', () => {
      const out = '## Findings\n- **High** — x. Evidence: `a.ts:1`.\n';
      const r = runScript(path, [], { input: out });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Required action:/);
    });

    it('accepts every severity from the asset vocabulary', () => {
      for (const sev of ['Critical', 'High', 'Medium', 'Low']) {
        const r = runScript(path, [], {
          input: `## Findings\n- **${sev}** — x. Required action: fix.\n`,
        });
        expect(r.status, `severity ${sev} should be accepted`).toBe(0);
      }
    });

    it('rejects a severity outside the closed vocabulary (e.g. "Trivial")', () => {
      const r = runScript(path, [], {
        input: '## Findings\n- **Trivial** — x. Required action: fix.\n',
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/missing severity tag/);
    });
  });

  describe('assets/output.template.md', () => {
    it('a realistically-filled template passes lint-findings.sh', () => {
      const filled = [
        '## Findings',
        '- **Critical** — auth bypass. Evidence: `src/auth.ts:42`. Required action: reject alg:none.',
        '- **High** — over-fetch. Evidence: `src/users/list.ts:60`. Required action: parallelize.',
        '- **Medium** — log leak. Evidence: `src/log.ts:7`. Required action: redact PII.',
      ].join('\n');
      const r = runScript(sh('lint-findings.sh'), [], { input: filled });
      expect(r.status).toBe(0);
    });
  });
});
