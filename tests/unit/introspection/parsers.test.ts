import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseComposerProject } from '@/introspection/parsers/composer.js';
import { parseDartProject } from '@/introspection/parsers/dart.js';
import { parseNpmProject } from '@/introspection/parsers/npm.js';
import { parsePnpmProject } from '@/introspection/parsers/pnpm.js';

describe('introspection parsers', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-parsers-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('parses composer projects and falls back to declared versions without a lockfile', async () => {
    writeFileSync(
      join(root, 'composer.json'),
      JSON.stringify({
        require: {
          'laravel/framework': '^12.0',
          'spatie/laravel-data': '^4.0',
        },
        'require-dev': {
          'pestphp/pest': '^3.0',
        },
      }),
    );
    writeFileSync(
      join(root, 'composer.lock'),
      JSON.stringify({
        packages: [{ name: 'laravel/framework', version: '12.1.0' }],
        'packages-dev': [{ name: 'pestphp/pest', version: '3.8.2' }],
      }),
    );

    const parsed = await parseComposerProject(root);
    expect(parsed).not.toBeNull();
    expect(parsed!.toolchain).toEqual({
      ecosystem: 'php',
      package_manager: 'composer',
      lockfile: 'composer.lock',
    });
    expect(parsed!.packages).toEqual([
      {
        name: 'laravel/framework',
        version_constraint: '^12.0',
        locked_version: '12.1.0',
        ecosystem: 'php',
        is_dev: false,
      },
      {
        name: 'pestphp/pest',
        version_constraint: '^3.0',
        locked_version: '3.8.2',
        ecosystem: 'php',
        is_dev: true,
      },
      {
        name: 'spatie/laravel-data',
        version_constraint: '^4.0',
        locked_version: '^4.0',
        ecosystem: 'php',
        is_dev: false,
      },
    ]);

    rmSync(join(root, 'composer.json'));
    await expect(parseComposerProject(root)).resolves.toBeNull();
  });

  it('parses npm projects from package-lock metadata', async () => {
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        dependencies: { react: '^19.0.0' },
        devDependencies: { vitest: '^3.2.4' },
      }),
    );
    writeFileSync(
      join(root, 'package-lock.json'),
      JSON.stringify({
        packages: {
          '': {},
          'node_modules/react': { version: '19.0.0' },
          'node_modules/vitest': { version: '3.2.4' },
          ignored: { version: '1.0.0' },
        },
      }),
    );

    await expect(parseNpmProject(root)).resolves.toEqual({
      toolchain: {
        ecosystem: 'node',
        package_manager: 'npm',
        lockfile: 'package-lock.json',
      },
      packages: [
        {
          name: 'react',
          version_constraint: '^19.0.0',
          locked_version: '19.0.0',
          ecosystem: 'node',
          is_dev: false,
        },
        {
          name: 'vitest',
          version_constraint: '^3.2.4',
          locked_version: '3.2.4',
          ecosystem: 'node',
          is_dev: true,
        },
      ],
    });
  });

  it('parses pnpm projects and resolves scoped packages from the lockfile', async () => {
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        dependencies: { vue: '^3.5.0', '@inertiajs/vue3': '^2.0.0' },
        devDependencies: { typescript: '^5.0.0' },
      }),
    );
    writeFileSync(
      join(root, 'pnpm-lock.yaml'),
      [
        'packages:',
        '  /vue@3.5.0:',
        '    version: 3.5.0',
        '  /@inertiajs/vue3@2.0.0:',
        '    version: 2.0.0',
        '  /typescript@5.0.4:',
        '    version: 5.0.4',
        '',
      ].join('\n'),
    );

    await expect(parsePnpmProject(root)).resolves.toEqual({
      toolchain: {
        ecosystem: 'node',
        package_manager: 'pnpm',
        lockfile: 'pnpm-lock.yaml',
      },
      packages: [
        {
          name: '@inertiajs/vue3',
          version_constraint: '^2.0.0',
          locked_version: '2.0.0',
          ecosystem: 'node',
          is_dev: false,
        },
        {
          name: 'typescript',
          version_constraint: '^5.0.0',
          locked_version: '5.0.4',
          ecosystem: 'node',
          is_dev: true,
        },
        {
          name: 'vue',
          version_constraint: '^3.5.0',
          locked_version: '3.5.0',
          ecosystem: 'node',
          is_dev: false,
        },
      ],
    });
  });

  it('parses dart projects including sdk dependencies and missing lock fallback', async () => {
    writeFileSync(
      join(root, 'pubspec.yaml'),
      [
        'dependencies:',
        '  flutter:',
        '    sdk: flutter',
        '  dio: ^5.0.0',
        'dev_dependencies:',
        '  flutter_test:',
        '    sdk: flutter',
        '  lints: ^3.0.0',
        '',
      ].join('\n'),
    );
    writeFileSync(
      join(root, 'pubspec.lock'),
      ['packages:', '  dio:', '    version: "5.1.0"', '  lints:', '    version: "3.0.1"', ''].join(
        '\n',
      ),
    );

    await expect(parseDartProject(root)).resolves.toEqual({
      toolchain: {
        ecosystem: 'dart',
        package_manager: 'pub',
        lockfile: 'pubspec.lock',
      },
      packages: [
        {
          name: 'dio',
          version_constraint: '^5.0.0',
          locked_version: '5.1.0',
          ecosystem: 'dart',
          is_dev: false,
        },
        {
          name: 'flutter',
          version_constraint: 'sdk:flutter',
          locked_version: 'sdk:flutter',
          ecosystem: 'dart',
          is_dev: false,
        },
        {
          name: 'flutter_test',
          version_constraint: 'sdk:flutter',
          locked_version: 'sdk:flutter',
          ecosystem: 'dart',
          is_dev: true,
        },
        {
          name: 'lints',
          version_constraint: '^3.0.0',
          locked_version: '3.0.1',
          ecosystem: 'dart',
          is_dev: true,
        },
      ],
    });

    rmSync(join(root, 'pubspec.yaml'));
    await expect(parseDartProject(root)).resolves.toBeNull();
  });

  it('gracefully handles missing package files for node parsers', async () => {
    await expect(parseNpmProject(root)).resolves.toBeNull();
    await expect(parsePnpmProject(root)).resolves.toBeNull();

    mkdirSync(join(root, 'subdir'), { recursive: true });
    writeFileSync(join(root, 'package.json'), '{invalid json');
    await expect(parseNpmProject(root)).resolves.toBeNull();
  });
});
