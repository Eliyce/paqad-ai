import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
// Use posix.join so test paths use forward slashes on every platform —
// matches what fast-glob (used by RagFileFilter) returns. Node's fs APIs
// accept mixed separators on Windows, so setup calls (writeFileSync, mkdirSync)
// still work. See https://github.com/Eliyce/paqad-ai/issues/17.
import { posix } from 'node:path';

const { join } = posix;

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LoadedStackPack } from '@/core/types/pack.js';
import { PATHS } from '@/core/constants/paths.js';
import { clearEngineLogger, setEngineLogger } from '@/core/logger-registry.js';
import { toPosixPath } from '@/core/path-utils.js';
import type { EngineLogEntry } from '@/core/types/logger.js';
import { RagFileFilter } from '@/rag/file-filter.js';

/** Installs a recording engine logger and returns the entries it receives. */
function captureEngineLogs(): EngineLogEntry[] {
  const entries: EngineLogEntry[] = [];
  setEngineLogger({ log: (entry) => void entries.push(entry) });
  return entries;
}

function createPack(options?: {
  extensions?: string[];
  excludeDirectories?: string[];
  basenameIncludes?: string[];
}): LoadedStackPack {
  return {
    manifest: {
      name: 'test-pack',
      display_name: 'Test Pack',
      ecosystem: 'test',
      version: '1.0.0',
      description: 'Test',
      maintainer: 'Test',
      detection: { heuristics: [{ file: 'package.json' }] },
      ast: options?.extensions
        ? { language: 'ts', tree_sitter_grammar: 'ts', file_extensions: options.extensions }
        : undefined,
      rag:
        options?.excludeDirectories || options?.basenameIncludes
          ? {
              exclude_directories: options.excludeDirectories,
              basename_includes: options.basenameIncludes,
            }
          : undefined,
    },
    root: '/pack',
    manifestPath: '/pack/pack.yaml',
    source: 'built-in',
    validation: { valid: true, issues: [] },
  };
}

function writeProjectFile(root: string, path: string, content: string) {
  const target = join(root, path);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, content);
  return target;
}

function writeText(root: string, path: string, label = path) {
  return writeProjectFile(root, path, `${label}\n${'x'.repeat(80)}\n`);
}

function writeRagConfig(root: string, body: string) {
  writeProjectFile(root, PATHS.RAG_IGNORE_CONFIG, body);
}

