import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  addActiveCapability,
  assertActiveCapability,
  isActiveCapability,
  listAvailableActiveCapabilities,
  normalizeActiveCapabilities,
  removeActiveCapability,
} from '@/core/capabilities.js';
import { getPackageRoot, getRuntimeRoot, getRuntimeTemplatesRoot } from '@/core/runtime-paths.js';

import { fixtureProfile } from '../adapters/shared.fixture.js';

describe('coverage core helpers', () => {
  it('covers capability listing, validation, normalization, add, and remove helpers', () => {
    expect(listAvailableActiveCapabilities()).toEqual(['content', 'coding']);
    expect(isActiveCapability('coding')).toBe(true);
    expect(isActiveCapability('security')).toBe(true);
    expect(isActiveCapability('unknown')).toBe(false);
    expect(assertActiveCapability('coding')).toBe('coding');
    expect(() => assertActiveCapability('unknown')).toThrow('Unknown capability "unknown"');
    expect(() => assertActiveCapability('security')).toThrow(
      'Capability "security" is dependency-managed and cannot be changed directly. Manage "coding" instead.',
    );

    expect(normalizeActiveCapabilities(['security'])).toEqual(['content']);
    expect(normalizeActiveCapabilities(['coding', 'security', 'coding'])).toEqual([
      'content',
      'coding',
      'security',
    ]);

    const profile = {
      ...fixtureProfile(),
      active_capabilities: ['content'] as const,
      stack_profile: {
        frameworks: ['laravel'],
        traits: [],
        toolchains: [],
        version_bands: [],
        sources: [],
      },
    };

    expect(addActiveCapability(profile as never, 'coding')).toMatchObject({
      active_capabilities: ['content', 'coding', 'security'],
    });
    expect(
      removeActiveCapability(
        { ...profile, active_capabilities: ['content', 'coding', 'security'] } as never,
        'security',
      ),
    ).toMatchObject({
      active_capabilities: ['content', 'coding', 'security'],
    });
    expect(
      removeActiveCapability(
        { ...profile, active_capabilities: ['content', 'coding', 'security'] } as never,
        'coding',
      ),
    ).toMatchObject({
      active_capabilities: ['content'],
      stack_profile: undefined,
    });
    expect(() => removeActiveCapability(profile as never, 'content')).toThrow(
      'content capability cannot be removed',
    );
  });

  it('returns package, runtime, and template roots', () => {
    const packageRoot = getPackageRoot();
    expect(packageRoot).toContain('paqad-ai');
    // Use platform-native join — production code uses path.join which uses
    // backslashes on Windows. The literal `${packageRoot}/runtime` would
    // fail cross-platform.
    expect(getRuntimeRoot()).toBe(join(packageRoot, 'runtime'));
    expect(getRuntimeTemplatesRoot()).toBe(join(packageRoot, 'runtime', 'templates'));
  });
});

