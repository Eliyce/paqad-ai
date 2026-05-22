import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { lines, runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/capabilities/security/skills/retest-verification';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('retest-verification', () => {
  describe('load-source-findings.sh', () => {
    const path = sh('load-source-findings.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('exits 2 when no arg', () => {
      expect(runScript(path).status).toBe(2);
    });

    it('exits 1 on invalid JSON', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'sidecar.json', 'not json');
        const r = runScript(path, [f]);
        expect(r.status).toBe(1);
      });
    });

    it('exits 1 when required fields missing', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'sidecar.json', JSON.stringify([{ id: 'PT-1' }]));
        const r = runScript(path, [f]);
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/missing/);
      });
    });

    it('emits one JSON row per finding with id/title/severity/status/evidence', () => {
      withTempDir((dir) => {
        const f = writeFile(
          dir,
          'sidecar.json',
          JSON.stringify([
            { id: 'PT-1', title: 'XSS', severity: 'high', status: 'open', evidence: 'src/x.ts:1' },
            { id: 'PT-2', title: 'IDOR', severity: 'medium', evidence: 'src/y.ts:2' },
          ]),
        );
        const r = runScript(path, [f]);
        expect(r.status).toBe(0);
        const rows = lines(r.stdout).map((l) => JSON.parse(l));
        expect(rows.length).toBe(2);
        expect(rows[0]).toMatchObject({
          id: 'PT-1',
          title: 'XSS',
          severity: 'high',
          status: 'open',
        });
        // Default status when missing.
        expect(rows[1].status).toBe('open');
      });
    });
  });

  describe('lint-output.sh', () => {
    const path = sh('lint-output.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('exits 2 when args missing', () => {
      expect(runScript(path).status).toBe(2);
    });

    it('passes a valid retest report referencing only source ids', () => {
      withTempDir((dir) => {
        const sidecar = writeFile(
          dir,
          's.json',
          JSON.stringify([
            { id: 'PT-1', title: 'XSS', severity: 'high', status: 'open' },
            { id: 'PT-2', title: 'IDOR', severity: 'medium', status: 'open' },
          ]),
        );
        const retest = writeFile(
          dir,
          'r.md',
          [
            '## Retest Decisions',
            '### PT-1 → fixed',
            '- evidence',
            '### PT-2 → still-open',
            '- evidence',
          ].join('\n'),
        );
        const r = runScript(path, [retest, sidecar]);
        expect(r.status).toBe(0);
      });
    });

    it('rejects an invented id (not in source sidecar)', () => {
      withTempDir((dir) => {
        const sidecar = writeFile(
          dir,
          's.json',
          JSON.stringify([{ id: 'PT-1', title: 'a', severity: 'low' }]),
        );
        const retest = writeFile(
          dir,
          'r.md',
          ['## Retest Decisions', '### PT-99 → fixed', '- not in source'].join('\n'),
        );
        const r = runScript(path, [retest, sidecar]);
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/invented id/);
      });
    });

    it('rejects out-of-vocab status tokens', () => {
      withTempDir((dir) => {
        const sidecar = writeFile(
          dir,
          's.json',
          JSON.stringify([{ id: 'PT-1', title: 'a', severity: 'low' }]),
        );
        const retest = writeFile(
          dir,
          'r.md',
          ['## Retest Decisions', '### PT-1 → maybe-fixed', '- prose'].join('\n'),
        );
        const r = runScript(path, [retest, sidecar]);
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/malformed|invented/);
      });
    });
  });

  describe('assets', () => {
    it('status-vocabulary.txt enumerates the 3 retest decisions', async () => {
      const fs = await import('node:fs');
      const text = fs.readFileSync(join(SKILL, 'assets/status-vocabulary.txt'), 'utf8');
      const tokens = text
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => l.split(/\s+/, 1)[0]);
      expect(new Set(tokens)).toEqual(
        new Set(['fixed', 'still-open', 'needs-manual-verification']),
      );
    });
  });
});
