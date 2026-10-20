import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockExeca } = vi.hoisted(() => ({ mockExeca: vi.fn() }));

vi.mock('execa', () => ({ execa: mockExeca }));

import { assertSafeCloneSource, installPack } from '@/packs/manager';

describe('pack clone arguments', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-pack-clone-test-'));
    mockExeca.mockReset();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const options = () => ({
    projectRoot: root,
    roots: {
      runtimeRoot: join(root, 'runtime'),
      globalPacksRoot: join(root, 'global'),
      projectPacksRoot: join(root, 'project'),
      registryUrl: 'https://packs.example.com',
    },
  });

  it('passes the source after -- so git never reads it as an option', async () => {
    mockExeca.mockRejectedValue(new Error('clone failed'));
    await expect(installPack('https://example.com/pack.git', options())).rejects.toThrow(
      'clone failed',
    );
    expect(mockExeca).toHaveBeenCalledWith('git', [
      'clone',
      '--depth',
      '1',
      '--',
      'https://example.com/pack.git',
      expect.any(String),
    ]);
  });

  it('refuses an option-like source before running git', async () => {
    await expect(installPack('--upload-pack=touch pwned.git', options())).rejects.toThrow(
      /looks like an option/,
    );
    expect(mockExeca).not.toHaveBeenCalled();
  });

  it('accepts normal sources and rejects blank or dash-led ones', () => {
    expect(() => assertSafeCloneSource('git@github.com:org/pack.git')).not.toThrow();
    expect(() => assertSafeCloneSource('-c')).toThrow();
    expect(() => assertSafeCloneSource('  ')).toThrow();
  });
});
