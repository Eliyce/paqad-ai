import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/capabilities/security/skills/permission-boundary-review';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('permission-boundary-review', () => {
  describe('scan-authz-smells.sh', () => {
    const path = sh('scan-authz-smells.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('detects lookup-by-user-id-no-authz (IDOR shape)', () => {
      withTempDir((dir) => {
        writeFile(dir, 'src/a.ts', 'await User.findById(req.params.id);');
        writeFile(dir, 'src/b.ts', 'await Order.find(req.query.orderId);');
        const r = runScript(path, [join(dir, 'src')]);
        expect(r.stdout).toContain('lookup-by-user-id-no-authz');
      });
    });

    it('detects string-compare role admin', () => {
      withTempDir((dir) => {
        writeFile(dir, 'src/a.ts', 'if (user.role === "admin") { ... }');
        const r = runScript(path, [join(dir, 'src')]);
        expect(r.stdout).toContain('string-compare-role-admin');
      });
    });

    it('detects admin/debug/internal path candidates', () => {
      withTempDir((dir) => {
        writeFile(
          dir,
          'src/routes.ts',
          'app.get("/admin/users", handler);\napp.get("/debug/info", h);',
        );
        const r = runScript(path, [join(dir, 'src')]);
        expect(r.stdout).toContain('admin-path-candidate');
      });
    });

    it('detects impersonation calls', () => {
      withTempDir((dir) => {
        writeFile(dir, 'src/a.ts', 'await sessionService.loginAs(targetId);');
        writeFile(dir, 'src/b.ts', 'function impersonate(u) { ... }');
        const r = runScript(path, [join(dir, 'src')]);
        expect(r.stdout).toContain('impersonation-call');
      });
    });

    it('detects tenant-scoped queries', () => {
      withTempDir((dir) => {
        writeFile(dir, 'src/a.ts', 'await Order.find({ where: { tenant_id: t } });');
        const r = runScript(path, [join(dir, 'src')]);
        expect(r.stdout).toMatch(/tenant-scoped-query|tenant-key-usage/);
      });
    });

    it('emits header only on safe code', () => {
      withTempDir((dir) => {
        writeFile(dir, 'src/safe.ts', 'function add(a: number, b: number) { return a + b; }');
        const r = runScript(path, [join(dir, 'src')]);
        expect(r.stdout.trim()).toBe('smell | file:line | excerpt');
      });
    });
  });

  describe('lint-findings.sh', () => {
    const path = sh('lint-findings.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('passes a valid block', () => {
      const ok =
        '## Findings\n- **High** (WSTG-AUTHZ-04) — users/idor. Evidence: `src/users.ts:42`. Missing proof: no policy test. Required action: add tenant filter.\n';
      expect(runScript(path, [], { input: ok }).status).toBe(0);
    });

    it('rejects findings missing WSTG-AUTHZ id', () => {
      const r = runScript(path, [], {
        input:
          '## Findings\n- **High** — bad. Evidence: `a.ts:1`. Missing proof: x. Required action: y.\n',
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/WSTG-AUTHZ/);
    });

    it('rejects findings missing Missing proof / Required action', () => {
      const r = runScript(path, [], {
        input: '## Findings\n- **High** (WSTG-AUTHZ-04) — x. Evidence: `a.ts:1`.\n',
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Missing proof|Required action/);
    });
  });
});
