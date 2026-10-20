import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { discoverModuleHealth, discoverSourceRoots } from '@/module-map/source-roots.js';

describe('module-map/source-roots discovery', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-source-roots-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeProfileFrameworks(frameworks: string[]): void {
    const yaml = `stack_profile:\n  frameworks:\n${frameworks
      .map((f) => `    - ${f}`)
      .join('\n')}\n`;
    writeFileSync(join(root, PATHS.PROJECT_PROFILE), yaml, 'utf8');
  }

  it('resolves source_roots from the active pack declared in the profile', () => {
    writeProfileFrameworks(['laravel']);

    const result = discoverSourceRoots(root);

    expect(result.pack_name).toBe('laravel');
    expect(result.reason).toBe('pack');
    expect(result.source_roots).toEqual(['app']);
  });

  it('returns the full module_health block for the active pack', () => {
    writeProfileFrameworks(['laravel']);

    const result = discoverModuleHealth(root);

    expect(result.pack_name).toBe('laravel');
    expect(result.module_health).not.toBeNull();
    expect(result.module_health?.source_roots).toEqual(['app']);
  });

  it('loads shipped packs even without a project profile (walk-all path)', () => {
    const result = discoverModuleHealth(root);

    expect(result.pack_name).not.toBeNull();
    expect(result.module_health).not.toBeNull();
  });
});
