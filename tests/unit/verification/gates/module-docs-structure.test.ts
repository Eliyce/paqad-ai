import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ModuleDocsStructureGate } from '@/verification/gates/module-docs-structure.js';

import { createVerificationContext } from '../shared.fixture.js';

describe('ModuleDocsStructureGate', () => {
  it('skips when no module documentation paths changed', async () => {
    const result = await new ModuleDocsStructureGate().check(
      createVerificationContext({
        changed_files: ['src/service.ts'],
        documentation_files_changed: false,
      }),
    );

    expect(result).toEqual({
      gate: 'module-docs-structure',
      passed: true,
      detail: 'No module feature documentation changes detected',
    });
  });

  it('skips module docs paths that are not feature markdown files', async () => {
    const context = createVerificationContext({
      changed_files: [
        './docs/modules',
        'docs/modules/billing/index/summary.md',
        'docs/modules/billing/features/invoices/diagram.png',
      ],
      documentation_files_changed: true,
    });

    const result = await new ModuleDocsStructureGate().check(context);

    expect(result).toEqual({
      gate: 'module-docs-structure',
      passed: true,
      detail: 'No module feature documentation changes detected',
    });
  });

  it('passes when touched feature docs include business, technical, and api files with headings', async () => {
    const context = createVerificationContext({
      changed_files: [
        'docs/modules/billing/features/invoices/business.md',
        'docs/modules/billing/features/invoices/technical.md',
      ],
      documentation_files_changed: true,
    });
    writeFeatureDocTriplet(context.project_root, 'billing', 'invoices');

    const result = await new ModuleDocsStructureGate().check(context);

    expect(result).toEqual({
      gate: 'module-docs-structure',
      passed: true,
      detail: 'Module feature documentation structure is valid',
    });
  });

  it('fails when docs are written under the legacy singular module path', async () => {
    const result = await new ModuleDocsStructureGate().check(
      createVerificationContext({
        changed_files: ['docs/module/billing/features/invoices/business.md'],
        documentation_files_changed: true,
      }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toBe(
      'Invalid module documentation path docs/module/billing/features/invoices/business.md; use docs/modules/',
    );
    expect(result.remediation).toContain('docs/modules/{module}/features/{feature}/');
  });

  it('fails when a touched feature scope is missing api.md', async () => {
    const context = createVerificationContext({
      changed_files: ['docs/modules/billing/features/invoices/technical.md'],
      documentation_files_changed: true,
    });
    writeFeatureDocTriplet(context.project_root, 'billing', 'invoices', [
      'business.md',
      'technical.md',
    ]);

    const result = await new ModuleDocsStructureGate().check(context);

    expect(result).toEqual({
      gate: 'module-docs-structure',
      passed: false,
      detail: 'Missing docs/modules/billing/features/invoices/api.md',
      remediation:
        'Create the missing feature-level api documentation file before completing the provider request.',
    });
  });

  it('fails when feature markdown is outside the expected feature folder structure', async () => {
    const result = await new ModuleDocsStructureGate().check(
      createVerificationContext({
        changed_files: ['docs/modules/billing/features/invoices.md'],
        documentation_files_changed: true,
      }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toBe(
      'Feature documentation path docs/modules/billing/features/invoices.md is outside docs/modules/{module}/features/{feature}/',
    );
  });

  it('fails when a required file is empty', async () => {
    const context = createVerificationContext({
      changed_files: ['docs/modules/billing/features/invoices/business.md'],
      documentation_files_changed: true,
    });
    writeFeatureDocTriplet(context.project_root, 'billing', 'invoices');
    writeFileSync(
      join(context.project_root, 'docs/modules/billing/features/invoices/technical.md'),
      '   \n',
    );

    const result = await new ModuleDocsStructureGate().check(context);

    expect(result).toEqual({
      gate: 'module-docs-structure',
      passed: false,
      detail:
        'Required documentation file docs/modules/billing/features/invoices/technical.md is empty',
      remediation: 'Add non-empty markdown content before completing the provider request.',
    });
  });

  it('fails when a required markdown file has no heading', async () => {
    const context = createVerificationContext({
      changed_files: ['docs/modules/billing/features/invoices/api.md'],
      documentation_files_changed: true,
    });
    writeFeatureDocTriplet(context.project_root, 'billing', 'invoices');
    writeFileSync(
      join(context.project_root, 'docs/modules/billing/features/invoices/api.md'),
      'API details without a heading.\n',
    );

    const result = await new ModuleDocsStructureGate().check(context);

    expect(result).toEqual({
      gate: 'module-docs-structure',
      passed: false,
      detail:
        'Required documentation file docs/modules/billing/features/invoices/api.md does not contain a heading',
      remediation: 'Add at least one markdown heading before completing the provider request.',
    });
  });

  // #313 finding 2 (#310 family): a doc-sync that edits a flat feature doc which
  // is the repo's established convention must NOT be forced to revert.
  it('passes when a touched flat feature doc is the pre-existing repo-wide convention', async () => {
    const context = createVerificationContext({
      changed_files: ['docs/modules/user/features/profile.md'],
      documentation_files_changed: true,
    });
    // Pre-existing flat siblings NOT in the change set — proof the flat layout is
    // the repo convention, so touching profile.md did not introduce it.
    writeFlatFeatureDoc(context.project_root, 'user', 'api-tokens.md');
    writeFlatFeatureDoc(context.project_root, 'user', 'two-factor.md');
    writeFlatFeatureDoc(context.project_root, 'user', 'profile.md');

    const result = await new ModuleDocsStructureGate().check(context);

    expect(result.passed).toBe(true);
  });

  it('still fails a lone flat feature doc introduced into a repo with no flat siblings', async () => {
    const context = createVerificationContext({
      changed_files: ['docs/modules/user/features/profile.md'],
      documentation_files_changed: true,
    });
    // The only flat doc on disk is the one being changed → not pre-existing.
    writeFlatFeatureDoc(context.project_root, 'user', 'profile.md');

    const result = await new ModuleDocsStructureGate().check(context);

    expect(result.passed).toBe(false);
    expect(result.detail).toContain(
      'docs/modules/user/features/profile.md is outside docs/modules/{module}/features/{feature}/',
    );
  });

  it('still fails a flat feature doc when the repo has no docs/modules tree at all', async () => {
    const emptyRoot = mkdtempSync(join(tmpdir(), 'paqad-module-docs-empty-'));
    const context = createVerificationContext({
      project_root: emptyRoot,
      changed_files: ['docs/modules/user/features/profile.md'],
      documentation_files_changed: true,
    });

    const result = await new ModuleDocsStructureGate().check(context);

    expect(result.passed).toBe(false);
  });

  it('tolerates a module directory that has no features subdir while detecting flat siblings elsewhere', async () => {
    const context = createVerificationContext({
      changed_files: ['docs/modules/user/features/profile.md'],
      documentation_files_changed: true,
    });
    writeFlatFeatureDoc(context.project_root, 'user', 'profile.md');
    writeFlatFeatureDoc(context.project_root, 'billing', 'invoices.md');
    // A module with no `features/` subdir — readdir throws and is skipped.
    mkdirSync(join(context.project_root, 'docs/modules/orphan'), { recursive: true });

    const result = await new ModuleDocsStructureGate().check(context);

    expect(result.passed).toBe(true);
  });
});

function writeFeatureDocTriplet(
  projectRoot: string,
  moduleName: string,
  featureName: string,
  filenames: Array<'business.md' | 'technical.md' | 'api.md'> = [
    'business.md',
    'technical.md',
    'api.md',
  ],
): void {
  const featureRoot = join(projectRoot, 'docs/modules', moduleName, 'features', featureName);
  mkdirSync(featureRoot, { recursive: true });

  for (const filename of filenames) {
    writeFileSync(featureRootPath(featureRoot, filename), `# ${filename.replace('.md', '')}\n`);
  }
}

function featureRootPath(featureRoot: string, filename: string): string {
  return join(featureRoot, filename);
}

function writeFlatFeatureDoc(
  projectRoot: string,
  moduleName: string,
  filename: string,
  content = `# ${filename.replace('.md', '')}\n`,
): void {
  const featuresDir = join(projectRoot, 'docs/modules', moduleName, 'features');
  mkdirSync(featuresDir, { recursive: true });
  writeFileSync(join(featuresDir, filename), content);
}
