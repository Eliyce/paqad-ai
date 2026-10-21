import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createModuleHealthCommand } from '@/cli/commands/module-health.js';

describe('module-health rollup entry points', () => {
  let root: string;
  let out: string[];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-mh-cli-'));
    out = [];
    process.exitCode = 1;
    vi.spyOn(console, 'log').mockImplementation((line?: unknown) => void out.push(String(line)));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = 0;
    rmSync(root, { recursive: true, force: true });
  });

  async function run(args: string[]): Promise<void> {
    await createModuleHealthCommand().parseAsync([...args, '--project-root', root], {
      from: 'user',
    });
  }

  it.each([
    [['sync', '--from-report', 'coverage/lcov.info']],
    [['sync', '--from-test-report', 'reports/junit.xml']],
    [['rollup']],
  ])('prints the rollup for %j and exits 0 when it is not blocked', async (args) => {
    await run(args);
    expect(JSON.parse(out[0]!)).toMatchObject({ blocked: null, modules: [] });
    expect(process.exitCode).toBe(0);
  });

  it.each([
    [['sync', '--from-report', 'coverage/lcov.info', '--silent']],
    [['rollup', '--silent']],
  ])('stays quiet with --silent for %j', async (args) => {
    await run(args);
    expect(out).toEqual([]);
    expect(process.exitCode).toBe(0);
  });
});
