import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/capabilities/security/skills/auth-mechanism-review';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('auth-mechanism-review', () => {
  describe('scan-auth-smells.sh', () => {
    const path = sh('scan-auth-smells.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('emits header and exits 0 when search root missing (note on stderr)', () => {
      const r = runScript(path, ['/no/such/dir']);
      expect(r.status).toBe(0);
      expect(r.stderr).toMatch(/search root not found/i);
    });

    it('detects every documented smell', () => {
      withTempDir((dir) => {
        // One file per smell type, hits clearly identifiable.
        writeFile(dir, 'src/jwt.ts', `const opts = { alg: "none" };`);
        writeFile(dir, 'src/storage.ts', `localStorage.setItem("authToken", t);`);
        writeFile(dir, 'src/storage2.ts', `sessionStorage.setItem("Token", t);`);
        writeFile(dir, 'src/hash.ts', `const x = md5(input);\nconst y = sha1(input);`);
        writeFile(dir, 'src/bcrypt.ts', `bcrypt.hash(p, 8);`);
        writeFile(dir, 'src/cfg.ts', `jwt_secret: "changeme"`);
        writeFile(dir, 'src/oauth.ts', `response_type=token`);
        writeFile(dir, 'src/redirect.ts', `redirect_uri=*`);

        const r = runScript(path, [join(dir, 'src')]);
        expect(r.status).toBe(0);
        const out = r.stdout;
        for (const smell of [
          'jwt-alg-none',
          'token-in-localstorage',
          'token-in-sessionstorage',
          'weak-hash',
          'bcrypt-cost-low',
          'weak-jwt-secret',
          'oauth-implicit-flow',
          'oauth-wildcard-redirect',
        ]) {
          expect(out, `smell ${smell} should be in output`).toContain(smell);
        }
      });
    });

    it('does NOT flag safe code', () => {
      withTempDir((dir) => {
        writeFile(
          dir,
          'src/safe.ts',
          [
            'import bcrypt from "bcrypt";',
            'await bcrypt.hash(pw, 12);',
            'const opts = { alg: "RS256" };',
            'document.cookie = `token=${t}; HttpOnly; Secure`;',
          ].join('\n'),
        );
        const r = runScript(path, [join(dir, 'src')]);
        // Header line only.
        expect(r.stdout.trim()).toBe('smell | file:line | excerpt');
      });
    });

    it('emits the canonical 3-column shape per row', () => {
      withTempDir((dir) => {
        writeFile(dir, 'src/jwt.ts', `alg: "none"`);
        const r = runScript(path, [join(dir, 'src')]);
        const dataRow = r.stdout.split('\n').find((l) => l.startsWith('jwt-alg-none'));
        expect(dataRow).toBeDefined();
        // Format: "<smell> | <file>:<line> | <excerpt>"
        expect(dataRow).toMatch(/^jwt-alg-none \| .+:\d+ \| .+$/);
      });
    });
  });

  describe('lint-findings.sh', () => {
    const path = sh('lint-findings.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('passes a valid block with WSTG ids and Evidence:file:line', () => {
      const ok = [
        '## Findings',
        '- **High** (WSTG-SESS-10) — jwt: alg none accepted. Evidence: `src/auth.ts:42`. Required action: reject.',
        '- **Medium** (WSTG-ATHN-03) — brute force surface. Evidence: `src/login.ts:7`. Required action: rate limit.',
      ].join('\n');
      const r = runScript(path, [], { input: ok });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('ok');
    });

    it('fails when WSTG id missing', () => {
      const r = runScript(path, [], {
        input: '## Findings\n- **High** — nope. Evidence: `a.ts:1`.\n',
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/WSTG/);
    });

    it('fails when Evidence:file:line missing', () => {
      const r = runScript(path, [], {
        input: '## Findings\n- **High** (WSTG-ATHN-03) — bla bla. no evidence here.\n',
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Evidence/);
    });

    it('exits 2 on missing file', () => {
      expect(runScript(path, ['/no/such/file']).status).toBe(2);
    });
  });

  describe('assets', () => {
    it('output.template.md filled passes lint-findings.sh', () => {
      const filled = [
        '## Findings',
        '- **High** (WSTG-SESS-10) — auth/jwt: alg confusion. Evidence: `src/jwt.ts:34`. Required action: enforce algorithm allowlist.',
        '- **Medium** (WSTG-ATHN-03) — auth/login: missing rate limit. Evidence: `src/login.ts:12`. Required action: add throttle.',
      ].join('\n');
      const r = runScript(sh('lint-findings.sh'), [], { input: filled });
      expect(r.status).toBe(0);
    });
  });
});
