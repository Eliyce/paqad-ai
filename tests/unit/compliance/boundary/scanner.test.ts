import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { scanBoundaries } from '@/compliance/boundary/scanner.js';

async function tempProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'paqad-scan-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  return root;
}

describe('scanBoundaries', () => {
  it('detects boundaries from annotated source files', async () => {
    const root = await tempProject();
    await writeFile(
      path.join(root, 'src', 'types.ts'),
      `// @boundary GateResult producer:spec-a consumer:spec-b states:pass,fail\nexport type GateResult = 'pass' | 'fail';\n`,
      'utf8',
    );

    const results = await scanBoundaries({ project_root: root });
    expect(results).toHaveLength(1);
    expect(results[0]!.boundary.type_name).toBe('GateResult');
  });

  it('returns empty when no source files contain @boundary annotations', async () => {
    const root = await tempProject();
    await writeFile(path.join(root, 'src', 'noop.ts'), `export const x = 1;\n`, 'utf8');
    const results = await scanBoundaries({ project_root: root });
    expect(results).toHaveLength(0);
  });

  it('loads spec text from spec_paths for handling-set extraction', async () => {
    const root = await tempProject();
    await writeFile(
      path.join(root, 'src', 'types.ts'),
      `// @boundary Status producer:p consumer:c states:active,inactive\n`,
      'utf8',
    );

    const specFile = path.join(root, 'spec.md');
    await writeFile(specFile, 'When status is active, proceed.', 'utf8');

    const results = await scanBoundaries({
      project_root: root,
      spec_paths: new Map([['c', specFile]]),
    });
    const unhandled = results[0]!.unhandled_by_consumer.get('c')!;
    expect(unhandled.map((u) => u.state)).toContain('inactive');
    expect(unhandled.map((u) => u.state)).not.toContain('active');
  });

  it('resolves relative spec paths against project root', async () => {
    const root = await tempProject();
    await writeFile(
      path.join(root, 'src', 'types.ts'),
      `// @boundary Status producer:p consumer:c states:active,inactive\n`,
      'utf8',
    );
    await mkdir(path.join(root, 'docs'), { recursive: true });
    await writeFile(path.join(root, 'docs', 'c.md'), 'status active is handled', 'utf8');

    const results = await scanBoundaries({
      project_root: root,
      spec_paths: new Map([['c', 'docs/c.md']]),
    });
    const unhandled = results[0]!.unhandled_by_consumer.get('c')!;
    expect(unhandled.map((u) => u.state)).toEqual(['inactive']);
  });

  it('uses empty text for missing spec paths gracefully', async () => {
    const root = await tempProject();
    await writeFile(
      path.join(root, 'src', 'types.ts'),
      `// @boundary Status producer:p consumer:c states:active,inactive\n`,
      'utf8',
    );

    const results = await scanBoundaries({
      project_root: root,
      spec_paths: new Map([['c', '/nonexistent/spec.md']]),
    });
    const unhandled = results[0]!.unhandled_by_consumer.get('c')!;
    // All states unhandled since spec is empty
    expect(unhandled).toHaveLength(2);
  });

  it('respects custom source_globs', async () => {
    const root = await tempProject();
    await mkdir(path.join(root, 'lib'), { recursive: true });
    await writeFile(
      path.join(root, 'lib', 'boundary.ts'),
      `// @boundary Foo producer:a consumer:b states:x,y\n`,
      'utf8',
    );

    const allResults = await scanBoundaries({
      project_root: root,
      source_globs: ['lib/**/*.ts'],
    });
    expect(allResults).toHaveLength(1);

    const noResults = await scanBoundaries({
      project_root: root,
      source_globs: ['src/**/*.ts'],
    });
    expect(noResults).toHaveLength(0);
  });
});
