import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/capabilities/security/skills/cryptographic-review';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('cryptographic-review', () => {
  describe('scan-crypto-smells.sh', () => {
    const path = sh('scan-crypto-smells.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('exits 0 with note when search root missing', () => {
      const r = runScript(path, ['/no/such']);
      expect(r.status).toBe(0);
      expect(r.stderr).toMatch(/search root not found/);
    });

    it('detects insecure PRNG (Math.random / rand / random.random)', () => {
      withTempDir((dir) => {
        writeFile(dir, 'src/a.ts', 'const t = Math.random();');
        writeFile(dir, 'src/b.php', '$x = rand();');
        writeFile(dir, 'src/c.py', 'token = random.random()');
        const r = runScript(path, [join(dir, 'src')]);
        expect(r.stdout).toContain('insecure-prng-js');
        expect(r.stdout).toContain('insecure-prng-php');
        expect(r.stdout).toContain('insecure-prng-py-java');
      });
    });

    it('detects weak hash for password (md5/sha1)', () => {
      withTempDir((dir) => {
        writeFile(dir, 'src/h.ts', 'const x = md5(password);\nconst y = sha1(password);');
        const r = runScript(path, [join(dir, 'src')]);
        expect(r.stdout).toContain('weak-hash-for-password-candidate');
      });
    });

    it('detects AES/ECB and TLS verify-disabled', () => {
      withTempDir((dir) => {
        writeFile(dir, 'src/a.ts', 'const cipher = createCipheriv("aes-128-ecb", key, iv);');
        writeFile(dir, 'src/b.ts', 'fetch(url, { rejectUnauthorized: false });');
        writeFile(dir, 'src/c.py', 'requests.get(url, verify=False)');
        const r = runScript(path, [join(dir, 'src')]);
        expect(r.stdout).toContain('aes-ecb-mode');
        expect(r.stdout).toMatch(/tls-verify-disabled/);
      });
    });

    it('detects hardcoded secret candidates', () => {
      withTempDir((dir) => {
        writeFile(dir, 'src/cfg.ts', 'export const apiKey = "AKIAIOSFODNN7EXAMPLE12345";');
        const r = runScript(path, [join(dir, 'src')]);
        expect(r.stdout).toContain('hardcoded-secret-candidate');
      });
    });

    it('emits header only on safe code', () => {
      withTempDir((dir) => {
        writeFile(
          dir,
          'src/safe.ts',
          [
            'import { randomBytes } from "crypto";',
            'const t = randomBytes(32);',
            'await argon2.hash(pw);',
          ].join('\n'),
        );
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

    it('passes a valid block with WSTG-CRYP id and Evidence', () => {
      const ok =
        '## Findings\n- **High** (WSTG-CRYP-01) — auth: weak hash. Evidence: `src/h.ts:3`. Required action: switch to argon2.\n';
      expect(runScript(path, [], { input: ok }).status).toBe(0);
    });

    it('rejects findings missing WSTG-CRYP id', () => {
      const r = runScript(path, [], {
        input: '## Findings\n- **High** — bad. Evidence: `a.ts:1`.\n',
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/WSTG-CRYP/);
    });

    it('rejects literal long base64-like secrets in the report (anti-leak guard)', () => {
      const bad =
        '## Findings\n- **High** (WSTG-CRYP-04) — Evidence: "AKIAIOSFODNN7EXAMPLEABCDEFGHIJKL".\n';
      const r = runScript(path, [], { input: bad });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/literal secret/);
    });
  });
});
