import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';

const SKILL = 'runtime/capabilities/security/skills/runtime-surface-probing';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('runtime-surface-probing', () => {
  describe('probe-surfaces.sh', () => {
    // Live HTTP fixtures are not exercised here because spawnSync deadlocks
    // with same-process listeners (curl reaches the kernel socket but Node's
    // event loop is blocked). End-to-end probing is verified manually; the
    // unit tests below cover the script's deterministic non-network paths.
    const path = sh('probe-surfaces.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('exits 2 when base-url missing', () => {
      const r = runScript(path);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/usage:/i);
    });

    it('exits 2 when paths-file missing', () => {
      const r = runScript(path, ['http://127.0.0.1:1', '/no/such/paths.txt']);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/paths file not found/);
    });

    it('exits 1 with "base unreachable" when no listener', () => {
      const r = runScript(path, ['http://127.0.0.1:1'], { timeoutMs: 15_000 });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/base unreachable/);
    }, 15_000);
  });

  describe('lint-findings.sh', () => {
    const path = sh('lint-findings.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('passes a valid finding with Path: backticked + Status: numeric', () => {
      const ok =
        '## Findings\n- **High** — admin: exposed. Path: `/admin`. Status: 200. Required action: gate.\n';
      expect(runScript(path, [], { input: ok }).status).toBe(0);
    });

    it('rejects findings missing backticked Path: or numeric Status:', () => {
      const r1 = runScript(path, [], {
        input: '## Findings\n- **High** — x. Status: 200. Required action: y.\n',
      });
      expect(r1.status).toBe(1);
      expect(r1.stderr).toMatch(/Path/);

      const r2 = runScript(path, [], {
        input: '## Findings\n- **High** — x. Path: `/y`. Required action: z.\n',
      });
      expect(r2.status).toBe(1);
      expect(r2.stderr).toMatch(/Status/);
    });
  });
});