describe('coverage bootstrap branches', () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.unmock('@/core/runtime-paths.js');
    vi.unmock('@/onboarding/manifest-writer.js');
    vi.unmock('@/index.js');
    vi.unmock('@/core/schema-version.js');
    vi.unmock('node:fs');
  });

  it('treats an EEXIST race on the expected symlink as success', async () => {
    const mkdirSync = vi.fn();
    const rmSync = vi.fn();
    const writeFrameworkMetadata = vi.fn();
    const lstatSync = vi.fn(() => ({ isSymbolicLink: () => true }));
    const readlinkSync = vi.fn(() => '/runtime/root');
    const existsSync = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(true);
    const symlinkSync = vi.fn(() => {
      const error = new Error('exists') as Error & { code: string };
      error.code = 'EEXIST';
      throw error;
    });

    vi.doMock('node:fs', () => ({
      existsSync,
      lstatSync,
      mkdirSync,
      readlinkSync,
      rmSync,
      symlinkSync,
    }));
    vi.doMock('@/core/runtime-paths.js', () => ({
      getRuntimeRoot: () => '/runtime/root',
    }));
    vi.doMock('@/onboarding/manifest-writer.js', () => ({
      resolveFrameworkInstallPath: () => '/framework/home',
      writeFrameworkMetadata,
    }));
    vi.doMock('@/index.js', () => ({
      VERSION: '1.2.3',
    }));
    vi.doMock('@/core/schema-version.js', () => ({
      ensureSchemaMarkerSync: vi.fn(),
    }));

    const { bootstrapFramework } = await import('@/install/bootstrap.js');
    const result = bootstrapFramework('/project/root');

    expect(result).toEqual({
      framework_home: '/framework/home',
      project_root: '/project/root',
      version: '1.2.3',
    });
    expect(rmSync).not.toHaveBeenCalled();
    expect(writeFrameworkMetadata).toHaveBeenCalledWith('/project/root', '1.2.3');
  });

  it('refuses to replace an existing directory after lstat failures', async () => {
    const mkdirSync = vi.fn();
    const rmSync = vi.fn();
    const writeFrameworkMetadata = vi.fn();
    const existsSync = vi.fn(() => true);
    const lstatSync = vi.fn(() => {
      return {
        isDirectory: () => true,
        isSymbolicLink: () => false,
      };
    });
    const readlinkSync = vi.fn();
    const symlinkSync = vi.fn();

    vi.doMock('node:fs', () => ({
      existsSync,
      lstatSync,
      mkdirSync,
      readlinkSync,
      rmSync,
      symlinkSync,
    }));
    vi.doMock('@/core/runtime-paths.js', () => ({
      getRuntimeRoot: () => '/runtime/root',
    }));
    vi.doMock('@/onboarding/manifest-writer.js', () => ({
      resolveFrameworkInstallPath: () => '/framework/home',
      writeFrameworkMetadata,
    }));
    vi.doMock('@/index.js', () => ({
      VERSION: '1.2.3',
    }));
    vi.doMock('@/core/schema-version.js', () => ({
      ensureSchemaMarkerSync: vi.fn(),
    }));

    const { bootstrapFramework } = await import('@/install/bootstrap.js');

    expect(() => bootstrapFramework('/project/root')).toThrow(
      'Refusing to replace existing framework home directory',
    );
    expect(rmSync).not.toHaveBeenCalled();
    expect(symlinkSync).not.toHaveBeenCalled();
    expect(writeFrameworkMetadata).not.toHaveBeenCalled();
  });

  it('rethrows unexpected symlink errors and treats lstat failures as non-matching paths', async () => {
    const mkdirSync = vi.fn();
    const rmSync = vi.fn();
    const writeFrameworkMetadata = vi.fn();
    const existsSync = vi.fn().mockReturnValue(true);
    const lstatSync = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('broken link');
      })
      .mockImplementationOnce(() => {
        return {
          isDirectory: () => false,
          isSymbolicLink: () => false,
        };
      })
      .mockImplementationOnce(() => {
        throw new Error('broken link');
      });
    const readlinkSync = vi.fn();
    const symlinkSync = vi.fn(() => {
      throw new Error('permission denied');
    });

    vi.doMock('node:fs', () => ({
      existsSync,
      lstatSync,
      mkdirSync,
      readlinkSync,
      rmSync,
      symlinkSync,
    }));
    vi.doMock('@/core/runtime-paths.js', () => ({
      getRuntimeRoot: () => '/runtime/root',
    }));
    vi.doMock('@/onboarding/manifest-writer.js', () => ({
      resolveFrameworkInstallPath: () => '/framework/home',
      writeFrameworkMetadata,
    }));
    vi.doMock('@/index.js', () => ({
      VERSION: '1.2.3',
    }));
    vi.doMock('@/core/schema-version.js', () => ({
      ensureSchemaMarkerSync: vi.fn(),
    }));

    const { bootstrapFramework } = await import('@/install/bootstrap.js');

    expect(() => bootstrapFramework('/project/root')).toThrow('permission denied');
    expect(rmSync).toHaveBeenCalledWith('/framework/home', { force: true, recursive: false });
    expect(writeFrameworkMetadata).not.toHaveBeenCalled();
  });
});
