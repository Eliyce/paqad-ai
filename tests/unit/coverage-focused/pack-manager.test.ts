import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createPack,
  installPack,
  removePack,
  resolvePackManagerRoots,
  validatePackAt,
} from '@/packs/manager';

describe('pack manager branch coverage', () => {
  let root: string;
  let projectRoot: string;
  let globalPacksRoot: string;
  let runtimeRoot: string;

  beforeEach(() => {
    root = join(
      tmpdir(),
      `paqad-pack-manager-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    projectRoot = join(root, 'project');
    globalPacksRoot = join(root, 'global-packs');
    runtimeRoot = join(process.cwd(), 'runtime');

    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(globalPacksRoot, { recursive: true });
  });

  afterEach(() => {
    delete process.env.PAQAD_GLOBAL_PACKS_ROOT;
    delete process.env.PAQAD_PACK_REGISTRY_URL;
    rmSync(root, { recursive: true, force: true });
  });

  it('resolves default, env, and override roots', () => {
    const defaultRoots = resolvePackManagerRoots(projectRoot);
    expect(defaultRoots.globalPacksRoot).toBe(join(homedir(), '.paqad', 'packs'));
    expect(defaultRoots.projectPacksRoot).toBe(join(projectRoot, '.paqad', 'packs'));

    process.env.PAQAD_GLOBAL_PACKS_ROOT = globalPacksRoot;
    process.env.PAQAD_PACK_REGISTRY_URL = 'https://registry.example.test/packs';

    const envRoots = resolvePackManagerRoots(projectRoot);
    expect(envRoots.globalPacksRoot).toBe(globalPacksRoot);
    expect(envRoots.registryUrl).toBe('https://registry.example.test/packs');

    const overrideRoots = resolvePackManagerRoots(projectRoot, {
      globalPacksRoot: join(root, 'override-global'),
      projectPacksRoot: join(root, 'override-project'),
      registryUrl: 'https://override.example.test/packs',
    });
    expect(overrideRoots.globalPacksRoot).toBe(join(root, 'override-global'));
    expect(overrideRoots.projectPacksRoot).toBe(join(root, 'override-project'));
    expect(overrideRoots.registryUrl).toBe('https://override.example.test/packs');
  });

  it('rejects bare pack names when no registry is configured', async () => {
    await expect(
      installPack('custom-pack', {
        projectRoot,
        roots: {
          runtimeRoot,
          globalPacksRoot,
          registryUrl: '',
        },
      }),
    ).rejects.toThrow('Cannot resolve bare pack name "custom-pack"');
  });

  it('installs a local pack when the source points at a parent directory with one child pack', async () => {
    const sourceParent = join(root, 'source-parent');
    mkdirSync(sourceParent, { recursive: true });
    const nestedPackRoot = createPack('nested-pack', { destinationRoot: sourceParent });

    const installed = await installPack(sourceParent, {
      projectRoot,
      roots: {
        runtimeRoot,
        globalPacksRoot,
      },
    });

    expect(installed.manifest.name).toBe('nested-pack');
    expect(installed.root).toBe(join(globalPacksRoot, 'nested-pack'));
    expect(existsSync(join(globalPacksRoot, 'nested-pack', 'pack.yaml'))).toBe(true);
    expect(nestedPackRoot).toBe(join(sourceParent, 'nested-pack'));
  });

  it('throws when removing a missing non-built-in pack', () => {
    expect(() =>
      removePack('missing-pack', projectRoot, 'global', {
        runtimeRoot,
        globalPacksRoot,
      }),
    ).toThrow(`Pack "missing-pack" is not installed in global scope`);
  });

  it('validates a created pack scaffold and keeps framework templates tierless', () => {
    const scaffoldRoot = createPack('framework-pack', { destinationRoot: root, ecosystem: 'node' });

    const validated = validatePackAt(scaffoldRoot);
    const yaml = readFileSync(join(scaffoldRoot, 'pack.yaml'), 'utf8');

    expect(validated.manifest.name).toBe('framework-pack');
    expect(validated.validation.valid).toBe(true);
    expect(yaml).not.toContain('tier: archetype');
  });

  it('throws when creating a pack scaffold over an existing path', () => {
    createPack('duplicate-pack', { destinationRoot: root });

    expect(() => createPack('duplicate-pack', { destinationRoot: root })).toThrow(
      `Pack scaffold already exists at ${join(root, 'duplicate-pack')}`,
    );
  });
});
