import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createRulesCommand } from '@/cli/commands/rules.js';
import { readBaseline } from '@/rules-discovery/baseline.js';
import {
  buildStackInventory,
  inventorySummary,
  writeStackInventory,
} from '@/rules-discovery/inventory.js';
import { RULES_DISCOVERY_BASELINE, runFilePath } from '@/rules-discovery/paths.js';
import type { InventoryPackage, StackInventory } from '@/rules-discovery/types.js';

const RUN = 'rd-20261110-120000';
const NOW = new Date('2026-11-10T12:00:00Z');
const roots: string[] = [];

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-rd-inventory-'));
  roots.push(root);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body, 'utf8');
  }
  return root;
}

async function inventoryOf(root: string): Promise<StackInventory> {
  return buildStackInventory({ projectRoot: root, runId: RUN, now: NOW, frameworks: [] });
}

function find(inv: StackInventory, name: string): InventoryPackage {
  const pkg = inv.packages.find((entry) => entry.name === name);
  if (pkg === undefined) throw new Error(`missing ${name}`);
  return pkg;
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('rules inventory · every ecosystem (AC-6)', () => {
  it.each([
    [
      'node',
      {
        'package.json': JSON.stringify({ dependencies: { zod: '^3.22.0' } }),
        'package-lock.json': JSON.stringify({
          packages: { 'node_modules/zod': { version: '3.22.4' } },
        }),
      },
      'zod',
      '^3.22.0',
      '3.22.4',
      'package.json',
    ],
    [
      'python',
      {
        'pyproject.toml': '[project]\nname = "app"\ndependencies = ["requests>=2.31"]\n',
        'poetry.lock': '[[package]]\nname = "requests"\nversion = "2.31.0"\n',
      },
      'requests',
      '>=2.31',
      '2.31.0',
      'pyproject.toml',
    ],
    [
      'php',
      {
        'composer.json': JSON.stringify({ require: { 'laravel/framework': '^11.0' } }),
        'composer.lock': JSON.stringify({
          packages: [{ name: 'laravel/framework', version: 'v11.2.0' }],
        }),
      },
      'laravel/framework',
      '^11.0',
      'v11.2.0',
      'composer.json',
    ],
    [
      'go',
      {
        'go.mod': 'module example.com/app\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.1\n)\n',
        'go.sum': 'github.com/gin-gonic/gin v1.9.1 h1:abc\n',
      },
      'github.com/gin-gonic/gin',
      'v1.9.1',
      'v1.9.1',
      'go.mod',
    ],
    [
      'rust',
      {
        'Cargo.toml':
          '[package]\nname = "app"\nversion = "0.1.0"\n\n[dependencies]\nserde = { version = "1.0", features = ["derive"] }\n',
        'Cargo.lock': '[[package]]\nname = "serde"\nversion = "1.0.190"\n',
      },
      'serde',
      '1.0',
      '1.0.190',
      'Cargo.toml',
    ],
    [
      'ruby',
      {
        Gemfile: "gem 'rails', '~> 7.1'\n",
        'Gemfile.lock': '    rails (7.1.2)\n',
      },
      'rails',
      '~> 7.1',
      null,
      'Gemfile',
    ],
    [
      'java',
      {
        'pom.xml':
          '<project><dependencies><dependency><groupId>org.springframework</groupId><artifactId>spring-core</artifactId><version>6.1.0</version></dependency></dependencies></project>',
      },
      'org.springframework:spring-core',
      '6.1.0',
      null,
      'pom.xml',
    ],
    [
      'kotlin',
      {
        'build.gradle.kts':
          'dependencies {\n  implementation("io.ktor:ktor-server-core:2.3.6")\n}\n',
      },
      'io.ktor:ktor-server-core',
      '2.3.6',
      null,
      'build.gradle.kts',
    ],
    [
      'flutter',
      {
        'pubspec.yaml': 'name: app\ndependencies:\n  http: ^1.1.0\n',
        'pubspec.lock': 'packages:\n  http:\n    version: "1.1.2"\n',
      },
      'http',
      '^1.1.0',
      '1.1.2',
      'pubspec.yaml',
    ],
    [
      'dotnet',
      {
        'App.csproj':
          '<Project><ItemGroup><PackageReference Include="Newtonsoft.Json" Version="13.0.3" /></ItemGroup></Project>',
        'packages.lock.json': JSON.stringify({
          dependencies: {
            'net8.0': { 'Newtonsoft.Json': { type: 'Direct', resolved: '13.0.3' } },
          },
        }),
      },
      'Newtonsoft.Json',
      '13.0.3',
      '13.0.3',
      'App.csproj',
    ],
  ] as const)(
    'AC-6: lists the %s direct dependency with version, manifest and dev flag',
    async (_label, files, name, declared, installed, manifest) => {
      const inv = await inventoryOf(project(files));
      const pkg = find(inv, name);
      expect(pkg).toMatchObject({ name, declared, manifest, dev: false });
      if (installed !== null) expect(pkg.installed).toBe(installed);
      expect(typeof pkg.ecosystem).toBe('string');
    },
  );

  it('AC-6: reads yarn.lock for installed versions', async () => {
    const inv = await inventoryOf(
      project({
        'package.json': JSON.stringify({ dependencies: { hono: '^4.0.0' } }),
        'yarn.lock':
          '"hono@^4.0.0":\n  version "4.0.5"\n  resolved "https://registry.yarnpkg.com/hono/-/hono-4.0.5.tgz"\n',
      }),
    );
    expect(find(inv, 'hono')).toMatchObject({ installed: '4.0.5', private: false });
  });
});

describe('rules inventory · lockfiles, workspaces and dev deps (AC-7)', () => {
  it('AC-7: installed is null without a lockfile, every workspace manifest is read, dev is true', async () => {
    const inv = await inventoryOf(
      project({
        'package.json': JSON.stringify({
          name: 'root',
          devDependencies: { vitest: '^2.0.0' },
        }),
        'packages/api/package.json': JSON.stringify({
          name: '@acme/api',
          dependencies: { hono: '^4.0.0' },
        }),
        'packages/web/package.json': JSON.stringify({
          name: '@acme/web',
          dependencies: { react: '^18.0.0' },
        }),
      }),
    );
    expect(inv.manifests).toEqual([
      'package.json',
      'packages/api/package.json',
      'packages/web/package.json',
    ]);
    expect(find(inv, 'hono')).toMatchObject({
      installed: null,
      manifest: 'packages/api/package.json',
    });
    expect(find(inv, 'react').manifest).toBe('packages/web/package.json');
    expect(find(inv, 'vitest')).toMatchObject({ dev: true, installed: null });
  });
});

describe('rules inventory · import counts (AC-8)', () => {
  it('AC-8: counts non-ignored files that import a package and marks an unimported one unused', async () => {
    const root = project({
      'package.json': JSON.stringify({
        dependencies: { zod: '^3.0.0', '@scope/kit': '^1.0.0', lodash: '^4.0.0' },
      }),
      'src/a.ts': "import { z } from 'zod';\nimport { k } from '@scope/kit/sub';\n",
      'src/b.ts': "const z = require('zod');\n",
      'src/c.ts': "export const c = await import('zod');\n",
      'generated/d.ts': "import { z } from 'zod';\n",
      '.gitignore': 'generated/\n',
    });
    execFileSync('git', ['init', '-q'], { cwd: root });
    const inv = await inventoryOf(root);
    expect(find(inv, 'zod')).toMatchObject({ import_count: 3, unused: false });
    expect(find(inv, '@scope/kit')).toMatchObject({ import_count: 1, unused: false });
    expect(find(inv, 'lodash')).toMatchObject({ import_count: 0, unused: true });
  });
});

describe('rules inventory · status against the baseline (AC-9)', () => {
  it('AC-9: marks new, removed, version-changed and unchanged and names the baseline', async () => {
    const root = project({
      'package.json': JSON.stringify({
        dependencies: { zod: '^3.22.0', hono: '^4.0.0', react: '^18.0.0' },
      }),
      '.paqad/stack-snapshot.json': JSON.stringify({
        packages: [
          {
            name: 'zod',
            version_constraint: '^3.22.0',
            locked_version: '^3.22.0',
            ecosystem: 'node',
            is_dev: false,
          },
          {
            name: 'react',
            version_constraint: '^17.0.0',
            locked_version: '^17.0.0',
            ecosystem: 'node',
            is_dev: false,
          },
          {
            name: 'express',
            version_constraint: '^4.0.0',
            locked_version: '^4.0.0',
            ecosystem: 'node',
            is_dev: false,
          },
        ],
      }),
    });
    const inv = await inventoryOf(root);
    expect(find(inv, 'zod').status).toBe('unchanged');
    expect(find(inv, 'hono').status).toBe('new');
    expect(find(inv, 'react').status).toBe('version-changed');
    expect(find(inv, 'express').status).toBe('removed');
    expect(inv.compared_to).toBe('.paqad/stack-snapshot.json');
    expect(readBaseline(root)?.source).toBe('seed');
  });

  it('AC-9: compares against the rules-discovery baseline, not a newer stack snapshot', async () => {
    const root = project({
      'package.json': JSON.stringify({ dependencies: { zod: '^3.22.0', hono: '^4.0.0' } }),
      '.paqad/stack-snapshot.json': JSON.stringify({
        packages: [
          {
            name: 'zod',
            version_constraint: '^3.22.0',
            locked_version: 'unknown',
            ecosystem: 'node',
            is_dev: false,
          },
          {
            name: 'hono',
            version_constraint: '^4.0.0',
            locked_version: 'unknown',
            ecosystem: 'node',
            is_dev: false,
          },
        ],
      }),
      [RULES_DISCOVERY_BASELINE]: JSON.stringify({
        schema_version: 1,
        source: 'run',
        inventory: runFilePath('rd-20261101-090000', 'inventory'),
        run_id: 'rd-20261101-090000',
        seeded_from: null,
        updated_at: '2026-11-01T09:00:00Z',
        packages: [
          { name: 'zod', ecosystem: 'node', declared: '^3.22.0', installed: null, dev: false },
        ],
      }),
    });
    const inv = await inventoryOf(root);
    expect(find(inv, 'hono').status).toBe('new');
    expect(inv.compared_to).toBe(runFilePath('rd-20261101-090000', 'inventory'));
  });
});

describe('rules inventory · no manifest (AC-10)', () => {
  it('AC-10: names the manifests it looked for and says the run goes on', async () => {
    const inv = await inventoryOf(project({ 'README.md': '# hi\n' }));
    expect(inv.packages).toEqual([]);
    expect(inv.manifests_looked_for).toEqual(
      expect.arrayContaining(['package.json', 'go.mod', 'Cargo.toml', '*.csproj', 'pubspec.yaml']),
    );
    expect(inventorySummary(inv)).toContain('looked for');
    expect(inventorySummary(inv)).toContain('decisions and existing rules only');
  });
});

describe('rules inventory · private packages (AC-11)', () => {
  it('AC-11: marks workspace, git and private-registry packages private with a reason, and leaves name-alike packages public', async () => {
    const root = project({
      'package.json': JSON.stringify({
        name: 'root',
        dependencies: {
          '@acme/api': 'workspace:*',
          '@acme/shared': '^1.0.0',
          'forked-lib': 'git+https://github.com/acme/forked-lib.git',
          'internal-auth': '^2.0.0',
          'acme-billing': '^1.0.0',
          zod: '^3.22.0',
        },
      }),
      'packages/shared/package.json': JSON.stringify({ name: '@acme/shared' }),
      'package-lock.json': JSON.stringify({
        packages: {
          'node_modules/internal-auth': {
            version: '2.0.1',
            resolved: 'https://npm.acme.internal/internal-auth/-/internal-auth-2.0.1.tgz',
          },
          'node_modules/zod': {
            version: '3.22.4',
            resolved: 'https://registry.npmjs.org/zod/-/zod-3.22.4.tgz',
          },
        },
      }),
    });
    const inv = await inventoryOf(root);
    expect(find(inv, '@acme/api')).toMatchObject({
      private: true,
      private_reason: 'workspace-source',
    });
    expect(find(inv, '@acme/shared')).toMatchObject({
      private: true,
      private_reason: 'workspace-package',
    });
    expect(find(inv, 'forked-lib')).toMatchObject({ private: true, private_reason: 'git-source' });
    expect(find(inv, 'internal-auth')).toMatchObject({
      private: true,
      private_reason: 'private-registry',
    });
    expect(find(inv, 'acme-billing')).toMatchObject({ private: false });
    expect(find(inv, 'acme-billing').private_reason).toBeUndefined();
    expect(find(inv, 'zod')).toMatchObject({ private: false });
    expect(find(inv, 'zod').private_reason).toBeUndefined();
  });

  it('AC-11: marks Cargo path, pubspec git and go.mod local replace dependencies private', async () => {
    const inv = await inventoryOf(
      project({
        'Cargo.toml': '[dependencies]\ncore-lib = { path = "../core" }\nserde = "1.0"\n',
        'pubspec.yaml':
          'name: app\ndependencies:\n  design:\n    git:\n      url: https://github.com/acme/design.git\n',
        'go.mod':
          'module example.com/app\n\nrequire example.com/shared v0.0.0\n\nreplace example.com/shared => ../shared\n',
      }),
    );
    expect(find(inv, 'core-lib')).toMatchObject({ private: true, private_reason: 'local-path' });
    expect(find(inv, 'serde').private).toBe(false);
    expect(find(inv, 'design')).toMatchObject({ private: true, private_reason: 'git-source' });
    expect(find(inv, 'example.com/shared')).toMatchObject({
      private: true,
      private_reason: 'local-path',
    });
  });
});

describe('paqad-ai rules inventory', () => {
  it('AC-6: writes stack-inventory.json into the run folder', async () => {
    const root = project({ 'package.json': JSON.stringify({ dependencies: { zod: '^3.0.0' } }) });
    const inv = await writeStackInventory({
      projectRoot: root,
      runId: RUN,
      now: NOW,
      frameworks: [],
    });
    const stored = JSON.parse(
      readFileSync(join(root, runFilePath(RUN, 'inventory')), 'utf8'),
    ) as StackInventory;
    expect(stored).toEqual(inv);
  });

  it('refuses a run id that is not a rules discovery id', async () => {
    const root = project({});
    const errors: string[] = [];
    const original = console.error;
    console.error = (line: string) => errors.push(line);
    try {
      await createRulesCommand().parseAsync(
        ['inventory', '--run', '../../escape', '--project-root', root],
        { from: 'user' },
      );
    } finally {
      console.error = original;
    }
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
    expect(errors.join('\n')).toContain('not a rules discovery run id');
  });
});
