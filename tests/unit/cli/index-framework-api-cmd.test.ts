// `paqad-ai index framework-api build|query` (issue #397). The CLI surface of the
// installed framework-API index; the verdict logic itself is covered in
// tests/unit/framework-api/.

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createIndexCommand } from '@/cli/commands/index-cmd.js';
import { frameworkApiIndexPath, writeFrameworkApiIndex } from '@/framework-api/store.js';
import { FRAMEWORK_API_SCHEMA_VERSION, type FrameworkApiSymbol } from '@/framework-api/types.js';

function write(root: string, rel: string, body: string): void {
  const target = join(root, rel);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, body);
}

function symbol(overrides: Partial<FrameworkApiSymbol> & { name: string }): FrameworkApiSymbol {
  return {
    kind: 'function',
    exists: true,
    deprecated: false,
    message: null,
    since: null,
    for_removal: false,
    provenance: 'asserted',
    ...overrides,
  };
}

describe('paqad-ai index framework-api', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-cli-framework-api-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    rmSync(root, { recursive: true, force: true });
  });

  async function run(args: string[]): Promise<{ log: string[]; out: string[] }> {
    const log: string[] = [];
    const out: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => log.push(String(line)));
    vi.spyOn(console, 'error').mockImplementation((line: string) => log.push(String(line)));
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      out.push(String(chunk));
      return true;
    });
    await createIndexCommand().parseAsync(args, { from: 'user' });
    return { log, out };
  }

  /** A project whose snapshot names react, with react actually installed. */
  function withReact(
    version = '19.2.6',
    declarations = 'export declare function useId(): string;',
  ) {
    write(
      root,
      '.paqad/stack-snapshot.json',
      JSON.stringify({
        generated_at: '2026-01-01T00:00:00.000Z',
        source_hashes: {},
        toolchains: [],
        packages: [
          {
            name: 'react',
            version_constraint: '^19.0.0',
            locked_version: '^19.0.0',
            ecosystem: 'node',
            is_dev: false,
          },
        ],
        profile: { frameworks: [], traits: [], toolchains: [], version_bands: [], sources: [] },
      }),
    );
    write(
      root,
      'node_modules/react/package.json',
      JSON.stringify({ name: 'react', version, types: './index.d.ts' }),
    );
    write(root, 'node_modules/react/index.d.ts', declarations);
  }

  it('is registered as a subcommand of index', () => {
    const names = createIndexCommand().commands.map((command) => command.name());
    expect(names).toContain('framework-api');
  });

  it('builds the index and reports what it checked', async () => {
    withReact();
    const { log, out } = await run(['framework-api', 'build', '--project-root', root]);
    expect(log[0]).toContain('checked your installed frameworks for you');
    const summary = JSON.parse(out[0] ?? '{}') as { built: boolean; path: string; symbols: number };
    expect(summary.built).toBe(true);
    expect(summary.path).toBe(frameworkApiIndexPath(root));
    expect(summary.symbols).toBeGreaterThan(0);
    expect(process.exitCode).toBeUndefined();
  });

  it('reports a cache hit on an unchanged rebuild', async () => {
    withReact();
    await run(['framework-api', 'build', '--project-root', root, '--quiet']);
    const { out } = await run(['framework-api', 'build', '--project-root', root]);
    expect(JSON.parse(out[0] ?? '{}')).toMatchObject({ cache_hits: 1 });
  });

  it('re-walks under --force', async () => {
    withReact();
    await run(['framework-api', 'build', '--project-root', root, '--quiet']);
    const { out } = await run(['framework-api', 'build', '--project-root', root, '--force']);
    expect(JSON.parse(out[0] ?? '{}')).toMatchObject({ cache_hits: 0 });
  });

  it('suppresses the machine-readable line under --quiet', async () => {
    withReact();
    const { out } = await run(['framework-api', 'build', '--project-root', root, '--quiet']);
    expect(out).toEqual([]);
  });

  it('surfaces a skipped package with its reason rather than hiding it', async () => {
    // react named in the snapshot but never installed.
    write(
      root,
      '.paqad/stack-snapshot.json',
      JSON.stringify({
        generated_at: '2026-01-01T00:00:00.000Z',
        source_hashes: {},
        toolchains: [],
        packages: [
          {
            name: 'react',
            version_constraint: '^19.0.0',
            locked_version: '^19.0.0',
            ecosystem: 'node',
            is_dev: false,
          },
        ],
        profile: { frameworks: [], traits: [], toolchains: [], version_bands: [], sources: [] },
      }),
    );
    const { log, out } = await run(['framework-api', 'build', '--project-root', root]);
    expect(log.join('\n')).toContain('package(s) skipped');
    expect(log.join('\n')).toContain('react');
    expect(JSON.parse(out[0] ?? '{}')).toMatchObject({ blocked: 1, packages: 0 });
  });

  it('writes nothing and exits non-zero when the built index fails schema validation', async () => {
    // INV-4: a malformed index must fail loudly, never ship a shape a consumer mis-reads.
    withReact();
    const schema = await import('@/framework-api/schema.js');
    vi.spyOn(schema, 'validateFrameworkApiIndex').mockReturnValue({
      valid: false,
      errors: ['/packages/0 must have required property "version"'],
    });
    const { log } = await run(['framework-api', 'build', '--project-root', root]);
    expect(log.join('\n')).toContain('failed schema validation — not written');
    expect(log.join('\n')).toContain('must have required property');
    expect(existsSync(frameworkApiIndexPath(root))).toBe(false);
    expect(process.exitCode).toBe(1);
  });

  it('reports a live symbol and exits clean', async () => {
    withReact();
    await run(['framework-api', 'build', '--project-root', root, '--quiet']);
    const { log } = await run(['framework-api', 'query', 'react', 'useId', '--project-root', root]);
    expect(log[0]).toContain('🟢 useId exists in react@19.2.6');
    expect(process.exitCode).toBeUndefined();
  });

  it('reports a deprecated symbol and exits non-zero', async () => {
    withReact(
      '19.2.6',
      [
        '/** @deprecated 16.3, use useId; will be removed. */',
        'export declare function useUID(): string;',
      ].join('\n'),
    );
    await run(['framework-api', 'build', '--project-root', root, '--quiet']);
    const { log } = await run([
      'framework-api',
      'query',
      'react',
      'useUID',
      '--project-root',
      root,
    ]);
    expect(log.join('\n')).toContain('🔴 useUID is deprecated in react@19.2.6 since 16.3');
    expect(log.join('\n')).toContain('slated for removal');
    expect(process.exitCode).toBe(1);
  });

  it('reports an absent symbol with the nearest match and exits non-zero', async () => {
    withReact();
    await run(['framework-api', 'build', '--project-root', root, '--quiet']);
    const { log } = await run([
      'framework-api',
      'query',
      'react',
      'useIdd',
      '--project-root',
      root,
    ]);
    expect(log.join('\n')).toContain('🔴 useIdd does not exist');
    expect(log.join('\n')).toContain('Did you mean "useId"?');
    expect(process.exitCode).toBe(1);
  });

  it('says so plainly when nothing is close, rather than suggesting noise', async () => {
    withReact();
    await run(['framework-api', 'build', '--project-root', root, '--quiet']);
    const { log } = await run([
      'framework-api',
      'query',
      'react',
      'zzzzzzzzzzzz',
      '--project-root',
      root,
    ]);
    expect(log.join('\n')).toContain('No close match');
  });

  it('reports a dynamic member without claiming it is missing, and exits clean', async () => {
    writeFrameworkApiIndex(root, {
      schema_version: FRAMEWORK_API_SCHEMA_VERSION,
      header: { generated_at: '2026-01-01T00:00:00.000Z', schema_version: 1 },
      packages: [
        {
          package: 'react',
          version: '19.2.6',
          ecosystem: 'node',
          root: '.',
          content_hash: 'sha256:test',
          sources: [],
          symbols: [symbol({ name: 'Component.*', kind: 'member', provenance: 'unknown-dynamic' })],
        },
      ],
      blocked: [],
    });
    const { log } = await run([
      'framework-api',
      'query',
      'react',
      'Component.render',
      '--project-root',
      root,
    ]);
    expect(log.join('\n')).toContain('🟡 Component.render is provided dynamically');
    expect(log.join('\n')).toContain('not claiming it is missing');
    expect(process.exitCode).toBeUndefined();
  });

  it('reports an unindexed package without guessing', async () => {
    withReact();
    await run(['framework-api', 'build', '--project-root', root, '--quiet']);
    const { log } = await run(['framework-api', 'query', 'vue', 'ref', '--project-root', root]);
    expect(log.join('\n')).toContain('🟡 vue is not in the framework-API index');
    expect(process.exitCode).toBeUndefined();
  });

  it('tells the user to build first when no index exists, and exits 2', async () => {
    const { log } = await run(['framework-api', 'query', 'react', 'useId', '--project-root', root]);
    expect(log.join('\n')).toContain('no framework-API index yet');
    expect(process.exitCode).toBe(2);
  });

  it('emits the machine-readable result unless --quiet is passed', async () => {
    withReact();
    await run(['framework-api', 'build', '--project-root', root, '--quiet']);
    const { out } = await run(['framework-api', 'query', 'react', 'useId', '--project-root', root]);
    expect(JSON.parse(out[0] ?? '{}')).toMatchObject({ package: 'react', verdict: 'live' });

    const quiet = await run([
      'framework-api',
      'query',
      'react',
      'useId',
      '--project-root',
      root,
      '--quiet',
    ]);
    expect(quiet.out).toEqual([]);
  });
});
