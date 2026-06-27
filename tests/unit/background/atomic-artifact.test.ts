import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { atomicWriteFile, buildAndSwap } from '@/background/atomic-artifact.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'paqad-bg-atomic-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('buildAndSwap', () => {
  it('never exposes a half-written artifact: target is absent until the swap', async () => {
    const target = join(dir, 'nested', 'artifact.json');
    let targetExistedDuringBuild = true;

    await buildAndSwap(target, async (tempPath) => {
      // Mid-build the final path must not exist yet — only the temp does.
      targetExistedDuringBuild = existsSync(target);
      await writeFile(tempPath, '{"ok":true}', 'utf8');
      expect(existsSync(tempPath)).toBe(true);
      expect(existsSync(target)).toBe(false);
    });

    expect(targetExistedDuringBuild).toBe(false);
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe('{"ok":true}');
  });

  it('creates parent directories for the target', async () => {
    const target = join(dir, 'a', 'b', 'c', 'out.txt');
    await buildAndSwap(target, (tempPath) => writeFile(tempPath, 'hi', 'utf8'));
    expect(readFileSync(target, 'utf8')).toBe('hi');
  });

  it('does not produce the target when the build throws', async () => {
    const target = join(dir, 'out.txt');
    await expect(
      buildAndSwap(target, async () => {
        throw new Error('build failed');
      }),
    ).rejects.toThrow('build failed');
    expect(existsSync(target)).toBe(false);
  });

  it('gives concurrent builds distinct temp paths so they do not collide', async () => {
    const a = join(dir, 'a.txt');
    const b = join(dir, 'b.txt');
    const seenTemps: string[] = [];
    await Promise.all([
      buildAndSwap(a, async (tempPath) => {
        seenTemps.push(tempPath);
        await writeFile(tempPath, 'A', 'utf8');
      }),
      buildAndSwap(b, async (tempPath) => {
        seenTemps.push(tempPath);
        await writeFile(tempPath, 'B', 'utf8');
      }),
    ]);
    expect(new Set(seenTemps).size).toBe(2);
    expect(readFileSync(a, 'utf8')).toBe('A');
    expect(readFileSync(b, 'utf8')).toBe('B');
  });
});

describe('atomicWriteFile', () => {
  it('writes the content atomically and leaves no temp file behind', async () => {
    const target = join(dir, 'data.json');
    await atomicWriteFile(target, 'payload');
    expect(readFileSync(target, 'utf8')).toBe('payload');
    expect(readdirSync(dir)).toEqual(['data.json']);
  });

  it('overwrites an existing artifact in place', async () => {
    const target = join(dir, 'data.txt');
    await atomicWriteFile(target, 'old');
    await atomicWriteFile(target, 'new');
    expect(readFileSync(target, 'utf8')).toBe('new');
  });
});
