import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { StackIntrospector } from '@/introspection';

describe('StackIntrospector', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-stack-'));
    mkdirSync(join(root, 'app'), { recursive: true });
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify(
        {
          dependencies: { react: '^19.0.0' },
          devDependencies: { vitest: '^3.2.4' },
        },
        null,
        2,
      ),
    );
    writeFileSync(
      join(root, 'pnpm-lock.yaml'),
      'packages:\n  /react@19.0.0:\n    version: 19.0.0\n  /vitest@3.2.4:\n    version: 3.2.4\n',
    );
    writeFileSync(
      join(root, 'composer.json'),
      JSON.stringify(
        {
          require: { 'laravel/framework': '^12.0' },
          'require-dev': { 'pestphp/pest': '^3.0' },
        },
        null,
        2,
      ),
    );
    writeFileSync(
      join(root, 'composer.lock'),
      JSON.stringify(
        {
          packages: [{ name: 'laravel/framework', version: 'v12.1.0' }],
          'packages-dev': [{ name: 'pestphp/pest', version: 'v3.7.4' }],
        },
        null,
        2,
      ),
    );
    writeFileSync(
      join(root, 'pubspec.yaml'),
      'dependencies:\n  flutter:\n    sdk: flutter\n  dio: ^5.0.0\ndev_dependencies:\n  flutter_test:\n    sdk: flutter\n',
    );
    writeFileSync(
      join(root, 'pubspec.lock'),
      'packages:\n  dio:\n    version: "5.8.0"\n  flutter_test:\n    version: "0.0.0"\n',
    );
    writeFileSync(
      join(root, 'package-lock.json'),
      JSON.stringify(
        {
          packages: {
            'node_modules/react': { version: '19.0.0' },
            'node_modules/vitest': { version: '3.2.4' },
          },
        },
        null,
        2,
      ),
    );
    writeFileSync(join(root, 'compose.yaml'), 'services:\n  app:\n    image: node:20\n');
    writeFileSync(join(root, 'Dockerfile'), 'FROM node:20\n');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('builds and caches a combined stack snapshot', async () => {
    const snapshot = await new StackIntrospector().snapshot(root);

    expect(snapshot.packages.map((pkg) => pkg.name)).toContain('react');
    expect(snapshot.packages.map((pkg) => pkg.name)).toContain('laravel/framework');
    expect(snapshot.profile.traits).toContain('pest');
    expect(snapshot.packages.find((pkg) => pkg.name === 'laravel/framework')?.locked_version).toBe(
      'v12.1.0',
    );
    expect(snapshot.packages.find((pkg) => pkg.name === 'dio')?.locked_version).toBe('5.8.0');
    expect(snapshot.toolchains.map((toolchain) => toolchain.package_manager)).toContain('pnpm');
    expect(snapshot.profile.traits).toContain('compose');
    expect(snapshot.profile.traits).toContain('docker');
    expect(snapshot.profile.sources.map((source) => source.file)).toContain('compose.yaml');
    expect(snapshot.profile.sources.map((source) => source.file)).toContain('Dockerfile');
    expect(readFileSync(join(root, PATHS.STACK_SNAPSHOT), 'utf8')).toContain('"packages"');

    const cached = await new StackIntrospector().snapshot(root);
    expect(cached.source_hashes).toEqual(snapshot.source_hashes);
  });

  it('detects phpunit as a stack trait when present in composer dev dependencies', async () => {
    writeFileSync(
      join(root, 'composer.json'),
      JSON.stringify(
        {
          require: { 'laravel/framework': '^12.0' },
          'require-dev': { 'phpunit/phpunit': '^11.0' },
        },
        null,
        2,
      ),
    );
    writeFileSync(
      join(root, 'composer.lock'),
      JSON.stringify(
        {
          packages: [{ name: 'laravel/framework', version: 'v12.1.0' }],
          'packages-dev': [{ name: 'phpunit/phpunit', version: '11.5.3' }],
        },
        null,
        2,
      ),
    );

    const snapshot = await new StackIntrospector().snapshot(root);

    expect(snapshot.profile.frameworks).toContain('laravel');
    expect(snapshot.profile.traits).toContain('phpunit');
    expect(snapshot.profile.traits).not.toContain('pest');
  });

  it('detects sail as an environment trait from composer dependencies', async () => {
    writeFileSync(
      join(root, 'composer.json'),
      JSON.stringify(
        {
          require: { 'laravel/framework': '^12.0', 'laravel/sail': '^1.0' },
          'require-dev': {},
        },
        null,
        2,
      ),
    );
    writeFileSync(
      join(root, 'composer.lock'),
      JSON.stringify(
        {
          packages: [
            { name: 'laravel/framework', version: 'v12.1.0' },
            { name: 'laravel/sail', version: 'v1.34.0' },
          ],
          'packages-dev': [],
        },
        null,
        2,
      ),
    );

    const snapshot = await new StackIntrospector().snapshot(root);

    expect(snapshot.profile.traits).toContain('sail');
    expect(snapshot.profile.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: 'composer.json',
          kind: 'manifest',
          detail: 'Detected laravel sail from composer dependency',
        }),
      ]),
    );
  });
});
