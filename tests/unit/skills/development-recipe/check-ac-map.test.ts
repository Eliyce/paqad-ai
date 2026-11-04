import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { cleanTempDirs, runScript, tempDir, writeTemp } from '../recipe-helpers.js';

afterEach(cleanTempDirs);

const SPEC = JSON.stringify({
  acceptance_criteria: [
    { id: 'AC-1', proof_type: 'automated' },
    { id: 'AC-12', proof_type: 'automated' },
    { id: 'AC-3', proof_type: 'manual' },
  ],
});

describe('check-ac-map.mjs', () => {
  it('passes when every automated criterion is named by a test', async () => {
    const root = tempDir();
    mkdirSync(join(root, 'tests'));
    writeFileSync(
      join(root, 'tests/a.test.ts'),
      "it('AC-1 works', () => {}); it('AC-12', () => {});",
    );
    const { json } = await runScript('development-recipe', 'check-ac-map.mjs', [
      writeTemp('spec.json', SPEC),
      root,
    ]);
    expect(json.ok).toBe(true);
  });

  it('does not read AC-12 as AC-1, and skips a manual criterion', async () => {
    const root = tempDir();
    writeFileSync(join(root, 'a.test.ts'), "it('AC-12 works', () => {});");
    const { json, exitCode } = await runScript('development-recipe', 'check-ac-map.mjs', [
      writeTemp('spec.json', SPEC),
      root,
    ]);
    expect(exitCode).toBe(1);
    expect(json.errors).toEqual(['AC-1 has no test that names it']);
  });
});
