import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDefaultEcosystemParserRegistry } from '@/introspection';
import { dartParser } from '@/introspection/ecosystems/dart.js';
import { goParser } from '@/introspection/ecosystems/go.js';
import { jvmParser } from '@/introspection/ecosystems/jvm.js';
import { npmParser } from '@/introspection/ecosystems/node-npm.js';
import { pnpmParser } from '@/introspection/ecosystems/node-pnpm.js';
import { phpParser } from '@/introspection/ecosystems/php.js';
import { pythonParser } from '@/introspection/ecosystems/python.js';
import { rubyParser } from '@/introspection/ecosystems/ruby.js';
import { rustParser } from '@/introspection/ecosystems/rust.js';

describe('ecosystem parsers', () => {
  it('parses node manifests and lockfiles for npm and pnpm', () => {
    expect(
      npmParser.parseManifest(
        JSON.stringify({
          dependencies: { react: '^19.0.0' },
          devDependencies: { vitest: '^3.2.4' },
          scripts: { test: 'vitest run' },
        }),
        'package.json',
      ),
    ).toEqual({
      ecosystem: 'node',
      packages: [
        { name: 'react', constraint: '^19.0.0', isDev: false },
        { name: 'vitest', constraint: '^3.2.4', isDev: true },
      ],
      scripts: { test: 'vitest run' },
    });

    expect(
      npmParser.parseLockfile(
        JSON.stringify({
          packages: {
            'node_modules/react': { version: '19.0.0' },
            'node_modules/vitest': { version: '3.2.4' },
          },
        }),
        'package-lock.json',
      ).packages,
    ).toEqual([
      { name: 'react', version: '19.0.0' },
      { name: 'vitest', version: '3.2.4' },
    ]);

    expect(
      pnpmParser.parseLockfile(
        'packages:\n  /react@19.0.0:\n    version: 19.0.0\n  /vitest@3.2.4:\n    version: 3.2.4\n',
        'pnpm-lock.yaml',
      ).packages,
    ).toEqual([
      { name: 'react', version: '19.0.0' },
      { name: 'vitest', version: '3.2.4' },
    ]);
  });

  it('parses php and dart manifests and lockfiles', () => {
    expect(
      phpParser.parseManifest(
        JSON.stringify({
          require: { 'laravel/framework': '^12.0' },
          'require-dev': { 'pestphp/pest': '^3.0' },
        }),
        'composer.json',
      ).packages,
    ).toEqual([
      { name: 'laravel/framework', constraint: '^12.0', isDev: false },
      { name: 'pestphp/pest', constraint: '^3.0', isDev: true },
    ]);

    expect(
      dartParser.parseManifest(
        'dependencies:\n  flutter:\n    sdk: flutter\n  dio: ^5.0.0\ndev_dependencies:\n  flutter_test:\n    sdk: flutter\n',
        'pubspec.yaml',
      ).packages,
    ).toEqual([
      { name: 'dio', constraint: '^5.0.0', isDev: false },
      { name: 'flutter', constraint: 'sdk:flutter', isDev: false },
      { name: 'flutter_test', constraint: 'sdk:flutter', isDev: true },
    ]);
  });

  it('parses first-pass python, ruby, jvm, go, and rust inputs', () => {
    expect(
      pythonParser.parseManifest('fastapi==0.115.0\nuvicorn==0.30.0\n', 'requirements.txt')
        .packages,
    ).toEqual([
      { name: 'fastapi', constraint: '0.115.0', isDev: false },
      { name: 'uvicorn', constraint: '0.30.0', isDev: false },
    ]);

    expect(
      rubyParser.parseManifest('gem "rails", "~> 8.0"\ngem "rspec"\n', 'Gemfile').packages,
    ).toEqual([
      { name: 'rails', constraint: '~> 8.0', isDev: false },
      { name: 'rspec', constraint: undefined, isDev: false },
    ]);

    expect(
      jvmParser.parseManifest(
        'dependencies {\n  implementation("org.springframework.boot:spring-boot-starter-web:3.4.0")\n}',
        'build.gradle.kts',
      ).packages,
    ).toEqual([
      {
        name: 'org.springframework.boot:spring-boot-starter-web',
        constraint: '3.4.0',
        isDev: false,
      },
    ]);

    expect(
      goParser.parseManifest('require github.com/gin-gonic/gin v1.10.0\n', 'go.mod').packages,
    ).toEqual([{ name: 'github.com/gin-gonic/gin', constraint: 'v1.10.0', isDev: false }]);

    expect(
      rustParser.parseManifest('[dependencies]\naxum = "0.7"\n', 'Cargo.toml').packages,
    ).toEqual([{ name: 'axum', constraint: '0.7', isDev: false }]);
  });

  it('returns empty results for malformed parser inputs', () => {
    expect(npmParser.parseManifest('{not json', 'package.json').packages).toEqual([]);
    expect(phpParser.parseLockfile('{bad json', 'composer.lock').packages).toEqual([]);
    expect(dartParser.parseManifest('::::', 'pubspec.yaml').packages).toEqual([]);
    expect(pythonParser.parseLockfile('{bad json', 'Pipfile.lock').packages).toEqual([]);
  });
});

describe('EcosystemParserRegistry', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-ecosystems-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('parses all supported ecosystems present in a project', async () => {
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ dependencies: { react: '^19.0.0' }, devDependencies: {} }),
    );
    writeFileSync(
      join(root, 'pnpm-lock.yaml'),
      'packages:\n  /react@19.0.0:\n    version: 19.0.0\n',
    );
    writeFileSync(
      join(root, 'composer.json'),
      JSON.stringify({ require: { 'laravel/framework': '^12.0' } }),
    );
    writeFileSync(
      join(root, 'composer.lock'),
      JSON.stringify({ packages: [{ name: 'laravel/framework', version: '12.1.0' }] }),
    );
    writeFileSync(join(root, 'pubspec.yaml'), 'dependencies:\n  dio: ^5.0.0\n');
    writeFileSync(join(root, 'requirements.txt'), 'fastapi==0.115.0\n');
    writeFileSync(join(root, 'Gemfile'), 'gem "rails", "~> 8.0"\n');
    writeFileSync(
      join(root, 'build.gradle'),
      'dependencies { implementation "org.springframework.boot:spring-boot-starter-web:3.4.0" }',
    );
    writeFileSync(join(root, 'go.mod'), 'require github.com/gin-gonic/gin v1.10.0\n');
    writeFileSync(join(root, 'Cargo.toml'), '[dependencies]\naxum = "0.7"\n');

    const registry = createDefaultEcosystemParserRegistry();
    const results = await registry.parseProject(root);

    expect(results.map((result) => result.toolchain.ecosystem)).toEqual([
      'node',
      'node',
      'php',
      'dart',
      'python',
      'ruby',
      'jvm',
      'go',
      'rust',
    ]);
    expect(results.flatMap((result) => result.packages.map((pkg) => pkg.name))).toEqual(
      expect.arrayContaining([
        'react',
        'laravel/framework',
        'dio',
        'fastapi',
        'rails',
        'org.springframework.boot:spring-boot-starter-web',
        'github.com/gin-gonic/gin',
        'axum',
      ]),
    );
  });
});
