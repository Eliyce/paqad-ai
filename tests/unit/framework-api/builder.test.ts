import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { StackSnapshot } from '@/core/types/introspection.js';
import { FrameworkApiAdapterRegistry } from '@/framework-api/adapters/registry.js';
import { nodeFrameworkApiAdapter } from '@/framework-api/adapters/node.js';
import { buildFrameworkApiIndex } from '@/framework-api/builder.js';
import { validateFrameworkApiIndex } from '@/framework-api/schema.js';
import { writeFrameworkApiIndex } from '@/framework-api/store.js';

let root: string;
const now = () => new Date('2026-01-01T00:00:00.000Z');

function snapshotOf(
  packages: { name: string; ecosystem?: string; root?: string }[],
): StackSnapshot {
  return {
    packages: packages.map((entry) => ({
      name: entry.name,
      version_constraint: '^1.0.0',
      // Deliberately a RANGE, exactly as the real snapshot stores it: the builder must
      // ignore this and read the resolved version from the install tree instead (FR-2).
      locked_version: '^1.0.0',
      ecosystem: (entry.ecosystem ?? 'node') as StackSnapshot['packages'][number]['ecosystem'],
      is_dev: false,
      root: entry.root,
    })),
  } as StackSnapshot;
}

function installReactLike(base: string, version: string, declarations: string): void {
  const dir = join(base, 'node_modules', 'react');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'react', version, types: './index.d.ts' }),
  );
  writeFileSync(join(dir, 'index.d.ts'), declarations);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-framework-api-builder-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('buildFrameworkApiIndex', () => {
  it('keys an entry by the RESOLVED version, not the manifest range (AC-1, FR-2)', () => {
    installReactLike(root, '19.2.6', 'export declare function useId(): string;');
    const { index } = buildFrameworkApiIndex(root, {
      snapshot: snapshotOf([{ name: 'react' }]),
      now,
    });
    expect(index.packages).toHaveLength(1);
    expect(index.packages[0]).toMatchObject({ package: 'react', version: '19.2.6', root: '.' });
    expect(validateFrameworkApiIndex(index).valid).toBe(true);
  });

  it('ignores dependencies that are not detected frameworks', () => {
    const { index } = buildFrameworkApiIndex(root, {
      snapshot: snapshotOf([{ name: 'lodash' }]),
      now,
    });
    expect(index.packages).toHaveLength(0);
    expect(index.blocked).toHaveLength(0);
  });

  it('searches the manifest root the dependency was declared under', () => {
    // The monorepo case this repo has: react is installed beside graph-ui.
    installReactLike(join(root, 'graph-ui'), '19.2.6', 'export declare function useId(): string;');
    const { index } = buildFrameworkApiIndex(root, {
      snapshot: snapshotOf([{ name: 'react', root: 'graph-ui' }]),
      now,
    });
    expect(index.packages[0]).toMatchObject({ version: '19.2.6', root: 'graph-ui' });
  });

  it('indexes a package listed twice by the snapshot only once', () => {
    installReactLike(root, '19.2.6', 'export declare function useId(): string;');
    const { index } = buildFrameworkApiIndex(root, {
      snapshot: snapshotOf([{ name: 'react' }, { name: 'react' }]),
      now,
    });
    expect(index.packages).toHaveLength(1);
  });

  it('records a declared-but-uninstalled framework as blocked, never as checked', () => {
    const { index } = buildFrameworkApiIndex(root, {
      snapshot: snapshotOf([{ name: 'react' }]),
      now,
    });
    expect(index.packages).toHaveLength(0);
    expect(index.blocked[0]).toMatchObject({ package: 'react', reason: 'not-installed' });
  });

  it('records an ecosystem with no adapter as blocked, leaving the #398 slot open (FR-14)', () => {
    const { index } = buildFrameworkApiIndex(root, {
      snapshot: snapshotOf([{ name: 'laravel/framework', ecosystem: 'php' }]),
      now,
    });
    expect(index.blocked[0]).toMatchObject({
      package: 'laravel/framework',
      reason: 'no-adapter',
    });
    expect(index.blocked[0]?.detail).toContain('php');
  });

  it("records an adapter refusal with the adapter's own reason", () => {
    // react installed but shipping no declarations at all.
    const dir = join(root, 'node_modules', 'react');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'react', version: '19.2.6' }));
    const { index } = buildFrameworkApiIndex(root, {
      snapshot: snapshotOf([{ name: 'react' }]),
      now,
    });
    expect(index.blocked[0]).toMatchObject({ package: 'react', reason: 'no-types' });
  });

  it('reuses a stored entry when the content address is unchanged (AC-7)', () => {
    installReactLike(root, '19.2.6', 'export declare function useId(): string;');
    const first = buildFrameworkApiIndex(root, { snapshot: snapshotOf([{ name: 'react' }]), now });
    expect(first.cacheHits).toBe(0);
    writeFrameworkApiIndex(root, first.index);

    const second = buildFrameworkApiIndex(root, { snapshot: snapshotOf([{ name: 'react' }]), now });
    expect(second.cacheHits).toBe(1);
    expect(second.index.packages).toEqual(first.index.packages);
  });

  it('re-walks when --force is passed even though nothing changed', () => {
    installReactLike(root, '19.2.6', 'export declare function useId(): string;');
    const first = buildFrameworkApiIndex(root, { snapshot: snapshotOf([{ name: 'react' }]), now });
    writeFrameworkApiIndex(root, first.index);
    const forced = buildFrameworkApiIndex(root, {
      snapshot: snapshotOf([{ name: 'react' }]),
      now,
      force: true,
    });
    expect(forced.cacheHits).toBe(0);
  });

  it('re-walks when the declarations changed under the same version', () => {
    installReactLike(root, '19.2.6', 'export declare function useId(): string;');
    const first = buildFrameworkApiIndex(root, { snapshot: snapshotOf([{ name: 'react' }]), now });
    writeFrameworkApiIndex(root, first.index);
    installReactLike(root, '19.2.6', 'export declare function useId2(): string;');
    const second = buildFrameworkApiIndex(root, { snapshot: snapshotOf([{ name: 'react' }]), now });
    expect(second.cacheHits).toBe(0);
    expect(second.index.packages[0]?.symbols.map((s) => s.name)).toContain('useId2');
  });

  it('produces an empty index when the project has no stack snapshot', () => {
    const { index } = buildFrameworkApiIndex(root, { snapshot: null, now });
    expect(index.packages).toHaveLength(0);
    expect(index.blocked).toHaveLength(0);
    expect(index.header.generated_at).toBe('2026-01-01T00:00:00.000Z');
  });

  it('sorts packages and blocked entries so the file is stable across runs', () => {
    installReactLike(root, '19.2.6', 'export declare function useId(): string;');
    const { index } = buildFrameworkApiIndex(root, {
      snapshot: snapshotOf([
        { name: 'vue' },
        { name: 'react' },
        { name: 'laravel/framework', ecosystem: 'php' },
      ]),
      now,
    });
    expect(index.blocked.map((entry) => entry.package)).toEqual(['laravel/framework', 'vue']);
  });

  it('stamps a real timestamp when no clock is injected', () => {
    const { index } = buildFrameworkApiIndex(root, { snapshot: null });
    expect(Number.isNaN(Date.parse(index.header.generated_at))).toBe(false);
  });

  it('reads the project snapshot when none is injected', () => {
    // No .paqad/stack-snapshot.json in a bare temp dir, so this exercises the default read.
    const { index } = buildFrameworkApiIndex(root, { now });
    expect(index.packages).toHaveLength(0);
  });

  it('honours an injected registry, which is how #398 will add ecosystems', () => {
    installReactLike(root, '19.2.6', 'export declare function useId(): string;');
    const empty = new FrameworkApiAdapterRegistry();
    const { index } = buildFrameworkApiIndex(root, {
      snapshot: snapshotOf([{ name: 'react' }]),
      registry: empty,
      now,
    });
    expect(index.blocked[0]?.reason).toBe('no-adapter');

    const withNode = new FrameworkApiAdapterRegistry([nodeFrameworkApiAdapter]);
    expect(withNode.get('node')).toBe(nodeFrameworkApiAdapter);
    expect(withNode.get('php')).toBeNull();
    expect(withNode.list()).toEqual([nodeFrameworkApiAdapter]);
  });
});
