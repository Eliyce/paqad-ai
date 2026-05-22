import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/capabilities/security/skills/logging-monitoring-review';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('logging-monitoring-review', () => {
  describe('scan-log-smells.sh', () => {
    const path = sh('scan-log-smells.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('detects sensitive data in log calls', () => {
      withTempDir((dir) => {
        writeFile(dir, 'src/a.ts', 'logger.info("user signed in with password=" + password);');
        writeFile(dir, 'src/b.ts', 'console.error("token issued: " + token);');
        const r = runScript(path, [join(dir, 'src')]);
        expect(r.stdout).toContain('sensitive-data-in-log');
      });
    });

    it('detects request body or req.* in log calls (log-injection candidate)', () => {
      withTempDir((dir) => {
        writeFile(dir, 'src/a.ts', 'logger.info(`incoming ${req.body.message}`);');
        const r = runScript(path, [join(dir, 'src')]);
        expect(r.stdout).toMatch(/log-injection-candidate|request-body-in-log/);
      });
    });

    it('detects audit-log calls (so the LLM can confirm coverage)', () => {
      withTempDir((dir) => {
        writeFile(dir, 'src/a.ts', 'await audit_log({ actor, action: "delete" });');
        const r = runScript(path, [join(dir, 'src')]);
        expect(r.stdout).toContain('audit-log-call');
      });
    });

    it('emits header only when search root missing', () => {
      const r = runScript(path, ['/no/such']);
      expect(r.status).toBe(0);
    });

    it('emits header only on safe code', () => {
      withTempDir((dir) => {
        writeFile(dir, 'src/safe.ts', 'logger.info("user_id=" + userId);');
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

    it('passes a valid block with WSTG-ERRH id', () => {
      const ok =
        '## Findings\n- **High** (WSTG-ERRH-02) — auth: log injection. Evidence: `src/a.ts:1`.\n';
      expect(runScript(path, [], { input: ok }).status).toBe(0);
    });

    it('fails when WSTG id missing', () => {
      const r = runScript(path, [], {
        input: '## Findings\n- **High** — bad. Evidence: `a.ts:1`.\n',
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/WSTG/);
    });
  });
});
