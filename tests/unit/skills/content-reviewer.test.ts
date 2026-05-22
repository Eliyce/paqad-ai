import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';

const SKILL = 'runtime/capabilities/content/skills/content-reviewer';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('content-reviewer', () => {
  describe('scan-prose.sh', () => {
    const path = sh('scan-prose.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('emits header only on clean prose', () => {
      const r = runScript(path, [], { input: 'Buy our SaaS today.\n' });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('smell | line | excerpt');
    });

    it('detects filler words', () => {
      const r = runScript(path, [], { input: 'this is really very simple.\n' });
      expect(r.stdout).toContain('filler-word');
    });

    it('detects hedges', () => {
      const r = runScript(path, [], { input: 'It might be slow.\n' });
      expect(r.stdout).toContain('hedge');
    });

    it('detects jargon', () => {
      const r = runScript(path, [], { input: 'We leverage synergy to utilize the paradigm.\n' });
      expect(r.stdout).toContain('jargon');
    });

    it('detects vague "this system / this tool"', () => {
      const r = runScript(path, [], { input: 'This system handles auth.\n' });
      expect(r.stdout).toContain('vague-this');
    });

    it('detects long lines (>180 chars)', () => {
      const long = 'x'.repeat(200);
      const r = runScript(path, [], { input: long + '\n' });
      expect(r.stdout).toContain('long-line');
    });

    it('detects "click here" anchor text', () => {
      const r = runScript(path, [], { input: 'For more, click here for details.\n' });
      expect(r.stdout).toContain('click-here-link-text');
    });

    it('detects empty markdown links', () => {
      const r = runScript(path, [], { input: 'See [the docs]() for more.\n' });
      expect(r.stdout).toContain('empty-link');
    });
  });

  describe('lint-output.sh', () => {
    const path = sh('lint-output.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('passes a 2-bucket valid block', () => {
      const ok = '## Blocking Issues\n- x\n## Improvement Opportunities\n- y\n';
      expect(runScript(path, [], { input: ok }).status).toBe(0);
    });

    it('passes "<bucket>: none" form', () => {
      const ok = 'Blocking Issues: none\nImprovement Opportunities: none\n';
      expect(runScript(path, [], { input: ok }).status).toBe(0);
    });

    it('fails when bucket missing', () => {
      const r = runScript(path, [], { input: '## Blocking Issues\n- x\n' });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Improvement Opportunities/);
    });
  });
});
