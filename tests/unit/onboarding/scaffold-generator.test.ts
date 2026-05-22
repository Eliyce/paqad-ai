import { describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths';
import { generateDocumentationScaffold } from '@/onboarding/scaffold-generator';

describe('generateDocumentationScaffold', () => {
  it('does not create empty architecture stub files', async () => {
    const files = await generateDocumentationScaffold(['core']);

    const paths = files.map((file) => file.path);
    expect(paths).not.toContain(PATHS.ARCHITECTURE_DIR + '/overview.md');
    expect(paths).not.toContain(PATHS.ARCHITECTURE_DIR + '/decisions.md');
    expect(paths).not.toContain(PATHS.ARCHITECTURE_DIR + '/patterns.md');
  });

  it('does not create empty benchmarks or tech-debt stub files', async () => {
    const files = await generateDocumentationScaffold(['core']);

    const paths = files.map((file) => file.path);
    expect(paths.some((p) => p.includes('benchmarks'))).toBe(false);
    expect(paths.some((p) => p.includes('tech-debt'))).toBe(false);
  });

  it('does not create any design-system files', async () => {
    const files = await generateDocumentationScaffold(['core']);

    const paths = files.map((file) => file.path);
    expect(paths.some((p) => p.includes('design-system'))).toBe(false);
  });

  it('still generates module scaffold files for the given modules', async () => {
    const files = await generateDocumentationScaffold(['core']);

    const paths = files.map((file) => file.path);
    expect(paths.some((p) => p.includes('docs/modules/core'))).toBe(true);
  });

  it('does not generate registry stubs', async () => {
    const files = await generateDocumentationScaffold(['core']);

    const paths = files.map((file) => file.path);
    expect(paths.some((p) => p.startsWith(PATHS.REGISTRIES_DIR))).toBe(false);
  });
});
