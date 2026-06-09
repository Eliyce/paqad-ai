import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { BudgetAllocator } from '@/context/budget-allocator.js';
import { ContextHitTracker } from '@/context/hit-tracker.js';
import { RelevanceScorer } from '@/context/relevance-scorer.js';
import { detectEnvironmentTraits } from '@/introspection/environment-traits.js';
import { dartParser } from '@/introspection/ecosystems/dart.js';
import { pnpmParser } from '@/introspection/ecosystems/node-pnpm.js';
import {
  normalizeConstraint,
  parseKeyValueLines,
  readJson,
  readProjectFile,
} from '@/introspection/ecosystems/shared.js';
import { parseComposerProject } from '@/introspection/parsers/composer.js';
import { parseDartProject } from '@/introspection/parsers/dart.js';
import { parseNpmProject } from '@/introspection/parsers/npm.js';
import { parsePnpmProject } from '@/introspection/parsers/pnpm.js';
import { getServersForStack, McpServerRegistry } from '@/mcp/server-registry.js';

describe('coverage-focused helper branches', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('node:fs');
    vi.doUnmock('@/core/runtime-paths.js');
    vi.doUnmock('@/onboarding/manifest-writer.js');
    vi.doUnmock('@/index.js');
    vi.doUnmock('@/core/schema-version.js');
  });

  it('covers parser and ecosystem helper fallbacks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'paqad-helper-parsers-'));

    expect(readJson<{ ok: boolean }>('{"ok":true}')).toEqual({ ok: true });
    expect(readJson('nope')).toBeNull();
    expect(normalizeConstraint('^1.0.0')).toBe('^1.0.0');
    expect(normalizeConstraint(42)).toBe('42');
    expect(normalizeConstraint(false)).toBe('false');
    expect(normalizeConstraint({ sdk: 'flutter' })).toBe('sdk:flutter');
    expect(normalizeConstraint({ version: '^2.0.0' })).toBe('^2.0.0');
    expect(normalizeConstraint({ unsupported: true })).toBe('unknown');
    expect(
      parseKeyValueLines(
        ['FOO=bar', 'EMPTY=', '=missing', 'NOSEP', '# comment', ' BAR = baz '].join('\n'),
        '=',
      ),
    ).toEqual([
      { name: 'FOO', value: 'bar' },
      { name: 'BAR', value: 'baz' },
    ]);
    await expect(readProjectFile(root, 'missing.txt')).resolves.toBeNull();

    expect(pnpmParser.parseManifest('{invalid json').packages).toEqual([]);
    expect(pnpmParser.parseManifest('{invalid json').scripts).toEqual({});
    expect(
      pnpmParser.parseLockfile(['packages:', '  /bad-entry:', '    resolution: {}', ''].join('\n'))
        .packages,
    ).toEqual([]);
    expect(pnpmParser.parseLockfile('not: [valid').packages).toEqual([]);

    expect(
      dartParser.parseManifest(['dependencies:', '  custom:', '    weird: true', ''].join('\n'))
        .packages,
    ).toEqual([{ name: 'custom', constraint: 'unknown', isDev: false }]);
    expect(dartParser.parseManifest('[').packages).toEqual([]);
    expect(
      dartParser.parseLockfile(['packages:', '  dio:', '    source: hosted', ''].join('\n'))
        .packages,
    ).toEqual([]);
    expect(dartParser.parseLockfile('[').packages).toEqual([]);

    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({
        dependencies: { react: '^19.0.0' },
        devDependencies: { vitest: '^3.2.4' },
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
          locked_version: '^19.0.0',
          ecosystem: 'node',
          is_dev: false,
        },
        {
          name: 'vitest',
          version_constraint: '^3.2.4',
          locked_version: '^3.2.4',
          ecosystem: 'node',
          is_dev: true,
        },
      ],
    });

    await writeFile(
      join(root, 'pnpm-lock.yaml'),
      [
        'packages:',
        '  /react@19.0.0:',
        '    version: 19.0.0',
        '  ignored:',
        '    version: 1.0.0',
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
          name: 'react',
          version_constraint: '^19.0.0',
          locked_version: '19.0.0',
          ecosystem: 'node',
          is_dev: false,
        },
        {
          name: 'vitest',
          version_constraint: '^3.2.4',
          locked_version: '^3.2.4',
          ecosystem: 'node',
          is_dev: true,
        },
      ],
    });

    await writeFile(
      join(root, 'composer.json'),
      JSON.stringify({
        'require-dev': { 'pestphp/pest': '^3.0' },
      }),
    );
    await expect(parseComposerProject(root)).resolves.toEqual({
      toolchain: {
        ecosystem: 'php',
        package_manager: 'composer',
        lockfile: 'composer.lock',
      },
      packages: [
        {
          name: 'pestphp/pest',
          version_constraint: '^3.0',
          locked_version: '^3.0',
          ecosystem: 'php',
          is_dev: true,
        },
      ],
    });

    await writeFile(
      join(root, 'pubspec.yaml'),
      [
        'dependencies:',
        '  local_pkg:',
        '    path: ../local_pkg',
        'dev_dependencies:',
        '  test: ^1.0.0',
        '',
      ].join('\n'),
    );
    await expect(parseDartProject(root)).resolves.toEqual({
      toolchain: {
        ecosystem: 'dart',
        package_manager: 'pub',
        lockfile: 'pubspec.lock',
      },
      packages: [
        {
          name: 'local_pkg',
          version_constraint: 'unknown',
          locked_version: 'unknown',
          ecosystem: 'dart',
          is_dev: false,
        },
        {
          name: 'test',
          version_constraint: '^1.0.0',
          locked_version: '^1.0.0',
          ecosystem: 'dart',
          is_dev: true,
        },
      ],
    });
  });

  it('covers environment traits and context helper branches', async () => {
    const root = await mkdtemp(join(tmpdir(), 'paqad-helper-env-'));
    await mkdir(join(root, 'docker'), { recursive: true });
    await writeFile(join(root, 'compose.yaml'), 'services: {}');
    await writeFile(join(root, 'Dockerfile.dev'), 'FROM node:22');
    await writeFile(join(root, 'package.json'), '{"scripts":{"up":"vendor/bin/sail up"}}');

    expect(detectEnvironmentTraits(root)).toMatchObject({
      traits: ['compose', 'docker', 'sail'],
    });

    const depRoot = await mkdtemp(join(tmpdir(), 'paqad-helper-env-dep-'));
    await writeFile(join(depRoot, 'composer.json'), '{"require":{"laravel/sail":"^1.0"}}');
    expect(detectEnvironmentTraits(depRoot, { packageNames: ['laravel/sail'] })).toMatchObject({
      traits: ['sail'],
    });

    const allocator = new BudgetAllocator();
    expect(allocator.allocate(101)).toEqual({
      critical_budget: 40,
      task_relevant_budget: 45,
      supporting_budget: 15,
    });
    expect(
      allocator
        .packChunks(
          [
            {
              id: '1',
              content: '1234',
              source_file: 'a',
              ast_node_type: 'function',
              ast_node_path: 'a',
              exported_symbols: [],
              char_count: 4,
              content_hash: 'a',
            },
            {
              id: '2',
              content: '1234',
              source_file: 'b',
              ast_node_type: 'function',
              ast_node_path: 'b',
              exported_symbols: [],
              char_count: 4,
              content_hash: 'b',
            },
          ],
          1,
          () => 1,
        )
        .map((chunk) => chunk.id),
    ).toEqual(['1']);

    const scorer = new RelevanceScorer();
    const ranked = scorer.filterAndRank(
      [
        {
          id: 'same-parent',
          source_file: '/repo/app/foo/file.ts',
          ast_node_type: 'function',
          ast_node_path: 'Class>method>deep>path>node>leaf',
          exported_symbols: [],
          content: 'alpha SymbolRef',
          char_count: 10,
          content_hash: '1',
        },
        {
          id: 'same-name',
          source_file: '/repo/lib/foo/file.ts',
          ast_node_type: 'function',
          ast_node_path: 'node',
          exported_symbols: [],
          content: 'alpha',
          char_count: 5,
          content_hash: '2',
        },
      ],
      {
        keywords: ['alpha'],
        symbolReferences: ['SymbolRef'],
        targetFilePath: '/repo/src/foo/other.ts',
        sessionStartMs: Date.now(),
      },
    );
    expect(ranked.chunks.map((chunk) => chunk.id).sort()).toEqual(['same-name', 'same-parent']);

    const zeroLoaded = new ContextHitTracker('session-1', 'analysis');
    expect(zeroLoaded.computeHitRate()).toMatchObject({
      hit_rate: 0,
      files_loaded: 0,
      files_referenced: 0,
      phase: 'analysis',
    });

    const tracker = new ContextHitTracker({
      session_id: 'session-2',
      phase: 'review',
      story: 'S1',
    });
    tracker.recordLoaded(['a.ts', 'b.ts']);
    tracker.recordReferenced('a.ts');
    expect(tracker.computeHitRate()).toMatchObject({
      hit_rate: 0.5,
      unreferenced_files: ['b.ts'],
      story: 'S1',
    });
    tracker.reset();
    expect(tracker.computeHitRate().files_loaded).toBe(0);
  });

  it('covers bootstrap race recovery and MCP registry dedupe branches', async () => {
    expect(getServersForStack('short-video', [])).toEqual([]);

    const registry = new McpServerRegistry();
    expect(registry.list()).not.toBe(registry.list());
    expect(
      registry.forProfile({
        active_capabilities: ['content'],
        stack_profile: {
          frameworks: ['short-video'],
          traits: [],
          toolchains: [],
          version_bands: [],
          sources: [],
        },
        mcp: { servers: [] },
      }),
    ).toEqual([]);

    const merged = registry.forProfile({
      active_capabilities: ['content', 'coding', 'security'],
      stack_profile: {
        frameworks: ['react', 'vue'],
        traits: ['tailwind'],
        toolchains: [],
        version_bands: [],
        sources: [],
      },
      mcp: { servers: [] },
    });
    expect(merged.find((server) => server.name === 'figma')?.stacks.sort()).toEqual([
      'react',
      'vue',
    ]);
    expect(merged.find((server) => server.name === 'tailwind-mcp')?.capabilities).toEqual([
      'tailwind',
    ]);

    vi.resetModules();
    const frameworkHome = '/tmp/mock-framework-home';
    const runtimeRoot = '/tmp/mock-runtime-root';
    let linked = false;

    vi.doMock('node:fs', () => ({
      existsSync: (target: string) => target === frameworkHome && linked,
      lstatSync: () => ({ isSymbolicLink: () => true }),
      mkdirSync: vi.fn(),
      readlinkSync: () => runtimeRoot,
      rmSync: vi.fn(),
      symlinkSync: () => {
        linked = true;
        const error = new Error('already exists') as Error & { code: string };
        error.code = 'EEXIST';
        throw error;
      },
    }));
    vi.doMock('@/core/runtime-paths.js', () => ({
      getRuntimeRoot: () => runtimeRoot,
    }));
    vi.doMock('@/onboarding/manifest-writer.js', () => ({
      resolveFrameworkInstallPath: () => frameworkHome,
      writeFrameworkMetadata: vi.fn(),
    }));
    vi.doMock('@/index.js', () => ({
      VERSION: 'test-version',
    }));
    vi.doMock('@/core/schema-version.js', () => ({
      ensureSchemaMarkerSync: vi.fn(),
    }));

    const { bootstrapFramework } = await import('@/install/bootstrap.js');
    expect(bootstrapFramework('/tmp/project-root')).toEqual({
      framework_home: frameworkHome,
      project_root: '/tmp/project-root',
      version: 'test-version',
    });
  });
});
