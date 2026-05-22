import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/capabilities/security/skills/rate-limiting-review';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('rate-limiting-review', () => {
  describe('scan-rate-limit.sh', () => {
    const path = sh('scan-rate-limit.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('detects auth-endpoint paths', () => {
      withTempDir((dir) => {
        writeFile(
          dir,
          'src/r.ts',
          'app.post("/login", h);\napp.post("/reset-password", h);\napp.post("/verify-otp", h);',
        );
        const r = runScript(path, [join(dir, 'src')]);
        expect(r.stdout).toContain('auth-endpoint');
      });
    });

    it('detects bulk-endpoint paths', () => {
      withTempDir((dir) => {
        writeFile(
          dir,
          'src/r.ts',
          'app.post("/export", h);\napp.post("/bulk/import", h);\napp.get("/download/csv", h);',
        );
        const r = runScript(path, [join(dir, 'src')]);
        expect(r.stdout).toContain('bulk-endpoint');
      });
    });

    it('detects throttle/limiter middleware presence', () => {
      withTempDir((dir) => {
        writeFile(dir, 'src/r.ts', 'app.use(rateLimit({ max: 100 }));\nrouter.use(throttle());');
        const r = runScript(path, [join(dir, 'src')]);
        expect(r.stdout).toContain('rate-limit-present');
      });
    });

    it('detects pagination-param candidates', () => {
      withTempDir((dir) => {
        writeFile(
          dir,
          'src/r.ts',
          'const { per_page } = req.query;\nconst { page_size: ps } = body;',
        );
        const r = runScript(path, [join(dir, 'src')]);
        expect(r.stdout).toContain('pagination-param-candidate');
      });
    });

    it('emits header only on benign code', () => {
      withTempDir((dir) => {
        writeFile(dir, 'src/safe.ts', 'function noop() { return 1; }');
        const r = runScript(path, [join(dir, 'src')]);
        expect(r.stdout.trim()).toBe('signal | file:line | excerpt');
      });
    });
  });

  describe('lint-findings.sh', () => {
    const path = sh('lint-findings.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('passes valid finding with WSTG-INPV-13 + Required action', () => {
      const ok =
        '## Findings\n- **High** (WSTG-INPV-13) — auth/login. Evidence: `src/r.ts:42`. Required action: add throttle.\n';
      expect(runScript(path, [], { input: ok }).status).toBe(0);
    });

    it('fails when WSTG id missing', () => {
      const r = runScript(path, [], {
        input: '## Findings\n- **High** — x. Evidence: `a.ts:1`. Required action: y.\n',
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/WSTG/);
    });

    it('fails when Required action missing', () => {
      const r = runScript(path, [], {
        input: '## Findings\n- **High** (WSTG-INPV-13) — x. Evidence: `a.ts:1`.\n',
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Required action/);
    });
  });
});
