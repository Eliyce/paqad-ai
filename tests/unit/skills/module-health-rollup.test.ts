import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { lines, runScript } from './_helpers/run-script.js';

const SKILL = 'runtime/base/skills/module-health-rollup';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('module-health-rollup scripts', () => {
  describe('rollup.sh', () => {
    // Thin wrapper around `paqad-ai module-health rollup`. Full CLI behaviour
    // is covered by tests/unit/cli/; here we just assert the surface.
    const path = sh('rollup.sh');

    it('--help exits 0 with usage on stdout', () => {
      const r = runScript(path, ['--help']);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('Usage:');
    });

    it('exit 2 on unknown flag', () => {
      const r = runScript(path, ['--bogus']);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('unknown flag');
    });
  });

  describe('is-blocked.sh', () => {
    const path = sh('is-blocked.sh');

    it('exit 0 + `none` when not blocked', () => {
      const r = runScript(path, [], {
        input: JSON.stringify({ blocked: null, modules: [], unattributed_files: [] }),
      });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('none');
    });

    it('exit 1 + reason when blocked', () => {
      const r = runScript(path, [], {
        input: JSON.stringify({ blocked: 'module_health_unknown', modules: [] }),
      });
      expect(r.status).toBe(1);
      expect(r.stdout.trim()).toBe('module_health_unknown');
    });

    it('exit 2 on parse error', () => {
      const r = runScript(path, [], { input: 'nope' });
      expect(r.status).toBe(2);
    });
  });

  describe('list-blocked-metrics.sh', () => {
    const path = sh('list-blocked-metrics.sh');

    it('emits one sorted `slug: reasons` line per module with blocked_metrics', () => {
      const r = runScript(path, [], {
        input: JSON.stringify({
          blocked: null,
          modules: [
            {
              slug: 'payments',
              profile: { blocked_metrics: ['coverage:not_configured', 'tests:report_missing:x'] },
            },
            {
              slug: 'auth',
              profile: { blocked_metrics: ['contract_stability:no_public_api_extractor'] },
            },
            { slug: 'core', profile: { blocked_metrics: [] } },
          ],
        }),
      });
      expect(r.status).toBe(0);
      expect(lines(r.stdout)).toEqual([
        'auth: contract_stability:no_public_api_extractor',
        'payments: coverage:not_configured, tests:report_missing:x',
      ]);
    });

    it('emits nothing when no module has blocked_metrics', () => {
      const r = runScript(path, [], {
        input: JSON.stringify({
          blocked: null,
          modules: [{ slug: 'core', profile: { blocked_metrics: [] } }],
        }),
      });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('');
    });

    it('exit 2 on parse error', () => {
      const r = runScript(path, [], { input: 'nope' });
      expect(r.status).toBe(2);
    });
  });

  describe('list-unattributed.sh', () => {
    const path = sh('list-unattributed.sh');

    it('emits sorted file paths', () => {
      const r = runScript(path, [], {
        input: JSON.stringify({
          blocked: null,
          modules: [],
          unattributed_files: ['src/z.ts', 'src/a.ts', 'src/m.ts'],
        }),
      });
      expect(r.status).toBe(0);
      expect(lines(r.stdout)).toEqual(['src/a.ts', 'src/m.ts', 'src/z.ts']);
    });

    it('emits nothing when unattributed_files is absent or empty', () => {
      const r = runScript(path, [], {
        input: JSON.stringify({ blocked: null, modules: [], unattributed_files: [] }),
      });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('');
    });
  });
});
