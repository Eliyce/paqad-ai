import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/base/skills/performance-regression-estimator';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('performance-regression-estimator', () => {
  describe('scan-perf-smells.sh', () => {
    const path = sh('scan-perf-smells.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('exits 2 with usage when no files', () => {
      const r = runScript(path);
      expect(r.status).toBe(2);
    });

    it('emits header only when files have no smells', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'a.ts', 'function foo() { return 1; }\n');
        const r = runScript(path, [f]);
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe('smell | file:line | excerpt');
      });
    });

    it('detects async-map (missing Promise.all)', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'a.ts', 'items.map(async (i) => fetch(i));');
        const r = runScript(path, [f]);
        expect(r.stdout).toContain('async-map-no-Promise.all');
      });
    });

    it('detects deep-clone via JSON.parse(JSON.stringify(...))', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'a.ts', 'const c = JSON.parse(JSON.stringify(obj));');
        const r = runScript(path, [f]);
        expect(r.stdout).toContain('deep-clone-via-JSON');
      });
    });

    it('detects ORM .find / .findOne candidates', () => {
      withTempDir((dir) => {
        const f = writeFile(
          dir,
          'a.ts',
          'await User.findOne({ id });\nawait Order.find({ active: true });',
        );
        const r = runScript(path, [f]);
        expect(r.stdout).toContain('orm-find-inside-loop-candidate');
      });
    });

    it('detects unbounded pagination (limit: 0 / LIMIT 0)', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'a.ts', 'await q({ limit: 0 });');
        const g = writeFile(dir, 'b.sql', 'SELECT * FROM t LIMIT 0;');
        const r = runScript(path, [f, g]);
        expect(r.stdout).toContain('unbounded-pagination');
      });
    });

    it('detects log-in-hot-path candidates', () => {
      withTempDir((dir) => {
        const f = writeFile(
          dir,
          'a.ts',
          'console.log("hello");\nconsole.info("hi");\nconsole.debug("dbg");',
        );
        const r = runScript(path, [f]);
        expect(r.stdout).toContain('log-in-hot-path-candidate');
      });
    });

    it('skips non-existent files quietly and continues', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'a.ts', 'JSON.parse(JSON.stringify(x));');
        const r = runScript(path, [f, '/no/such/file.ts']);
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('deep-clone-via-JSON');
      });
    });
  });

  describe('lint-output.sh', () => {
    const path = sh('lint-output.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('passes the empty short-circuit literal', () => {
      const r = runScript(path, [], { input: 'Performance Hazards: none detected.\n' });
      expect(r.status).toBe(0);
    });

    it('passes a valid block with allowed severities', () => {
      const ok = [
        '## Performance Hazards',
        '### Hazard Map',
        '| # | Hazard | Path | On hot path? | Severity | Remediation |',
        '| --- | --- | --- | --- | --- | --- |',
        '| 1 | N+1 | `src/a.ts:42` | yes | high | batch query |',
        '| 2 | log | `src/jobs/cleanup.ts:18` | no | low | drop log |',
        '### Recommended Pre-Merge Actions',
      ].join('\n');
      expect(runScript(path, [], { input: ok }).status).toBe(0);
    });

    it('rejects out-of-vocab severity', () => {
      const bad = [
        '## Performance Hazards',
        '### Hazard Map',
        '| # | Hazard | Path | On hot path? | Severity | Remediation |',
        '| --- | --- | --- | --- | --- | --- |',
        '| 1 | x | `a.ts:1` | yes | catastrophic | y |',
        '### Recommended Pre-Merge Actions',
      ].join('\n');
      const r = runScript(path, [], { input: bad });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/unknown severity: catastrophic/);
    });

    it('fails when canonical 6-column header missing', () => {
      const r = runScript(path, [], {
        input:
          '## Performance Hazards\n### Hazard Map\n| # | Hazard | Severity |\n### Recommended Pre-Merge Actions\n',
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/canonical 6-column header/);
    });
  });
});