describe('RagFileFilter', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    clearEngineLogger();
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function makeRoot() {
    // Posix-normalize so join(root, ...) expectations match the posix paths
    // discoverFiles returns (mkdtempSync emits backslashes on Windows).
    const root = toPosixPath(mkdtempSync(join(tmpdir(), 'paqad-rag-filter-')));
    tempRoots.push(root);
    return root;
  }

  it('admits base and pack extensions, named basenames, and variant filenames', async () => {
    const root = makeRoot();
    writeText(root, 'README.MD', 'readme');
    writeText(root, 'src/app.ts', 'app');
    writeText(root, 'resources/views/layout.blade.php', 'blade');
    writeText(root, 'Dockerfile.dev', 'docker');
    writeText(root, '.editorconfig', 'editor');
    writeText(root, 'dockerfile', 'lowercase');
    writeText(root, 'image.png', 'png');

    const filter = new RagFileFilter({
      projectRoot: root,
      packs: [createPack({ extensions: ['.ts', '.blade.php'] })],
    });

    const files = await filter.discoverFiles();

    expect(files).toContain(join(root, 'README.MD'));
    expect(files).toContain(join(root, 'src/app.ts'));
    expect(files).toContain(join(root, 'resources/views/layout.blade.php'));
    expect(files).toContain(join(root, 'Dockerfile.dev'));
    expect(files).toContain(join(root, '.editorconfig'));
    expect(files).not.toContain(join(root, 'dockerfile'));
    expect(files).not.toContain(join(root, 'image.png'));
  });

  it('admits project-config extensions and basenames only when both layers allow them', async () => {
    const root = makeRoot();
    writeRagConfig(
      root,
      [
        'version: 1',
        'additional_extensions:',
        '  - .sql',
        'additional_basename_includes:',
        '  - .env.example',
        'include:',
        '  - .env.example',
      ].join('\n'),
    );
    writeText(root, 'db/schema.sql', 'sql');
    writeText(root, '.env.example', 'env example');

    const filter = new RagFileFilter({
      projectRoot: root,
      packs: [],
    });

    const files = await filter.discoverFiles();

    expect(files).toContain(join(root, 'db/schema.sql'));
    expect(files).toContain(join(root, '.env.example'));
  });

  it('excludes framework output, AI tool state, lockfiles, adapter files, and hard exclusions from config', async () => {
    const root = makeRoot();
    writeRagConfig(
      root,
      [
        'version: 1',
        'additional_named_file_exclusions:',
        '  - README.md',
        'include:',
        '  - README.md',
      ].join('\n'),
    );
    writeText(root, '.paqad/session/state.json', 'state');
    writeText(root, '.codex/history.md', 'history');
    writeText(root, 'package-lock.json', 'lock');
    writeText(root, 'README.md', 'readme');
    writeProjectFile(
      root,
      PATHS.ONBOARDING_MANIFEST,
      JSON.stringify({
        generated_artifacts: [{ path: 'AGENTS.md', auto_update: true }],
      }),
    );
    writeText(root, 'AGENTS.md', 'agents');

    const filter = new RagFileFilter({
      projectRoot: root,
      packs: [],
    });

    const files = await filter.discoverFiles();
    expect(files).toEqual([]);

    await expect(filter.probeFile(join(root, '.codex/history.md'))).resolves.toMatchObject({
      excluded: true,
      layer: 2,
    });
    await expect(filter.probeFile(join(root, 'package-lock.json'))).resolves.toMatchObject({
      excluded: true,
      layer: 2,
    });
  });

  it('applies framework, pack, ignore-file, and project-config layer-3 exclusions with include override', async () => {
    const root = makeRoot();
    writeProjectFile(root, '.gitignore', 'ignored.md\n');
    writeProjectFile(root, 'packages/app/.gitignore', 'nested.md\n');
    writeRagConfig(
      root,
      ['version: 1', 'exclude:', '  - custom/**', 'include:', '  - custom/keep.md'].join('\n'),
    );
    writeText(root, 'node_modules/pkg/readme.md', 'node_modules');
    writeText(root, 'packages/app/nested.md', 'nested');
    writeText(root, 'ignored.md', 'ignored');
    writeText(root, 'generated/pack.md', 'pack');
    writeText(root, 'custom/drop.md', 'drop');
    writeText(root, 'custom/keep.md', 'keep');

    const filter = new RagFileFilter({
      projectRoot: root,
      packs: [createPack({ excludeDirectories: ['generated'] })],
    });

    const files = await filter.discoverFiles();

    expect(files).not.toContain(join(root, 'node_modules/pkg/readme.md'));
    expect(files).not.toContain(join(root, 'packages/app/nested.md'));
    expect(files).not.toContain(join(root, 'ignored.md'));
    expect(files).not.toContain(join(root, 'generated/pack.md'));
    expect(files).not.toContain(join(root, 'custom/drop.md'));
    expect(files).toContain(join(root, 'custom/keep.md'));
  });

  it('ignores negation rules in nested gitignores without warning', async () => {
    const root = makeRoot();
    const logs = captureEngineLogs();
    writeProjectFile(root, 'storage/logs/.gitignore', '*\n!.gitignore\n');
    writeText(root, 'storage/logs/app.md', 'log');

    const filter = new RagFileFilter({
      projectRoot: root,
      packs: [],
    });

    await expect(filter.discoverFiles()).resolves.not.toContain(join(root, 'storage/logs/app.md'));
    expect(logs).toHaveLength(0);
  });

  it('emits discovery progress before and during filtering', async () => {
    const root = makeRoot();
    writeText(root, 'docs/one.md', 'one');
    writeText(root, 'docs/two.md', 'two');
    writeText(root, 'docs/three.md', 'three');
    writeText(root, 'image.png', 'png');
    const progress = vi.fn();

    const filter = new RagFileFilter({
      projectRoot: root,
      packs: [],
    });

    await filter.discoverFiles(progress);

    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'build',
        message: 'Discovering repository files for RAG eligibility',
      }),
    );
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Filtering 4 discovered files with RAG rules'),
        loaded: 0,
        total: 4,
        percent: 0,
      }),
    );
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('RAG file filtering kept 3 eligible files'),
        percent: 100,
      }),
    );
  });

  it('can skip project ignore files when configured', async () => {
    const root = makeRoot();
    writeProjectFile(root, '.gitignore', 'README.md\n');
    writeRagConfig(root, ['version: 1', 'use_project_ignore_files: false'].join('\n'));
    writeText(root, 'README.md', 'readme');

    const filter = new RagFileFilter({
      projectRoot: root,
      packs: [],
    });

    await expect(filter.discoverFiles()).resolves.toContain(join(root, 'README.md'));
  });

  it('falls back safely when rag.ignore.yaml is invalid', async () => {
    const root = makeRoot();
    const logs = captureEngineLogs();
    writeRagConfig(root, 'version: nope\nexclude: [docs/**]');
    writeText(root, 'docs/guide.md', 'guide');

    const filter = new RagFileFilter({
      projectRoot: root,
      packs: [],
    });

    await expect(filter.discoverFiles()).resolves.toContain(join(root, 'docs/guide.md'));
    expect(logs.some((entry) => entry.level === 'warn')).toBe(true);
  });

  it('falls back safely when rag.ignore.yaml cannot be parsed as yaml', async () => {
    const root = makeRoot();
    const logs = captureEngineLogs();
    writeRagConfig(root, 'version: [unterminated');
    writeText(root, 'docs/guide.md', 'guide');

    const filter = new RagFileFilter({
      projectRoot: root,
      packs: [],
    });

    await expect(filter.discoverFiles()).resolves.toContain(join(root, 'docs/guide.md'));
    expect(logs.some((entry) => entry.level === 'warn')).toBe(true);
  });

  it('applies size and content guards at layer 4', async () => {
    const root = makeRoot();
    writeText(root, 'docs/pass.md', 'pass');
    writeProjectFile(root, 'docs/empty.md', '');
    writeProjectFile(root, 'docs/short.md', 'tiny\n');
    writeProjectFile(root, 'docs/binary.md', `abc${String.fromCharCode(0)}def`);
    writeProjectFile(root, 'docs/large.md', `header\n${'x'.repeat(160000)}`);

    const filter = new RagFileFilter({
      projectRoot: root,
      packs: [],
      intelligence: { rag_max_file_size: 153600 },
    });

    const files = await filter.discoverFiles();

    expect(files).toContain(join(root, 'docs/pass.md'));
    expect(files).not.toContain(join(root, 'docs/empty.md'));
    expect(files).not.toContain(join(root, 'docs/short.md'));
    expect(files).not.toContain(join(root, 'docs/binary.md'));
    expect(files).not.toContain(join(root, 'docs/large.md'));
    await expect(filter.probeFile(join(root, 'docs/large.md'))).resolves.toMatchObject({
      excluded: true,
      layer: 4,
      rule: 'size-cap',
    });
  });

  it('does not treat NUL bytes after the first 8192 bytes as binary', async () => {
    const root = makeRoot();
    writeProjectFile(root, 'docs/late-nul.md', `${'x'.repeat(8200)}\0tail`);

    const filter = new RagFileFilter({
      projectRoot: root,
      packs: [],
    });

    await expect(filter.discoverFiles()).resolves.toContain(join(root, 'docs/late-nul.md'));
  });

  it('excludes soft env files, symlinks, nested directory patterns, and malformed onboarding manifests', async () => {
    const root = makeRoot();
    writeRagConfig(
      root,
      ['version: 1', 'additional_basename_includes:', '  - .env.local'].join('\n'),
    );
    writeProjectFile(root, '.ignore', ['logs/', 'nested/cache/', './', '!keep.md'].join('\n'));
    writeProjectFile(root, PATHS.ONBOARDING_MANIFEST, '{not-json');
    writeText(root, '.env.local', 'env');
    writeText(root, 'logs/ignored.md', 'logs');
    writeText(root, 'nested/cache/ignored.md', 'cache');
    writeText(root, 'storage/framework/cache.md', 'storage');
    writeText(root, 'AGENTS.md', 'agents');
    writeText(root, 'docs/real.md', 'real');
    symlinkSync(join(root, 'docs/real.md'), join(root, 'docs/link.md'));

    const filter = new RagFileFilter({
      projectRoot: root,
      packs: [createPack({ excludeDirectories: ['', 'storage/framework'] })],
    });

    const files = await filter.discoverFiles();

    expect(files).not.toContain(join(root, '.env.local'));
    expect(files).not.toContain(join(root, 'logs/ignored.md'));
    expect(files).not.toContain(join(root, 'nested/cache/ignored.md'));
    expect(files).not.toContain(join(root, 'storage/framework/cache.md'));
    expect(files).not.toContain(join(root, 'AGENTS.md'));
    expect(files).not.toContain(join(root, 'docs/link.md'));
    await expect(filter.probeFile(join(root, 'docs/link.md'))).resolves.toMatchObject({
      excluded: true,
      layer: 4,
      rule: 'symlink',
    });
    await expect(filter.probeFile(join(root, '.env.local'))).resolves.toMatchObject({
      excluded: true,
      layer: 3,
      rule: 'soft-env-exclusion',
    });
  });

  it('supports global gitignore opt-in and relative probe paths', async () => {
    const root = makeRoot();
    const home = makeRoot();
    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;
    process.env.HOME = home;
    // os.homedir() reads USERPROFILE on Windows; without this the global
    // gitignore files land outside the resolved home and are never applied.
    process.env.USERPROFILE = home;
    mkdirSync(join(home, '.config', 'git'), { recursive: true });
    writeProjectFile(home, '.gitignore_global', 'global.md\n');
    writeProjectFile(join(home, '.config', 'git'), 'ignore', 'config-global.md\n');
    writeRagConfig(
      root,
      ['version: 1', 'use_global_gitignore: true', 'exclude:', '  - /'].join('\n'),
    );
    writeText(root, 'global.md', 'global');
    writeText(root, 'config-global.md', 'config-global');
    writeText(root, 'docs/relative.md', 'relative');

    const filter = new RagFileFilter({
      projectRoot: root,
      packs: [],
    });

    const cwd = process.cwd();
    process.chdir(root);
    try {
      const files = await filter.discoverFiles();
      expect(files).not.toContain(join(root, 'global.md'));
      expect(files).not.toContain(join(root, 'config-global.md'));
      await expect(filter.probeFile('docs/relative.md')).resolves.toMatchObject({
        excluded: false,
      });
    } finally {
      process.chdir(cwd);
      process.env.HOME = previousHome;
      if (previousUserProfile === undefined) {
        delete process.env.USERPROFILE;
      } else {
        process.env.USERPROFILE = previousUserProfile;
      }
    }
  });

  it('supports directory-shaped project config globs', async () => {
    const root = makeRoot();
    writeRagConfig(
      root,
      ['version: 1', 'exclude:', '  - docs/', 'include:', '  - docs/keep.md'].join('\n'),
    );
    writeText(root, 'docs/drop.md', 'drop');
    writeText(root, 'docs/keep.md', 'keep');

    const filter = new RagFileFilter({
      projectRoot: root,
      packs: [],
    });

    const files = await filter.discoverFiles();
    expect(files).not.toContain(join(root, 'docs/drop.md'));
    expect(files).toContain(join(root, 'docs/keep.md'));
  });

  it('covers hard-file exclusions outside adapter output', async () => {
    const root = makeRoot();
    writeRagConfig(
      root,
      ['version: 1', 'additional_named_file_exclusions:', '  - generated.md'].join('\n'),
    );
    writeText(root, 'generated.md', 'generated');

    const filter = new RagFileFilter({
      projectRoot: root,
      packs: [],
    });

    await expect(filter.probeFile(join(root, 'generated.md'))).resolves.toMatchObject({
      excluded: true,
      layer: 2,
      rule: 'hard-file:generated.md',
    });
  });

  it('skips unreadable and invalid-utf8 files with warnings', async () => {
    const root = makeRoot();
    const logs = captureEngineLogs();
    const unreadablePath = writeText(root, 'docs/private.md', 'private');
    const invalidUtf8Path = writeProjectFile(
      root,
      'docs/latin.md',
      Buffer.from([0xff, 0xfe, 0xfd]),
    );

    chmodSync(unreadablePath, 0o000);

    const filter = new RagFileFilter({
      projectRoot: root,
      packs: [],
    });

    const files = await filter.discoverFiles();

    // chmod 0o000 does not block reads on Windows, so the file stays
    // legitimately readable (and admitted) there.
    if (process.platform !== 'win32') {
      expect(files).not.toContain(unreadablePath);
    }
    expect(files).not.toContain(invalidUtf8Path);
    expect(logs.some((entry) => entry.level === 'warn')).toBe(true);

    chmodSync(unreadablePath, 0o644);
  });

  it('exposes diagnostics, probe results, and preview output', async () => {
    const root = makeRoot();
    writeText(root, 'src/app.ts', 'app');
    writeText(root, 'docs/guide.md', 'guide');
    writeText(root, 'node_modules/pkg/readme.md', 'node_modules');

    const filter = new RagFileFilter({
      projectRoot: root,
      packs: [createPack({ extensions: ['.ts'], basenameIncludes: ['Procfile'] })],
    });

    const diagnostics = filter.filterDiagnostics();
    const discovered = await filter.discoverFiles();
    const preview = await filter.previewIndex();

    expect(diagnostics.extensionAllowlist).toEqual(expect.arrayContaining(['.md', '.ts']));
    expect(diagnostics.namedBasenameIncludes).toContain('Procfile');
    expect(diagnostics.directoryExclusionSet).toContain('node_modules');
    expect(diagnostics.hardNamedFileExclusionSet).toContain('package-lock.json');
    expect(discovered).toEqual(preview);
    await expect(filter.probeFile(join(root, 'node_modules/pkg/readme.md'))).resolves.toMatchObject(
      {
        excluded: true,
        layer: 3,
      },
    );
    await expect(filter.probeFile(join(root, 'src/app.ts'))).resolves.toMatchObject({
      excluded: false,
    });
    await expect(filter.probeFile(join(root, 'missing.md'))).resolves.toMatchObject({
      excluded: true,
      layer: 4,
      rule: 'not-found',
    });
  });

  it('respects explicit rag_max_file_size overrides', async () => {
    const root = makeRoot();
    writeProjectFile(root, 'docs/medium.md', `header\n${'x'.repeat(3000)}`);

    const filter = new RagFileFilter({
      projectRoot: root,
      packs: [],
      intelligence: { rag_max_file_size: 1024 },
    });

    await expect(filter.discoverFiles()).resolves.not.toContain(join(root, 'docs/medium.md'));
  });

  it('honors root .ignore style files', async () => {
    const root = makeRoot();
    writeProjectFile(root, '.ignore', 'docs/blocked.md\n');
    writeText(root, 'docs/blocked.md', 'blocked');
    writeText(root, 'docs/allowed.md', 'allowed');

    const filter = new RagFileFilter({
      projectRoot: root,
      packs: [],
    });

    const files = await filter.discoverFiles();
    expect(files).not.toContain(join(root, 'docs/blocked.md'));
    expect(files).toContain(join(root, 'docs/allowed.md'));
  });

  it('probeFile() uses a shared ignore-rule cache — readIgnoreRules is only called once across multiple probe calls', async () => {
    const root = makeRoot();
    writeProjectFile(root, '.gitignore', 'secrets/\n');
    writeText(root, 'docs/page.md', 'page');
    writeText(root, 'README.md', 'readme');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyFilter = new RagFileFilter({ projectRoot: root, packs: [] }) as any;

    // _layer3RulesCache is null before any probe
    expect(anyFilter._layer3RulesCache).toBeNull();

    await anyFilter.probeFile(join(root, 'docs/page.md'));

    // Cache is populated after the first call
    const firstCacheRef = anyFilter._layer3RulesCache;
    expect(firstCacheRef).not.toBeNull();

    await anyFilter.probeFile(join(root, 'README.md'));

    // Same Promise reference — readIgnoreRules was not called a second time
    expect(anyFilter._layer3RulesCache).toBe(firstCacheRef);
  });
});
