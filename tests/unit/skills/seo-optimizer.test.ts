import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/capabilities/content/skills/seo-optimizer';
const sh = (n: string) => join(SKILL, 'scripts', n);

function audit(draft: string, kw?: string): Record<string, string> {
  const out: Record<string, string> = {};
  return withTempDir((dir) => {
    const f = writeFile(dir, 'draft.md', draft);
    const args = kw === undefined ? [f] : [f, kw];
    const r = runScript(sh('audit-seo.sh'), args);
    expect(r.status).toBe(0);
    for (const line of r.stdout.split('\n')) {
      const m = line.match(/^([a-z0-9_]+):\s*(.*)$/);
      if (m) out[m[1]] = m[2];
    }
    return out;
  });
}

describe('seo-optimizer', () => {
  describe('audit-seo.sh', () => {
    const path = sh('audit-seo.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('exits 2 when draft missing', () => {
      expect(runScript(path, ['/no/such/draft.md']).status).toBe(2);
    });

    it('counts headings, title length, internal links', () => {
      const out = audit(
        '# Hello world\n\nIntro paragraph.\n\n## Sub one\n## Sub two\n### Sub-sub\n\n[link](/internal) and [extern](https://x)\n',
      );
      expect(out.h1_count).toBe('1');
      expect(out.h2_count).toBe('2');
      expect(out.h3_count).toBe('1');
      expect(out.title).toBe('Hello world');
      expect(out.title_len).toBe('11');
      expect(out.internal_links).toBe('1');
    });

    it('extracts the meta-description as the first paragraph after H1', () => {
      const out = audit(
        '# Title\nThis is the lede paragraph in one line.\n\nNext paragraph here.\n',
      );
      expect(out.meta).toBe('This is the lede paragraph in one line.');
      expect(Number(out.meta_len)).toBeGreaterThan(20);
    });

    it('counts primary keyword case-insensitively', () => {
      const out = audit(
        '# Refund Window\n\nThe refund window is 30 days.\n\nLearn how the Refund Window works.\n',
        'refund window',
      );
      expect(Number(out.primary_kw_count)).toBeGreaterThanOrEqual(2);
    });

    it('counts images and images-with-alt', () => {
      const out = audit('# T\n\n![alt](x.png)\n![](y.png)\n\nSee\n');
      expect(out.images).toBe('2');
      expect(out.images_with_alt).toBe('1');
    });

    it('returns 0s on a draft with nothing to count', () => {
      const out = audit('plain prose\nno headings\n');
      expect(out.h1_count).toBe('0');
      expect(out.h2_count).toBe('0');
      expect(out.images).toBe('0');
      expect(out.internal_links).toBe('0');
    });
  });

  describe('lint-output.sh', () => {
    const path = sh('lint-output.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('passes a valid block', () => {
      const ok = '## SEO Findings\n- x\n## Suggested Title/Meta\n- y\n';
      expect(runScript(path, [], { input: ok }).status).toBe(0);
    });

    it('fails when either section missing', () => {
      const r1 = runScript(path, [], { input: '## SEO Findings\n- x\n' });
      expect(r1.status).toBe(1);
      expect(r1.stderr).toMatch(/Suggested Title/);

      const r2 = runScript(path, [], { input: '## Suggested Title/Meta\n- y\n' });
      expect(r2.status).toBe(1);
      expect(r2.stderr).toMatch(/SEO Findings/);
    });
  });
});
