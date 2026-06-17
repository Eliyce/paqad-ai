import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { lines, runScript } from './_helpers/run-script.js';

const SKILL = 'runtime/base/skills/module-health-update';
const sh = (n: string) => join(SKILL, 'scripts', n);

// A combined refresh report as `refresh.sh` emits it: { rollup, sync }.
const REPORT = JSON.stringify({
  rollup: {
    blocked: null,
    unattributed_files: ['src/zeta/new.ts', 'src/alpha/new.ts'],
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
  },
  sync: { processed_events: 2, updated_profiles: ['payments', 'auth'] },
});

describe('module-health-update scripts', () => {
  describe('refresh.sh', () => {
    // Thin wrapper around `paqad-ai module-health rollup` + `sync`. Full CLI
    // behaviour is covered by tests/unit/cli/; here we just assert the --help
    // short-circuit, which never shells out to the CLI.
    const path = sh('refresh.sh');

    it('--help exits 0 with usage on stdout', () => {
      const r = runScript(path, ['--help']);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('Usage:');
    });

    it('-h is an alias for --help', () => {
      const r = runScript(path, ['-h']);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('Usage:');
    });
  });

  describe('is-blocked.sh', () => {
    const path = sh('is-blocked.sh');

    it('exit 0 + `none` when the rollup pass is not blocked', () => {
      const r = runScript(path, [], { input: REPORT });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('none');
    });

    it('exit 1 + reason when the rollup pass is blocked', () => {
      const r = runScript(path, [], {
        input: JSON.stringify({ rollup: { blocked: 'module_health_unknown' }, sync: {} }),
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
      const r = runScript(path, [], { input: REPORT });
      expect(r.status).toBe(0);
      expect(lines(r.stdout)).toEqual([
        'auth: contract_stability:no_public_api_extractor',
        'payments: coverage:not_configured, tests:report_missing:x',
      ]);
    });
  });

  describe('list-updated.sh', () => {
    const path = sh('list-updated.sh');

    it('emits the sorted slugs the sync pass updated', () => {
      const r = runScript(path, [], { input: REPORT });
      expect(r.status).toBe(0);
      expect(lines(r.stdout)).toEqual(['auth', 'payments']);
    });
  });

  describe('list-unattributed.sh', () => {
    const path = sh('list-unattributed.sh');

    it('emits the sorted unattributed file paths', () => {
      const r = runScript(path, [], { input: REPORT });
      expect(r.status).toBe(0);
      expect(lines(r.stdout)).toEqual(['src/alpha/new.ts', 'src/zeta/new.ts']);
    });
  });
});
