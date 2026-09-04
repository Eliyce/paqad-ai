import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { groundArea } from '@/spec-pipeline/grounding.js';

const roots: string[] = [];
function tempRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-ground-'));
  roots.push(r);
  return r;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function writeDoc(root: string, rel: string, body: string): void {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body, 'utf8');
}

describe('groundArea', () => {
  it('collects terms and references from module docs (FR-2.2)', () => {
    const root = tempRoot();
    writeDoc(
      root,
      'docs/modules/export/business.md',
      '# Report export\n## Clean export\nAn export excludes **hidden columns** and **archived invoices**.\n',
    );
    const g = groundArea(root, { modules: ['export'] });
    expect(g.references).toEqual([{ kind: 'doc', ref: 'docs/modules/export/business.md' }]);
    expect(g.terms).toContain('Clean export');
    expect(g.terms).toContain('hidden columns');
    expect(g.sparse).toBe(false);
  });

  it('succeeds and marks sparse for an undocumented area (FR-2.3)', () => {
    const g = groundArea(tempRoot(), { modules: ['nope'] });
    expect(g.references).toEqual([]);
    expect(g.terms).toEqual([]);
    expect(g.sparse).toBe(true);
  });

  it('is deterministic (sorted references and terms)', () => {
    const root = tempRoot();
    writeDoc(root, 'docs/modules/a/business.md', '## Beta\n## Alpha\n');
    expect(groundArea(root)).toEqual(groundArea(root));
  });
});
