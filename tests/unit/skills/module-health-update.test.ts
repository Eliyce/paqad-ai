import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { lines, runScript } from './_helpers/run-script.js';

const SKILL = 'runtime/base/skills/module-health-update';
const sh = (n: string) => join(SKILL, 'scripts', n);

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

    const dirs: string[] = [];
    afterEach(() => {
      for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
    });

    const withStub = (body: string) => {
      const dir = mkdtempSync(join(tmpdir(), 'mh-refresh-'));
      dirs.push(dir);
      const stub = join(dir, 'paqad-ai');
      writeFileSync(stub, `#!/usr/bin/env bash\n${body}\n`);
      chmodSync(stub, 0o755);
      return { PATH: `${dir}${delimiter}${process.env.PATH ?? ''}` };
    };

    it('combines the rollup and sync JSON into one object and exits 0', () => {
      const env = withStub(
        'if [ "$2" = "rollup" ]; then echo \'{"blocked":null,"modules":[]}\'; else echo \'{"processed_events":1}\'; fi',
      );
      const r = runScript(path, ['/tmp/project'], { env });
      expect(r.status).toBe(0);
      expect(JSON.parse(r.stdout)).toEqual({
        rollup: { blocked: null, modules: [] },
        sync: { processed_events: 1 },
      });
    });

    it('still exits 0 with null sides when both inner commands fail with no output', () => {
      const env = withStub('exit 1');
      const r = runScript(path, ['/tmp/project'], { env });
      expect(r.status).toBe(0);
      expect(JSON.parse(r.stdout)).toEqual({ rollup: null, sync: null });
    });

    it('still exits 0 and keeps the parseable side when one inner command fails', () => {
      const env = withStub(
        'if [ "$2" = "rollup" ]; then echo \'{"blocked":"module_health_unknown"}\'; exit 3; fi; echo not-json; exit 2',
      );
      const r = runScript(path, ['/tmp/project'], { env });
      expect(r.status).toBe(0);
      expect(JSON.parse(r.stdout)).toEqual({
        rollup: { blocked: 'module_health_unknown' },
        sync: null,
      });
    });

    it('defaults the project root to the working directory when no argument is given', () => {
      const env = withStub('printf \'{"root":"%s"}\' "$4"');
      const cwd = mkdtempSync(join(tmpdir(), 'mh-cwd-'));
      dirs.push(cwd);
      const r = runScript(path, [], { env, cwd });
      expect(r.status).toBe(0);
      const out = JSON.parse(r.stdout) as { rollup: { root: string }; sync: { root: string } };
      expect(out.rollup.root).toContain('mh-cwd-');
      expect(out.sync.root).toBe(out.rollup.root);
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
