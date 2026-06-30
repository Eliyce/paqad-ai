import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PATHS, REGISTRIES } from '@/core/constants/paths.js';

describe('coverage smoke imports', () => {
  it('loads type and interface modules at runtime', async () => {
    const modules = await Promise.all([
      import('@/adapters/adapter.interface.js'),
      import('@/cache/types.js'),
      import('@/context/types.js'),
      import('@/core/types/design-tokens.js'),
      import('@/core/types/document-generation.js'),
      import('@/core/types/feature-development-policy.js'),
      import('@/core/types/introspection.js'),
      import('@/core/types/onboarding.js'),
      import('@/core/types/pack.js'),
      import('@/core/types/repository.js'),
      import('@/core/types/template.js'),
      import('@/introspection/ecosystems/types.js'),
      import('@/patterns/types.js'),
      import('@/session/types.js'),
      import('@/verification/gates/gate.interface.js'),
      import('@/workflows/types.js'),
    ]);

    expect(modules).toHaveLength(16);
    expect(modules.every((module) => typeof module === 'object')).toBe(true);
  });
});

describe('registry generation', () => {
  it('discovers modules from multiple roots and writes initial registry files', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'paqad-registry-'));
    await mkdir(join(projectRoot, 'src'), { recursive: true });
    await Promise.all([
      mkdir(join(projectRoot, 'docs/modules/payments'), { recursive: true }),
      mkdir(join(projectRoot, 'app/Billing'), { recursive: true }),
      mkdir(join(projectRoot, 'lib/shared'), { recursive: true }),
      mkdir(join(projectRoot, 'src/.hidden'), { recursive: true }),
      writeFile(join(projectRoot, 'src/readme.md'), 'not a directory'),
    ]);

    const { discoverModules, generateInitialRegistries } =
      await import('@/onboarding/registry-generator.js');

    await expect(discoverModules(projectRoot)).resolves.toEqual([
      'Billing',
      'core',
      'payments',
      'shared',
    ]);

    const generated = await generateInitialRegistries(projectRoot);
    expect(generated).toHaveLength(REGISTRIES.length + 2);
    expect(generated[0]).toMatchObject({
      path: '.paqad/indexes/registry-status.json',
      autoUpdate: true,
    });
    expect(generated[1]).toMatchObject({
      path: PATHS.GLOSSARY,
      content: '# Glossary\n\n',
      autoUpdate: false,
    });
    expect(generated.find((entry) => entry.path.endsWith('module-registry.md'))).toMatchObject({
      path: join(PATHS.REGISTRIES_DIR, 'module-registry.md'),
      content: expect.stringContaining('- payments'),
      autoUpdate: false,
    });
    expect(generated.find((entry) => entry.path.endsWith('feature-registry.md'))).toMatchObject({
      path: join(PATHS.REGISTRIES_DIR, 'feature-registry.md'),
      content: '# feature-registry.md\n\n',
      autoUpdate: false,
    });
  });
});
