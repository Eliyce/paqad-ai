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

  describe('with a module map', () => {
    const LIFECYCLE = 'docs/modules/cli-lifecycle/index/summary.md';

    function mapped(): string {
      const root = project();
      mkdirSync(join(root, 'docs/modules/cli-lifecycle/index'), { recursive: true });
      writeFileSync(join(root, LIFECYCLE), '# lifecycle\n');
      mkdirSync(join(root, 'docs/instructions/rules'), { recursive: true });
      writeFileSync(
        join(root, 'docs/instructions/rules/module-map.yml'),
        [
          'version: 2',
          'modules:',
          '  - slug: cli-lifecycle',
          '    summary: |',
          '      - not/a/source',
          '    sources:',
          '      - src/cli/commands/update.ts',
          '    features:',
          '      - slug: update',
          '        sources: [src/cli/commands/refresh.ts, src/update]',
          '    evidence:',
          '      symbols:',
          '        - src/not-a-source',
          '  - slug: hud',
          '    sources:',
          '      - src/hud/',
          '',
        ].join('\n'),
      );
      return root;
    }
    const check = (root: string, input: string, args: string[] = []) =>
      runScript('documentation-sync-recipe', 'stale-docs.mjs', [root, ...args], input);

    it.each(['src/cli/commands/update.ts', 'src/cli/commands/refresh.ts', 'src/update/updater.ts'])(
      'finds the doc of a module named only by the map: %s',
      async (file) => {
        const { json, exitCode } = await check(mapped(), `${file}\n`);
        expect(exitCode).toBe(1);
        expect(json.stale).toEqual([LIFECYCLE]);
      },
    );

    it('takes the update or the --ok for a mapped module', async () => {
      const root = mapped();
      expect((await check(root, `src/update/updater.ts\n${LIFECYCLE}\n`)).json.ok).toBe(true);
      expect((await check(root, 'src/update/updater.ts\n', ['--ok', LIFECYCLE])).json.ok).toBe(
        true,
      );
    });

    it.each([
      ['an empty list', ''],
      ['only docs', `${LIFECYCLE}\ndocs/other.md\n`],
      ['a file in no module', 'src/other/file.ts\n'],
      ['a source that only starts the same', 'src/update-helpers/x.ts\n'],
      ['a block scalar line', 'not/a/source\n'],
      ['a list that is not sources', 'src/not-a-source\n'],
      ['only tests', 'tests/unit/hud/snapshot.test.ts\nsrc/hud/snapshot.test.ts\n'],
      ['only records', '.paqad/ledger/feature-evidence/hud/x.json\n.claude/agents/hud.md\n'],
    ])('passes with nothing to sync: %s', async (_name, input) => {
      const { json, exitCode } = await check(mapped(), input);
      expect(json.stale).toEqual([]);
      expect(exitCode).toBe(0);
    });
  });

  it('falls back to the module name when the map cannot be read', async () => {
    const root = project();
    mkdirSync(join(root, 'docs/instructions/rules/module-map.yml'), { recursive: true });
    const { json } = await runScript(
      'documentation-sync-recipe',
      'stale-docs.mjs',
      [root],
      'src/hud/a.ts\n',
    );
    expect(json.stale).toEqual([DOC]);
  });
});
