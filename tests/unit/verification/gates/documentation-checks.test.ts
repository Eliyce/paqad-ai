import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  areRegistriesStale,
  collectCanonicalDocumentationFailures,
  collectUnresolvedDocTargets,
  formatCanonicalDocTarget,
} from '@/verification/gates/documentation-checks.js';

import { createVerificationContext } from '../shared.fixture.js';

describe('documentation checks helpers', () => {
  it('filters out stale doc targets that were already updated in the diff', async () => {
    const context = createVerificationContext();
    mkdirSync(join(context.project_root, 'docs/maintainers'), { recursive: true });
    writeFileSync(
      join(context.project_root, 'docs/maintainers/architecture-map.md'),
      '# Architecture Map\n',
    );

    await expect(
      collectUnresolvedDocTargets(
        context.project_root,
        ['docs/maintainers/architecture-map.md'],
        [
          {
            target_path: 'docs/maintainers/architecture-map.md',
            ownership_kind: 'direct-doc-edit',
            owners: ['docs/maintainers/architecture-map.md'],
            reason: 'Canonical doc changed directly in the diff.',
          },
          {
            target_path: 'docs/modules/verification/index/summary.md',
            ownership_kind: 'implementation-drift',
            owners: ['src/verification/gates/documentation-checks.ts'],
            reason: 'Verification implementation changed.',
          },
        ],
      ),
    ).resolves.toEqual([
      {
        target_path: 'docs/modules/verification/index/summary.md',
        ownership_kind: 'implementation-drift',
        owners: ['src/verification/gates/documentation-checks.ts'],
        reason: 'Verification implementation changed.',
      },
    ]);
  });

  it('treats null and invalid registry timestamps as stale', () => {
    expect(areRegistriesStale(null)).toBe(true);
    expect(areRegistriesStale('not-a-date')).toBe(true);
    expect(areRegistriesStale(new Date().toISOString())).toBe(false);
  });

  it('formats canonical doc targets with ownership and owners', () => {
    expect(
      formatCanonicalDocTarget({
        target_path: 'docs/modules/verification/index/summary.md',
        ownership_kind: 'direct-doc-edit',
        owners: ['docs/modules/verification/index/summary.md'],
        reason: 'Canonical doc changed directly in the diff.',
      }),
    ).toBe(
      'docs/modules/verification/index/summary.md [direct doc edit; owners: docs/modules/verification/index/summary.md; reason: Canonical doc changed directly in the diff.]',
    );

    expect(
      formatCanonicalDocTarget({
        target_path: 'docs/modules/pipeline/index/summary.md',
        ownership_kind: 'implementation-drift',
        owners: [],
        reason: 'Pipeline implementation changed.',
      }),
    ).toBe(
      'docs/modules/pipeline/index/summary.md [implementation drift; owners: none; reason: Pipeline implementation changed.]',
    );
  });

  it('reports missing error-codes and integration contracts files', async () => {
    const context = createVerificationContext();
    rmSync(join(context.project_root, 'docs/modules/core/api/error-codes.md'));
    rmSync(join(context.project_root, 'docs/modules/core/integration/contracts.md'));

    const failures = await collectCanonicalDocumentationFailures(
      context.project_root,
      context.expected_ui_modules,
      context.expected_api_modules,
      context.expected_integration_modules,
      context.expected_error_catalog_modules,
    );

    expect(failures.some((detail) => detail.includes('error-codes.md'))).toBe(true);
    expect(failures.some((detail) => detail.includes('contracts.md'))).toBe(true);
  });

  it('filters out directly edited api endpoints docs when the canonical file is valid', async () => {
    const context = createVerificationContext();

    await expect(
      collectUnresolvedDocTargets(
        context.project_root,
        ['docs/modules/core/api/endpoints.md'],
        [
          {
            target_path: 'docs/modules/core/api/endpoints.md',
            ownership_kind: 'direct-doc-edit',
            owners: ['docs/modules/core/api/endpoints.md'],
            reason: 'API endpoints were edited directly.',
          },
        ],
      ),
    ).resolves.toEqual([]);
  });

  it('keeps directly edited api endpoints docs unresolved when the canonical file is invalid', async () => {
    const context = createVerificationContext();
    writeFileSync(join(context.project_root, 'docs/modules/core/api/endpoints.md'), '# broken');

    await expect(
      collectUnresolvedDocTargets(
        context.project_root,
        ['docs/modules/core/api/endpoints.md'],
        [
          {
            target_path: 'docs/modules/core/api/endpoints.md',
            ownership_kind: 'direct-doc-edit',
            owners: ['docs/modules/core/api/endpoints.md'],
            reason: 'API endpoints were edited directly.',
          },
        ],
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        target_path: 'docs/modules/core/api/endpoints.md',
        reason: expect.stringContaining('Missing required heading: ## Endpoints'),
      }),
    ]);
  });

  it('filters out directly edited error catalogs when the canonical file is valid', async () => {
    const context = createVerificationContext();

    await expect(
      collectUnresolvedDocTargets(
        context.project_root,
        ['docs/modules/core/error-catalog.md'],
        [
          {
            target_path: 'docs/modules/core/error-catalog.md',
            ownership_kind: 'direct-doc-edit',
            owners: ['docs/modules/core/error-catalog.md'],
            reason: 'Error catalog was edited directly.',
          },
        ],
      ),
    ).resolves.toEqual([]);
  });

  it('keeps directly edited error catalogs unresolved when the canonical file is invalid', async () => {
    const context = createVerificationContext();
    writeFileSync(join(context.project_root, 'docs/modules/core/error-catalog.md'), '# broken');

    await expect(
      collectUnresolvedDocTargets(
        context.project_root,
        ['docs/modules/core/error-catalog.md'],
        [
          {
            target_path: 'docs/modules/core/error-catalog.md',
            ownership_kind: 'direct-doc-edit',
            owners: ['docs/modules/core/error-catalog.md'],
            reason: 'Error catalog was edited directly.',
          },
        ],
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        target_path: 'docs/modules/core/error-catalog.md',
        reason: expect.stringContaining('Missing required heading: ## Error Code Format'),
      }),
    ]);
  });

  it('filters out directly edited non-markdown canonical targets without markdown validation', async () => {
    const context = createVerificationContext();
    mkdirSync(join(context.project_root, 'docs/maintainers'), { recursive: true });
    writeFileSync(join(context.project_root, 'docs/maintainers/ownership-map.json'), '{}');

    await expect(
      collectUnresolvedDocTargets(
        context.project_root,
        ['docs/maintainers/ownership-map.json'],
        [
          {
            target_path: 'docs/maintainers/ownership-map.json',
            ownership_kind: 'direct-doc-edit',
            owners: ['docs/maintainers/ownership-map.json'],
            reason: 'Ownership map was edited directly.',
          },
        ],
      ),
    ).resolves.toEqual([]);
  });

  it('keeps directly edited markdown targets unresolved when the file is empty', async () => {
    const context = createVerificationContext();
    mkdirSync(join(context.project_root, 'docs/maintainers'), { recursive: true });
    writeFileSync(join(context.project_root, 'docs/maintainers/architecture-map.md'), '   \n');

    await expect(
      collectUnresolvedDocTargets(
        context.project_root,
        ['docs/maintainers/architecture-map.md'],
        [
          {
            target_path: 'docs/maintainers/architecture-map.md',
            ownership_kind: 'direct-doc-edit',
            owners: ['docs/maintainers/architecture-map.md'],
            reason: 'Architecture map was edited directly.',
          },
        ],
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        target_path: 'docs/maintainers/architecture-map.md',
        reason: expect.stringContaining('markdown file is empty'),
      }),
    ]);
  });

  it('keeps directly edited canonical targets unresolved when the file no longer exists', async () => {
    const context = createVerificationContext();

    await expect(
      collectUnresolvedDocTargets(
        context.project_root,
        ['docs/maintainers/missing.md'],
        [
          {
            target_path: 'docs/maintainers/missing.md',
            ownership_kind: 'direct-doc-edit',
            owners: ['docs/maintainers/missing.md'],
            reason: 'Maintainer map was edited directly.',
          },
        ],
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        target_path: 'docs/maintainers/missing.md',
        reason: expect.stringContaining('file does not exist'),
      }),
    ]);
  });
});
