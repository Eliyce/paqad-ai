import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createModuleMapCommand } from '@/cli/commands/module-map.js';
import { PATHS } from '@/core/constants/paths.js';

describe('module-map reconcile command', () => {
  let root: string;
  let out: string[];
  let err: string[];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-mm-cli-'));
    mkdirSync(join(root, 'docs/instructions/rules'), { recursive: true });
    mkdirSync(join(root, 'docs/modules/core'), { recursive: true });
    mkdirSync(join(root, 'src/core'), { recursive: true });
    writeFileSync(join(root, 'src/core/a.ts'), 'x');
    writeFileSync(
      join(root, PATHS.MODULE_MAP),
      'modules:\n  - slug: core\n    sources: [src/core]\n',
    );
    out = [];
    err = [];
    process.exitCode = 0;
    vi.spyOn(console, 'log').mockImplementation((line?: unknown) => void out.push(String(line)));
    vi.spyOn(console, 'error').mockImplementation((line?: unknown) => void err.push(String(line)));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = 0;
    rmSync(root, { recursive: true, force: true });
  });

  async function run(args: string[]): Promise<void> {
    await createModuleMapCommand().parseAsync(['reconcile', ...args, '--project-root', root], {
      from: 'user',
    });
  }

  it('reports a clean map and writes the drift report', async () => {
    await run(['--source-roots', 'src, ', '--file-extensions', '.ts,']);
    expect(out).toEqual(['No module-map drift detected.']);
    expect(existsSync(join(root, PATHS.MODULE_MAP_DRIFT))).toBe(true);
  });

  it('lists finding counts and fails on drift when asked, without writing', async () => {
    writeFileSync(join(root, 'src/stray.ts'), 'x');
    await run(['--source-roots', 'src', '--fail-on-drift', '--no-write']);
    expect(out).toEqual(['Found 1 drift finding(s):', '  MM-ADD: 1']);
    expect(process.exitCode).toBe(1);
    expect(existsSync(join(root, PATHS.MODULE_MAP_DRIFT))).toBe(false);
  });

  it('explains a blocked run and prints JSON when asked', async () => {
    await run([]);
    expect(err[0]).toBe('Reconciler blocked: source_roots_unknown.');

    out = [];
    await run(['--source-roots', 'src', '--json']);
    expect(JSON.parse(out[0]!)).toMatchObject({ blocked: null, findings: [] });
  });
});
