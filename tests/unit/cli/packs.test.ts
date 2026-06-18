import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createPacksCommand } from '@/cli/commands/packs.js';

describe('packs command', () => {
  let root: string;
  let projectRoot: string;
  let globalRoot: string;
  let localPackRoot: string;
  let gitPackRepo: string;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-packs-cli-'));
    projectRoot = join(root, 'project');
    globalRoot = join(root, 'global-packs');
    localPackRoot = join(root, 'local-pack');
    gitPackRepo = join(root, 'git-pack');

    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(join(projectRoot, '.paqad', 'packs'), { recursive: true });
    mkdirSync(globalRoot, { recursive: true });

    process.env.PAQAD_GLOBAL_PACKS_ROOT = globalRoot;
    vi.stubEnv('HOME', root);

    writePack(localPackRoot, 'custom-local');
    writePack(gitPackRepo, 'custom-git');
    execFileSync('git', ['init'], { cwd: gitPackRepo });
    execFileSync('git', ['config', 'user.email', 'packs@example.com'], { cwd: gitPackRepo });
    execFileSync('git', ['config', 'user.name', 'Pack Tests'], { cwd: gitPackRepo });
    execFileSync('git', ['add', '.'], { cwd: gitPackRepo });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: gitPackRepo });

    stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    vi.unstubAllEnvs();
    delete process.env.PAQAD_GLOBAL_PACKS_ROOT;
    delete process.env.PAQAD_PACK_REGISTRY_URL;
    rmSync(root, { recursive: true, force: true });
  });

  it('installs a pack from a local path into the global pack root by default', async () => {
    const command = createPacksCommand();

    await command.parseAsync(
      ['node', 'packs', 'install', localPackRoot, '--project-root', projectRoot],
      {
        from: 'node',
      },
    );

    expect(existsSync(join(globalRoot, 'custom-local', 'pack.yaml'))).toBe(true);
  });

  it('installs a pack from a git url', async () => {
    const command = createPacksCommand();

    await command.parseAsync(
      ['node', 'packs', 'install', `file://${gitPackRepo}`, '--project-root', projectRoot],
      {
        from: 'node',
      },
    );

    expect(existsSync(join(globalRoot, 'custom-git', 'pack.yaml'))).toBe(true);
  });

  it('installs a pack from a configured registry bare name', async () => {
    const command = createPacksCommand();
    const registryRoot = join(root, 'registry');
    const registryRepo = join(registryRoot, 'custom-registry.git');

    mkdirSync(registryRoot, { recursive: true });
    execFileSync('git', ['clone', '--bare', gitPackRepo, registryRepo]);
    process.env.PAQAD_PACK_REGISTRY_URL = `file://${registryRoot}`;

    await command.parseAsync(
      ['node', 'packs', 'install', 'custom-registry', '--project-root', projectRoot],
      {
        from: 'node',
      },
    );

    expect(existsSync(join(globalRoot, 'custom-git', 'pack.yaml'))).toBe(true);
  });

  it('installs a pack into project scope when requested', async () => {
    const command = createPacksCommand();

    await command.parseAsync(
      [
        'node',
        'packs',
        'install',
        localPackRoot,
        '--project-root',
        projectRoot,
        '--scope',
        'project',
      ],
      {
        from: 'node',
      },
    );

    expect(existsSync(join(projectRoot, '.paqad', 'packs', 'custom-local', 'pack.yaml'))).toBe(
      true,
    );
    expect(existsSync(join(globalRoot, 'custom-local', 'pack.yaml'))).toBe(false);
  });

  it('lists effective packs including active overrides and project matches', async () => {
    const command = createPacksCommand();
    const laravelOverrideRoot = join(projectRoot, '.paqad', 'packs', 'laravel');
    writePack(laravelOverrideRoot, 'Laravel Override', 'laravel');
    writeFileSync(
      join(projectRoot, '.paqad', 'project-profile.yaml'),
      [
        'project:',
        '  name: Demo',
        '  id: demo',
        '  description: Demo',
        'active_capabilities: [content, coding, security]',
        'stack_profile:',
        '  frameworks: [laravel]',
        '  traits: []',
        '  toolchains: []',
        '  version_bands: []',
        '  sources: []',
        'commands:',
        '  install: pnpm install',
        '  dev: pnpm dev',
        '  test: pnpm test',
        '  test_single: pnpm test -- one',
        '  lint: pnpm lint',
        '  format: pnpm format',
        '  migrate: pnpm migrate',
        '  build: pnpm build',
        'strictness:',
        '  full_lane_default: false',
        '  require_adversarial_review: true',
        '  block_on_stale_docs: true',
        '  require_db_review_for_migrations: true',
        'compliance_packs: []',
        'features:',
        '  spec_only_mode: false',
        '  market_research: false',
        '  design_research: false',
        '  team_agents: true',
        'mcp:',
        '  servers: []',
        'model_routing:',
        '  default_model: gpt-5',
        '  reasoning_model: gpt-5',
        '  fast_model: gpt-5-mini',
        'research:',
        '  depth: standard',
        'efficiency:',
        '  differential_refresh: true',
        'escalation:',
        '  destructive_operations: block',
        '  risky_migrations: warn',
        '  security_findings: block',
        '  db_row_threshold: 1000',
        'custom:',
        '  classification_dimensions: []',
        '  verification_plugins: []',
        '  escalation_rules: []',
      ].join('\n'),
    );

    await command.parseAsync(['node', 'packs', 'list', '--project-root', projectRoot, '--json'], {
      from: 'node',
    });

    const output = stdoutSpy.mock.calls.at(-1)?.[0]?.toString() ?? '';
    const packs = JSON.parse(output) as Array<{
      name: string;
      effective_source: string;
      override_active: boolean;
      matched_in_project: boolean;
    }>;
    const laravel = packs.find((pack) => pack.name === 'laravel');

    expect(laravel).toMatchObject({
      effective_source: 'project',
      override_active: true,
      matched_in_project: true,
    });
  });

  it('prevents removing built-in packs and removes project overrides', async () => {
    const command = createPacksCommand();
    writePack(
      join(projectRoot, '.paqad', 'packs', 'temporary-pack'),
      'Temporary Pack',
      'temporary-pack',
    );

    await command.parseAsync(
      [
        'node',
        'packs',
        'remove',
        'temporary-pack',
        '--project-root',
        projectRoot,
        '--scope',
        'project',
      ],
      {
        from: 'node',
      },
    );
    expect(existsSync(join(projectRoot, '.paqad', 'packs', 'temporary-pack'))).toBe(false);

    await expect(
      command.parseAsync(['node', 'packs', 'remove', 'laravel', '--project-root', projectRoot], {
        from: 'node',
      }),
    ).rejects.toThrow('Cannot remove built-in pack "laravel"');
  });

  it('validates pack paths and surfaces invalid manifests', async () => {
    const command = createPacksCommand();
    const invalidRoot = join(root, 'invalid-pack');
    mkdirSync(invalidRoot, { recursive: true });
    writeFileSync(join(invalidRoot, 'pack.yaml'), 'name: invalid-pack\n');

    await expect(
      command.parseAsync(['node', 'packs', 'validate', invalidRoot], { from: 'node' }),
    ).rejects.toThrow('display_name');
  });

  it('creates a minimal pack scaffold', async () => {
    const command = createPacksCommand();
    const destination = join(root, 'scaffolds');
    mkdirSync(destination, { recursive: true });

    await command.parseAsync(
      ['node', 'packs', 'create', 'my-pack', '--destination', destination, '--ecosystem', 'node'],
      {
        from: 'node',
      },
    );

    const scaffoldRoot = join(destination, 'my-pack');
    expect(existsSync(join(scaffoldRoot, 'pack.yaml'))).toBe(true);
    expect(existsSync(join(scaffoldRoot, 'rules', 'conventions.md'))).toBe(true);
    expect(readFileSync(join(scaffoldRoot, 'pack.yaml'), 'utf8')).toContain('name: my-pack');
  });

  it('scaffolds an archetype pack when --tier archetype is passed', async () => {
    const command = createPacksCommand();
    const destination = join(root, 'scaffolds-arch');
    mkdirSync(destination, { recursive: true });

    await command.parseAsync(
      [
        'node',
        'packs',
        'create',
        'my-archetype',
        '--destination',
        destination,
        '--ecosystem',
        'node',
        '--tier',
        'archetype',
      ],
      { from: 'node' },
    );

    const scaffoldRoot = join(destination, 'my-archetype');
    const yaml = readFileSync(join(scaffoldRoot, 'pack.yaml'), 'utf8');
    expect(yaml).toContain('tier: archetype');
    expect(yaml).toContain('fields:');
  });

  it('includes tier in packs list JSON output', async () => {
    const command = createPacksCommand();

    await command.parseAsync(['node', 'packs', 'list', '--project-root', projectRoot, '--json'], {
      from: 'node',
    });

    const output = stdoutSpy.mock.calls.at(-1)?.[0]?.toString() ?? '';
    const packs = JSON.parse(output) as Array<{ name: string; tier: string }>;

    expect(packs.every((p) => p.tier === 'framework' || p.tier === 'archetype')).toBe(true);
    const nodeCli = packs.find((p) => p.name === 'node-cli');
    expect(nodeCli?.tier).toBe('archetype');
    const laravel = packs.find((p) => p.name === 'laravel');
    expect(laravel?.tier).toBe('framework');
  });

  it('includes tier in packs list text output', async () => {
    const command = createPacksCommand();

    await command.parseAsync(['node', 'packs', 'list', '--project-root', projectRoot], {
      from: 'node',
    });

    const output = stdoutSpy.mock.calls.map((call) => call[0]?.toString() ?? '').join('');
    expect(output).toContain('(archetype)');
    expect(output).toContain('(framework)');
  });
});

function writePack(packRoot: string, displayName: string, name?: string): void {
  mkdirSync(join(packRoot, 'rules'), { recursive: true });
  const packName = name ?? displayName.toLowerCase().replace(/\s+/g, '-');
  writeFileSync(
    join(packRoot, 'pack.yaml'),
    [
      `name: ${packName}`,
      `display_name: ${displayName}`,
      'ecosystem: node',
      'version: 1.0.0',
      'description: test pack',
      'maintainer: tests',
      'detection:',
      '  manifests:',
      '    - file: package.json',
      `      packages: [${packName}]`,
      'docs:',
      '  conventions_template: rules/conventions.md',
    ].join('\n'),
  );
  writeFileSync(join(packRoot, 'rules', 'conventions.md'), `# ${displayName}\n`);
}
