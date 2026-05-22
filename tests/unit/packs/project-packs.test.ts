import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  getPackManifestMap,
  getPackTestRunners,
  getPacksForFrameworks,
} from '@/packs/project-packs.js';

describe('project pack runtime loading', () => {
  const originalGlobalRoot = process.env.PAQAD_GLOBAL_PACKS_ROOT;
  let root: string;
  let runtimeRoot: string;
  let projectRoot: string;
  let globalRoot: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-project-packs-'));
    runtimeRoot = join(root, 'runtime');
    projectRoot = join(root, 'project');
    globalRoot = join(root, 'global-packs');
    mkdirSync(join(runtimeRoot, 'capabilities', 'coding', 'stacks'), { recursive: true });
    mkdirSync(join(projectRoot, '.paqad', 'packs'), { recursive: true });
    mkdirSync(globalRoot, { recursive: true });
    process.env.PAQAD_GLOBAL_PACKS_ROOT = globalRoot;

    writePack(join(globalRoot, 'custom-stack'), {
      name: 'custom-stack',
      display_name: 'Custom Stack',
      ecosystem: 'node',
      version: '1.0.0',
      description: 'Global custom stack',
      maintainer: 'test',
      detection: {
        manifests: [{ file: 'package.json', packages: ['custom-stack-runtime'] }],
      },
    });

    writeFileSync(
      join(projectRoot, 'package.json'),
      JSON.stringify({ name: 'demo', dependencies: { 'custom-stack-runtime': '^1.0.0' } }, null, 2),
    );
  });

  afterEach(() => {
    if (originalGlobalRoot === undefined) {
      delete process.env.PAQAD_GLOBAL_PACKS_ROOT;
    } else {
      process.env.PAQAD_GLOBAL_PACKS_ROOT = originalGlobalRoot;
    }
    rmSync(root, { recursive: true, force: true });
  });

  it('loads globally installed packs in the core project-pack registry path', async () => {
    const runtimePaths = await import('@/core/runtime-paths.js');
    vi.spyOn(runtimePaths, 'getRuntimeRoot').mockReturnValue(runtimeRoot);

    const packs = getPacksForFrameworks(['custom-stack'], projectRoot);

    expect(packs).toHaveLength(1);
    expect(packs[0]?.manifest.display_name).toBe('Custom Stack');
    expect(packs[0]?.source).toBe('global');
  });

  it('merges and deduplicates test runners across matched packs', async () => {
    const runtimePaths = await import('@/core/runtime-paths.js');
    vi.spyOn(runtimePaths, 'getRuntimeRoot').mockReturnValue(runtimeRoot);

    writePack(join(runtimeRoot, 'capabilities', 'coding', 'stacks', 'react'), {
      name: 'react',
      display_name: 'React',
      ecosystem: 'node',
      version: '1.0.0',
      description: 'React stack',
      maintainer: 'test',
      detection: {
        manifests: [{ file: 'package.json', packages: ['react'] }],
      },
      test_runners: [
        { runner_id: 'vitest', structured_format: 'none' },
        { runner_id: 'playwright', structured_format: 'junit-xml' },
      ],
    });
    writePack(join(projectRoot, '.paqad', 'packs', 'laravel'), {
      name: 'laravel',
      display_name: 'Laravel',
      ecosystem: 'php',
      version: '1.0.0',
      description: 'Laravel stack',
      maintainer: 'test',
      detection: {
        manifests: [{ file: 'composer.json', packages: ['laravel/framework'] }],
      },
      test_runners: [
        { runner_id: 'phpunit', structured_format: 'junit-xml' },
        { runner_id: 'vitest', structured_format: 'tap' },
      ],
    });

    const runners = getPackTestRunners(['react', 'laravel'], projectRoot);

    expect(runners).toEqual([
      expect.objectContaining({ runner_id: 'playwright', structured_format: 'junit-xml' }),
      expect.objectContaining({ runner_id: 'phpunit', structured_format: 'junit-xml' }),
      expect.objectContaining({ runner_id: 'vitest', structured_format: 'tap' }),
    ]);
  });

  it('returns manifest maps and empty runner lists when packs omit test_runners', async () => {
    const runtimePaths = await import('@/core/runtime-paths.js');
    vi.spyOn(runtimePaths, 'getRuntimeRoot').mockReturnValue(runtimeRoot);

    writePack(join(runtimeRoot, 'capabilities', 'coding', 'stacks', 'docs-only'), {
      name: 'docs-only',
      display_name: 'Docs Only',
      ecosystem: 'content',
      version: '1.0.0',
      description: 'No tests',
      maintainer: 'test',
      detection: {
        manifests: [{ file: 'package.json', packages: ['docs-only'] }],
      },
    });

    const manifestMap = getPackManifestMap(['docs-only'], projectRoot);

    expect(manifestMap.get('docs-only')?.display_name).toBe('Docs Only');
    expect(getPackTestRunners(['docs-only'], projectRoot)).toEqual([]);
  });
});

function writePack(
  packRoot: string,
  manifest: {
    name: string;
    display_name: string;
    ecosystem: string;
    version: string;
    description: string;
    maintainer: string;
    detection: { manifests: Array<{ file: string; packages: string[] }> };
    test_runners?: Array<{ runner_id: string; structured_format: string }>;
  },
): void {
  mkdirSync(join(packRoot, 'rules'), { recursive: true });
  writeFileSync(join(packRoot, 'rules', 'conventions.md'), '# conventions\n');
  writeFileSync(
    join(packRoot, 'pack.yaml'),
    [
      `name: ${manifest.name}`,
      `display_name: ${manifest.display_name}`,
      `ecosystem: ${manifest.ecosystem}`,
      `version: ${manifest.version}`,
      `description: ${manifest.description}`,
      `maintainer: ${manifest.maintainer}`,
      'detection:',
      '  manifests:',
      ...manifest.detection.manifests.flatMap((rule) => [
        `    - file: ${rule.file}`,
        `      packages: [${rule.packages.join(', ')}]`,
      ]),
      ...(manifest.test_runners
        ? [
            'test_runners:',
            ...manifest.test_runners.flatMap((runner) => [
              `  - runner_id: ${runner.runner_id}`,
              `    structured_format: ${runner.structured_format}`,
            ]),
          ]
        : []),
      'docs:',
      '  conventions_template: rules/conventions.md',
    ].join('\n'),
  );
}
