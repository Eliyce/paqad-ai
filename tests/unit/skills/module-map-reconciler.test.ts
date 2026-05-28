import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { lines, runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/base/skills/module-map-reconciler';
const sh = (n: string) => join(SKILL, 'scripts', n);

const EMPTY_COUNTS = {
  'MM-ADD': 0,
  'MM-FEAT-ADD': 0,
  'MM-REMOVE': 0,
  'MM-RENAME': 0,
  'MM-FEAT-STALE': 0,
  'MM-DOC-ORPHAN': 0,
  'MM-DOC-MISSING': 0,
  'MM-MISMATCH': 0,
};

function writeDrift(dir: string, body: unknown): void {
  writeFile(dir, '.paqad/module-map/drift.json', JSON.stringify(body));
}

describe('module-map-reconciler scripts', () => {
  describe('reconcile.sh', () => {
    // Thin wrapper around `paqad-ai module-map reconcile`. We assert the
    // help surface only — full CLI behaviour is covered by tests/unit/cli/.
    const path = sh('reconcile.sh');

    it('--help exits 0 with usage on stdout', () => {
      const r = runScript(path, ['--help']);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('Usage:');
    });
  });

  describe('has-findings.sh', () => {
    const path = sh('has-findings.sh');

    it('exit 3 when drift.json is missing', () => {
      withTempDir((dir) => {
        const r = runScript(path, [dir]);
        expect(r.status).toBe(3);
        expect(r.stderr).toContain('drift.json missing');
      });
    });

    it('exit 1 + zero count when findings array is empty', () => {
      withTempDir((dir) => {
        writeDrift(dir, {
          generated_at: '',
          source_roots: ['src'],
          findings: [],
          blocked: null,
          counts: EMPTY_COUNTS,
        });
        const r = runScript(path, [dir]);
        expect(r.status).toBe(1);
        expect(r.stdout.trim()).toBe('0');
      });
    });

    it('exit 0 + count when findings are present', () => {
      withTempDir((dir) => {
        writeDrift(dir, {
          generated_at: '',
          source_roots: ['src'],
          findings: [
            { code: 'MM-ADD', paths: [], module_slug: null, feature_slug: null, detail: '' },
            { code: 'MM-DOC-MISSING', paths: [], module_slug: 'x', feature_slug: null, detail: '' },
          ],
          blocked: null,
          counts: { ...EMPTY_COUNTS, 'MM-ADD': 1, 'MM-DOC-MISSING': 1 },
        });
        const r = runScript(path, [dir]);
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe('2');
      });
    });

    it('exit 2 + blocked reason on stderr when reconciler is blocked', () => {
      withTempDir((dir) => {
        writeDrift(dir, {
          generated_at: '',
          source_roots: [],
          findings: [],
          blocked: 'source_roots_unknown',
          counts: EMPTY_COUNTS,
        });
        const r = runScript(path, [dir]);
        expect(r.status).toBe(2);
        expect(r.stderr).toContain('blocked: source_roots_unknown');
      });
    });
  });

  describe('is-blocked.sh', () => {
    const path = sh('is-blocked.sh');

    it('exit 0 + `none` when not blocked', () => {
      withTempDir((dir) => {
        writeDrift(dir, {
          generated_at: '',
          source_roots: ['src'],
          findings: [],
          blocked: null,
          counts: EMPTY_COUNTS,
        });
        const r = runScript(path, [dir]);
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe('none');
      });
    });

    it('exit 1 + reason when blocked', () => {
      withTempDir((dir) => {
        writeDrift(dir, {
          generated_at: '',
          source_roots: [],
          findings: [],
          blocked: 'source_roots_unknown',
          counts: EMPTY_COUNTS,
        });
        const r = runScript(path, [dir]);
        expect(r.status).toBe(1);
        expect(r.stdout.trim()).toBe('source_roots_unknown');
      });
    });

    it('exit 2 when drift.json is missing', () => {
      withTempDir((dir) => {
        const r = runScript(path, [dir]);
        expect(r.status).toBe(2);
      });
    });
  });

  describe('count-by-code.sh', () => {
    const path = sh('count-by-code.sh');

    it('emits sorted `CODE: N` lines, skipping zero counts', () => {
      withTempDir((dir) => {
        writeDrift(dir, {
          generated_at: '',
          source_roots: ['src'],
          findings: [],
          blocked: null,
          counts: { ...EMPTY_COUNTS, 'MM-ADD': 3, 'MM-DOC-MISSING': 1, 'MM-REMOVE': 0 },
        });
        const r = runScript(path, [dir]);
        expect(r.status).toBe(0);
        expect(lines(r.stdout)).toEqual(['MM-ADD: 3', 'MM-DOC-MISSING: 1']);
      });
    });

    it('emits nothing when all counts are zero', () => {
      withTempDir((dir) => {
        writeDrift(dir, {
          generated_at: '',
          source_roots: ['src'],
          findings: [],
          blocked: null,
          counts: EMPTY_COUNTS,
        });
        const r = runScript(path, [dir]);
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe('');
      });
    });
  });

  describe('filter-by-code.sh', () => {
    const path = sh('filter-by-code.sh');

    it('exit 2 with no code argument', () => {
      expect(runScript(path).status).toBe(2);
    });

    it('exit 2 on unknown MM-* code', () => {
      const r = runScript(path, ['MM-NOPE']);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('unknown MM-* code');
    });

    it('returns matching findings as JSON array', () => {
      withTempDir((dir) => {
        writeDrift(dir, {
          generated_at: '',
          source_roots: ['src'],
          findings: [
            {
              code: 'MM-ADD',
              module_slug: null,
              feature_slug: null,
              paths: ['src/x.ts'],
              detail: 'x',
            },
            {
              code: 'MM-DOC-MISSING',
              module_slug: 'y',
              feature_slug: null,
              paths: [],
              detail: 'y',
            },
            {
              code: 'MM-ADD',
              module_slug: null,
              feature_slug: null,
              paths: ['src/z.ts'],
              detail: 'z',
            },
          ],
          blocked: null,
          counts: { ...EMPTY_COUNTS, 'MM-ADD': 2, 'MM-DOC-MISSING': 1 },
        });
        const r = runScript(path, ['MM-ADD', dir]);
        expect(r.status).toBe(0);
        const out = JSON.parse(r.stdout) as { detail: string }[];
        expect(out.map((f) => f.detail)).toEqual(['x', 'z']);
      });
    });

    it('returns [] when no finding matches', () => {
      withTempDir((dir) => {
        writeDrift(dir, {
          generated_at: '',
          source_roots: ['src'],
          findings: [],
          blocked: null,
          counts: EMPTY_COUNTS,
        });
        const r = runScript(path, ['MM-ADD', dir]);
        expect(r.status).toBe(0);
        expect(JSON.parse(r.stdout)).toEqual([]);
      });
    });
  });
});
