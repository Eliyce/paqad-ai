import { afterEach, describe, expect, it } from 'vitest';

import { cleanTempDirs, runScript, writeTemp } from '../recipe-helpers.js';

afterEach(cleanTempDirs);

const run = (text: string) =>
  runScript('specification-recipe', 'check-spec.mjs', [writeTemp('spec.md', text)]);

const GOOD = `## Acceptance criteria

- AC-1: Given a user, when they save, then it lands (proof: automated).

## Edge cases

- EC-1: nothing to save.
`;

describe('check-spec.mjs', () => {
  it('passes flat ids in given, when, then form with edge cases', async () => {
    expect((await run(GOOD)).json).toMatchObject({ ok: true, errors: [] });
  });

  it('names a dotted id, a repeat, a bad form and a missing edge case section', async () => {
    const { json, exitCode } = await run(`## Acceptance criteria

- AC-1.1: Given a, when b, then c.
- AC-2: it works.
- AC-2: Given a, when b, then c.
`);
    expect(exitCode).toBe(1);
    const errors = json.errors.join('\n');
    expect(errors).toContain('AC-1.1 is not a flat AC-N id');
    expect(errors).toContain('AC-2 is not in given, when, then form');
    expect(errors).toContain('AC-2 appears twice');
    expect(errors).toContain('no "## Edge cases" section');
  });

  it('names a spec with no criteria', async () => {
    expect((await run('# Title\n')).json.errors).toEqual([
      'the spec has no "## Acceptance criteria" section',
    ]);
  });
});
