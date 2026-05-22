import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { lines, runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/base/skills/test-execution-feedback-loop';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('test-execution-feedback-loop', () => {
  describe('load-failures.sh', () => {
    const path = sh('load-failures.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('exits 1 when evidence file missing', () => {
      const r = runScript(path, ['/no/such/evidence.json']);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/evidence not found/);
    });

    it('exits 1 on invalid JSON', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'e.json', 'not json');
        const r = runScript(path, [f]);
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/invalid JSON/);
      });
    });

    it('exits 1 on unsupported schema_version', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'e.json', JSON.stringify({ schema_version: '2.0.0', gates: [] }));
        const r = runScript(path, [f]);
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/unsupported schema_version/);
      });
    });

    it('emits "(no failures)" on stderr when there are no fails', () => {
      withTempDir((dir) => {
        const f = writeFile(
          dir,
          'e.json',
          JSON.stringify({
            schema_version: '1.0.0',
            gates: [{ name: 'x', status: 'pass', failures: [] }],
          }),
        );
        const r = runScript(path, [f]);
        expect(r.status).toBe(0);
        expect(r.stderr).toMatch(/\(no failures\)/);
        expect(r.stdout.trim()).toBe('');
      });
    });

    it('emits one JSON line per failure with the canonical schema', () => {
      withTempDir((dir) => {
        const f = writeFile(
          dir,
          'e.json',
          JSON.stringify({
            schema_version: '1.0.0',
            gates: [
              {
                name: 'tests',
                status: 'fail',
                failures: [
                  {
                    category: 'test-failure',
                    file: 'src/a.ts',
                    line: 42,
                    ac_id: 'AC-1.1',
                    test_id: 'T1.1',
                    suite: 'auth',
                    message: 'expected 200',
                  },
                  {
                    category: 'test-failure',
                    file: 'src/b.ts',
                    line: 7,
                    ac_id: 'AC-2.1',
                    test_id: 'T2.1',
                    suite: 'invites',
                    message: 'expected 401',
                  },
                ],
              },
            ],
          }),
        );
        const r = runScript(path, [f]);
        expect(r.status).toBe(0);
        const out = lines(r.stdout);
        expect(out.length).toBe(2);
        const first = JSON.parse(out[0]);
        expect(first).toMatchObject({
          idx: 1,
          gate: 'tests',
          category: 'test-failure',
          file: 'src/a.ts',
          line: 42,
          ac_id: 'AC-1.1',
          test_id: 'T1.1',
          suite: 'auth',
        });
        expect(first.message).toBe('expected 200');
      });
    });

    it('truncates messages to 240 chars and collapses whitespace', () => {
      withTempDir((dir) => {
        const longMsg = 'x  '.repeat(200);
        const f = writeFile(
          dir,
          'e.json',
          JSON.stringify({
            schema_version: '1.0.0',
            gates: [
              { name: 'g', status: 'fail', failures: [{ message: longMsg, file: 'x', line: 1 }] },
            ],
          }),
        );
        const r = runScript(path, [f]);
        const obj = JSON.parse(lines(r.stdout)[0]);
        expect(obj.message.length).toBeLessThanOrEqual(240);
        expect(obj.message).not.toContain('  '); // collapsed whitespace
      });
    });

    it('skips gates whose status is "pass"', () => {
      withTempDir((dir) => {
        const f = writeFile(
          dir,
          'e.json',
          JSON.stringify({
            schema_version: '1.0.0',
            gates: [
              { name: 'lint', status: 'pass', failures: [] },
              {
                name: 'tests',
                status: 'fail',
                failures: [{ category: 'test-failure', file: 'a', line: 1, message: 'm' }],
              },
            ],
          }),
        );
        const r = runScript(path, [f]);
        const out = lines(r.stdout);
        expect(out.length).toBe(1);
        expect(JSON.parse(out[0]).gate).toBe('tests');
      });
    });
  });

  describe('lint-output.sh', () => {
    const path = sh('lint-output.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('passes the empty short-circuit literal', () => {
      const r = runScript(path, [], { input: 'Fix Proposals: none — verification passed.\n' });
      expect(r.status).toBe(0);
    });

    it('passes a valid block with required field lines per proposal', () => {
      const ok = [
        '## Fix Proposals',
        '### Failure 1 — auth > AC-1.1 — bad jwt',
        '- **AC:** AC-1.1',
        '- **Failure category:** test-failure',
        '- **Anchor:** `tests/unit/auth.test.ts:47`',
        '- **Root cause hypothesis:** `src/auth/middleware.ts:34` returns 200 on alg none',
        '- **Proposed fix:** add allowlist',
        '- **Confidence:** high',
        'Total failures: 1 | Combined into 1 proposals | High-confidence: 1 | Defer to human: 0',
      ].join('\n');
      expect(runScript(path, [], { input: ok }).status).toBe(0);
    });

    it('fails when Total failures footer missing', () => {
      const r = runScript(path, [], {
        input:
          '## Fix Proposals\n### Failure 1\n- **AC:** AC-1.1\n- **Failure category:** test-failure\n- **Anchor:** `a:1`\n- **Root cause hypothesis:** x\n- **Proposed fix:** y\n- **Confidence:** high\n',
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Total failures/);
    });

    it('fails when a proposal is missing a required field', () => {
      const r = runScript(path, [], {
        input:
          '## Fix Proposals\n### Failure 1\n- **AC:** AC-1.1\n- **Failure category:** test-failure\n- **Anchor:** `a:1`\n- **Root cause hypothesis:** x\nTotal failures: 1 | Combined into 1 proposals | High-confidence: 0 | Defer to human: 0\n',
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Proposed fix:|Confidence:/);
    });
  });
});
