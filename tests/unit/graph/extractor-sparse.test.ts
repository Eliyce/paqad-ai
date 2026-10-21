import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { extractGraph } from '@/graph/extractor';
import { VERSION } from '@/index.js';

function write(path: string, data: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, typeof data === 'string' ? data : JSON.stringify(data));
}

describe('extractGraph with sparse artefacts', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-graph-sparse-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function chunk(source: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      source_file: source,
      ast_node_type: 'fallback',
      ast_node_path: 'p',
      char_count: 0,
      content_hash: 'h',
      ...extra,
    };
  }

  it('reads modules, defects, files and imports that carry missing or odd fields', async () => {
    write(join(root, '.paqad/onboarding-manifest.json'), { project_root: '.' });
    write(join(root, '.paqad/module-health/core.json'), { module: 'core', tier: 'purple' });
    write(join(root, '.paqad/module-health/bad.json'), { module: 42 });
    write(join(root, '.paqad/module-health/broken.json'), '{nope');
    write(join(root, '.paqad/defect-patterns/entries/a.json'), {
      module: 'core',
      modules: ['core', 'ui'],
    });
    write(join(root, '.paqad/defect-patterns/entries/b.json'), { affected_modules: ['core'] });
    write(join(root, '.paqad/defect-patterns/entries/c.json'), '{nope');
    write(join(root, 'src/core/a.ts'), "import { b } from '@/core/b';\nimport { a } from './a';\n");
    write(join(root, 'src/core/b.ts'), 'export const b = 1;\n');
    write(join(root, 'Makefile'), 'all:\n');

    const a = join(root, 'src/core/a.ts');
    const b = join(root, 'src/core/b.ts');
    const unknownExt = join(root, 'src/core/data.xyz');
    write(join(root, '.paqad/context/chunk-index.json'), {
      entries: [
        { source_file: a, chunks: [chunk(a, { exported_symbols: ['a', '', 'a'] })] },
        { source_file: b, chunks: [chunk(b, { id: 'v1', content: 'export const b = 1;' })] },
        { source_file: join(root, 'Makefile'), chunks: [chunk(join(root, 'Makefile'))] },
        { source_file: unknownExt, chunks: [] },
        { source_file: join(root, 'main.go'), chunks: [] },
      ],
    });

    const graph = await extractGraph({ projectRoot: root });

    const core = graph.nodes.find((node) => node.id === 'module:core');
    expect(core?.attributes).toMatchObject({
      health_tier: 'unknown',
      defect_count: 2,
      risk_floor: null,
      complexity_correction: null,
    });
    expect(graph.nodes.filter((node) => node.type === 'module')).toHaveLength(1);
    expect(graph.nodes.find((node) => node.id === 'file:Makefile')?.attributes.language).toBeNull();
    expect(graph.nodes.find((node) => node.id === 'file:src/core/data.xyz')).toMatchObject({
      parent_id: 'module:core',
      attributes: { language: null, size_bytes: null, symbol_count: 0 },
    });
    expect(graph.nodes.find((node) => node.id === 'file:main.go')).toMatchObject({
      parent_id: null,
      attributes: { language: 'go' },
    });
    expect(graph.nodes.filter((node) => node.type === 'symbol').map((node) => node.label)).toEqual([
      'a',
    ]);
    expect(graph.edges.filter((edge) => edge.type === 'imports')).toEqual([
      expect.objectContaining({ source: 'file:src/core/a.ts', target: 'file:src/core/b.ts' }),
    ]);
    expect(graph.meta.overlays_available).toMatchObject({ health: true, defects: true });
  });

  it('marks modules with no defects as zero only when the defect store exists', async () => {
    write(join(root, '.paqad/onboarding-manifest.json'), { framework_version: VERSION });
    write(join(root, '.paqad/module-health/ui.json'), { module: 'ui', tier: 'green' });
    mkdirSync(join(root, '.paqad/defect-patterns/entries'), { recursive: true });

    const graph = await extractGraph({ projectRoot: root });
    expect(graph.nodes.find((node) => node.id === 'module:ui')?.attributes.defect_count).toBe(0);
    expect(graph.meta.degraded_reasons.some((reason) => reason.includes('version mismatch'))).toBe(
      false,
    );
  });

  it('does not flag a version that differs only below the major', async () => {
    const [major] = VERSION.split('.');
    write(join(root, '.paqad/onboarding-manifest.json'), { framework_version: `${major}.0.0-old` });
    write(join(root, '.paqad/module-health/empty.txt'), 'x');

    const graph = await extractGraph({ projectRoot: root });
    expect(graph.meta.degraded_reasons.some((reason) => reason.includes('version mismatch'))).toBe(
      false,
    );
    expect(graph.meta.overlays_available.health).toBe(false);
  });

  it('flags a version whose major differs, including one with no leading number', async () => {
    write(join(root, '.paqad/onboarding-manifest.json'), { framework_version: 'next' });

    const graph = await extractGraph({ projectRoot: root });
    expect(graph.meta.degraded_reasons.some((reason) => reason.includes('version mismatch'))).toBe(
      true,
    );
  });
});
