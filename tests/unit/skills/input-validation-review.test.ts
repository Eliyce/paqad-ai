import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/capabilities/security/skills/input-validation-review';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('input-validation-review', () => {
  describe('scan-injection-smells.sh', () => {
    const path = sh('scan-injection-smells.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('emits header only when search root missing', () => {
      const r = runScript(path, ['/no/such']);
      expect(r.status).toBe(0);
    });

    it('detects shell-exec with input', () => {
      withTempDir((dir) => {
        writeFile(dir, 'src/a.ts', 'const r = child_process.exec(`ls ${dir}`);');
        writeFile(dir, 'src/b.py', 'subprocess.run(cmd, shell=True)');
        const r = runScript(path, [join(dir, 'src')]);
        expect(r.stdout).toContain('shell-exec-with-input');
      });
    });

    it('detects unsafe template render (dangerouslySetInnerHTML / |raw)', () => {
      withTempDir((dir) => {
        writeFile(dir, 'src/a.tsx', 'return <div dangerouslySetInnerHTML={{ __html: x }} />;');
        writeFile(dir, 'src/b.html', '{{ html | raw }}');
        const r = runScript(path, [join(dir, 'src')]);
        expect(r.stdout).toContain('unsafe-template-render');
      });
    });

    it('detects unsafe deserialize (pickle.loads / unserialize / yaml.load)', () => {
      withTempDir((dir) => {
        writeFile(dir, 'src/a.py', 'data = pickle.loads(blob)');
        writeFile(dir, 'src/b.php', 'unserialize($input);');
        writeFile(dir, 'src/c.py', 'yaml.load(stream)');
        const r = runScript(path, [join(dir, 'src')]);
        expect(r.stdout).toContain('unsafe-deserialize');
      });
    });

    it('detects mass-assignment-candidate calls', () => {
      withTempDir((dir) => {
        writeFile(dir, 'src/a.ts', 'await User.create(req.body);\nawait User.update(req.body);');
        const r = runScript(path, [join(dir, 'src')]);
        expect(r.stdout).toContain('mass-assignment-candidate');
      });
    });

    it('detects PHP superglobal direct use', () => {
      withTempDir((dir) => {
        writeFile(dir, 'src/a.php', '$id = $_GET["id"];');
        const r = runScript(path, [join(dir, 'src')]);
        expect(r.stdout).toContain('php-superglobal-direct-use');
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
        '## Findings\n- **High** (WSTG-INPV-17) — billing/ssrf. Evidence: `src/x.ts:10`.\n';
      expect(runScript(path, [], { input: ok }).status).toBe(0);
    });

    it('rejects findings missing WSTG id', () => {
      const r = runScript(path, [], {
        input: '## Findings\n- **High** — bad. Evidence: `a.ts:1`.\n',
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/WSTG/);
    });
  });
});
