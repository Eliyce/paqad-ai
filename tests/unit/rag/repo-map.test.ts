import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildProjectRepoMap,
  buildRepoMap,
  pageRank,
  type RepoEdge,
  type RepoFile,
} from '@/rag/repo-map.js';

describe('pageRank', () => {
  it('ranks an import hub above its leaf importers', () => {
    // a, b, c all import the shared `hub`.
    const edges: RepoEdge[] = [
      { from: 'a.ts', to: 'hub.ts' },
      { from: 'b.ts', to: 'hub.ts' },
      { from: 'c.ts', to: 'hub.ts' },
    ];
    const ranks = pageRank(['a.ts', 'b.ts', 'c.ts', 'hub.ts'], edges);
    expect(ranks.get('hub.ts')!).toBeGreaterThan(ranks.get('a.ts')!);
  });

  it('gives a seed node with no edges a non-zero rank', () => {
    const ranks = pageRank(['lonely.ts'], []);
    expect(ranks.get('lonely.ts')!).toBeGreaterThan(0);
  });

  it('returns an empty map for no nodes', () => {
    expect(pageRank([], []).size).toBe(0);
  });

  it('ignores self-imports', () => {
    const ranks = pageRank(['x.ts'], [{ from: 'x.ts', to: 'x.ts' }]);
    expect(ranks.get('x.ts')!).toBeGreaterThan(0);
  });
});

describe('buildRepoMap', () => {
  const files: RepoFile[] = [
    { path: 'src/a.ts', module: 'feature-a', symbols: ['doA'] },
    { path: 'src/hub.ts', module: 'core', symbols: ['hub', 'shared'] },
  ];
  const edges: RepoEdge[] = [{ from: 'src/a.ts', to: 'src/hub.ts' }];

  it('orders entries by descending rank and renders a skeleton', () => {
    const map = buildRepoMap(files, edges);
    expect(map.entries[0].path).toBe('src/hub.ts');
    expect(map.skeleton).toContain('## Repo map');
    expect(map.skeleton).toContain('`src/hub.ts`');
    expect(map.skeleton).toContain('core');
    expect(map.skeleton).toContain('hub, shared');
  });

  it('truncates to the token budget', () => {
    const many: RepoFile[] = Array.from({ length: 200 }, (_unused, index) => ({
      path: `src/file-${index}.ts`,
      module: 'mod',
      symbols: ['sym'],
    }));
    const map = buildRepoMap(many, [], { tokenBudget: 60 });
    expect(map.truncated).toBe(true);
    expect(map.skeleton).toContain('repo map truncated');
    expect(map.entries.length).toBe(200); // ranking keeps every entry; only the render is cut
  });

  it('returns an empty skeleton for no files', () => {
    const map = buildRepoMap([], []);
    expect(map.skeleton).toBe('');
    expect(map.truncated).toBe(false);
  });
});

describe('buildProjectRepoMap', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-repomap-'));
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('scans real import edges and ranks the imported file higher', async () => {
    writeFileSync(join(projectRoot, 'src', 'util.ts'), 'export const u = 1;\n');
    writeFileSync(
      join(projectRoot, 'src', 'a.ts'),
      "import { u } from './util.js';\nexport const a = u;\n",
    );
    writeFileSync(
      join(projectRoot, 'src', 'b.ts'),
      "import { u } from './util.js';\nexport const b = u;\n",
    );

    const map = await buildProjectRepoMap(projectRoot, {
      files: ['src/util.ts', 'src/a.ts', 'src/b.ts'],
      moduleOf: () => 'core',
    });
    expect(map.entries[0].path).toBe('src/util.ts');
    expect(map.skeleton).toContain('`src/util.ts`');
  });
});
