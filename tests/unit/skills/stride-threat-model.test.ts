import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { lines, runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/capabilities/security/skills/stride-threat-model';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('stride-threat-model', () => {
  describe('list-modules.sh', () => {
    const path = sh('list-modules.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('lists docs/modules/ directories when present', () => {
      withTempDir((dir) => {
        writeFile(dir, 'docs/modules/users/README.md', '');
        writeFile(dir, 'docs/modules/billing/README.md', '');
        writeFile(dir, 'docs/modules/orders/README.md', '');
        const r = runScript(path, [], { cwd: dir });
        expect(r.status).toBe(0);
        expect(lines(r.stdout)).toEqual(['billing', 'orders', 'users']);
      });
    });

    it('falls back to module-map.yml top-level keys when docs/modules absent', () => {
      withTempDir((dir) => {
        writeFile(
          dir,
          'docs/instructions/rules/module-map.yml',
          'users:\n  features:\n    - invite\nbilling:\n  features:\n    - charge\n',
        );
        const r = runScript(path, [], { cwd: dir });
        expect(r.status).toBe(0);
        expect(lines(r.stdout)).toEqual(['billing', 'users']);
        // Critically, "features" (nested key) must NOT appear.
        expect(r.stdout).not.toContain('features');
      });
    });

    it('emits a stderr note when no module source found', () => {
      withTempDir((dir) => {
        const r = runScript(path, [], { cwd: dir });
        expect(r.stderr).toMatch(/no module source found/);
      });
    });
  });

  describe('validate-threats.sh', () => {
    const path = sh('validate-threats.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('passes a valid array of threats', () => {
      const ok = JSON.stringify([
        {
          module: 'users',
          asset: 'session token',
          stride_category: 'spoofing',
          threat_description: 'session-id can be replayed because cookie has no Secure flag in dev',
          severity_hint: 'high',
        },
      ]);
      const r = runScript(path, [], { input: ok });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('ok');
    });

    it('rejects invalid JSON', () => {
      const r = runScript(path, [], { input: 'not json' });
      expect(r.status).toBe(1);
    });

    it('rejects non-array JSON', () => {
      const r = runScript(path, [], { input: '{}' });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/expected JSON array/);
    });

    it('rejects threats missing required fields', () => {
      const bad = JSON.stringify([{ module: 'x' }]);
      const r = runScript(path, [], { input: bad });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/missing/);
    });

    it('rejects out-of-vocab stride_category', () => {
      const bad = JSON.stringify([
        {
          module: 'x',
          asset: 'a',
          stride_category: 'unknown',
          threat_description: 'real',
          severity_hint: 'high',
        },
      ]);
      const r = runScript(path, [], { input: bad });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/bad stride_category/);
    });

    it('rejects out-of-vocab severity_hint', () => {
      const bad = JSON.stringify([
        {
          module: 'x',
          asset: 'a',
          stride_category: 'spoofing',
          threat_description: 'real',
          severity_hint: 'urgent',
        },
      ]);
      const r = runScript(path, [], { input: bad });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/bad severity_hint/);
    });

    it('rejects > 50 entries', () => {
      const big = JSON.stringify(
        Array.from({ length: 51 }, (_, i) => ({
          module: 'm' + i,
          asset: 'a',
          stride_category: 'spoofing',
          threat_description: 'specific threat number ' + i,
          severity_hint: 'medium',
        })),
      );
      const r = runScript(path, [], { input: big });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/inventory too large/);
    });

    it('rejects generic / boilerplate threat descriptions', () => {
      const bad = JSON.stringify([
        {
          module: 'x',
          asset: 'a',
          stride_category: 'spoofing',
          threat_description: 'generic STRIDE prose',
          severity_hint: 'high',
        },
      ]);
      const r = runScript(path, [], { input: bad });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/generic threat_description/);
    });

    it('accepts every STRIDE category', () => {
      for (const cat of [
        'spoofing',
        'tampering',
        'repudiation',
        'information-disclosure',
        'denial-of-service',
        'elevation-of-privilege',
      ]) {
        const arr = JSON.stringify([
          {
            module: 'x',
            asset: 'a',
            stride_category: cat,
            threat_description: 'concrete attack on x.a',
            severity_hint: 'medium',
          },
        ]);
        expect(runScript(path, [], { input: arr }).status, `cat ${cat}`).toBe(0);
      }
    });
  });

  describe('assets', () => {
    it('stride-prompts.txt enumerates the 6 STRIDE categories', async () => {
      const fs = await import('node:fs');
      const text = fs.readFileSync(join(SKILL, 'assets/stride-prompts.txt'), 'utf8');
      const tokens = text
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => l.split(/\s+/, 1)[0]);
      expect(new Set(tokens)).toEqual(
        new Set([
          'spoofing',
          'tampering',
          'repudiation',
          'information-disclosure',
          'denial-of-service',
          'elevation-of-privilege',
        ]),
      );
    });
  });
});
