import { describe, expect, it } from 'vitest';

import {
  changeIsFeatureDev,
  isDocumentationPath,
  isFeatureDevEdit,
  isFrameworkInternalPath,
} from '@/stage-evidence/scope.js';

// Feature-development scope (issue #310). The stage gate governs feature development
// only; a documentation-only or framework-internal change is skipped. The predicate
// is an EXCLUDE list (docs + .paqad), never a src/ allowlist, so it holds for any
// onboarded stack (Laravel `app/*.php`, Python, Go, …).
describe('scope — isFrameworkInternalPath', () => {
  it('flags .paqad metadata and out-of-tree paths', () => {
    expect(isFrameworkInternalPath('.paqad/.config')).toBe(true);
    expect(isFrameworkInternalPath('.paqad/configs/.config.policy')).toBe(true);
    expect(isFrameworkInternalPath('.paqad/.agent-entry-loaded')).toBe(true);
    expect(isFrameworkInternalPath('.paqad')).toBe(true);
    expect(isFrameworkInternalPath('../outside/x.ts')).toBe(true);
    expect(isFrameworkInternalPath('')).toBe(true);
  });

  it('does not flag ordinary source', () => {
    expect(isFrameworkInternalPath('src/a.ts')).toBe(false);
    expect(isFrameworkInternalPath('app/Http/Controller.php')).toBe(false);
  });

  it('normalises an absolute host path against the project root', () => {
    expect(isFrameworkInternalPath('/proj/.paqad/.config', '/proj')).toBe(true);
    expect(isFrameworkInternalPath('/proj/src/a.ts', '/proj')).toBe(false);
  });
});

describe('scope — isDocumentationPath', () => {
  it('flags the docs tree, markdown/rst docs, and top-level project docs', () => {
    expect(isDocumentationPath('docs')).toBe(true);
    expect(isDocumentationPath('docs/inbound/README.md')).toBe(true);
    expect(isDocumentationPath('docs/instructions/rules/x.md')).toBe(true);
    expect(isDocumentationPath('guide.mdx')).toBe(true);
    expect(isDocumentationPath('handbook.rst')).toBe(true);
    expect(isDocumentationPath('notes.adoc')).toBe(true);
    expect(isDocumentationPath('README')).toBe(true);
    expect(isDocumentationPath('CHANGELOG.md')).toBe(true);
    expect(isDocumentationPath('CONTRIBUTING.md')).toBe(true);
    expect(isDocumentationPath('LICENSE')).toBe(true);
    // a markdown doc living inside a source dir is still documentation
    expect(isDocumentationPath('src/module/README.md')).toBe(true);
  });

  it('does not flag source, tests, or config', () => {
    expect(isDocumentationPath('src/a.ts')).toBe(false);
    expect(isDocumentationPath('app/Http/Controller.php')).toBe(false);
    expect(isDocumentationPath('tests/a.test.ts')).toBe(false);
    expect(isDocumentationPath('package.json')).toBe(false);
    // `documentation.ts` is source, not a doc — the extension check is exact.
    expect(isDocumentationPath('src/documentation.ts')).toBe(false);
  });
});

describe('scope — isFeatureDevEdit', () => {
  it('is feature development for any non-doc, non-framework edit (any stack)', () => {
    expect(isFeatureDevEdit('src/a.ts')).toBe(true);
    expect(isFeatureDevEdit('app/Http/Controller.php')).toBe(true); // Laravel
    expect(isFeatureDevEdit('cmd/server/main.go')).toBe(true); // Go
    expect(isFeatureDevEdit('service/handler.py')).toBe(true); // Python
    expect(isFeatureDevEdit('tests/a.test.ts')).toBe(true); // tests are code
    expect(isFeatureDevEdit('package.json')).toBe(true); // config counts as a change
  });

  it('is NOT feature development for docs or framework-internal edits', () => {
    expect(isFeatureDevEdit('docs/inbound/README.md')).toBe(false);
    expect(isFeatureDevEdit('README.md')).toBe(false);
    expect(isFeatureDevEdit('.paqad/configs/.config.policy')).toBe(false);
    expect(isFeatureDevEdit('.paqad/.agent-entry-loaded')).toBe(false);
  });

  it('fails closed for an unknown/absent target path (gate applies)', () => {
    expect(isFeatureDevEdit(undefined)).toBe(true);
  });
});

describe('scope — changeIsFeatureDev', () => {
  it('is true when any file is a non-doc, non-framework product change', () => {
    expect(changeIsFeatureDev(['docs/a.md', 'src/a.ts'])).toBe(true);
  });

  it('is false for a docs-only / framework-only change', () => {
    expect(changeIsFeatureDev(['docs/a.md', 'README.md', '.paqad/.config'])).toBe(false);
  });

  it('is false for an empty change set (nothing to build)', () => {
    expect(changeIsFeatureDev([])).toBe(false);
  });
});
