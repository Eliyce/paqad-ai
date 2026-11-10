import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildStackInventory,
  countImports,
  inventorySummary,
  lockfileSources,
  matchesPrivatePattern,
  packageKey,
} from '@/rules-discovery/inventory.js';
import { RULES_DISCOVERY_BASELINE } from '@/rules-discovery/paths.js';
import type { InventoryPackage, StackInventory } from '@/rules-discovery/types.js';

const RUN = 'rd-20261110-120000';
const NOW = new Date('2026-11-10T12:00:00Z');
const roots: string[] = [];

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-rd-sources-'));
  roots.push(root);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body, 'utf8');
  }
  return root;
}

function find(inv: StackInventory, name: string): InventoryPackage {
  const pkg = inv.packages.find((entry) => entry.name === name);
  if (pkg === undefined) throw new Error(`missing ${name}`);
  return pkg;
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('AC-5 lockfile sources', () => {
  it('AC-5: returns no sources for a package-lock.json that is not JSON', () => {
    expect(lockfileSources('{ not json', 'package-lock.json').size).toBe(0);
  });

  it('AC-5: reads pnpm tarballs keyed with and without a leading slash and skips entries without one', () => {
    const sources = lockfileSources(
      [
        'packages:',
        '  /zod@3.22.4:',
        '    resolution: {tarball: https://npm.acme.internal/zod-3.22.4.tgz}',
        '  "@scope/kit@1.0.0":',
        '    resolution: {tarball: https://registry.npmjs.org/@scope/kit/-/kit-1.0.0.tgz}',
        '  hono@4.0.0:',
        '    resolution: {integrity: sha512-abc}',
        '  plain:',
        '    resolution: {tarball: https://x.test/plain.tgz}',
        '',
      ].join('\n'),
      'pnpm-lock.yaml',
    );
    expect(Object.fromEntries(sources)).toEqual({
      zod: 'https://npm.acme.internal/zod-3.22.4.tgz',
      '@scope/kit': 'https://registry.npmjs.org/@scope/kit/-/kit-1.0.0.tgz',
    });
  });

  it('AC-5: returns no sources for an empty or broken pnpm lockfile', () => {
    expect(lockfileSources('', 'pnpm-lock.yaml').size).toBe(0);
    expect(lockfileSources('packages: [unclosed', 'pnpm-lock.yaml').size).toBe(0);
  });

  it('AC-5: reads Cargo.lock sources and skips path crates without one', () => {
    const sources = lockfileSources(
      [
        '[[package]]',
        'name = "serde"',
        'version = "1.0.0"',
        'source = "registry+https://github.com/rust-lang/crates.io-index"',
        '',
        '[[package]]',
        'name = "core-lib"',
        'version = "0.1.0"',
        '',
      ].join('\n'),
      'Cargo.lock',
    );
    expect(Object.fromEntries(sources)).toEqual({
      serde: 'registry+https://github.com/rust-lang/crates.io-index',
    });
  });

  it('AC-5: marks composer path packages from both package lists and survives broken JSON', () => {
    const sources = lockfileSources(
      JSON.stringify({
        packages: [
          { name: 'acme/shared', dist: { type: 'path' } },
          { name: 'laravel/framework', dist: { type: 'zip' } },
          { dist: { type: 'path' } },
        ],
        'packages-dev': [{ name: 'acme/testing', dist: { type: 'path' } }],
      }),
      'composer.lock',
    );
    expect(Object.fromEntries(sources)).toEqual({
      'acme/shared': 'path+local',
      'acme/testing': 'path+local',
    });
    expect(lockfileSources('{', 'composer.lock').size).toBe(0);
    expect(lockfileSources('{}', 'composer.lock').size).toBe(0);
  });

  it('AC-5: has no sources for a lockfile it does not read', () => {
    expect(lockfileSources('anything', 'Gemfile.lock').size).toBe(0);
  });
});

describe('AC-5 private packages from lockfile sources', () => {
  it('AC-5: a git, file or non-url resolved source decides privacy for node packages', async () => {
    const root = project({
      'package.json': JSON.stringify({
        dependencies: { forked: '^1.0.0', local: '^1.0.0', odd: '^1.0.0', mirror: '^1.0.0' },
      }),
      'package-lock.json': JSON.stringify({
        packages: {
          '': { name: 'app' },
          'node_modules/forked': { version: '1.0.0', resolved: 'git+ssh://git@x.test/a.git' },
          'node_modules/local': { version: '1.0.0', resolved: 'file:../local' },
          'node_modules/odd': { version: '1.0.0', resolved: 'odd-1.0.0.tgz' },
          'node_modules/mirror': {
            version: '1.0.0',
            resolved: 'https://registry.npmmirror.com/mirror/-/mirror-1.0.0.tgz',
          },
        },
      }),
    });
    const inv = await buildStackInventory({
      projectRoot: root,
      runId: RUN,
      now: NOW,
      frameworks: [],
      env: {},
    });
    expect(find(inv, 'forked')).toMatchObject({ private: true, private_reason: 'git-source' });
    expect(find(inv, 'local')).toMatchObject({ private: true, private_reason: 'local-path' });
    expect(find(inv, 'odd').private).toBe(false);
    expect(find(inv, 'mirror').private).toBe(false);
  });

  it('AC-5: a crate from another registry is private, crates.io is not', async () => {
    const root = project({
      'Cargo.toml': '[package]\nname = "app"\n\n[dependencies]\nserde = "1.0"\nacme = "0.2"\n',
      'Cargo.lock': [
        '[[package]]',
        'name = "serde"',
        'version = "1.0.0"',
        'source = "registry+https://github.com/rust-lang/crates.io-index"',
        '',
        '[[package]]',
        'name = "acme"',
        'version = "0.2.0"',
        'source = "sparse+https://crates.acme.internal/index/"',
        '',
      ].join('\n'),
    });
    const inv = await buildStackInventory({
      projectRoot: root,
      runId: RUN,
      now: NOW,
      frameworks: [],
      env: {},
    });
    expect(find(inv, 'serde')).toMatchObject({ private: false, installed: '1.0.0' });
    expect(find(inv, 'acme')).toMatchObject({ private: true, private_reason: 'private-registry' });
  });

  it('AC-5: workspace names come from composer.json, pubspec.yaml and go.mod', async () => {
    const root = project({
      'composer.json': JSON.stringify({
        name: 'acme/app',
        require: { 'acme/app': '^1.0', 'laravel/framework': '^11.0' },
      }),
      'tools/pubspec.yaml': 'name: tools\ndependencies:\n  tools: ^1.0.0\n',
      'svc/go.mod': 'module example.com/svc\n\nrequire example.com/svc v1.0.0\n',
    });
    const inv = await buildStackInventory({
      projectRoot: root,
      runId: RUN,
      now: NOW,
      frameworks: [],
      env: {},
    });
    expect(find(inv, 'acme/app')).toMatchObject({
      private: true,
      private_reason: 'workspace-package',
    });
    expect(find(inv, 'laravel/framework').private).toBe(false);
    expect(find(inv, 'tools')).toMatchObject({
      private: true,
      private_reason: 'workspace-package',
    });
    expect(find(inv, 'example.com/svc')).toMatchObject({
      private: true,
      private_reason: 'workspace-package',
    });
  });

  it('AC-5: matches configured patterns case-insensitively and treats regex characters literally', () => {
    expect(matchesPrivatePattern('ACME-billing', ['acme-*'])).toBe(true);
    expect(matchesPrivatePattern('acmeXjs', ['acme.js'])).toBe(false);
    expect(matchesPrivatePattern('acme.js', ['acme.js'])).toBe(true);
    expect(matchesPrivatePattern('zod', [])).toBe(false);
  });

  it('AC-5: detects frameworks when the caller passes none', async () => {
    const root = project({
      'package.json': JSON.stringify({ dependencies: { react: '^18.0.0' } }),
    });
    const inv = await buildStackInventory({ projectRoot: root, runId: RUN, now: NOW, env: {} });
    expect(Array.isArray(inv.frameworks)).toBe(true);
    expect(inv.frameworks).toEqual([...inv.frameworks].sort());
  });
});

describe('AC-5 import counts in every language', () => {
  it('AC-5: counts imports per ecosystem and leaves ecosystems without sources uncounted', () => {
    const root = project({
      'app/main.py': 'import requests.adapters\nfrom my_lib import thing\n',
      'app/empty.py': 'print("no imports")\n',
      'cmd/main.go':
        'package main\n\nimport (\n\t"github.com/gin-gonic/gin"\n\tlog "github.com/sirupsen/logrus/hooks"\n)\n',
      'src/lib.rs': 'use my_crate::Thing;\npub extern crate libc;\n',
      'lib/app.rb': 'require \'rails/all\'\nrequire "nokogiri"\n',
      'lib/main.dart': "import 'package:http/http.dart';\n",
      'src/App.cs': 'using Newtonsoft.Json;\nusing static Serilog.Log;\n',
      'src/Main.java': 'import com.google.gson.Gson;\nimport static org.junit.Assert.assertTrue;\n',
    });
    const packages = [
      { name: 'requests', ecosystem: 'python' as const },
      { name: 'my-lib', ecosystem: 'python' as const },
      { name: 'flask', ecosystem: 'python' as const },
      { name: 'github.com/gin-gonic/gin', ecosystem: 'go' as const },
      { name: 'github.com/sirupsen/logrus', ecosystem: 'go' as const },
      { name: 'my-crate', ecosystem: 'rust' as const },
      { name: 'libc', ecosystem: 'rust' as const },
      { name: 'rails', ecosystem: 'ruby' as const },
      { name: 'nokogiri', ecosystem: 'ruby' as const },
      { name: 'http', ecosystem: 'dart' as const },
      { name: 'Newtonsoft.Json', ecosystem: 'dotnet' as const },
      { name: 'Serilog', ecosystem: 'dotnet' as const },
      { name: 'com.google.gson:gson', ecosystem: 'jvm' as const },
      { name: 'org.junit', ecosystem: 'jvm' as const },
      { name: ':orphan', ecosystem: 'jvm' as const },
      { name: 'laravel/framework', ecosystem: 'php' as const },
    ];
    const counts = countImports(root, packages);
    const of = (pkg: { name: string; ecosystem: string }): number | null | undefined =>
      counts.get(packageKey(pkg));
    expect(of(packages[0]!)).toBe(1);
    expect(of(packages[1]!)).toBe(1);
    expect(of(packages[2]!)).toBe(0);
    for (const pkg of packages.slice(3, 14)) expect(of(pkg), pkg.name).toBe(1);
    expect(of(packages[14]!)).toBe(0);
    expect(of(packages[15]!)).toBeNull();
  });
});

describe('AC-5 inventory summary', () => {
  const base: StackInventory = {
    schema_version: 1,
    generated_at: NOW.toISOString(),
    run_id: RUN,
    packages: [],
    frameworks: [],
    manifests: ['package.json'],
    manifests_looked_for: [],
    compared_to: null,
  };
  const row = (name: string, status: InventoryPackage['status']): InventoryPackage => ({
    name,
    ecosystem: 'node',
    declared: '^1.0.0',
    installed: null,
    manifest: 'package.json',
    dev: false,
    import_count: 0,
    unused: true,
    status,
    private: false,
  });

  it('AC-5: counts statuses and says there was no baseline on a first run', () => {
    expect(inventorySummary({ ...base, packages: [row('a', 'new'), row('b', 'unchanged')] })).toBe(
      '2 packages from 1 manifest: 1 new, 0 version-changed, 0 removed (first run, no baseline).',
    );
  });

  it('AC-5: leaves removed packages out of the listed count and names the baseline', () => {
    expect(
      inventorySummary({
        ...base,
        manifests: ['package.json', 'api/package.json'],
        packages: [row('a', 'version-changed'), row('b', 'removed')],
        compared_to: 'run rd-20261101-100000',
      }),
    ).toBe(
      '1 packages from 2 manifests: 0 new, 1 version-changed, 1 removed against run rd-20261101-100000.',
    );
  });
});

describe('AC-5 inventory edges', () => {
  it('AC-5: reads lockfiles with no package block or no resolved line as sourceless', () => {
    expect(lockfileSources('{}', 'package-lock.json').size).toBe(0);
    expect(lockfileSources('"hono@^4.0.0":\n  version "4.0.5"\n', 'yarn.lock').size).toBe(0);
  });

  it('AC-5: a pubspec without a name and a go.mod without a module add no workspace name', async () => {
    const root = project({
      'pubspec.yaml': 'dependencies:\n  http: ^1.0.0\n',
      'go.mod': 'require example.com/x v1.0.0\n',
    });
    const inv = await buildStackInventory({
      projectRoot: root,
      runId: RUN,
      frameworks: [],
      env: {},
    });
    expect(find(inv, 'http').private).toBe(false);
    expect(find(inv, 'example.com/x').private).toBe(false);
    expect(Date.parse(inv.generated_at)).not.toBeNaN();
  });

  it('AC-5: an empty constraint is unknown, never private, and lists one row per manifest', async () => {
    const root = project({
      'package.json': JSON.stringify({ dependencies: { zod: '' } }),
      'web/package.json': JSON.stringify({ dependencies: { zod: '^3.0.0' } }),
    });
    const inv = await buildStackInventory({
      projectRoot: root,
      runId: RUN,
      now: NOW,
      frameworks: [],
      env: {},
    });
    const rows = inv.packages.filter((pkg) => pkg.name === 'zod');
    expect(rows.map((pkg) => [pkg.manifest, pkg.declared, pkg.private])).toEqual([
      ['package.json', null, false],
      ['web/package.json', '^3.0.0', false],
    ]);
  });

  it('AC-5: an unknown version on either side does not count as a version change', async () => {
    const root = project({
      'package.json': JSON.stringify({
        dependencies: { zod: '^3.0.0', hono: '^4.0.0', react: '^18.0.0' },
      }),
      'package-lock.json': JSON.stringify({
        packages: { 'node_modules/hono': { version: '4.1.0' } },
      }),
      [RULES_DISCOVERY_BASELINE]: JSON.stringify({
        schema_version: 1,
        source: 'run',
        inventory: null,
        run_id: null,
        seeded_from: null,
        updated_at: NOW.toISOString(),
        packages: [
          { name: 'zod', ecosystem: 'node', declared: null, installed: '3.0.0', dev: false },
          { name: 'hono', ecosystem: 'node', declared: '^4.0.0', installed: null, dev: false },
          { name: 'react', ecosystem: 'node', declared: '^17.0.0', installed: null, dev: false },
        ],
      }),
    });
    const inv = await buildStackInventory({
      projectRoot: root,
      runId: RUN,
      now: NOW,
      frameworks: [],
      env: {},
    });
    expect(find(inv, 'zod').status).toBe('unchanged');
    expect(find(inv, 'hono').status).toBe('unchanged');
    expect(find(inv, 'react').status).toBe('version-changed');
    expect(inv.compared_to).toBe(RULES_DISCOVERY_BASELINE);
  });
});
