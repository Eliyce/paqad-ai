import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getRuntimeRoot } from '@/core/runtime-paths.js';
import { StackPackLoader } from '@/packs';
import { SchemaValidator } from '@/validators';

describe('StackPackLoader', () => {
  let root: string;
  let runtimeRoot: string;
  let globalRoot: string;
  let projectRoot: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-packs-'));
    runtimeRoot = join(root, 'runtime');
    globalRoot = join(root, 'global-packs');
    projectRoot = join(root, 'project');
    mkdirSync(join(runtimeRoot, 'capabilities', 'coding', 'stacks'), { recursive: true });
    mkdirSync(globalRoot, { recursive: true });
    mkdirSync(join(projectRoot, '.paqad', 'packs'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('validates a stack-pack manifest schema', () => {
    const validator = new SchemaValidator();
    const result = validator.validate('stack-pack', {
      name: 'laravel',
      display_name: 'Laravel',
      ecosystem: 'php',
      version: '1.0.0',
      description: 'PHP framework pack',
      maintainer: 'paqad-ai',
      detection: {
        manifests: [{ file: 'composer.json', packages: ['laravel/framework'] }],
      },
      test_runners: [
        {
          runner_id: 'phpunit',
          structured_format: 'junit-xml',
          output_source: 'file',
          output_path_pattern: '.paqad/test-results/phpunit.xml',
        },
      ],
    });

    expect(result.valid).toBe(true);
  });

  it('prefers project packs over global and built-in packs', () => {
    writePack(join(runtimeRoot, 'capabilities', 'coding', 'stacks', 'laravel'), 'Laravel Built-In');
    writePack(join(globalRoot, 'laravel'), 'Laravel Global');
    writePack(join(projectRoot, '.paqad', 'packs', 'laravel'), 'Laravel Project');

    const registry = new StackPackLoader().load({
      runtimeRoot,
      globalPacksRoot: globalRoot,
      projectRoot,
    });

    expect(registry.packs.get('laravel')?.manifest.display_name).toBe('Laravel Project');
    expect(registry.packs.get('laravel')?.source).toBe('project');
  });

  it('skips invalid higher-precedence overrides and keeps lower-precedence valid packs', () => {
    writePack(join(runtimeRoot, 'capabilities', 'coding', 'stacks', 'laravel'), 'Laravel Built-In');
    mkdirSync(join(projectRoot, '.paqad', 'packs', 'laravel'), { recursive: true });
    writeFileSync(join(projectRoot, '.paqad', 'packs', 'laravel', 'pack.yaml'), 'name: laravel\n');

    const registry = new StackPackLoader().load({
      runtimeRoot,
      projectRoot,
    });

    expect(registry.packs.get('laravel')?.manifest.display_name).toBe('Laravel Built-In');
    expect(registry.warnings.some((warning) => warning.message.includes('display_name'))).toBe(
      true,
    );
  });

  it('reports missing referenced files, duplicate traits, and unknown custom refs', () => {
    const packRoot = join(projectRoot, '.paqad', 'packs', 'custom-pack');
    mkdirSync(packRoot, { recursive: true });
    writeFileSync(
      join(packRoot, 'pack.yaml'),
      [
        'name: custom-pack',
        'display_name: Custom Pack',
        'ecosystem: node',
        'version: 1.0.0',
        'description: Custom',
        'maintainer: test',
        'detection:',
        '  manifests:',
        '    - file: package.json',
        '      packages: [custom]',
        'traits:',
        '  - name: dup',
        '    display_name: Dup',
        '    description: first',
        '  - name: dup',
        '    display_name: Dup',
        '    description: second',
        'mcp_defaults:',
        '  - name: custom-mcp',
        '    when: always',
        'pentest:',
        '  file_check_map:',
        '    - glob: src/**',
        '      checks: [custom-check]',
        'docs:',
        '  overview_template: docs/overview.md',
      ].join('\n'),
    );

    const pack = new StackPackLoader().validatePack(packRoot);

    expect(pack.validation.valid).toBe(false);
    expect(pack.validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'error',
          message: expect.stringContaining('Duplicate trait name'),
        }),
        expect.objectContaining({
          level: 'error',
          message: expect.stringContaining('Referenced file does not exist'),
        }),
        expect.objectContaining({
          level: 'warning',
          message: expect.stringContaining('Unknown MCP server'),
        }),
        expect.objectContaining({
          level: 'warning',
          message: expect.stringContaining('Unknown pentest check'),
        }),
      ]),
    );
  });

  it('validates the shipped first-party built-in framework packs', () => {
    const runtimeRoot = getRuntimeRoot();
    const loader = new StackPackLoader();

    for (const packName of [
      'laravel',
      'flutter',
      'react',
      'vue',
      'django',
      'fastapi',
      'rails',
      'spring-boot',
      'express',
      'angular',
      'svelte',
      'astro',
      'go-web',
      'rust-web',
    ]) {
      const pack = loader.validatePack(
        join(runtimeRoot, 'capabilities', 'coding', 'stacks', packName),
        'built-in',
      );
      expect(pack.validation.valid).toBe(true);
      expect(pack.manifest.docs?.conventions_template).toBeTruthy();
      expect(pack.manifest.testing?.frameworks?.length).toBeGreaterThan(0);
      expect(pack.manifest.test_runners?.length).toBeGreaterThan(0);
    }
  });

  it('validates the shipped first-party built-in archetype packs', () => {
    const runtimeRoot = getRuntimeRoot();
    const loader = new StackPackLoader();

    for (const packName of ['node-cli', 'node-library', 'node-service']) {
      const pack = loader.validatePack(
        join(runtimeRoot, 'capabilities', 'coding', 'stacks', packName),
        'built-in',
      );
      expect(pack.validation.valid).toBe(true);
      expect(pack.manifest.tier).toBe('archetype');
      expect(pack.manifest.ecosystem).toBe('node');
      expect(pack.manifest.docs?.conventions_template).toBeTruthy();
      expect(pack.manifest.test_runners?.length).toBeGreaterThan(0);
    }
  });

  it('fails when a file-based test runner omits its output path pattern', () => {
    const packRoot = join(projectRoot, '.paqad', 'packs', 'bad-runner');
    mkdirSync(join(packRoot, 'rules'), { recursive: true });
    writeFileSync(join(packRoot, 'rules', 'conventions.md'), '# conventions\n');
    writeFileSync(
      join(packRoot, 'pack.yaml'),
      [
        'name: bad-runner',
        'display_name: Bad Runner',
        'ecosystem: node',
        'version: 1.0.0',
        'description: Missing runner path',
        'maintainer: test',
        'detection:',
        '  manifests:',
        '    - file: package.json',
        '      packages: [bad-runner]',
        'testing:',
        '  frameworks:',
        '    - name: jest',
        '      detect_package: jest',
        '      run_command: pnpm test',
        'test_runners:',
        '  - runner_id: jest',
        '    structured_format: jest-json',
        '    output_source: file',
        'docs:',
        '  conventions_template: rules/conventions.md',
      ].join('\n'),
    );

    const pack = new StackPackLoader().validatePack(packRoot);

    expect(pack.validation.valid).toBe(false);
    expect(
      pack.validation.issues.some((issue) =>
        issue.message.includes('uses file output without output_path_pattern'),
      ),
    ).toBe(true);
  });

  it('errors when archetype pack has no ecosystem', () => {
    const packRoot = join(projectRoot, '.paqad', 'packs', 'bad-archetype');
    mkdirSync(join(packRoot, 'rules'), { recursive: true });
    writeFileSync(
      join(packRoot, 'pack.yaml'),
      [
        'name: bad-archetype',
        'display_name: Bad Archetype',
        'ecosystem: unknown',
        'version: 1.0.0',
        'description: Archetype without ecosystem',
        'maintainer: test',
        'tier: archetype',
        'detection:',
        '  manifests:',
        '    - file: package.json',
        '      packages: [bad-archetype]',
      ].join('\n'),
    );

    const pack = new StackPackLoader().validatePack(packRoot);

    expect(pack.validation.valid).toBe(false);
    expect(
      pack.validation.issues.some(
        (issue) => issue.level === 'error' && issue.message.includes('must declare an ecosystem'),
      ),
    ).toBe(true);
  });

  it('warns when archetype pack has only package-based detection', () => {
    const packRoot = join(projectRoot, '.paqad', 'packs', 'pkg-only-archetype');
    mkdirSync(join(packRoot, 'rules'), { recursive: true });
    writeFileSync(join(packRoot, 'rules', 'conventions.md'), '# conventions\n');
    writeFileSync(
      join(packRoot, 'pack.yaml'),
      [
        'name: pkg-only-archetype',
        'display_name: Package Only Archetype',
        'ecosystem: node',
        'version: 1.0.0',
        'description: Archetype with only package detection',
        'maintainer: test',
        'tier: archetype',
        'detection:',
        '  manifests:',
        '    - file: package.json',
        '      packages: [my-pkg]',
        'docs:',
        '  conventions_template: rules/conventions.md',
      ].join('\n'),
    );

    const pack = new StackPackLoader().validatePack(packRoot);

    expect(
      pack.validation.issues.some(
        (issue) => issue.level === 'warning' && issue.message.includes('package-based detection'),
      ),
    ).toBe(true);
  });

  it('accepts archetype pack with fields detection without warning', () => {
    const packRoot = join(projectRoot, '.paqad', 'packs', 'good-archetype');
    mkdirSync(join(packRoot, 'rules'), { recursive: true });
    writeFileSync(join(packRoot, 'rules', 'conventions.md'), '# conventions\n');
    writeFileSync(
      join(packRoot, 'pack.yaml'),
      [
        'name: good-archetype',
        'display_name: Good Archetype',
        'ecosystem: node',
        'version: 1.0.0',
        'description: Archetype with field detection',
        'maintainer: test',
        'tier: archetype',
        'detection:',
        '  manifests:',
        '    - file: package.json',
        '      fields:',
        '        - name: bin',
        '          presence: required',
        'docs:',
        '  conventions_template: rules/conventions.md',
      ].join('\n'),
    );

    const pack = new StackPackLoader().validatePack(packRoot);

    expect(pack.validation.valid).toBe(true);
    expect(
      pack.validation.issues.some((issue) => issue.message.includes('package-based detection')),
    ).toBe(false);
  });
});

function writePack(packRoot: string, displayName: string): void {
  mkdirSync(packRoot, { recursive: true });
  writeFileSync(
    join(packRoot, 'pack.yaml'),
    [
      'name: laravel',
      `display_name: ${displayName}`,
      'ecosystem: php',
      'version: 1.0.0',
      'description: PHP framework pack',
      'maintainer: paqad-ai',
      'detection:',
      '  manifests:',
      '    - file: composer.json',
      '      packages: [laravel/framework]',
    ].join('\n'),
  );
}
