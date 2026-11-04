import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { cleanTempDirs, runScript, tempDir } from '../recipe-helpers.js';

afterEach(cleanTempDirs);

function project(): string {
  const root = tempDir();
  mkdirSync(join(root, 'docs/modules/hud/index'), { recursive: true });
  writeFileSync(join(root, 'docs/modules/hud/index/summary.md'), '# hud\n');
  return root;
}

const DOC = 'docs/modules/hud/index/summary.md';

describe('stale-docs.mjs', () => {
  it('lists a module doc whose code changed', async () => {
    const { json, exitCode } = await runScript(
      'documentation-sync-recipe',
      'stale-docs.mjs',
      [project()],
      'src/hud/snapshot.ts\n',
    );
    expect(exitCode).toBe(1);
    expect(json.stale).toEqual([DOC]);
  });

  it('passes when the doc changed too, was named, or nothing touches it', async () => {
    const root = project();
    const run = (args: string[], input: string) =>
      runScript('documentation-sync-recipe', 'stale-docs.mjs', [root, ...args], input);
    expect((await run([], `src/hud/snapshot.ts\n${DOC}\n`)).json.ok).toBe(true);
    expect((await run(['--ok', DOC], 'src/hud/snapshot.ts\n')).json.ok).toBe(true);
    expect((await run([], 'src/other/file.ts\n')).json.ok).toBe(true);
  });
});
