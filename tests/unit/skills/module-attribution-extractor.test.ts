import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';

const SKILL = 'runtime/base/skills/module-attribution-extractor';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('module-attribution-extractor scripts', () => {
  describe('extract.sh', () => {
    // Thin wrapper around `paqad-ai module-decisions extract`. We don't invoke
    // the real CLI from unit tests — that's covered by tests/unit/cli/. These
    // assert the wrapper's input validation surface.
    const path = sh('extract.sh');

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

  describe('needs-decision.sh', () => {
    const path = sh('needs-decision.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('exit 0 + count when needs_decision is non-empty', () => {
      const r = runScript(path, [], {
        input: JSON.stringify({ needs_decision: [{ slug: 'a' }, { slug: 'b' }], candidates: [] }),
      });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('2');
    });

    it('exit 1 + literal status on stderr when needs_decision is empty', () => {
      const r = runScript(path, [], { input: JSON.stringify({ needs_decision: [] }) });
      expect(r.status).toBe(1);
      expect(r.stdout.trim()).toBe('0');
      expect(r.stderr).toContain('extractor: no-decision-needed');
    });

    it('exit 2 on parse error', () => {
      const r = runScript(path, [], { input: 'not json' });
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('parse error');
    });
  });

  describe('filter-by-kind.sh', () => {
    const path = sh('filter-by-kind.sh');

    it('exit 2 with no kind argument', () => {
      expect(runScript(path).status).toBe(2);
    });

    it('exit 2 on invalid kind', () => {
      const r = runScript(path, ['totally-invalid']);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('kind must be');
    });

    it('filters candidates matching kind=unknown', () => {
      const r = runScript(path, ['unknown'], {
        input: JSON.stringify({
          candidates: [
            { slug: 'a', kind: 'unknown' },
            { slug: 'b', kind: 'exact-match' },
            { slug: 'c', kind: 'unknown' },
          ],
        }),
      });
      expect(r.status).toBe(0);
      const out = JSON.parse(r.stdout);
      expect(out.map((c: { slug: string }) => c.slug)).toEqual(['a', 'c']);
    });

    it('returns [] when nothing matches', () => {
      const r = runScript(path, ['near-collision'], {
        input: JSON.stringify({ candidates: [{ slug: 'a', kind: 'unknown' }] }),
      });
      expect(r.status).toBe(0);
      expect(JSON.parse(r.stdout)).toEqual([]);
    });
  });
});
