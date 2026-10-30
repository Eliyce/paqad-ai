import { utimesSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { computeBuildOutputFingerprint, resolveBuildOutputs } from '@/checks/build-output.js';

import { writeRepoFile } from '../_helpers/git-repo.js';
import { useTempRoots } from '../_helpers/temp-roots.js';

describe('build output fingerprint', () => {
  const makeRoot = useTempRoots('paqad-build-output-');

  it('reads the build output folders the shipped packs declare', () => {
    const root = makeRoot();
    expect(resolveBuildOutputs(root, ['react'])).toEqual(['dist']);
    expect(resolveBuildOutputs(root, ['react', 'node-service'])).toEqual(['dist']);
    expect(resolveBuildOutputs(root, ['vue'])).toBeNull();
  });

  it('AC-8: is stable for the same files and changes with size, mtime or a new nested file', () => {
    const root = makeRoot();
    writeRepoFile(root, 'dist/index.js', 'a\n');
    writeRepoFile(root, 'dist/chunks/x.js', 'x\n');
    const base = computeBuildOutputFingerprint(root, ['dist/']);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(computeBuildOutputFingerprint(root, ['dist'])).toBe(base);
    const when = new Date('2030-01-01T00:00:00.000Z');
    utimesSync(join(root, 'dist/chunks/x.js'), when, when);
    const touched = computeBuildOutputFingerprint(root, ['dist']);
    expect(touched).not.toBe(base);
    writeRepoFile(root, 'dist/chunks/x.js', 'xx\n');
    utimesSync(join(root, 'dist/chunks/x.js'), when, when);
    expect(computeBuildOutputFingerprint(root, ['dist'])).not.toBe(touched);
    writeRepoFile(root, 'dist/chunks/y.js', '');
    expect(computeBuildOutputFingerprint(root, ['dist'])).not.toBe(touched);
  });

  it('AC-8: has no fingerprint without declared folders, or when a folder is missing or a file', () => {
    const root = makeRoot();
    writeRepoFile(root, 'dist/index.js', 'a\n');
    writeRepoFile(root, 'out', 'not a folder\n');
    expect(computeBuildOutputFingerprint(root, null)).toBeNull();
    expect(computeBuildOutputFingerprint(root, [])).toBeNull();
    expect(computeBuildOutputFingerprint(root, ['dist', 'build'])).toBeNull();
    expect(computeBuildOutputFingerprint(root, ['out'])).toBeNull();
  });
});
