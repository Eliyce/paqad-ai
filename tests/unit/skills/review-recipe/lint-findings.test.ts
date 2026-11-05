import { join } from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import { cleanTempDirs, runScript, writeTemp } from '../recipe-helpers.js';

afterEach(cleanTempDirs);

const SHELL = join(
  process.cwd(),
  'runtime/base/skills/adversarial-review/scripts/lint-findings.sh',
);

const MARKDOWN: ReadonlyArray<[string, string]> = [
  [
    'clean',
    '## Findings\n\n- **High**: bad. Required action: fix.\n- **Low**: meh. Required action: tidy.\n',
  ],
  ['no heading', '- **High**: bad. Required action: fix.\n'],
  ['no bullets', '## Findings\n\nnothing\n'],
  ['no severity', '## Findings\n\n- bad. Required action: fix.\n'],
  [
    'out of order',
    '## Findings\n\n- **Low**: a. Required action: x.\n- **High**: b. Required action: y.\n',
  ],
  ['no action', '## Findings\n\n- **High**: bad.\n'],
];

describe('lint-findings.mjs', () => {
  it.each(MARKDOWN)('gives the same verdict as the shell linter: %s', async (_name, text) => {
    const file = writeTemp('findings.md', text);
    const shell = await execa('bash', [SHELL, file], { reject: false });
    const { json } = await runScript('review-recipe', 'lint-findings.mjs', [file]);
    expect(json.ok).toBe(shell.exitCode === 0);
  });

  const template = (findings: unknown) =>
    runScript('review-recipe', 'lint-findings.mjs', [
      writeTemp('review.json', JSON.stringify({ findings })),
    ]);

  it('passes a review template in rank order, and one with no findings', async () => {
    const ordered = [
      { severity: 'blocker', description: 'a' },
      { severity: 'minor', description: 'b' },
    ];
    expect((await template(ordered)).json.ok).toBe(true);
    expect((await template([])).json.ok).toBe(true);
  });

  it('names a template out of order, or with a bad severity or no description', async () => {
    const { json, exitCode } = await template([
      { severity: 'minor', description: 'a' },
      { severity: 'blocker', description: '' },
      { severity: 'huge', description: 'c' },
    ]);
    expect(exitCode).toBe(1);
    const errors = json.errors.join('\n');
    expect(errors).toContain('severity out of order at: finding 2');
    expect(errors).toContain('finding 2 has no description');
    expect(errors).toContain('finding 3 has no severity');
  });
});
