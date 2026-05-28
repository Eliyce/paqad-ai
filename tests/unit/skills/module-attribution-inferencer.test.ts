import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/base/skills/module-attribution-inferencer';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('module-attribution-inferencer scripts', () => {
  describe('infer.sh', () => {
    // Thin wrapper around `paqad-ai module-decisions infer`. Test surface is
    // input validation; CLI behaviour is covered by tests/unit/cli/.
    const path = sh('infer.sh');

    it('--help exits 2 with usage on stdout', () => {
      const r = runScript(path, ['--help']);
      expect(r.status).toBe(2);
      expect(r.stdout).toContain('Usage:');
    });

    it('exit 2 with no arguments', () => {
      const r = runScript(path);
      expect(r.status).toBe(2);
    });

    it('exit 2 when prompt file does not exist', () => {
      const r = runScript(path, ['/no/such/prompt-file.txt']);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('prompt file not found');
    });
  });

  describe('is-confident.sh', () => {
    const path = sh('is-confident.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('exit 0 when confident is true', () => {
      const r = runScript(path, [], { input: JSON.stringify({ confident: true, choices: [] }) });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('true');
    });

    it('exit 1 when confident is false', () => {
      const r = runScript(path, [], { input: JSON.stringify({ confident: false }) });
      expect(r.status).toBe(1);
      expect(r.stdout.trim()).toBe('false');
    });

    it('exit 1 when confident is absent (treated as not confident)', () => {
      const r = runScript(path, [], { input: JSON.stringify({}) });
      expect(r.status).toBe(1);
      expect(r.stdout.trim()).toBe('false');
    });

    it('exit 2 on parse error', () => {
      const r = runScript(path, [], { input: 'nope' });
      expect(r.status).toBe(2);
    });
  });

  describe('require-module-map.sh', () => {
    const path = sh('require-module-map.sh');

    it('exit 0 + prints path when map exists', () => {
      withTempDir((dir) => {
        const mapPath = writeFile(dir, 'docs/instructions/rules/module-map.yml', 'modules: []\n');
        const r = runScript(path, [dir]);
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe(mapPath);
      });
    });

    it('exit 1 + actionable message when map is missing', () => {
      withTempDir((dir) => {
        const r = runScript(path, [dir]);
        expect(r.status).toBe(1);
        expect(r.stderr).toContain('Inferencer requires module-map.yml');
        expect(r.stderr).toContain('create documentation');
      });
    });
  });
});
