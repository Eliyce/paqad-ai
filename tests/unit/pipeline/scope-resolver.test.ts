import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveScope, toProjectRelativeModule } from '@/pipeline/scope-resolver.js';

describe('resolveScope', () => {
  it('returns single-module for empty module list', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-scope-'));
    expect(await resolveScope(root, [])).toEqual({
      scope: 'single-module',
      scope_graph_depth: 0,
    });
  });

  it('returns single-file for exactly one module', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-scope-'));
    expect(await resolveScope(root, ['src/file.ts'])).toEqual({
      scope: 'single-file',
      scope_graph_depth: 0,
    });
  });

  it('returns system-wide immediately when a core/shared module is touched', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-scope-'));
    expect(await resolveScope(root, ['src/api/routes', 'src/core/types/classification'])).toEqual({
      scope: 'system-wide',
      scope_graph_depth: 3,
    });
  });

  it('returns single-module when all paths share the same top-level module root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-scope-'));
    // Both paths → topLevelModuleRoot = 'src/pipeline'
    const result = await resolveScope(root, [
      'src/pipeline/classifier',
      'src/pipeline/pre-classifier',
    ]);
    expect(result).toEqual({ scope: 'single-module', scope_graph_depth: 0 });
  });

  it('returns multi-module when imports span different top-level module roots', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-scope-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src/a.ts'), "import { b } from './b';\n");
    writeFileSync(join(root, 'src/b.ts'), 'export const b = true;\n');

    const result = await resolveScope(root, ['src/a.ts', 'src/b.ts']);
    expect(result.scope).toBe('multi-module');
    expect(result.scope_graph_depth).toBe(1);
  });

  it('skips non-project imports (node_modules) when computing depth', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-scope-'));
    mkdirSync(join(root, 'src/api'), { recursive: true });
    mkdirSync(join(root, 'src/services'), { recursive: true });
    // Only npm imports — no project-internal cross-module deps
    writeFileSync(
      join(root, 'src/api/routes.ts'),
      "import express from 'express'; import zod from 'zod';\n",
    );
    writeFileSync(join(root, 'src/services/auth.ts'), "import lodash from 'lodash';\n");

    const result = await resolveScope(root, ['src/api/routes.ts', 'src/services/auth.ts']);
    // Both paths have different top-level roots (src/api vs src/services) → multi-module
    // No project-internal imports → externalRoots empty → depth 0, totalRoots.size = 2 → multi-module
    expect(result.scope).toBe('multi-module');
    expect(result.scope_graph_depth).toBe(0);
  });

  it('returns system-wide for larger graphs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-scope-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(
      join(root, 'src/a.ts'),
      "import x from './b'; import y from './c'; import z from './d';\n",
    );
    writeFileSync(join(root, 'src/b.ts'), 'export default 1;\n');
    writeFileSync(join(root, 'src/c.ts'), 'export default 2;\n');
    writeFileSync(join(root, 'src/d.ts'), 'export default 3;\n');
    writeFileSync(join(root, 'src/e.ts'), 'export default 4;\n');

    const result = await resolveScope(root, ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts']);
    expect(result.scope).toBe('system-wide');
    expect(result.scope_graph_depth).toBe(3);
  });

  it('resolves @/ alias imports to src/ paths when computing external roots', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-scope-alias-'));
    mkdirSync(join(root, 'src/api'), { recursive: true });
    mkdirSync(join(root, 'src/services'), { recursive: true });
    // Use @/ alias import pointing to a different module root
    writeFileSync(
      join(root, 'src/api/routes.ts'),
      "import { AuthService } from '@/services/auth';\n",
    );
    writeFileSync(join(root, 'src/services/auth.ts'), 'export class AuthService {}\n');

    const result = await resolveScope(root, ['src/api/routes.ts', 'src/services/auth.ts']);
    // @/ resolves to src/services → external root detected → still multi-module
    expect(result.scope).toBe('multi-module');
  });

  it('gracefully handles unreadable files during import scan', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-scope-'));
    // Paths that don't exist on disk — readFile will throw, caught internally
    const result = await resolveScope(root, ['src/missing/a.ts', 'src/other/b.ts']);
    // No readable files, no external imports found → multi-module (ownRoots.size=2)
    expect(result.scope).toBe('multi-module');
    expect(result.scope_graph_depth).toBe(0);
  });

  it('maps absolute files to project-relative modules', () => {
    expect(toProjectRelativeModule('/repo', '/repo/src/file.ts')).toBe('src/file.ts');
  });
});
