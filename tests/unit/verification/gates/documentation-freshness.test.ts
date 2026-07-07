import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DocumentationFreshnessGate } from '@/verification/gates/documentation-freshness.js';

import { createVerificationContext } from '../shared.fixture.js';

describe('DocumentationFreshnessGate', () => {
  const gate = new DocumentationFreshnessGate();

  it('passes when all docs are current', async () => {
    const result = await gate.check(createVerificationContext());
    expect(result.passed).toBe(true);
  });

  it('fails when api/endpoints.md is missing', async () => {
    const context = createVerificationContext();
    rmSync(join(context.project_root, 'docs/modules/core/api/endpoints.md'));
    const result = await gate.check(context);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('endpoints.md');
  });

  it('fails when integration/events.md is missing', async () => {
    const context = createVerificationContext();
    rmSync(join(context.project_root, 'docs/modules/core/integration/events.md'));
    const result = await gate.check(context);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('events.md');
  });

  it('fails when the diff implies stale canonical docs that were not updated', async () => {
    const context = createVerificationContext({
      changed_files: ['src/pipeline/router.ts'],
      changed_files_source: 'session-artifact',
      code_changed: true,
      stale_doc_targets: [
        {
          target_path: 'docs/maintainers/architecture-map.md',
          ownership_kind: 'implementation-drift',
          owners: ['src/pipeline/router.ts'],
          reason: 'Routing changes can stale architecture ownership mappings.',
        },
      ],
    });
    // The drift doc EXISTS, so the code change legitimately flags it for review. A
    // framework-assumed doc the project never created can't be staled (issue #307).
    mkdirSync(join(context.project_root, 'docs/maintainers'), { recursive: true });
    writeFileSync(join(context.project_root, 'docs/maintainers/architecture-map.md'), '# Map\n');

    const result = await gate.check(context);

    expect(result.passed).toBe(false);
    expect(result.detail).toContain('Canonical docs not updated');
    expect(result.detail).toContain('docs/maintainers/architecture-map.md');
    expect(result.detail).toContain('src/pipeline/router.ts');
    expect(result.detail).toContain('Routing changes can stale architecture ownership mappings.');
  });

  it('does not flag a framework-assumed drift doc that does not exist on disk', async () => {
    const result = await gate.check(
      createVerificationContext({
        changed_files: ['src/pipeline/router.ts'],
        changed_files_source: 'session-artifact',
        code_changed: true,
        stale_doc_targets: [
          {
            target_path: 'docs/maintainers/architecture-map.md',
            ownership_kind: 'implementation-drift',
            owners: ['src/pipeline/router.ts'],
            reason: 'Routing changes can stale architecture ownership mappings.',
          },
        ],
      }),
    );

    expect(result.detail).not.toContain('Canonical docs not updated');
  });

  it('fails when a directly edited stale canonical target is still invalid', async () => {
    const context = createVerificationContext({
      changed_files: ['src/pipeline/router.ts', 'docs/maintainers/architecture-map.md'],
      changed_files_source: 'session-artifact',
      code_changed: true,
      stale_doc_targets: [
        {
          target_path: 'docs/maintainers/architecture-map.md',
          ownership_kind: 'direct-doc-edit',
          owners: ['src/pipeline/router.ts', 'docs/maintainers/architecture-map.md'],
          reason: 'Routing changes can stale architecture ownership mappings.',
        },
      ],
    });
    writeBrokenDoc(context.project_root, 'docs/maintainers/architecture-map.md', 'not markdown');

    const result = await gate.check(context);

    expect(result.passed).toBe(false);
    expect(result.detail).toContain('docs/maintainers/architecture-map.md');
    expect(result.detail).toContain('Direct edit still unresolved');
    expect(result.detail).toContain('missing a heading');
  });

  it('fails when error-catalog.md is missing', async () => {
    const context = createVerificationContext();
    rmSync(join(context.project_root, 'docs/modules/core/error-catalog.md'));
    const result = await gate.check(context);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('error-catalog.md');
  });

  it('fails when registries are stale', async () => {
    const context = createVerificationContext({
      registry_refreshed_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 8).toISOString(),
    });
    const result = await gate.check(context);
    expect(result.passed).toBe(false);
  });

  it('fails when api/schemas.md is missing', async () => {
    const context = createVerificationContext();
    rmSync(join(context.project_root, 'docs/modules/core/api/schemas.md'));
    const result = await gate.check(context);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('schemas.md');
  });

  it('fails when api docs exist but do not satisfy the canonical markdown contract', async () => {
    const context = createVerificationContext();
    writeBrokenDoc(context.project_root, 'docs/modules/core/api/endpoints.md', '# broken');

    const result = await gate.check(context);

    expect(result.passed).toBe(false);
    expect(result.detail).toContain('Invalid API docs');
    expect(result.detail).toContain('Missing required heading: ## Endpoints');
  });

  it('fails when the error catalog exists but is structurally invalid', async () => {
    const context = createVerificationContext();
    writeBrokenDoc(context.project_root, 'docs/modules/core/error-catalog.md', '# broken');

    const result = await gate.check(context);

    expect(result.passed).toBe(false);
    expect(result.detail).toContain('Invalid error catalog');
    expect(result.detail).toContain('Missing required heading: ## Error Code Format');
  });
});

function writeBrokenDoc(projectRoot: string, relativePath: string, content: string): void {
  const absolutePath = join(projectRoot, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}
